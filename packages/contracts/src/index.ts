import { z } from 'zod';

export const roleSchema = z.enum(['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER']);

const titleSchema = z.string().trim().min(1).max(160);
const summarySchema = z.string().max(4000);
const transcriptSchema = z.string().max(20_000);
const speakerPersonIdSchema = z.string().uuid().nullable();

// 访谈授权用途
export const consentUsageSchema = z.enum([
  'TRANSCRIPTION', // 文字整理
  'EDITING', // 编辑成书
  'PUBLICATION', // 公开发表
  'RESEARCH', // 学术研究
  'ARCHIVE', // 归档保存
]);

// 发布渠道
export const consentChannelSchema = z.enum([
  'PRINT', // 纸质出版
  'WEB', // 网络公开
  'SOCIAL_MEDIA', // 社交媒体
  'BROADCAST', // 音视频播出
  'PRIVATE_CIRCLE', // 家族内部
]);

const consentScopeBase = {
  usages: z.array(consentUsageSchema).min(1).max(20),
  channels: z.array(consentChannelSchema).min(1).max(20),
  attributionName: z.string().trim().max(120).optional(),
  requiresAnonymization: z.boolean().default(false),
  restrictions: z.string().trim().max(2000).default(''),
};

export const consentScopeSchema = z.object(consentScopeBase).strict();

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: '无效日期',
  });

export const consentCreateSchema = z
  .object({
    intervieweeName: z.string().trim().min(1).max(120),
    intervieweeContact: z.string().trim().max(200).default(''),
    grantedAt: isoDateSchema,
    expiresOn: isoDateSchema.nullable().default(null),
    scope: consentScopeSchema,
    notes: z.string().trim().max(4000).default(''),
  })
  .strict()
  .refine(
    (value) => value.expiresOn === null || value.expiresOn >= value.grantedAt,
    { message: '授权到期日不能早于授权日', path: ['expiresOn'] },
  );

export const consentUpdateSchema = z
  .object({
    intervieweeName: z.string().trim().min(1).max(120).optional(),
    intervieweeContact: z.string().trim().max(200).optional(),
    grantedAt: isoDateSchema.optional(),
    expiresOn: isoDateSchema.nullable().optional(),
    scope: consentScopeSchema.optional(),
    notes: z.string().trim().max(4000).optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.grantedAt === undefined ||
      value.expiresOn === undefined ||
      value.expiresOn === null ||
      value.expiresOn >= value.grantedAt,
    { message: '授权到期日不能早于授权日', path: ['expiresOn'] },
  );

export const consentWithdrawSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

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
  })
  .strict();

export const chapterUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    intro: z.string().max(10_000).optional(),
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

export type Role = z.infer<typeof roleSchema>;
export type ClipInput = z.infer<typeof clipSchema>;
export type ClipUpdateInput = z.infer<typeof clipUpdateSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type ChapterBlockCreateInput = z.infer<typeof chapterBlockCreateSchema>;
export type ConsentUsage = z.infer<typeof consentUsageSchema>;
export type ConsentChannel = z.infer<typeof consentChannelSchema>;
export type ConsentScope = z.infer<typeof consentScopeSchema>;
export type ConsentCreateInput = z.infer<typeof consentCreateSchema>;
export type ConsentUpdateInput = z.infer<typeof consentUpdateSchema>;
export type ConsentWithdrawInput = z.infer<typeof consentWithdrawSchema>;

export const apiError = (code: string, message: string, details?: unknown) => ({
  error: { code, message, details },
  requestId: '',
});
