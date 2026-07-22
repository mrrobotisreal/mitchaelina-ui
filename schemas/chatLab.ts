import { z } from 'zod';

// Zod contracts for Mitchaelina. Mirrors the Go DTOs in
// internal/models/chatlab.go (camelCase). Every API response is parsed
// against these so a malformed response fails fast rather than rendering
// garbage. Assistant message content is plain markdown text (model output).

// ---------------------------------------------------------------------------
// Identity / admin (GET /chatlab/me).
// ---------------------------------------------------------------------------

/** The caller's identity + admin status. Purely a rendering hint for the admin
 *  chrome (view-as dropdown, stats scope toggle) — the server never trusts it
 *  and re-enforces every authorization decision from the verified token.
 *  `users` is the full allowlist for admins, [] for non-admins. */
export const MeResponseSchema = z.object({
  email: z.string(),
  isAdmin: z.boolean(),
  users: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------------------------------------------------------------------------
// Model catalog (GET /chatlab/models).
// ---------------------------------------------------------------------------

export const ChatLabEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);
export type ChatLabEffort = z.infer<typeof ChatLabEffortSchema>;

/** '' means reasoning off — the value sent on the wire for "Off". */
export const ChatLabEffortOrOffSchema = z.union([z.literal(''), ChatLabEffortSchema]);
export type ChatLabEffortOrOff = z.infer<typeof ChatLabEffortOrOffSchema>;

export const ChatLabModelPricingSchema = z.object({
  promptUsdPerMTok: z.number(),
  completionUsdPerMTok: z.number(),
});

export const ChatLabModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  contextLength: z.number(),
  supportsImages: z.boolean(),
  supportsReasoning: z.boolean(),
  supportsTools: z.boolean(), // can read project assets on demand (read_asset)
  supportsAudio: z.boolean(), // input_audio content parts
  // Output modalities — optional for compatibility with a not-yet-redeployed API
  // (whose catalog was text-output models only, hence the defaults).
  supportsText: z.boolean().optional().default(true), // "text" in output_modalities
  supportsImageGen: z.boolean().optional().default(false), // "image" in output_modalities
  supportsVideoGen: z.boolean().optional().default(false), // "video" in output_modalities
  supportedEfforts: z.array(ChatLabEffortSchema).nullable(),
  pricing: ChatLabModelPricingSchema,
  created: z.number(),
});
export type ChatLabModel = z.infer<typeof ChatLabModelSchema>;

// ---------------------------------------------------------------------------
// Response feedback (👍/👎 on assistant messages).
// ---------------------------------------------------------------------------

export const ChatLabFeedbackRatingSchema = z.enum(['up', 'down']);
export type ChatLabFeedbackRating = z.infer<typeof ChatLabFeedbackRatingSchema>;

export const ChatLabFeedbackCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type ChatLabFeedbackCategory = z.infer<typeof ChatLabFeedbackCategorySchema>;

/** Server-defined category catalog — the UI never hardcodes option ids. */
export const ChatLabFeedbackCategoriesSchema = z.object({
  up: z.array(ChatLabFeedbackCategorySchema),
  down: z.array(ChatLabFeedbackCategorySchema),
});
export type ChatLabFeedbackCategories = z.infer<typeof ChatLabFeedbackCategoriesSchema>;

export const ChatLabMessageFeedbackSchema = z.object({
  rating: ChatLabFeedbackRatingSchema,
  categories: z.array(z.string()),
  comment: z.string(),
  raterEmail: z.string(),
  isMine: z.boolean(),
  updatedAt: z.string(),
});
export type ChatLabMessageFeedback = z.infer<typeof ChatLabMessageFeedbackSchema>;

/** The models fetch doubles as the "lab config" fetch. */
export const ChatLabModelsResponseSchema = z.object({
  models: z.array(ChatLabModelSchema),
  feedbackCategories: ChatLabFeedbackCategoriesSchema,
});
export type ChatLabModelsResponse = z.infer<typeof ChatLabModelsResponseSchema>;

// ---------------------------------------------------------------------------
// Sessions.
// ---------------------------------------------------------------------------

export const ChatLabSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  titleSource: z.enum(['default', 'derived', 'generated', 'manual']),
  createdByEmail: z.string(),
  isMine: z.boolean(), // SERVER-computed; rename/delete are creator-only
  projectId: z.string().nullable(), // null = a general chat
  lastModel: z.string().nullable(),
  lastReasoningEffort: z.string().nullable(),
  createdAt: z.string(), // ISO 8601 UTC
  updatedAt: z.string(), // bumped on every message → recency grouping
});
export type ChatLabSession = z.infer<typeof ChatLabSessionSchema>;

export const ChatLabSessionsResponseSchema = z.object({
  sessions: z.array(ChatLabSessionSchema),
});

// ---------------------------------------------------------------------------
// Messages + attachments.
// ---------------------------------------------------------------------------

// 'video' joins the kinds with media generation — generated MP4s are stored as
// message-bound attachments exactly like uploaded images/files.
export const ChatLabAttachmentKindSchema = z.enum(['image', 'file', 'video']);
export type ChatLabAttachmentKind = z.infer<typeof ChatLabAttachmentKindSchema>;

export const ChatLabAttachmentSchema = z.object({
  id: z.string(),
  kind: ChatLabAttachmentKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  viewUrl: z.string(), // presigned GET, inline — expiring; refetch keeps it fresh
  downloadUrl: z.string(), // presigned GET w/ Content-Disposition: attachment
});
export type ChatLabAttachment = z.infer<typeof ChatLabAttachmentSchema>;

// One recorded tool execution on an assistant message. read_asset uses
// assetId/assetName; the desktop local tools use the additive
// path/command/detail/diff fields (all optional — existing read_asset rows keep
// validating). assetId/assetName are relaxed to optional-with-default so local
// tool rows (which carry neither) still parse.
export const ChatLabToolActivitySchema = z.object({
  name: z.string(),
  assetId: z.string().optional().default(''),
  assetName: z.string().optional().default(''),
  status: z.enum(['ok', 'error']),
  // Desktop local-tool fields (omitted for read_asset).
  path: z.string().optional(),
  command: z.string().optional(),
  detail: z.string().optional(),
  diff: z.string().optional(),
});
export type ChatLabToolActivity = z.infer<typeof ChatLabToolActivitySchema>;

export const ChatLabMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  authorEmail: z.string().nullable(), // user messages only
  content: z.string(), // plain text (user) / markdown (assistant)
  reasoning: z.string().nullable(), // assistant only
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  // 'generating' is the transient state a video assistant row sits in between
  // job submit and the poller's terminal update.
  status: z.enum(['complete', 'interrupted', 'error', 'generating']),
  errorMessage: z.string().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  totalCostUsd: z.number().nullable(),
  // Per-response performance metrics — null on historical (pre-metrics) rows;
  // nullish (not just nullable) so a not-yet-redeployed API parses too.
  durationMs: z.number().nullish(), // request start → terminal, incl. tool rounds
  reasoningMs: z.number().nullish(), // summed thinking time; null when no reasoning
  firstTokenMs: z.number().nullish(),
  requestType: z.string().nullish(), // 'text'|'file'|'image'|'pdf'|'audio'|'mixed'
  createdAt: z.string(),
  attachments: z.array(ChatLabAttachmentSchema),
  toolActivity: z.array(ChatLabToolActivitySchema).nullable(), // null when no tools ran
  feedback: z.array(ChatLabMessageFeedbackSchema).nullable(), // both users' rows; null when none
});
export type ChatLabMessage = z.infer<typeof ChatLabMessageSchema>;

export const ChatLabSessionProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ChatLabSessionProjectRef = z.infer<typeof ChatLabSessionProjectRefSchema>;

export const ChatLabSessionDetailResponseSchema = z.object({
  session: ChatLabSessionSchema,
  project: ChatLabSessionProjectRefSchema.nullable(), // breadcrumb, project chats only
  messages: z.array(ChatLabMessageSchema), // ordered (created_at, seq)
});
export type ChatLabSessionDetailResponse = z.infer<typeof ChatLabSessionDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Projects.
// ---------------------------------------------------------------------------

export const ChatLabMemoryStatusSchema = z.enum(['idle', 'updating', 'error', 'disabled']);
export type ChatLabMemoryStatus = z.infer<typeof ChatLabMemoryStatusSchema>;

export const ChatLabProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isMine: z.boolean(), // gates the whole-project DELETE only — everything else is collaborative
  createdByEmail: z.string(),
  chatCount: z.number(),
  assetCount: z.number(),
  memoryUpdatedAt: z.string().nullable(),
  memoryStatus: ChatLabMemoryStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatLabProject = z.infer<typeof ChatLabProjectSchema>;

export const ChatLabProjectsResponseSchema = z.object({
  projects: z.array(ChatLabProjectSchema),
});

export const ChatLabProjectAssetKindSchema = z.enum(['text', 'code', 'image', 'audio', 'pdf']);
export type ChatLabProjectAssetKind = z.infer<typeof ChatLabProjectAssetKindSchema>;

export const ChatLabProjectAssetSchema = z.object({
  id: z.string(),
  kind: ChatLabProjectAssetKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  uploadedByEmail: z.string(),
  createdAt: z.string(),
  viewUrl: z.string(),
  downloadUrl: z.string(),
});
export type ChatLabProjectAsset = z.infer<typeof ChatLabProjectAssetSchema>;

export const ChatLabProjectDetailSchema = ChatLabProjectSchema.extend({
  instructions: z.string(),
  memory: z.string(),
  assets: z.array(ChatLabProjectAssetSchema),
  sessions: z.array(ChatLabSessionSchema),
});
export type ChatLabProjectDetail = z.infer<typeof ChatLabProjectDetailSchema>;

export const ChatLabProjectPresignResponseSchema = z.object({
  assetId: z.string(),
  uploadUrl: z.string(),
  key: z.string(),
});
export type ChatLabProjectPresignResponse = z.infer<typeof ChatLabProjectPresignResponseSchema>;

export const ChatLabMemoryRefreshResponseSchema = z.object({
  status: z.enum(['updating', 'disabled']),
});
export type ChatLabMemoryRefreshResponse = z.infer<typeof ChatLabMemoryRefreshResponseSchema>;

// ---------------------------------------------------------------------------
// Mutation responses.
// ---------------------------------------------------------------------------

export const ChatLabPresignResponseSchema = z.object({
  attachmentId: z.string(),
  uploadUrl: z.string(),
  key: z.string(),
});
export type ChatLabPresignResponse = z.infer<typeof ChatLabPresignResponseSchema>;

export const ChatLabDeletedResponseSchema = z.object({ deleted: z.boolean() });
export const ChatLabOkResponseSchema = z.object({ ok: z.boolean() });

// ---------------------------------------------------------------------------
// Stream events (the send endpoint’s SSE frames — see chatlab_stream.go).
// ---------------------------------------------------------------------------

export const ChatLabStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meta'),
    userMessageId: z.string(),
    assistantMessageId: z.string(),
  }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('tool'),
    name: z.string(),
    assetId: z.string(),
    assetName: z.string(),
    status: z.enum(['running', 'ok', 'error']),
  }),
  z.object({
    type: z.literal('usage'),
    promptTokens: z.number(),
    completionTokens: z.number(),
    reasoningTokens: z.number(),
    costUsd: z.number(),
    // Timing for instant footer display on the just-streamed message (the
    // refetched row carries the persisted values). Nullish for compatibility
    // with a not-yet-redeployed API.
    durationMs: z.number().nullish(),
    reasoningMs: z.number().nullish(),
  }),
  // Media-generation progress: "running" at start, "polling" on each video
  // poll tick, "ok" when an image finished storing. The terminal outcome still
  // arrives via usage/done/error.
  z.object({
    type: z.literal('generation'),
    modality: z.enum(['image', 'video']),
    status: z.enum(['running', 'polling', 'ok']),
  }),
  // Desktop local agentic file access: a "pending" event asks the Electron
  // renderer to execute a client-side tool call (identified by callId); the
  // matching terminal event ("ok"/"error") carries the human summary and, for
  // file writes/edits, a unified diff. Dormant on the web (never emitted).
  z.object({
    type: z.literal('local_tool'),
    callId: z.string(),
    name: z.string(),
    args: z.string(), // raw JSON argument string
    status: z.enum(['pending', 'ok', 'error']),
    detail: z.string().optional(),
    diff: z.string().optional(),
  }),
  z.object({ type: z.literal('done'), status: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatLabStreamEvent = z.infer<typeof ChatLabStreamEventSchema>;

export type ChatLabUsage = Extract<ChatLabStreamEvent, { type: 'usage' }>;
export type ChatLabGenerationEvent = Extract<ChatLabStreamEvent, { type: 'generation' }>;
export type ChatLabLocalToolEvent = Extract<ChatLabStreamEvent, { type: 'local_tool' }>;

// ---------------------------------------------------------------------------
// Media generation — send-side selection (mirrors the API's outputModality +
// ChatGenerationOptions). "text" is the normal chat completion.
// ---------------------------------------------------------------------------

export const ChatLabOutputModalitySchema = z.enum(['text', 'image', 'video']);
export type ChatLabOutputModality = z.infer<typeof ChatLabOutputModalitySchema>;

/** Optional generation knobs; empty/0 means provider default (omitted from the
 *  request). Aspect ratio "W:H", resolution one of the server's allowlist,
 *  duration in seconds (video only). */
export interface ChatLabGenerationOptions {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
}

// ---------------------------------------------------------------------------
// Usage & spend analytics + credit ledger. All times/buckets are UTC.
// ---------------------------------------------------------------------------

export const ChatLabStatsTotalsSchema = z.object({
  costUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  reasoningTokens: z.number(),
  events: z.number(),
  chatEvents: z.number(),
  unknownCostEvents: z.number(), // NULL-cost events under-count spend → UI shows "≈"
  estimatedCostEvents: z.number(),
});
export type ChatLabStatsTotals = z.infer<typeof ChatLabStatsTotalsSchema>;

export const ChatLabCreditBalanceSchema = z.object({
  currentUsd: z.number(),
  totalCreditedUsd: z.number(),
  totalSpentUsd: z.number(),
  trackingSince: z.string().nullable(),
  hasLedger: z.boolean(),
});
export type ChatLabCreditBalance = z.infer<typeof ChatLabCreditBalanceSchema>;

export const ChatLabStatsSummarySchema = z.object({
  totals: ChatLabStatsTotalsSchema,
  balance: ChatLabCreditBalanceSchema,
});
export type ChatLabStatsSummary = z.infer<typeof ChatLabStatsSummarySchema>;

export const ChatLabStatsDimensionSchema = z.enum(['model', 'user', 'project', 'session', 'kind', 'type']);
export type ChatLabStatsDimension = z.infer<typeof ChatLabStatsDimensionSchema>;

/** The request-type filter values (?type= on breakdown/timeseries).
 *  'image_gen'/'video_gen' mark generation sends (the model PRODUCED media). */
export const ChatLabRequestTypeSchema = z.enum([
  'text',
  'file',
  'image',
  'pdf',
  'audio',
  'mixed',
  'image_gen',
  'video_gen',
]);
export type ChatLabRequestType = z.infer<typeof ChatLabRequestTypeSchema>;

export const ChatLabStatsBreakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  costUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  reasoningTokens: z.number(),
  events: z.number(),
  // Latency aggregates: kind='chat' events with metrics only; null when the
  // group has none (historical rows → the UI shows "—").
  chatEvents: z.number().nullish(),
  avgDurationMs: z.number().nullish(),
  p50DurationMs: z.number().nullish(),
  p95DurationMs: z.number().nullish(),
  avgFirstTokenMs: z.number().nullish(),
  avgReasoningMs: z.number().nullish(),
  thumbsUp: z.number().optional(), // dimension=model only
  thumbsDown: z.number().optional(),
});
export type ChatLabStatsBreakdownRow = z.infer<typeof ChatLabStatsBreakdownRowSchema>;

export const ChatLabStatsBreakdownResponseSchema = z.object({
  rows: z.array(ChatLabStatsBreakdownRowSchema),
});

export const ChatLabStatsBucketSchema = z.enum(['day', 'week', 'month']);
export type ChatLabStatsBucket = z.infer<typeof ChatLabStatsBucketSchema>;

export const ChatLabStatsTimeseriesPointSchema = z.object({
  bucket: z.string(), // RFC3339, UTC bucket start
  key: z.string().optional(), // absent for dimension=none; "other" = top-8 rollup
  costUsd: z.number(),
  totalTokens: z.number(),
  events: z.number(),
  // Chat-only latency; null when the bucket has no measured chat events.
  avgDurationMs: z.number().nullish(),
  p95DurationMs: z.number().nullish(),
});
export type ChatLabStatsTimeseriesPoint = z.infer<typeof ChatLabStatsTimeseriesPointSchema>;

export const ChatLabStatsTimeseriesResponseSchema = z.object({
  points: z.array(ChatLabStatsTimeseriesPointSchema),
});

export const ChatLabCreditEntrySchema = z.object({
  id: z.string(),
  entryType: z.enum(['deposit', 'adjustment']),
  amountUsd: z.number(),
  effectiveAt: z.string(),
  note: z.string(),
  createdByEmail: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatLabCreditEntry = z.infer<typeof ChatLabCreditEntrySchema>;

export const ChatLabCreditsResponseSchema = z.object({
  balance: ChatLabCreditBalanceSchema,
  entries: z.array(ChatLabCreditEntrySchema),
});
export type ChatLabCreditsResponse = z.infer<typeof ChatLabCreditsResponseSchema>;

// ---------------------------------------------------------------------------
// Attachment allowlist / caps — the chat-lab-specific rules (mirrors the
// server's chatLabAttachmentExt; deliberately NOT the doc-asset allowlist).
// Images become multimodal model input; PDFs go through OpenRouter's file
// parser; text files are inlined into the prompt (hence the small caps).
// ---------------------------------------------------------------------------

// Upload allowlist — only image + file are UPLOADABLE ('video' is a generated
// output kind, never uploaded as a chat attachment).
export const CHATLAB_ATTACHMENT_EXT: Record<'image' | 'file', Record<string, string>> = {
  image: {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  },
  file: {
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'application/json': 'json',
  },
};

const MiB = 1024 * 1024;

/** Per-contentType byte caps (PDFs are larger than inlined text files). */
export function chatLabMaxBytes(kind: ChatLabAttachmentKind, contentType: string): number {
  if (kind === 'image') return 10 * MiB;
  if (contentType === 'application/pdf') return 25 * MiB;
  return 2 * MiB;
}

export const CHATLAB_MAX_ATTACHMENTS = 5;

/** The composer's file-input accept attribute. */
export function chatLabAccept(): string {
  return [...Object.keys(CHATLAB_ATTACHMENT_EXT.image), '.pdf', '.txt', '.csv', '.md', '.json'].join(',');
}

// ---------------------------------------------------------------------------
// Project asset allowlist (mirrors the server's projectAssetKind — extension-
// first classification; text/code/image/audio/pdf, NO video).
// ---------------------------------------------------------------------------

export const CHATLAB_PROJECT_ASSET_EXTS: Record<ChatLabProjectAssetKind, string[]> = {
  text: ['md', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'xml'],
  code: [
    'go', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'rs', 'java', 'kt', 'swift',
    'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'sql', 'css', 'html', 'php',
  ],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  audio: ['mp3', 'wav'],
  pdf: ['pdf'],
};

export const CHATLAB_MAX_PROJECT_ASSETS = 50;

/** Per-kind byte caps (mirrors the server). */
export function chatLabProjectAssetMaxBytes(kind: ChatLabProjectAssetKind): number {
  switch (kind) {
    case 'image':
      return 10 * MiB;
    case 'audio':
    case 'pdf':
      return 25 * MiB;
    default:
      return 2 * MiB; // text + code
  }
}

/** Classify a file by extension (mirrors projectAssetKind). null = unsupported. */
export function chatLabProjectAssetKind(fileName: string): ChatLabProjectAssetKind | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  for (const kind of Object.keys(CHATLAB_PROJECT_ASSET_EXTS) as ChatLabProjectAssetKind[]) {
    if (CHATLAB_PROJECT_ASSET_EXTS[kind].includes(ext)) return kind;
  }
  return null;
}

/** The project asset upload input's accept attribute. */
export function chatLabProjectAssetAccept(): string {
  return (Object.keys(CHATLAB_PROJECT_ASSET_EXTS) as ChatLabProjectAssetKind[])
    .flatMap((kind) => CHATLAB_PROJECT_ASSET_EXTS[kind].map((ext) => `.${ext}`))
    .join(',');
}
