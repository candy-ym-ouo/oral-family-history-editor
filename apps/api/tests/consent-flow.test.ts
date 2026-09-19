// 集成测试：嵌入式 PostgreSQL + Fastify inject，覆盖授权登记 → 变更 → 撤回 →
// 发布拦截 → 已发布章节历史风险提示 → 审计留痕 的完整链路。
// 依赖 devDependency `embedded-postgres`；缺失时自动跳过（判定逻辑的单元测试在 contracts 包）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type EmbeddedPostgresType from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

let EmbeddedPostgres: typeof EmbeddedPostgresType | null = null;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  EmbeddedPostgres = null;
}

const PG_PORT = 54399;
const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

type Inject = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
) => Promise<{ statusCode: number; json: () => any }>;

const describeWithDb = EmbeddedPostgres ? describe : describe.skip;

describeWithDb('访谈授权全流程', () => {
  let app: any;
  let prisma: any;
  let pg: EmbeddedPostgresType;
  let call: Inject;

  let token: string;
  let workspaceId: string;
  let userId: string;
  let recordingId: string;
  let clipId: string;
  let chapterId: string;
  let consentId: string;

  async function startServer() {
    return (await import('../src/server.js')).app;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6399';
    process.env.PORT = '43999';
    process.env.JWT_SECRET = 'integration-test-secret-0123456789';
    process.env.STORAGE_DIR = '/tmp/itest-storage';

    rmSync('/tmp/itest-pgdata', { recursive: true, force: true });
    rmSync('/tmp/itest-storage', { recursive: true, force: true });

    pg = new EmbeddedPostgres!({
      databaseDir: '/tmp/itest-pgdata',
      user: 'postgres',
      password: 'postgres',
      port: PG_PORT,
      persistent: true,
    });
    await pg.initialise();
    await pg.start();

    execFileSync(
      '/workspace/node_modules/.bin/prisma',
      ['migrate', 'deploy', '--schema=/workspace/apps/api/prisma/schema.prisma'],
      { env: { ...process.env, DATABASE_URL }, stdio: 'inherit' },
    );

    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

    // Redis 在测试环境不可用：本测试不涉及上传入队，仅屏蔽连接告警。
    app = await startServer();
    app.log.level = 'silent';

    call = (async (method, url, payload) => {
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: payload as any,
      });
      return res as unknown as { statusCode: number; json: () => any };
    }) as Inject;
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (pg) await pg.stop();
  });

  it('准备用户、工作区、READY 录音、片段与章节', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'editor@example.com', password: 'password123' },
    });
    expect(reg.statusCode).toBe(201);
    token = reg.json().data.token;
    userId = reg.json().data.user.id;

    const ws = await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '集成测试家史' },
    });
    workspaceId = ws.json().data.id;

    const recording = await prisma.recording.create({
      data: {
        workspaceId,
        title: '爷爷的访谈',
        originalPath: '/tmp/fake.m4a',
        mimeType: 'audio/mp4',
        sizeBytes: BigInt(1000),
        durationMs: 60_000,
        status: 'READY',
        createdById: userId,
      },
    });
    recordingId = recording.id;

    const clip = await prisma.clip.create({
      data: {
        workspaceId,
        recordingId,
        title: '片段一',
        startMs: 0,
        endMs: 10_000,
        createdById: userId,
        updatedById: userId,
      },
    });
    clipId = clip.id;

    const chapter = await prisma.chapter.create({
      data: {
        workspaceId,
        title: '第一章',
        audience: 'FAMILY',
        createdById: userId,
      },
    });
    chapterId = chapter.id;
    await prisma.chapterBlock.create({
      data: { chapterId, type: 'clip', position: 'a', contentJson: {}, clipId },
    });
  });

  it('无授权时发布被 403 拦截，给出 CONSENT_MISSING', async () => {
    const res = await call('POST', `/v1/chapters/${chapterId}/publish`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CONSENT_PUBLISH_BLOCKED');
    expect(res.json().error.details.issues[0].code).toBe('CONSENT_MISSING');
  });

  it('登记 TRANSCRIPT 授权后，家族发布因范围不足被拦截', async () => {
    const res = await call('POST', `/v1/workspaces/${workspaceId}/consents`, {
      intervieweeName: '爷爷',
      scope: 'TRANSCRIPT',
      startAt: '2026-01-01T00:00:00.000Z',
      recordingIds: [recordingId],
      signature: '纸质签字',
    });
    expect(res.statusCode).toBe(201);
    consentId = res.json().data.id;

    const pub = await call('POST', `/v1/chapters/${chapterId}/publish`);
    expect(pub.statusCode).toBe(403);
    expect(pub.json().error.details.issues[0].code).toBe(
      'CONSENT_SCOPE_INSUFFICIENT',
    );
  });

  it('变更为 FAMILY 范围（乐观锁 + 留痕）后发布成功', async () => {
    const badVersion = await call('PATCH', `/v1/consents/${consentId}`, {
      scope: 'FAMILY',
      version: 99,
    });
    expect(badVersion.statusCode).toBe(409);

    const upd = await call('PATCH', `/v1/consents/${consentId}`, {
      scope: 'FAMILY',
      version: 1,
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.version).toBe(2);

    const pub = await call('POST', `/v1/chapters/${chapterId}/publish`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.status).toBe('PUBLISHED');
  });

  it('撤回授权后再次发布被拦截，登记记录依法保留', async () => {
    const wd = await call('POST', `/v1/consents/${consentId}/withdraw`, {
      reason: '受访人改变主意',
    });
    expect(wd.statusCode).toBe(200);
    expect(wd.json().data.state).toBe('WITHDRAWN');

    const again = await call('POST', `/v1/consents/${consentId}/withdraw`, {});
    expect(again.statusCode).toBe(409);

    const patch = await call('PATCH', `/v1/consents/${consentId}`, {
      scope: 'PUBLIC',
      version: wd.json().data.version,
    });
    expect(patch.statusCode).toBe(409);

    const pub = await call('POST', `/v1/chapters/${chapterId}/publish`);
    expect(pub.statusCode).toBe(403);
    expect(pub.json().error.details.issues[0].code).toBe('CONSENT_WITHDRAWN');

    const list = await call('GET', `/v1/workspaces/${workspaceId}/consents`);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].status).toBe('WITHDRAWN');
    expect(list.json().data[0].withdrawReason).toBe('受访人改变主意');
  });

  it('已发布的历史章节不删除，列表给出 BLOCKED 风险提示', async () => {
    const list = await call('GET', `/v1/workspaces/${workspaceId}/chapters`);
    expect(list.statusCode).toBe(200);
    const chapter = list.json().data[0];
    expect(chapter.status).toBe('PUBLISHED');
    expect(chapter.blocks).toHaveLength(1);
    expect(chapter.consentRisk.level).toBe('BLOCKED');
    expect(chapter.consentRisk.issues[0].code).toBe('CONSENT_WITHDRAWN');
  });

  it('审计日志按 登记→变更→撤回 顺序仅追加', async () => {
    const res = await call('GET', `/v1/consents/${consentId}/audit-log`);
    expect(res.statusCode).toBe(200);
    const actions = res.json().data.map((log: { action: string }) => log.action);
    expect(actions).toEqual(['CREATED', 'UPDATED', 'WITHDRAWN']);
  });

  it('过期授权实时计算为 EXPIRED；撤回授权的录音授权摘要清零', async () => {
    const created = await call('POST', `/v1/workspaces/${workspaceId}/consents`, {
      intervieweeName: '奶奶',
      scope: 'PUBLIC',
      startAt: '2025-01-01T00:00:00.000Z',
      endAt: '2025-06-01T00:00:00.000Z',
      recordingIds: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.state).toBe('EXPIRED');

    const recs = await call('GET', `/v1/workspaces/${workspaceId}/recordings`);
    const target = recs
      .json()
      .data.find((r: { id: string }) => r.id === recordingId);
    expect(target.consent.activeCount).toBe(0);
    expect(target.consent.maxScope).toBeNull();
  });
});
