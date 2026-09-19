# 口述家史编辑器

React + TypeScript 前端、Fastify API、BullMQ worker、PostgreSQL 和 Redis 组成的 pnpm monorepo。当前版本支持注册登录、创建工作区、上传真实音频、异步读取音频时长、创建固定时间范围片段、按时间段播放，以及章节/内容块和发布接口。

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
- `PATCH /v1/chapters/:id`
- `POST /v1/chapters/:id/blocks`
- `POST /v1/chapters/:id/publish`（授权门禁：无授权、撤回、到期或范围不覆盖发布时返回 403）
- `GET/POST /v1/recordings/:id/consents`（访谈授权登记：范围、用途、渠道、期限）
- `PATCH /v1/consents/:id`（乐观锁；已撤回记录不可修改）
- `POST /v1/consents/:id/withdraw`（撤回授权，撤回原因永久留痕）
- `GET /v1/consents/:id/events`（授权登记/变更/撤回的不可变操作留痕）
- `GET /v1/workspaces/:id/events`
- `GET /v1/realtime?workspaceId=...`（WebSocket）

健康检查为 `GET /health` 和 `GET /ready`。

## 访谈授权登记

每段录音可登记一条或多条访谈授权（受访人、授权日期、到期日、授权用途、发布渠道、匿名化要求与其他限制）。发布章节时系统会对章节引用的全部录音做授权校验：

- 未登记授权、授权已撤回、已到期，或授权范围不包含“公开发表”/所选渠道时，发布返回 403 `CONSENT_PUBLISH_BLOCKED`。
- 撤回授权**不会删除**授权记录与历史章节；撤回只追加 `RecordingConsentEvent` 事件（登记/变更/撤回），满足法定留痕要求，且已撤回记录不可再修改。
- 章节列表对每个章节实时计算 `consentRisk`；发布后被撤回或到期的历史章节会在前端显示红色风险横幅与留痕说明，但数据本身保留。
- 授权到期日按 UTC 当天 23:59:59 计算，到期日当天仍有效；到期日留空表示长期授权。

## 存储

默认将原始音频保存到仓库根目录下的 `storage/`，并通过带权限校验的 API 流式读取。可通过 `STORAGE_DIR` 修改路径。`docker-compose.yml` 中的 MinIO 使用 `object-storage` profile，当前不会随 `postgres redis` 一起启动：

```bash
docker compose --profile object-storage up -d minio
```

生产环境应使用独立数据库、Redis、对象存储和 secret manager，不要把 `.env` 或真实密钥提交到仓库。
