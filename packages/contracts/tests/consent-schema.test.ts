import { describe, expect, it } from 'vitest';
import {
  consentCreateSchema,
  consentUpdateSchema,
  effectiveConsentStatus,
  evaluateChapterConsent,
  scopeCovers,
} from '../src/index.js';

const now = new Date('2026-09-18T00:00:00.000Z');

const baseConsent = {
  id: 'c1',
  scope: 'FAMILY' as const,
  startAt: '2026-01-01T00:00:00.000Z',
  endAt: null as string | null,
  recordingIds: ['r1'],
};

describe('consent schemas', () => {
  it('applies defaults for a valid create payload', () => {
    const parsed = consentCreateSchema.parse({
      intervieweeName: '张三',
      scope: 'FAMILY',
      startAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.contactInfo).toBe('');
    expect(parsed.recordingIds).toEqual([]);
  });

  it('rejects endAt earlier than startAt', () => {
    const parsed = consentCreateSchema.safeParse({
      intervieweeName: '张三',
      scope: 'TRANSCRIPT',
      startAt: '2026-09-01T00:00:00.000Z',
      endAt: '2026-08-01T00:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires version on update', () => {
    expect(
      consentUpdateSchema.safeParse({ scope: 'PUBLIC' }).success,
    ).toBe(false);
  });
});

describe('scopeCovers', () => {
  it('orders TRANSCRIPT < FAMILY < PUBLIC', () => {
    expect(scopeCovers('PUBLIC', 'FAMILY')).toBe(true);
    expect(scopeCovers('FAMILY', 'FAMILY')).toBe(true);
    expect(scopeCovers('TRANSCRIPT', 'FAMILY')).toBe(false);
    expect(scopeCovers('FAMILY', 'PUBLIC')).toBe(false);
  });
});

describe('effectiveConsentStatus', () => {
  it('treats withdrawal as WITHDRAWN even before endAt', () => {
    expect(
      effectiveConsentStatus(
        {
          status: 'WITHDRAWN',
          withdrawnAt: '2026-05-01T00:00:00.000Z',
          endAt: '2027-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe('WITHDRAWN');
  });

  it('treats past endAt as EXPIRED', () => {
    expect(
      effectiveConsentStatus(
        { status: 'ACTIVE', withdrawnAt: null, endAt: '2026-08-01T00:00:00.000Z' },
        now,
      ),
    ).toBe('EXPIRED');
  });

  it('treats open-ended consent as ACTIVE', () => {
    expect(
      effectiveConsentStatus({ status: 'ACTIVE', withdrawnAt: null, endAt: null }, now),
    ).toBe('ACTIVE');
  });
});

describe('evaluateChapterConsent', () => {
  const blocks = [{ clip: { recordingId: 'r1' } }];

  it('passes when an in-scope active consent covers the recording', () => {
    const risk = evaluateChapterConsent(
      blocks,
      [{ ...baseConsent, scope: 'PUBLIC' }],
      'FAMILY',
      now,
    );
    expect(risk.level).toBe('OK');
    expect(risk.coveredBy.r1).toBe('c1');
  });

  it('blocks publishing after withdrawal but preserves the trail reason', () => {
    const risk = evaluateChapterConsent(
      blocks,
      [
        {
          ...baseConsent,
          status: 'WITHDRAWN',
          withdrawnAt: '2026-06-01T00:00:00.000Z',
          endAt: '2027-01-01T00:00:00.000Z',
        },
      ],
      'FAMILY',
      now,
    );
    expect(risk.level).toBe('BLOCKED');
    expect(risk.issues[0].code).toBe('CONSENT_WITHDRAWN');
  });

  it('blocks when consent scope does not cover audience', () => {
    const risk = evaluateChapterConsent(
      blocks,
      [{ ...baseConsent, scope: 'TRANSCRIPT' }],
      'PUBLIC',
      now,
    );
    expect(risk.level).toBe('BLOCKED');
    expect(risk.issues[0].code).toBe('CONSENT_SCOPE_INSUFFICIENT');
  });

  it('blocks when no consent is registered for the recording', () => {
    const risk = evaluateChapterConsent(blocks, [], 'FAMILY', now);
    expect(risk.level).toBe('BLOCKED');
    expect(risk.issues[0].code).toBe('CONSENT_MISSING');
  });

  it('warns when the covering consent expires within 30 days', () => {
    const risk = evaluateChapterConsent(
      blocks,
      [
        {
          ...baseConsent,
          endAt: '2026-09-25T00:00:00.000Z',
        },
      ],
      'FAMILY',
      now,
    );
    expect(risk.level).toBe('WARNING');
    expect(risk.warnings[0].code).toBe('CONSENT_EXPIRING_SOON');
  });

  it('ignores consents registered against other recordings', () => {
    const risk = evaluateChapterConsent(
      blocks,
      [{ ...baseConsent, recordingIds: ['r2'] }],
      'FAMILY',
      now,
    );
    expect(risk.level).toBe('BLOCKED');
    expect(risk.issues[0].code).toBe('CONSENT_MISSING');
  });
});
