'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryRetry } from '@/lib/apiClient';
import { track } from '@/lib/analyticsClient';
import * as api from './api';
import type {
  ChatLabMessageFeedback,
  ChatLabProject,
  ChatLabProjectDetail,
  ChatLabRequestType,
  ChatLabSession,
  ChatLabSessionDetailResponse,
  ChatLabStatsBucket,
  ChatLabStatsDimension,
} from '@/schemas/chatLab';

// Query keys, namespaced ['chatlab',…] so a single invalidate can target
// the whole feature, the session lists, one session, or the projects (mirrors
// feedbackKeys). Session lists carry a projectId dimension: 'general' is the
// project-free sidebar list; a project id scopes to that project's chats.
export const chatLabKeys = {
  all: ['chatlab'] as const,
  me: () => ['chatlab', 'me'] as const,
  models: () => ['chatlab', 'models'] as const,
  sessionsRoot: ['chatlab', 'sessions'] as const, // prefix matching ALL session lists
  sessions: (projectId?: string) => ['chatlab', 'sessions', projectId ?? 'general'] as const,
  session: (sessionId: string) => ['chatlab', 'session', sessionId] as const,
};

export const projectKeys = {
  projects: () => ['chatlab', 'projects'] as const,
  project: (projectId: string) => ['chatlab', 'project', projectId] as const,
};

// The `scope` dimension ('mine' | 'all') keeps the admin scope toggle's two
// views in separate cache slots so switching refetches with the right ?scope.
export const statsKeys = {
  all: ['chatlab', 'stats'] as const,
  summary: (from?: string, to?: string, scope = 'mine') =>
    ['chatlab', 'stats', 'summary', from ?? '', to ?? '', scope] as const,
  breakdown: (dimension: string, from?: string, to?: string, type?: string, scope = 'mine') =>
    ['chatlab', 'stats', 'breakdown', dimension, from ?? '', to ?? '', type ?? '', scope] as const,
  timeseries: (bucket: string, dimension: string, from?: string, to?: string, type?: string, scope = 'mine') =>
    ['chatlab', 'stats', 'timeseries', bucket, dimension, from ?? '', to ?? '', type ?? '', scope] as const,
  credits: () => ['chatlab', 'stats', 'credits'] as const,
};

// ---- Queries ---------------------------------------------------------------

/** The caller's identity + admin status — drives the admin chrome (view-as
 *  dropdown, stats scope toggle). Rendering hint only; the server re-enforces
 *  every decision. Rarely changes, so a long staleTime. */
export function useMe() {
  return useQuery({
    queryKey: chatLabKeys.me(),
    queryFn: api.fetchMe,
    staleTime: 5 * 60_000,
    retry: queryRetry,
  });
}

/** The filtered model catalog (server caches for 1h — mirror that here). The
 *  same fetch carries the lab config (feedback categories) — one shared query,
 *  two selecting hooks. */
export function useChatLabModels() {
  return useQuery({
    queryKey: chatLabKeys.models(),
    queryFn: api.fetchChatLabConfig,
    select: (data) => data.models,
    staleTime: 60 * 60_000,
    retry: queryRetry,
  });
}

/** The server-defined feedback category catalog (never hardcoded client-side). */
export function useChatLabFeedbackCategories() {
  return useQuery({
    queryKey: chatLabKeys.models(),
    queryFn: api.fetchChatLabConfig,
    select: (data) => data.feedbackCategories,
    staleTime: 60 * 60_000,
    retry: queryRetry,
  });
}

/** A session list: general chats by default, one project's chats when
 *  projectId is set. No SSE nudges for the chat lab (v1) — reconciliation
 *  happens via invalidation on send/navigate, plus refetch-on-focus for the
 *  second user's additions. */
export function useChatLabSessions(opts?: { projectId?: string }) {
  const projectId = opts?.projectId;
  return useQuery({
    queryKey: chatLabKeys.sessions(projectId),
    queryFn: () => api.fetchChatLabSessions(projectId),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: queryRetry,
  });
}

/** One session + its full message history. staleTime kept short so streaming
 *  reconciliation (invalidate after done/stop/error) refetches promptly. */
export function useChatLabSession(sessionId: string | null) {
  return useQuery({
    queryKey: chatLabKeys.session(sessionId ?? ''),
    queryFn: () => api.fetchChatLabSession(sessionId as string),
    enabled: !!sessionId,
    staleTime: 2_000,
    // While any message is still 'generating' (an in-flight video job), poll so
    // the finished video lands without a manual refresh — for the sender after a
    // tab close AND for the other user. Stops once nothing is generating.
    refetchInterval: (query) =>
      query.state.data?.messages.some((m) => m.status === 'generating') ? 10_000 : false,
    retry: queryRetry,
  });
}

/** All projects (sidebar + any picker). */
export function useChatLabProjects() {
  return useQuery({
    queryKey: projectKeys.projects(),
    queryFn: api.fetchChatLabProjects,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: queryRetry,
  });
}

/** One project's full detail (context, assets, sessions). Polls every 5s ONLY
 *  while the memory updater is running, so the Memory card livens without a
 *  standing interval. */
export function useChatLabProject(projectId: string | null) {
  return useQuery({
    queryKey: projectKeys.project(projectId ?? ''),
    queryFn: () => api.fetchChatLabProject(projectId as string),
    enabled: !!projectId,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.memoryStatus === 'updating' ? 5_000 : false),
    retry: queryRetry,
  });
}

// ---- Session mutations -------------------------------------------------------

export function useCreateChatLabSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId?: string) => api.createChatLabSession(projectId),
    onSuccess: (session: ChatLabSession) => {
      track('session_created');
      // Seed both caches so the new chat renders instantly on navigation.
      qc.setQueryData<ChatLabSession[]>(chatLabKeys.sessions(session.projectId ?? undefined), (old) => [
        session,
        ...(old ?? []),
      ]);
      qc.setQueryData<ChatLabSessionDetailResponse>(chatLabKeys.session(session.id), {
        session,
        project: null, // breadcrumb hydrates on the real fetch
        messages: [],
      });
      void qc.invalidateQueries({ queryKey: chatLabKeys.sessions(session.projectId ?? undefined) });
      if (session.projectId) {
        void qc.invalidateQueries({ queryKey: projectKeys.project(session.projectId) });
        void qc.invalidateQueries({ queryKey: projectKeys.projects() });
      }
    },
  });
}

export function useRenameChatLabSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      api.renameChatLabSession(sessionId, title),
    onSuccess: (session: ChatLabSession) => {
      qc.setQueryData<ChatLabSession[]>(chatLabKeys.sessions(session.projectId ?? undefined), (old) =>
        old?.map((s) => (s.id === session.id ? session : s)),
      );
      qc.setQueryData<ChatLabSessionDetailResponse | undefined>(chatLabKeys.session(session.id), (old) =>
        old ? { ...old, session } : old,
      );
      void qc.invalidateQueries({ queryKey: chatLabKeys.sessionsRoot });
      if (session.projectId) void qc.invalidateQueries({ queryKey: projectKeys.project(session.projectId) });
    },
  });
}

export function useDeleteChatLabSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.deleteChatLabSession(sessionId),
    onSuccess: (_data, sessionId) => {
      qc.removeQueries({ queryKey: chatLabKeys.session(sessionId) });
      // The session may live in any list (general or a project's) — refresh
      // them all plus the project caches (chat counts).
      void qc.invalidateQueries({ queryKey: chatLabKeys.sessionsRoot });
      void qc.invalidateQueries({ queryKey: projectKeys.projects() });
      qc.setQueriesData<ChatLabSession[]>({ queryKey: chatLabKeys.sessionsRoot }, (old) =>
        old?.filter((s) => s.id !== sessionId),
      );
    },
  });
}

// ---- Project mutations ---------------------------------------------------------

export function useCreateChatLabProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.CreateChatLabProjectBody) => api.createChatLabProject(body),
    onSuccess: (project: ChatLabProject) => {
      track('project_created');
      qc.setQueryData<ChatLabProject[]>(projectKeys.projects(), (old) => [project, ...(old ?? [])]);
      void qc.invalidateQueries({ queryKey: projectKeys.projects() });
    },
  });
}

export function useUpdateChatLabProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: api.UpdateChatLabProjectBody }) =>
      api.updateChatLabProject(projectId, body),
    onSuccess: (project: ChatLabProject) => {
      qc.setQueryData<ChatLabProject[]>(projectKeys.projects(), (old) =>
        old?.map((p) => (p.id === project.id ? project : p)),
      );
      qc.setQueryData<ChatLabProjectDetail | undefined>(projectKeys.project(project.id), (old) =>
        old ? { ...old, ...project } : old,
      );
      // Description/instructions edits fire the memory updater server-side —
      // refetch the detail so memoryStatus ('updating') starts the poll.
      void qc.invalidateQueries({ queryKey: projectKeys.project(project.id) });
      void qc.invalidateQueries({ queryKey: projectKeys.projects() });
    },
  });
}

export function useDeleteChatLabProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.deleteChatLabProject(projectId),
    onSuccess: (_data, projectId) => {
      qc.setQueryData<ChatLabProject[]>(projectKeys.projects(), (old) => old?.filter((p) => p.id !== projectId));
      qc.removeQueries({ queryKey: projectKeys.project(projectId) });
      qc.removeQueries({ queryKey: chatLabKeys.sessions(projectId) });
      void qc.invalidateQueries({ queryKey: projectKeys.projects() });
    },
  });
}

export function useRefreshChatLabMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.refreshChatLabProjectMemory(projectId),
    onSuccess: (_res, projectId) => {
      // Refetch the detail: memoryStatus flips to 'updating' → the 5s poll in
      // useChatLabProject takes over until it lands back on idle/error.
      void qc.invalidateQueries({ queryKey: projectKeys.project(projectId) });
    },
  });
}

// ---- Response feedback ---------------------------------------------------------

/** Upsert or remove the CALLER's feedback on an assistant message, updating
 *  the session detail cache in place (optimistic-ish: server responds fast and
 *  we reconcile on settle). */
export function useMessageFeedback(sessionId: string) {
  const qc = useQueryClient();

  const updateCache = (messageId: string, mutate: (fb: ChatLabMessageFeedback[]) => ChatLabMessageFeedback[]) => {
    qc.setQueryData<ChatLabSessionDetailResponse | undefined>(chatLabKeys.session(sessionId), (old) => {
      if (!old) return old;
      return {
        ...old,
        messages: old.messages.map((m) =>
          m.id === messageId ? { ...m, feedback: mutate(m.feedback ?? []) } : m,
        ),
      };
    });
  };

  const put = useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: api.PutFeedbackBody }) =>
      api.putMessageFeedback(messageId, body),
    onSuccess: (feedback, { messageId }) => {
      updateCache(messageId, (fb) => [...fb.filter((f) => !f.isMine), feedback]);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatLabKeys.session(sessionId) });
    },
  });

  const remove = useMutation({
    mutationFn: (messageId: string) => api.deleteMessageFeedback(messageId),
    onSuccess: (_res, messageId) => {
      updateCache(messageId, (fb) => fb.filter((f) => !f.isMine));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatLabKeys.session(sessionId) });
    },
  });

  return { put, remove };
}

// ---- Usage & spend analytics + credits -------------------------------------------

// `allUsers` maps to the admin-only ?scope=all aggregate view; default is the
// effective viewer's own usage.
export function useChatLabStatsSummary(range: api.StatsRange, allUsers = false) {
  return useQuery({
    queryKey: statsKeys.summary(range.from, range.to, allUsers ? 'all' : 'mine'),
    queryFn: () => api.fetchChatLabStatsSummary(range, allUsers),
    staleTime: 15_000,
    retry: queryRetry,
  });
}

/** Optional `type` filters rows by request_type (performance section only —
 *  spend queries stay unfiltered). */
export function useChatLabStatsBreakdown(
  dimension: ChatLabStatsDimension,
  range: api.StatsRange,
  type?: ChatLabRequestType,
  allUsers = false,
) {
  return useQuery({
    queryKey: statsKeys.breakdown(dimension, range.from, range.to, type, allUsers ? 'all' : 'mine'),
    queryFn: () => api.fetchChatLabStatsBreakdown(dimension, range, type, 50, allUsers),
    staleTime: 15_000,
    retry: queryRetry,
  });
}

export function useChatLabStatsTimeseries(
  bucket: ChatLabStatsBucket,
  dimension: 'none' | 'model' | 'kind',
  range: api.StatsRange,
  type?: ChatLabRequestType,
  allUsers = false,
) {
  return useQuery({
    queryKey: statsKeys.timeseries(bucket, dimension, range.from, range.to, type, allUsers ? 'all' : 'mine'),
    queryFn: () => api.fetchChatLabStatsTimeseries(bucket, dimension, range, type, allUsers),
    staleTime: 15_000,
    retry: queryRetry,
  });
}

export function useChatLabCredits() {
  return useQuery({
    queryKey: statsKeys.credits(),
    queryFn: api.fetchChatLabCredits,
    staleTime: 15_000,
    retry: queryRetry,
  });
}

/** Create/update/delete ledger entries. Every change reshapes the balance, so
 *  ALL stats queries are invalidated. */
export function useChatLabCreditMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: statsKeys.all });
  };
  const create = useMutation({
    mutationFn: (body: api.CreditEntryBody) => api.createChatLabCreditEntry(body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: api.CreditEntryBody }) =>
      api.updateChatLabCreditEntry(entryId, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (entryId: string) => api.deleteChatLabCreditEntry(entryId),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
