# 口述家史编辑器

React + TypeScript 前端、Fastify API、BullMQ worker、PostgreSQL 和 Redis 组成的 pnpm monorepo。当前版本支持注册登录、创建工作区、上传真实音频、异步读取音频时长、创建固定时间范围片段、按时间段播放，章节/内容块、访谈授权登记（范围、期限、撤回、审计留痕），以及发布前授权校验。

## 环境要求

- Node.js 22.13 或更高版本
- pnpm 9
- Docker（本地 PostgreSQL、Redis）
- FFmpeg 可选。worker 优先使用 `ffprobe`，未安装时会使用 `music-metadata` 读取常见音频时长

## 本地启动

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:5173>。首次注册会自动登录并创建一个默认工作区；上传音频后，worker 会异步读取元数据，状态变为 `READY` 后即可创建片段。

开发阶段也可以用 `pnpm db:push` 直接同步 schema。根目录脚本会自动读取 `.env`；若文件不存在则回退到 `.env.example`。

## 检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 主要接口

- `POST /v1/auth/register`、`POST /v1/auth/login`
- `GET/POST /v1/workspaces`
- `POST /v1/workspaces/:id/recordings/uploads`
- `GET /v1/recordings/:id/file`（支持 HTTP Range）
- `GET/POST /v1/recordings/:id/clips`
- `PATCH /v1/clips/:id`（乐观锁，版本冲突返回 409）
- `GET/POST /v1/workspaces/:id/chapters`
- `PATCH /v1/chapters/:id`（含 `audience` 发布范围，乐观锁版本冲突返回 409）
- `POST /v1/chapters/:id/blocks`
- `POST /v1/chapters/:id/publish`（发布前强制授权校验，不通过返回 403 `CONSENT_PUBLISH_BLOCKED`）
- `GET/POST /v1/workspaces/:id/consents`
- `PATCH /v1/consents/:id`（乐观锁；已撤回不可变更，返回 409）
- `POST /v1/consents/:id/withdraw`（撤回不可撤销；不提供删除接口）
- `GET /v1/consents/:id/audit-log`（仅追加的授权审计留痕）
- `GET /v1/workspaces/:id/events`
- `GET /v1/realtime?workspaceId=...`（WebSocket）

健康检查为 `GET /health` 和 `GET /ready`。

## 访谈授权与合规

- 每份授权登记记录受访人、授权范围（`TRANSCRIPT` 仅文字整理 < `FAMILY` 家族内部 < `PUBLIC` 公开发布）、起止期限、签署/凭证信息以及覆盖的录音。
- 发布章节时，系统逐段检查内容块引用的录音：必须存在覆盖目标发布范围（章节 `audience`）、在期限内且未撤回的授权，否则返回 403 并列出具体问题（未登记 / 已撤回 / 已过期 / 范围不足 / 未生效）。
- 撤回授权即时生效并禁止相关章节发布；**授权登记、审计记录和已发布的历史内容都不会被删除**（法定留痕），章节接口返回 `consentRisk`（`OK` / `WARNING` 30 天内到期 / `BLOCKED`），前端对历史章节持续提示风险。
- 授权过期状态按期限实时计算，无需后台任务；`ConsentAuditLog` 仅追加（登记 / 变更 / 撤回），任何接口都不提供修改或删除。

## 存储

默认将原始音频保存到仓库根目录下的 `storage/`，并通过带权限校验的 API 流式读取。可通过 `STORAGE_DIR` 修改路径。`docker-compose.yml` 中的 MinIO 使用 `object-storage` profile，当前不会随 `postgres redis` 一起启动：

```bash
docker compose --profile object-storage up -d minio
```

生产环境应使用独立数据库、Redis、对象存储和 secret manager，不要把 `.env` 或真实密钥提交到仓库。
