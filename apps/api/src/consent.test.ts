import { describe, expect, it } from 'vitest';
import {
  consentState,
  evaluateChapterRisk,
  evaluateConsent,
  type ConsentSnapshot,
} from './consent.js';

const NOW = new Date('2026-09-18T08:00:00.000Z');

const scope = (overrides: Record<string, unknown> = {}) => ({
  usages: ['TRANSCRIPTION', 'EDITING', 'PUBLICATION'],
  channels: ['PRINT', 'WEB'],
  requiresAnonymization: false,
  restrictions: '',
  ...overrides,
});

function snapshot(overrides: Partial<ConsentSnapshot> = {}): ConsentSnapshot {
  return {
    id: 'c1',
    intervieweeName: '王秀英',
    status: 'ACTIVE',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresOn: null,
    withdrawnAt: null,
    scopeJson: scope(),
    ...overrides,
  };
}

describe('evaluateConsent', () => {
  it('blocks publishing when no consent exists', () => {
    expect(evaluateConsent(null, { now: NOW })).toMatchObject({
      level: 'blocked',
      reasonCode: 'NO_CONSENT',
    });
  });

  it('blocks publishing after withdrawal and keeps the record reference', () => {
    const result = evaluateConsent(
      snapshot({
        status: 'WITHDRAWN',
        withdrawnAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
      { now: NOW },
    );
    expect(result).toMatchObject({
      level: 'blocked',
      reasonCode: 'CONSENT_WITHDRAWN',
      consentId: 'c1',
      intervieweeName: '王秀英',
    });
  });

  it('treats the expiry day itself as still valid and blocks the day after', () => {
    const expiresOn = new Date('2026-09-18T00:00:00.000Z');
    expect(
      evaluateConsent(snapshot({ expiresOn }), {
        now: new Date('2026-09-18T15:59:59.000Z'),
      }).level,
    ).toBe('ok');
    expect(
      evaluateConsent(snapshot({ expiresOn }), {
        now: new Date('2026-09-19T00:00:00.000Z'),
      }),
    ).toMatchObject({ level: 'blocked', reasonCode: 'CONSENT_EXPIRED' });
  });

  it('blocks when scope does not include publication', () => {
    const result = evaluateConsent(
      snapshot({ scopeJson: scope({ usages: ['TRANSCRIPTION'] }) }),
      { now: NOW },
    );
    expect(result).toMatchObject({
      level: 'blocked',
      reasonCode: 'SCOPE_MISSING_PUBLICATION',
    });
  });

  it('blocks when the selected channel is outside scope', () => {
    const result = evaluateConsent(snapshot(), { now: NOW, channel: 'BROADCAST' });
    expect(result).toMatchObject({
      level: 'blocked',
      reasonCode: 'SCOPE_MISSING_CHANNEL',
    });
  });

  it('warns instead of blocking when anonymization is required', () => {
    const result = evaluateConsent(
      snapshot({ scopeJson: scope({ requiresAnonymization: true }) }),
      { now: NOW },
    );
    expect(result.level).toBe('warning');
    expect(result.reasonCode).toBe('ANONYMIZATION_REQUIRED');
  });

  it('blocks malformed scope data', () => {
    const result = evaluateConsent(snapshot({ scopeJson: { broken: true } }), {
      now: NOW,
    });
    expect(result).toMatchObject({ level: 'blocked', reasonCode: 'SCOPE_INVALID' });
  });
});

describe('evaluateChapterRisk', () => {
  it('returns the worst risk across recordings so withdrawn historical chapters are flagged', () => {
    const risk = evaluateChapterRisk(
      [
        { recordingId: 'r1', recordingTitle: '访谈一', consent: snapshot() },
        {
          recordingId: 'r2',
          recordingTitle: '访谈二',
          consent: snapshot({
            id: 'c2',
            status: 'WITHDRAWN',
            withdrawnAt: new Date('2026-06-01T00:00:00.000Z'),
          }),
        },
      ],
      { now: NOW },
    );
    expect(risk.level).toBe('blocked');
    expect(risk.reasonCode).toBe('CONSENT_WITHDRAWN');
    expect(risk.recordings).toHaveLength(2);
    expect(risk.recordings.find((item) => item.recordingId === 'r1')?.level).toBe(
      'ok',
    );
  });

  it('downgrades to warning when all recordings are valid but one requires anonymization', () => {
    const risk = evaluateChapterRisk(
      [
        {
          recordingId: 'r1',
          recordingTitle: '访谈一',
          consent: snapshot({ scopeJson: scope({ requiresAnonymization: true }) }),
        },
      ],
      { now: NOW },
    );
    expect(risk.level).toBe('warning');
  });
});

describe('consentState', () => {
  it('prioritizes withdrawal over expiry', () => {
    expect(
      consentState(
        {
          status: 'WITHDRAWN',
          withdrawnAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresOn: new Date('2025-01-01T00:00:00.000Z'),
        },
        NOW,
      ),
    ).toBe('WITHDRAWN');
    expect(
      consentState(
        {
          status: 'ACTIVE',
          withdrawnAt: null,
          expiresOn: new Date('2025-01-01T00:00:00.000Z'),
        },
        NOW,
      ),
    ).toBe('EXPIRED');
  });
});
