// Mitchaelina chat-lab API. Uses the shared transport (apiClient.ts) and the
// shared presign → PUT-to-S3 → complete handshake (s3Upload.ts). Every response
// is zod-parsed against schemas/drChatLab.ts so a malformed response fails
// fast. The streaming send is NOT here — it lives in useChatStream.ts because
// it consumes an SSE body via fetch + ReadableStream.

import {
  CHATLAB_ATTACHMENT_EXT,
  ChatLabCreditEntrySchema,
  ChatLabCreditsResponseSchema,
  ChatLabDeletedResponseSchema,
  ChatLabMemoryRefreshResponseSchema,
  ChatLabMessageFeedbackSchema,
  ChatLabModelsResponseSchema,
  ChatLabPresignResponseSchema,
  ChatLabProjectDetailSchema,
  ChatLabProjectPresignResponseSchema,
  ChatLabProjectSchema,
  ChatLabProjectsResponseSchema,
  ChatLabSessionDetailResponseSchema,
  ChatLabSessionSchema,
  ChatLabSessionsResponseSchema,
  ChatLabStatsBreakdownResponseSchema,
  ChatLabStatsSummarySchema,
  ChatLabStatsTimeseriesResponseSchema,
  chatLabMaxBytes,
  chatLabProjectAssetKind,
  chatLabProjectAssetMaxBytes,
  type ChatLabAttachmentKind,
  type ChatLabCreditEntry,
  type ChatLabCreditsResponse,
  type ChatLabFeedbackRating,
  type ChatLabMemoryRefreshResponse,
  type ChatLabMessageFeedback,
  type ChatLabModelsResponse,
  type ChatLabPresignResponse,
  type ChatLabProject,
  type ChatLabProjectDetail,
  type ChatLabProjectPresignResponse,
  type ChatLabRequestType,
  type ChatLabSession,
  type ChatLabSessionDetailResponse,
  type ChatLabStatsBreakdownRow,
  type ChatLabStatsBucket,
  type ChatLabStatsDimension,
  type ChatLabStatsSummary,
  type ChatLabStatsTimeseriesPoint,
} from '@/schemas/chatLab';
import { apiGet, apiSend } from '@/lib/apiClient';
import { putToS3 } from '@/lib/s3Upload';

const enc = encodeURIComponent;

// ---- Models / lab config ---------------------------------------------------------

/** The models fetch doubles as the lab-config fetch (feedback categories ride
 *  along). Hooks select the slice they need off one shared query. */
export const fetchChatLabConfig = async (): Promise<ChatLabModelsResponse> =>
  ChatLabModelsResponseSchema.parse(await apiGet('/chatlab/models'));

// ---- Sessions ----------------------------------------------------------------

/** Without projectId: GENERAL sessions only (the API default). With it: that
 *  project's sessions. */
export const fetchChatLabSessions = async (projectId?: string): Promise<ChatLabSession[]> => {
  const query = projectId ? `?projectId=${enc(projectId)}` : '';
  return ChatLabSessionsResponseSchema.parse(await apiGet(`/chatlab/sessions${query}`)).sessions;
};

export const createChatLabSession = async (projectId?: string): Promise<ChatLabSession> =>
  ChatLabSessionSchema.parse(await apiSend('POST', '/chatlab/sessions', projectId ? { projectId } : {}));

export const fetchChatLabSession = async (sessionId: string): Promise<ChatLabSessionDetailResponse> =>
  ChatLabSessionDetailResponseSchema.parse(await apiGet(`/chatlab/sessions/${enc(sessionId)}`));

export const renameChatLabSession = async (sessionId: string, title: string): Promise<ChatLabSession> =>
  ChatLabSessionSchema.parse(await apiSend('PUT', `/chatlab/sessions/${enc(sessionId)}`, { title }));

export const deleteChatLabSession = async (sessionId: string): Promise<void> => {
  ChatLabDeletedResponseSchema.parse(await apiSend('DELETE', `/chatlab/sessions/${enc(sessionId)}`));
};

// ---- Attachments (compose-before-send) -----------------------------------------

export interface PresignChatLabAttachmentBody {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  kind: ChatLabAttachmentKind;
  width: number | null;
  height: number | null;
}

export const presignChatLabAttachment = async (
  sessionId: string,
  body: PresignChatLabAttachmentBody,
): Promise<ChatLabPresignResponse> =>
  ChatLabPresignResponseSchema.parse(await apiSend('POST', `/chatlab/sessions/${enc(sessionId)}/attachments`, body));

export const completeChatLabAttachment = async (sessionId: string, attachmentId: string): Promise<void> => {
  await apiSend('POST', `/chatlab/sessions/${enc(sessionId)}/attachments/${enc(attachmentId)}/complete`);
};

export const deleteChatLabAttachment = async (sessionId: string, attachmentId: string): Promise<void> => {
  await apiSend('DELETE', `/chatlab/sessions/${enc(sessionId)}/attachments/${enc(attachmentId)}`);
};

// Resolve a browser File to (kind, server content type) on the CHAT-LAB
// allowlist. Browsers sometimes leave File.type empty (notably .md/.csv), so we
// fall back to the extension. Returns null when unsupported.
export function resolveChatLabAttachment(file: File): { kind: ChatLabAttachmentKind; contentType: string } | null {
  for (const kind of ['image', 'file'] as const) {
    const allow = CHATLAB_ATTACHMENT_EXT[kind];
    if (file.type && allow[file.type]) return { kind, contentType: file.type };
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    for (const [ct, e] of Object.entries(allow)) {
      if (e === ext) return { kind, contentType: ct };
    }
  }
  return null;
}

/** Client-side size guard (mirrors the server caps) — true when oversize. */
export function isChatLabAttachmentOversize(sizeBytes: number, kind: ChatLabAttachmentKind, contentType: string): boolean {
  return sizeBytes > chatLabMaxBytes(kind, contentType);
}

export interface UploadChatLabAttachmentParams {
  sessionId: string;
  file: File;
  kind: ChatLabAttachmentKind;
  contentType: string;
  width?: number | null;
  height?: number | null;
  /** Called with the attachment id as soon as it is minted (before upload
   *  finishes), so the caller can DELETE it if the user cancels. */
  onAttachmentId?: (attachmentId: string) => void;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

// Full handshake for one attachment: presign → PUT (with progress +
// cancellation) → complete. Returns the attachment id. On any failure/cancel,
// best-effort deletes the (unbound) attachment row + S3 object so a cancelled
// upload never survives to send. Mirrors uploadFeedbackAttachment.
export async function uploadChatLabAttachment(params: UploadChatLabAttachmentParams): Promise<string> {
  const { attachmentId, uploadUrl } = await presignChatLabAttachment(params.sessionId, {
    fileName: params.file.name,
    contentType: params.contentType,
    sizeBytes: params.file.size,
    kind: params.kind,
    width: params.width ?? null,
    height: params.height ?? null,
  });
  params.onAttachmentId?.(attachmentId);
  try {
    await putToS3(uploadUrl, params.file, params.contentType, params.onProgress, params.signal);
    await completeChatLabAttachment(params.sessionId, attachmentId);
    return attachmentId;
  } catch (err) {
    void deleteChatLabAttachment(params.sessionId, attachmentId).catch(() => {});
    throw err;
  }
}

// Reuse the generic image-dimension helper unchanged (same trick as feedback).
export { readImageDimensions } from '@/lib/imageDimensions';

// ---- Projects ------------------------------------------------------------------

export const fetchChatLabProjects = async (): Promise<ChatLabProject[]> =>
  ChatLabProjectsResponseSchema.parse(await apiGet('/chatlab/projects')).projects;

export interface CreateChatLabProjectBody {
  name: string;
  description?: string;
  instructions?: string;
}

export const createChatLabProject = async (body: CreateChatLabProjectBody): Promise<ChatLabProject> =>
  ChatLabProjectSchema.parse(await apiSend('POST', '/chatlab/projects', body));

export const fetchChatLabProject = async (projectId: string): Promise<ChatLabProjectDetail> =>
  ChatLabProjectDetailSchema.parse(await apiGet(`/chatlab/projects/${enc(projectId)}`));

export interface UpdateChatLabProjectBody {
  name?: string;
  description?: string;
  instructions?: string;
}

/** Partial update — collaborative: any allowlisted user may edit. */
export const updateChatLabProject = async (projectId: string, body: UpdateChatLabProjectBody): Promise<ChatLabProject> =>
  ChatLabProjectSchema.parse(await apiSend('PUT', `/chatlab/projects/${enc(projectId)}`, body));

/** Creator-only. Destroys ALL the project's chats and assets. */
export const deleteChatLabProject = async (projectId: string): Promise<void> => {
  ChatLabDeletedResponseSchema.parse(await apiSend('DELETE', `/chatlab/projects/${enc(projectId)}`));
};

export const refreshChatLabProjectMemory = async (projectId: string): Promise<ChatLabMemoryRefreshResponse> =>
  ChatLabMemoryRefreshResponseSchema.parse(await apiSend('POST', `/chatlab/projects/${enc(projectId)}/memory/refresh`));

// ---- Project assets ---------------------------------------------------------------

export interface PresignChatLabProjectAssetBody {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export const presignChatLabProjectAsset = async (
  projectId: string,
  body: PresignChatLabProjectAssetBody,
): Promise<ChatLabProjectPresignResponse> =>
  ChatLabProjectPresignResponseSchema.parse(await apiSend('POST', `/chatlab/projects/${enc(projectId)}/assets`, body));

export const completeChatLabProjectAsset = async (projectId: string, assetId: string): Promise<void> => {
  await apiSend('POST', `/chatlab/projects/${enc(projectId)}/assets/${enc(assetId)}/complete`);
};

export const deleteChatLabProjectAsset = async (projectId: string, assetId: string): Promise<void> => {
  await apiSend('DELETE', `/chatlab/projects/${enc(projectId)}/assets/${enc(assetId)}`);
};

/** Client-side pre-check mirroring the server's extension-first policy.
 *  Returns null when the file type is unsupported (video, archives, …). */
export function checkProjectAssetFile(file: File): { kind: NonNullable<ReturnType<typeof chatLabProjectAssetKind>>; oversize: boolean } | null {
  const kind = chatLabProjectAssetKind(file.name);
  if (!kind) return null;
  return { kind, oversize: file.size > chatLabProjectAssetMaxBytes(kind) };
}

export interface UploadChatLabProjectAssetParams {
  projectId: string;
  file: File;
  width?: number | null;
  height?: number | null;
  onAssetId?: (assetId: string) => void;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

// Full handshake for one project asset: presign → PUT → complete. The server
// derives the kind from the extension; we just forward name/type/size. On any
// failure/cancel, best-effort deletes the pending asset row + object.
export async function uploadChatLabProjectAsset(params: UploadChatLabProjectAssetParams): Promise<string> {
  const contentType = params.file.type || 'application/octet-stream';
  const { assetId, uploadUrl } = await presignChatLabProjectAsset(params.projectId, {
    fileName: params.file.name,
    contentType,
    sizeBytes: params.file.size,
    width: params.width ?? null,
    height: params.height ?? null,
  });
  params.onAssetId?.(assetId);
  try {
    // PUT with the SAME content type the server stored/presigned (it may have
    // normalized exotic code-file types to text/plain) — mismatches fail the
    // signature. The server echoes nothing, so re-derive it the same way:
    // just use what we sent; the presigned URL enforces the normalized type.
    await putToS3(uploadUrl, params.file, normalizedProjectAssetPutType(params.file.name, contentType), params.onProgress, params.signal);
    await completeChatLabProjectAsset(params.projectId, assetId);
    return assetId;
  } catch (err) {
    void deleteChatLabProjectAsset(params.projectId, assetId).catch(() => {});
    throw err;
  }
}

// ---- Response feedback --------------------------------------------------------

export interface PutFeedbackBody {
  rating: ChatLabFeedbackRating;
  categories: string[];
  comment?: string;
}

export const putMessageFeedback = async (messageId: string, body: PutFeedbackBody): Promise<ChatLabMessageFeedback> =>
  ChatLabMessageFeedbackSchema.parse(await apiSend('PUT', `/chatlab/messages/${enc(messageId)}/feedback`, body));

export const deleteMessageFeedback = async (messageId: string): Promise<void> => {
  await apiSend('DELETE', `/chatlab/messages/${enc(messageId)}/feedback`);
};

// ---- Usage & spend analytics + credits ------------------------------------------

export interface StatsRange {
  from?: string; // RFC3339
  to?: string;
}

function rangeParams(range: StatsRange, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra ?? {});
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const fetchChatLabStatsSummary = async (range: StatsRange): Promise<ChatLabStatsSummary> =>
  ChatLabStatsSummarySchema.parse(await apiGet(`/chatlab/stats/summary${rangeParams(range)}`));

export const fetchChatLabStatsBreakdown = async (
  dimension: ChatLabStatsDimension,
  range: StatsRange,
  requestType?: ChatLabRequestType,
  limit = 50,
): Promise<ChatLabStatsBreakdownRow[]> =>
  ChatLabStatsBreakdownResponseSchema.parse(
    await apiGet(
      `/chatlab/stats/breakdown${rangeParams(range, {
        dimension,
        limit: String(limit),
        ...(requestType ? { type: requestType } : {}),
      })}`,
    ),
  ).rows;

export const fetchChatLabStatsTimeseries = async (
  bucket: ChatLabStatsBucket,
  dimension: 'none' | 'model' | 'kind',
  range: StatsRange,
  requestType?: ChatLabRequestType,
): Promise<ChatLabStatsTimeseriesPoint[]> =>
  ChatLabStatsTimeseriesResponseSchema.parse(
    await apiGet(
      `/chatlab/stats/timeseries${rangeParams(range, {
        bucket,
        dimension,
        ...(requestType ? { type: requestType } : {}),
      })}`,
    ),
  ).points;

export const fetchChatLabCredits = async (): Promise<ChatLabCreditsResponse> =>
  ChatLabCreditsResponseSchema.parse(await apiGet('/chatlab/credits'));

export interface CreditEntryBody {
  entryType: 'deposit' | 'adjustment';
  amountUsd: number;
  effectiveAt: string; // RFC3339
  note?: string;
}

export const createChatLabCreditEntry = async (body: CreditEntryBody): Promise<ChatLabCreditEntry> =>
  ChatLabCreditEntrySchema.parse(await apiSend('POST', '/chatlab/credits', body));

export const updateChatLabCreditEntry = async (entryId: string, body: CreditEntryBody): Promise<ChatLabCreditEntry> =>
  ChatLabCreditEntrySchema.parse(await apiSend('PUT', `/chatlab/credits/${enc(entryId)}`, body));

export const deleteChatLabCreditEntry = async (entryId: string): Promise<void> => {
  await apiSend('DELETE', `/chatlab/credits/${enc(entryId)}`);
};

// Mirror of the server's normalizeProjectAssetContentType so the S3 PUT's
// Content-Type matches the presigned signature for text/code assets.
export function normalizedProjectAssetPutType(fileName: string, contentType: string): string {
  const kind = chatLabProjectAssetKind(fileName);
  if (kind !== 'text' && kind !== 'code') return contentType.toLowerCase();
  const ct = contentType.toLowerCase();
  if (
    ct === '' ||
    ct === 'application/octet-stream' ||
    ct.startsWith('text/x-') ||
    ct.startsWith('application/x-')
  ) {
    return 'text/plain; charset=utf-8';
  }
  if (ct === 'application/json' || ct === 'application/xml' || ct === 'application/yaml' || ct === 'application/toml' || ct.startsWith('text/')) {
    return ct;
  }
  return 'text/plain; charset=utf-8';
}
