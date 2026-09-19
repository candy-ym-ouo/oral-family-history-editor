import type { Prisma, PrismaClient } from '@prisma/client';
import {
  effectiveConsentStatus,
  evaluateChapterConsent,
  type ChapterConsentRisk,
  type ConsentLike,
  type ConsentScope,
} from '@history/contracts';

type DbClient = PrismaClient | Prisma.TransactionClient;

type ConsentWithRecordings = Prisma.InterviewConsentGetPayload<{
  include: { recordings: true };
}>;

export function toConsentLike(consent: ConsentWithRecordings, now: Date): ConsentLike {
  return {
    id: consent.id,
    intervieweeName: consent.intervieweeName,
    scope: consent.scope as ConsentScope,
    startAt: consent.startAt,
    endAt: consent.endAt,
    status: consent.status as ConsentLike['status'],
    withdrawnAt: consent.withdrawnAt,
    recordingIds: consent.recordings.map((link) => link.recordingId),
  };
}

/** 授权 DTO：DB status 只记录撤回，过期按期限实时计算 */
export function serializeConsent(consent: ConsentWithRecordings, now: Date = new Date()) {
  return {
    id: consent.id,
    workspaceId: consent.workspaceId,
    intervieweeName: consent.intervieweeName,
    contactInfo: consent.contactInfo,
    scope: consent.scope,
    startAt: consent.startAt,
    endAt: consent.endAt,
    agreementText: consent.agreementText,
    signature: consent.signature,
    evidenceRef: consent.evidenceRef,
    notes: consent.notes,
    status: consent.status,
    // 实时状态：WITHDRAWN / EXPIRED / ACTIVE
    state: effectiveConsentStatus(
      {
        status: consent.status as ConsentLike['status'],
        withdrawnAt: consent.withdrawnAt,
        endAt: consent.endAt,
      },
      now,
    ),
    withdrawnAt: consent.withdrawnAt,
    withdrawnById: consent.withdrawnById,
    withdrawReason: consent.withdrawReason,
    recordingIds: consent.recordings.map((link) => link.recordingId),
    version: consent.version,
    createdById: consent.createdById,
    createdAt: consent.createdAt,
    updatedAt: consent.updatedAt,
  };
}

export async function listWorkspaceConsents(
  db: DbClient,
  workspaceId: string,
): Promise<ConsentWithRecordings[]> {
  return db.interviewConsent.findMany({
    where: { workspaceId },
    include: { recordings: true },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });
}

type ChapterBlockForRisk = {
  clip?: { recordingId?: string | null } | null;
  clipId?: string | null;
};

type ChapterForRisk = {
  audience: ConsentScope;
  blocks: ChapterBlockForRisk[];
};

/**
 * 计算章节的授权合规风险。已发布章节同样评估：撤回/过期不会删除历史内容，
 * 只在章节列表给出 BLOCKED/WARNING 提示，并在发布接口作为硬门槛。
 * 注意：章节列表接口对 clip 做了 deletedAt 过滤，被引用片段被删除时 clip 为
 * null，此时同样视为授权无法核验（风险 + 发布拦截）。
 */
export function assessChapterRisk(
  chapter: ChapterForRisk,
  consents: ConsentWithRecordings[],
  now: Date = new Date(),
): ChapterConsentRisk {
  const likes = consents.map((consent) => toConsentLike(consent, now));
  const blocks = chapter.blocks.map((block) => {
    if (block.clip?.recordingId) {
      return { clip: { recordingId: block.clip.recordingId } };
    }
    // 引用了片段但片段已删除（过滤后 clip 为 null）：标记为无法核验的占位
    return block.clipId
      ? { clip: { recordingId: `deleted:${block.clipId}` } }
      : { clip: null };
  });
  return evaluateChapterConsent(
    blocks as Parameters<typeof evaluateChapterConsent>[0],
    likes,
    chapter.audience,
    now,
  );
}
