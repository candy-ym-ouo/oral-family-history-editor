import type { ConsentChannel, ConsentScope } from '@history/contracts';
import { consentScopeSchema } from '@history/contracts';

export const CONSENT_PUBLICATION_USAGE = 'PUBLICATION' as const;

export type ConsentRiskLevel = 'ok' | 'warning' | 'blocked';

export type ConsentRiskReason =
  | 'OK'
  | 'NO_CONSENT'
  | 'CONSENT_WITHDRAWN'
  | 'CONSENT_EXPIRED'
  | 'SCOPE_INVALID'
  | 'SCOPE_MISSING_PUBLICATION'
  | 'SCOPE_MISSING_CHANNEL'
  | 'ANONYMIZATION_REQUIRED';

export interface ConsentRisk {
  level: ConsentRiskLevel;
  reasonCode: ConsentRiskReason;
  message: string;
  consentId?: string;
  intervieweeName?: string;
}

export interface ConsentSnapshot {
  id: string;
  intervieweeName: string;
  status: 'ACTIVE' | 'WITHDRAWN';
  grantedAt: Date;
  expiresOn: Date | null;
  withdrawnAt: Date | null;
  scopeJson: unknown;
}

export interface RecordingConsentRisk extends ConsentRisk {
  recordingId: string;
  recordingTitle: string;
}

export interface ChapterConsentRisk {
  level: ConsentRiskLevel;
  reasonCode: ConsentRiskReason;
  message: string;
  recordings: RecordingConsentRisk[];
}

/** expiresOn 以授权到期日当天 23:59:59（UTC）为准，当天仍属授权有效期内 */
function isExpired(expiresOn: Date, now: Date): boolean {
  return now.getTime() >= expiresOn.getTime() + 24 * 60 * 60 * 1000;
}

export function parseScope(scopeJson: unknown): ConsentScope | null {
  const parsed = consentScopeSchema.safeParse(scopeJson);
  return parsed.success ? parsed.data : null;
}

/**
 * 评估单条录音的最新授权是否覆盖发布行为。
 * 约定：同一录音存在多条授权时，以最新一条为准（重新授权应新建记录）。
 */
export function evaluateConsent(
  consent: ConsentSnapshot | null,
  options: { now: Date; channel?: ConsentChannel },
): ConsentRisk {
  if (!consent) {
    return {
      level: 'blocked',
      reasonCode: 'NO_CONSENT',
      message: '尚未登记访谈授权，不得发布',
    };
  }

  if (consent.status === 'WITHDRAWN' || consent.withdrawnAt) {
    return {
      level: 'blocked',
      reasonCode: 'CONSENT_WITHDRAWN',
      message: `受访人${consent.intervieweeName ? `（${consent.intervieweeName}）` : ''}已撤回授权，撤回后不得继续发布；授权记录依法保留留痕`,
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  if (consent.expiresOn && isExpired(consent.expiresOn, options.now)) {
    return {
      level: 'blocked',
      reasonCode: 'CONSENT_EXPIRED',
      message: `授权已于 ${toDateText(consent.expiresOn)} 到期，续期前不得发布`,
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  const scope = parseScope(consent.scopeJson);
  if (!scope) {
    return {
      level: 'blocked',
      reasonCode: 'SCOPE_INVALID',
      message: '授权范围数据异常，请核对后重新登记',
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  if (!scope.usages.includes(CONSENT_PUBLICATION_USAGE)) {
    return {
      level: 'blocked',
      reasonCode: 'SCOPE_MISSING_PUBLICATION',
      message: '授权范围不包含“公开发表”，不得发布',
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  if (options.channel && !scope.channels.includes(options.channel)) {
    return {
      level: 'blocked',
      reasonCode: 'SCOPE_MISSING_CHANNEL',
      message: '授权范围不包含所选发布渠道',
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  if (scope.requiresAnonymization) {
    return {
      level: 'warning',
      reasonCode: 'ANONYMIZATION_REQUIRED',
      message: '授权要求发布前做匿名化处理，请确认相关内容已脱敏',
      consentId: consent.id,
      intervieweeName: consent.intervieweeName,
    };
  }

  return {
    level: 'ok',
    reasonCode: 'OK',
    message: '授权有效',
    consentId: consent.id,
    intervieweeName: consent.intervieweeName,
  };
}

/**
 * 汇总章节涉及的所有录音的授权风险。
 * 已发布的历史章节同样会被评估——撤回授权不会删除章节（法定留痕），
 * 但会以风险提示的形式标注，阻止再次发布。
 */
export function evaluateChapterRisk(
  items: Array<{
    recordingId: string;
    recordingTitle: string;
    consent: ConsentSnapshot | null;
  }>,
  options: { now: Date; channel?: ConsentChannel },
): ChapterConsentRisk {
  const recordings = items.map((item) => ({
    recordingId: item.recordingId,
    recordingTitle: item.recordingTitle,
    ...evaluateConsent(item.consent, options),
  }));

  const blocked = recordings.find((risk) => risk.level === 'blocked');
  if (blocked) {
    return {
      level: 'blocked',
      reasonCode: blocked.reasonCode,
      message: blocked.message,
      recordings,
    };
  }

  const warning = recordings.find((risk) => risk.level === 'warning');
  if (warning) {
    return {
      level: 'warning',
      reasonCode: warning.reasonCode,
      message: warning.message,
      recordings,
    };
  }

  return {
    level: 'ok',
    reasonCode: 'OK',
    message: recordings.length ? '授权有效' : '章节暂无可评估的录音片段',
    recordings,
  };
}

/** 授权当前生效状态：撤回优先，其次到期 */
export function consentState(
  consent: Pick<ConsentSnapshot, 'status' | 'withdrawnAt' | 'expiresOn'>,
  now: Date,
): 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED' {
  if (consent.status === 'WITHDRAWN' || consent.withdrawnAt) return 'WITHDRAWN';
  if (consent.expiresOn && isExpired(consent.expiresOn, now)) return 'EXPIRED';
  return 'ACTIVE';
}

export function toDateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}
