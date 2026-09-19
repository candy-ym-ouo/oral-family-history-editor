import { z } from 'zod';

export const roleSchema = z.enum(['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER']);

// 授权范围：仅文字整理 < 家族内部 < 公开发布；高等级覆盖低等级
export const consentScopeSchema = z.enum(['TRANSCRIPT', 'FAMILY', 'PUBLIC']);
export const consentStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'WITHDRAWN']);

export const CONSENT_SCOPE_RANK: Record<ConsentScope, number> = {
  TRANSCRIPT: 1,
  FAMILY: 2,
  PUBLIC: 3,
};

export const CONSENT_SCOPE_LABELS: Record<ConsentScope, string> = {
  TRANSCRIPT: '仅文字整理（不得发布）',
  FAMILY: '家族内部发布',
  PUBLIC: '公开发布',
};

const titleSchema = z.string().trim().min(1).max(160);
const summarySchema = z.string().max(4000);
const transcriptSchema = z.string().max(20_000);
const speakerPersonIdSchema = z.string().uuid().nullable();

export const clipSchema = z
  .object({
    title: titleSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    summary: summarySchema.default(''),
    transcript: transcriptSchema.default(''),
    speakerPersonId: speakerPersonIdSchema.optional(),
    version: z.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => value.endMs > value.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });

export const clipUpdateSchema = z
  .object({
    title: titleSchema.optional(),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(),
    summary: summarySchema.optional(),
    transcript: transcriptSchema.optional(),
    speakerPersonId: speakerPersonIdSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const chapterCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    intro: z.string().max(10_000).default(''),
    audience: consentScopeSchema.default('FAMILY'),
  })
  .strict();

export const chapterUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    intro: z.string().max(10_000).optional(),
    audience: z.enum(['TRANSCRIPT', 'FAMILY', 'PUBLIC']).optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const chapterBlockCreateSchema = z
  .object({
    type: z.string().trim().min(1).max(40).default('paragraph'),
    position: z.string().trim().min(1).max(100).optional(),
    content: z.unknown().optional(),
    clipId: z.string().uuid().nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// 访谈授权（consent）
// ---------------------------------------------------------------------------

const isoDateSchema = z.string().datetime({ offset: true });

export const consentCreateSchema = z
  .object({
    intervieweeName: z.string().trim().min(1).max(120),
    contactInfo: z.string().trim().max(300).default(''),
    scope: consentScopeSchema,
    startAt: isoDateSchema,
    endAt: isoDateSchema.nullable().optional(),
    agreementText: z.string().max(20_000).default(''),
    signature: z.string().trim().max(300).default(''),
    evidenceRef: z.string().trim().max(500).default(''),
    notes: z.string().max(5_000).default(''),
    recordingIds: z.array(z.string().uuid()).max(200).default([]),
  })
  .strict()
  .refine(
    (value) => value.endAt === null || value.endAt === undefined || value.endAt > value.startAt,
    { message: 'endAt must be later than startAt', path: ['endAt'] },
  );

export const consentUpdateSchema = z
  .object({
    scope: consentScopeSchema.optional(),
    startAt: isoDateSchema.optional(),
    endAt: isoDateSchema.nullable().optional(),
    agreementText: z.string().max(20_000).optional(),
    signature: z.string().trim().max(300).optional(),
    evidenceRef: z.string().trim().max(500).optional(),
    notes: z.string().max(5_000).optional(),
    recordingIds: z.array(z.string().uuid()).max(200).optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const consentWithdrawSchema = z
  .object({
    reason: z.string().trim().max(2_000).default(''),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
export type ClipInput = z.infer<typeof clipSchema>;
export type ClipUpdateInput = z.infer<typeof clipUpdateSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type ChapterBlockCreateInput = z.infer<typeof chapterBlockCreateSchema>;
export type ConsentScope = z.infer<typeof consentScopeSchema>;
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
export type ConsentCreateInput = z.infer<typeof consentCreateSchema>;
export type ConsentUpdateInput = z.infer<typeof consentUpdateSchema>;
export type ConsentWithdrawInput = z.infer<typeof consentWithdrawSchema>;

// ---------------------------------------------------------------------------
// 授权判定纯函数（API 与前端共用，便于单测）
// ---------------------------------------------------------------------------

export type ConsentLike = {
  id: string;
  intervieweeName?: string;
  scope: ConsentScope;
  startAt: string | Date;
  endAt?: string | Date | null;
  status?: ConsentStatus;
  withdrawnAt?: string | Date | null;
  recordingIds?: string[];
};

/** scope 是否覆盖目标发布范围（含自身） */
export function scopeCovers(scope: ConsentScope, audience: ConsentScope): boolean {
  return CONSENT_SCOPE_RANK[scope] >= CONSENT_SCOPE_RANK[audience];
}

/** 依据撤回标记与期限实时计算授权状态（DB 中的 status 只记录撤回，过期动态计算） */
export function effectiveConsentStatus(
  consent: Pick<ConsentLike, 'status' | 'withdrawnAt' | 'endAt'>,
  now: Date = new Date(),
): ConsentStatus {
  if (consent.status === 'WITHDRAWN' || consent.withdrawnAt) return 'WITHDRAWN';
  const endAt = consent.endAt ? new Date(consent.endAt) : null;
  if (endAt && endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function isConsentActive(
  consent: Pick<ConsentLike, 'status' | 'withdrawnAt' | 'endAt' | 'startAt'>,
  now: Date = new Date(),
): boolean {
  if (effectiveConsentStatus(consent, now) !== 'ACTIVE') return false;
  return new Date(consent.startAt).getTime() <= now.getTime();
}

export type ConsentIssueCode =
  | 'CONSENT_MISSING'
  | 'CONSENT_WITHDRAWN'
  | 'CONSENT_EXPIRED'
  | 'CONSENT_SCOPE_INSUFFICIENT'
  | 'CONSENT_NOT_STARTED';

export type ConsentIssue = {
  code: ConsentIssueCode;
  recordingId: string;
  /** 该录音上最近一条候选授权（用于提示具体受访人/原因），缺失时为 null */
  consentId: string | null;
  message: string;
};

export type ConsentWarningCode = 'CONSENT_EXPIRING_SOON';

export type ConsentWarning = {
  code: ConsentWarningCode;
  recordingId: string;
  consentId: string;
  message: string;
};

export type ChapterConsentRisk = {
  // OK：全部放行；WARNING：可发布但授权即将到期；BLOCKED：存在未授权/撤回/过期/范围不足
  level: 'OK' | 'WARNING' | 'BLOCKED';
  issues: ConsentIssue[];
  warnings: ConsentWarning[];
  /** 每个被引用录音的放行授权 id，无则不含 */
  coveredBy: Record<string, string>;
};

type ChapterBlockLike = {
  clip?: {
    id?: string;
    deletedAt?: string | Date | null;
    recordingId?: string;
  } | null;
  clipId?: string | null;
};

/**
 * 评估章节内容块相对访谈授权的合规风险。
 * - 每个引用到的录音都需要一条：状态有效、覆盖该录音、scope 覆盖 audience 的授权。
 * - 有任一不满足 => BLOCKED（禁止发布）。
 * - 放行授权将在 30 天内到期 => WARNING（可发布，章节列表持续提示）。
 * - 对已发布章节同样适用，调用方据此展示历史风险（内容保留，仅提示）。
 */
export function evaluateChapterConsent(
  blocks: ChapterBlockLike[],
  consents: ConsentLike[],
  audience: ConsentScope,
  now: Date = new Date(),
): ChapterConsentRisk {
  const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;
  const recordingIds = Array.from(
    new Set(
      blocks
        .map((block) => block.clip?.recordingId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const issues: ConsentIssue[] = [];
  const warnings: ConsentWarning[] = [];
  const coveredBy: Record<string, string> = {};

  for (const recordingId of recordingIds) {
    const candidates = consents.filter((consent) =>
      consent.recordingIds?.includes(recordingId),
    );

    // 优先选择一条可放行的授权：有效 + scope 足够，取到期日最晚者
    const valid = candidates
      .filter(
        (consent) =>
          isConsentActive(consent, now) && scopeCovers(consent.scope, audience),
      )
      .sort((a, b) => {
        const aEnd = a.endAt ? new Date(a.endAt).getTime() : Number.POSITIVE_INFINITY;
        const bEnd = b.endAt ? new Date(b.endAt).getTime() : Number.POSITIVE_INFINITY;
        return bEnd - aEnd;
      });

    const chosen = valid[0];
    if (chosen) {
      coveredBy[recordingId] = chosen.id;
      if (chosen.endAt) {
        const remaining = new Date(chosen.endAt).getTime() - now.getTime();
        if (remaining <= EXPIRY_WARNING_MS) {
          warnings.push({
            code: 'CONSENT_EXPIRING_SOON',
            recordingId,
            consentId: chosen.id,
            message: `授权将于 ${new Date(chosen.endAt).toISOString().slice(0, 10)} 到期，到期后该内容将被限制发布`,
          });
        }
      }
      continue;
    }

    // 没有可放行授权时，给出最有解释力的一条候选的原因
    const statusOf = (consent: ConsentLike): ConsentIssueCode | null => {
      const effective = effectiveConsentStatus(consent, now);
      if (effective === 'WITHDRAWN') return 'CONSENT_WITHDRAWN';
      if (effective === 'EXPIRED') return 'CONSENT_EXPIRED';
      if (new Date(consent.startAt).getTime() > now.getTime()) {
        return 'CONSENT_NOT_STARTED';
      }
      if (!scopeCovers(consent.scope, audience)) return 'CONSENT_SCOPE_INSUFFICIENT';
      return null;
    };

    const order: ConsentIssueCode[] = [
      'CONSENT_WITHDRAWN',
      'CONSENT_EXPIRED',
      'CONSENT_SCOPE_INSUFFICIENT',
      'CONSENT_NOT_STARTED',
    ];
    let picked: { consent: ConsentLike; code: ConsentIssueCode } | null = null;
    for (const code of order) {
      const consent = candidates.find((item) => statusOf(item) === code);
      if (consent) {
        picked = { consent, code };
        break;
      }
    }

    const messages: Record<ConsentIssueCode, string> = {
      CONSENT_MISSING: '该访谈录音尚未登记任何授权，禁止发布',
      CONSENT_WITHDRAWN: '受访人已撤回授权，禁止继续发布（法定留痕保留）',
      CONSENT_EXPIRED: '授权期限已届满，需重新取得授权',
      CONSENT_SCOPE_INSUFFICIENT: '现有授权范围不覆盖目标发布范围',
      CONSENT_NOT_STARTED: '授权尚未生效',
    };

    issues.push({
      code: picked?.code ?? 'CONSENT_MISSING',
      recordingId,
      consentId: picked?.consent.id ?? null,
      message: picked ? messages[picked.code] : messages.CONSENT_MISSING,
    });
  }

  return {
    level: issues.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNING' : 'OK',
    issues,
    warnings,
    coveredBy,
  };
}

export const apiError = (code: string, message: string, details?: unknown) => ({
  error: { code, message, details },
  requestId: '',
});
