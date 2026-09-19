import { describe, expect, it } from 'vitest';
import { consentCreateSchema, consentUpdateSchema } from '../src/index.js';

const validBody = {
  intervieweeName: '王秀英',
  grantedAt: '2026-01-01',
  expiresOn: null,
  scope: {
    usages: ['TRANSCRIPTION', 'PUBLICATION'],
    channels: ['WEB'],
    requiresAnonymization: false,
    restrictions: '',
  },
};

describe('consentCreateSchema', () => {
  it('applies scope defaults for a valid consent', () => {
    const parsed = consentCreateSchema.parse(validBody);
    expect(parsed.scope.requiresAnonymization).toBe(false);
    expect(parsed.scope.restrictions).toBe('');
    expect(parsed.notes).toBe('');
    expect(parsed.expiresOn).toBeNull();
  });

  it('rejects empty usage list', () => {
    const parsed = consentCreateSchema.safeParse({
      ...validBody,
      scope: { ...validBody.scope, usages: [] },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects expiry earlier than grant date', () => {
    const parsed = consentCreateSchema.safeParse({
      ...validBody,
      grantedAt: '2026-05-01',
      expiresOn: '2026-04-01',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed dates and unknown fields', () => {
    expect(
      consentCreateSchema.safeParse({ ...validBody, grantedAt: '2026/01/01' })
        .success,
    ).toBe(false);
    expect(
      consentCreateSchema.safeParse({ ...validBody, version: 1 }).success,
    ).toBe(false);
  });
});

describe('consentUpdateSchema', () => {
  it('requires an optimistic-lock version', () => {
    expect(consentUpdateSchema.safeParse({ notes: 'x' }).success).toBe(false);
    expect(
      consentUpdateSchema.safeParse({ notes: 'x', version: 2 }).success,
    ).toBe(true);
  });

  it('validates cross-field dates when both supplied', () => {
    const parsed = consentUpdateSchema.safeParse({
      version: 1,
      grantedAt: '2026-05-01',
      expiresOn: '2026-04-01',
    });
    expect(parsed.success).toBe(false);
  });
});
