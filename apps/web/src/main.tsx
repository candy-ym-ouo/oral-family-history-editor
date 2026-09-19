import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

type User = {
  id: string;
  email: string;
  displayName: string;
};

type AuthResponse = {
  token: string;
  user: User;
};

type WorkspaceModel = {
  id: string;
  name: string;
  timezone: string;
};

type Recording = {
  id: string;
  title: string;
  sizeBytes: string | number;
  durationMs: number;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  processingError?: string | null;
  _count?: { clips: number };
};

type Clip = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
  version: number;
};

type ConsentScope = 'TRANSCRIPT' | 'FAMILY' | 'PUBLIC';
type ConsentState = 'ACTIVE' | 'EXPIRED' | 'WITHDRAWN';

type Consent = {
  id: string;
  intervieweeName: string;
  contactInfo: string;
  scope: ConsentScope;
  startAt: string;
  endAt: string | null;
  agreementText: string;
  signature: string;
  evidenceRef: string;
  notes: string;
  status: 'ACTIVE' | 'EXPIRED' | 'WITHDRAWN';
  state: ConsentState;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  recordingIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ConsentAuditEntry = {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'WITHDRAWN';
  actorId: string;
  createdAt: string;
};

type ConsentIssue = {
  code:
    | 'CONSENT_MISSING'
    | 'CONSENT_WITHDRAWN'
    | 'CONSENT_EXPIRED'
    | 'CONSENT_SCOPE_INSUFFICIENT'
    | 'CONSENT_NOT_STARTED';
  recordingId: string;
  consentId: string | null;
  message: string;
};

type ConsentWarning = {
  code: 'CONSENT_EXPIRING_SOON';
  recordingId: string;
  consentId: string;
  message: string;
};

type ChapterConsentRisk = {
  level: 'OK' | 'WARNING' | 'BLOCKED';
  issues: ConsentIssue[];
  warnings: ConsentWarning[];
};

type ChapterBlock = {
  id: string;
  type: string;
  position: string;
  clipId: string | null;
};

type Chapter = {
  id: string;
  title: string;
  intro: string;
  status: 'DRAFT' | 'PUBLISHED';
  audience: ConsentScope;
  version: number;
  blocks: ChapterBlock[];
  consentRisk: ChapterConsentRisk;
  updatedAt: string;
};

type RecordingWithConsent = Recording & {
  consent: { activeCount: number; maxScope: ConsentScope | null };
};

const SCOPE_LABELS: Record<ConsentScope, string> = {
  TRANSCRIPT: '仅文字整理',
  FAMILY: '家族内部',
  PUBLIC: '公开发布',
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function fromDateInput(value: string, endOfDay = false): string | null {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}+08:00`).toISOString();
}

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem('token');
  const isFormData = init?.body instanceof FormData;

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API}${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload & {
    data?: T;
  };

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/v1/auth/')) {
      window.dispatchEvent(new Event('history:auth-expired'));
    }
    throw new ApiError(payload.error?.message || '请求失败，请稍后重试', response.status);
  }

  if (payload.data === undefined) {
    throw new ApiError('服务器返回格式错误', response.status);
  }
  return payload.data;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api<AuthResponse>(
        `/v1/auth/${register ? 'register' : 'login'}`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayName: email.split('@')[0],
          }),
        },
      );
      localStorage.setItem('token', result.token);
      onLogin(result.token);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form onSubmit={submit}>
        <div className="mark">家史</div>
        <h1>口述家史编辑器</h1>
        <p className="muted">把访谈录音整理成可阅读的家庭章节</p>
        <label>
          邮箱
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </label>
        <label>
          密码
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? '处理中...' : register ? '创建账户' : '登录'}</button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            setError('');
            setRegister((value) => !value);
          }}
        >
          {register ? '已有账户，去登录' : '首次使用，创建账户'}
        </button>
      </form>
    </main>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    const logout = () => {
      localStorage.removeItem('token');
      setToken(null);
    };
    window.addEventListener('history:auth-expired', logout);
    return () => window.removeEventListener('history:auth-expired', logout);
  }, []);

  if (!token) return <Login onLogin={setToken} />;

  return (
    <WorkspaceShell
      onLogout={() => {
        localStorage.removeItem('token');
        setToken(null);
      }}
    />
  );
}

type WorkspaceView = 'recordings' | 'consents' | 'chapters';

function WorkspaceShell({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<WorkspaceView>('recordings');
  const [workspace, setWorkspace] = useState<WorkspaceModel | null>(null);
  const [recordings, setRecordings] = useState<RecordingWithConsent[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) || null,
    [recordings, selectedId],
  );

  const loadRecordings = useCallback(async () => {
    if (!workspace) return;
    const rows = await api<RecordingWithConsent[]>(
      `/v1/workspaces/${workspace.id}/recordings`,
    );
    setRecordings(rows);
  }, [workspace]);

  const loadConsents = useCallback(async () => {
    if (!workspace) return;
    const rows = await api<Consent[]>(`/v1/workspaces/${workspace.id}/consents`);
    setConsents(rows);
  }, [workspace]);

  const loadChapters = useCallback(async () => {
    if (!workspace) return;
    const rows = await api<Chapter[]>(`/v1/workspaces/${workspace.id}/chapters`);
    setChapters(rows);
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoading(true);
      setError('');
      try {
        let workspaces = await api<WorkspaceModel[]>('/v1/workspaces');
        if (workspaces.length === 0) {
          const created = await api<WorkspaceModel>('/v1/workspaces', {
            method: 'POST',
            body: JSON.stringify({ name: '我的家史' }),
          });
          workspaces = [created];
        }

        const current = workspaces[0];
        const [rows, consentRows, chapterRows] = await Promise.all([
          api<RecordingWithConsent[]>(
            `/v1/workspaces/${current.id}/recordings`,
          ),
          api<Consent[]>(`/v1/workspaces/${current.id}/consents`),
          api<Chapter[]>(`/v1/workspaces/${current.id}/chapters`),
        ]);
        if (cancelled) return;
        setWorkspace(current);
        setRecordings(rows);
        setConsents(consentRows);
        setChapters(chapterRows);
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveProcessing = recordings.some(
    (recording) =>
      recording.status === 'UPLOADING' || recording.status === 'PROCESSING',
  );

  useEffect(() => {
    if (!workspace || !hasActiveProcessing) return;
    const timer = window.setInterval(() => {
      void loadRecordings().catch((pollError) => {
        setError((pollError as Error).message);
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [workspace, hasActiveProcessing, loadRecordings]);

  useEffect(() => {
    if (!selected) {
      setClips([]);
      return;
    }

    let cancelled = false;
    if (selected.status !== 'READY') {
      setClips([]);
      return;
    }

    void api<Clip[]>(`/v1/recordings/${selected.id}/clips`)
      .then((rows) => {
        if (!cancelled) setClips(rows);
      })
      .catch((clipError) => {
        if (!cancelled) setError((clipError as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !workspace) return;

    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);

    try {
      await api<Recording>(`/v1/workspaces/${workspace.id}/recordings/uploads`, {
        method: 'POST',
        body: form,
      });
      await loadRecordings();
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const navItems: { key: WorkspaceView; label: string }[] = [
    { key: 'recordings', label: '访谈录音' },
    { key: 'consents', label: '授权登记' },
    { key: 'chapters', label: '章节发布' },
  ];

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="mark small">家史</span>
          <strong>{workspace?.name || '口述家史'}</strong>
        </div>
        <nav className="topnav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`navtab ${view === item.key ? 'active' : ''}`}
              onClick={() => setView(item.key)}
            >
              {item.label}
              {item.key === 'chapters' &&
                chapters.some((chapter) => chapter.consentRisk.level === 'BLOCKED') && (
                  <span className="nav-dot" title="存在授权风险章节" />
                )}
            </button>
          ))}
          <button className="ghost" onClick={onLogout}>
            退出
          </button>
        </nav>
      </header>

      {view === 'consents' && workspace ? (
        <ConsentRegistry
          workspaceId={workspace.id}
          recordings={recordings}
          consents={consents}
          onChanged={() => {
            void loadConsents();
            void loadChapters();
            void loadRecordings();
          }}
        />
      ) : view === 'chapters' && workspace ? (
        <Chapters
          workspaceId={workspace.id}
          chapters={chapters}
          recordings={recordings}
          onChanged={() => {
            void loadChapters();
          }}
        />
      ) : (
        <div className="layout">
          <aside>
            <div className="aside-head">
              <span>访谈录音</span>
              <label className={`upload ${busy ? 'disabled' : ''}`}>
                + 上传录音
                <input
                  ref={fileInput}
                  type="file"
                  accept="audio/*,.m4a,.flac,.aac,.ogg,.opus"
                  onChange={upload}
                  disabled={busy || !workspace}
                />
              </label>
            </div>
            {busy && <div className="progress">正在上传，请勿关闭页面...</div>}
            {error && <div className="error sidebar-error">{error}</div>}
            {loading && <p className="empty">正在加载工作区...</p>}
            {!loading &&
              recordings.map((recording) => (
                <button
                  key={recording.id}
                  type="button"
                  className={`recording ${selectedId === recording.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(recording.id)}
                >
                  <span className="play">▶</span>
                  <span>
                    <b>{recording.title}</b>
                    <small>
                      {recording.status === 'READY'
                        ? '可编辑'
                        : recording.status === 'FAILED'
                          ? '处理失败'
                          : '处理中'}{' '}
                      · {recording._count?.clips || 0} 个片段
                    </small>
                    <small className="recording-consent">
                      {recording.consent.activeCount === 0 ? (
                        <span className="risk-tag blocked">未登记授权</span>
                      ) : (
                        <span
                          className={`risk-tag ${recording.consent.maxScope === 'TRANSCRIPT' ? 'warn' : 'ok'}`}
                        >
                          授权：{SCOPE_LABELS[recording.consent.maxScope ?? 'TRANSCRIPT']}
                        </span>
                      )}
                    </small>
                  </span>
                </button>
              ))}
            {!loading && !recordings.length && !busy && (
              <p className="empty">上传一段访谈录音开始整理。</p>
            )}
          </aside>

          <section className="content">
            {selected ? (
              <Editor
                key={selected.id}
                recording={selected}
                clips={clips}
                setClips={setClips}
              />
            ) : (
              <div className="welcome">
                <div className="wave decorative">〰 〰 〰</div>
                <h2>从一段声音开始</h2>
                <p>选择左侧录音，在时间轴上标记片段并整理内容。</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ConsentStateBadge({ state }: { state: ConsentState }) {
  const label =
    state === 'ACTIVE' ? '有效' : state === 'EXPIRED' ? '已过期' : '已撤回';
  return <span className={`risk-tag ${state === 'ACTIVE' ? 'ok' : state === 'EXPIRED' ? 'warn' : 'blocked'}`}>{label}</span>;
}

type ConsentDraft = {
  intervieweeName: string;
  contactInfo: string;
  scope: ConsentScope;
  startAt: string;
  endAt: string;
  signature: string;
  evidenceRef: string;
  notes: string;
  recordingIds: string[];
};

const emptyConsentDraft = (): ConsentDraft => ({
  intervieweeName: '',
  contactInfo: '',
  scope: 'FAMILY',
  startAt: new Date().toISOString().slice(0, 10),
  endAt: '',
  signature: '',
  evidenceRef: '',
  notes: '',
  recordingIds: [],
});

function ConsentRegistry({
  workspaceId,
  recordings,
  consents,
  onChanged,
}: {
  workspaceId: string;
  recordings: RecordingWithConsent[];
  consents: Consent[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<ConsentDraft>(emptyConsentDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyConsentDraft());
    setError('');
    setShowForm(true);
  };

  const startEdit = (consent: Consent) => {
    setEditingId(consent.id);
    setDraft({
      intervieweeName: consent.intervieweeName,
      contactInfo: consent.contactInfo,
      scope: consent.scope,
      startAt: toDateInput(consent.startAt),
      endAt: toDateInput(consent.endAt),
      signature: consent.signature,
      evidenceRef: consent.evidenceRef,
      notes: consent.notes,
      recordingIds: consent.recordingIds,
    });
    setError('');
    setShowForm(true);
  };

  const toggleRecording = (id: string) => {
    setDraft((current) => ({
      ...current,
      recordingIds: current.recordingIds.includes(id)
        ? current.recordingIds.filter((item) => item !== id)
        : [...current.recordingIds, id],
    }));
  };

  const submit = async () => {
    if (!draft.intervieweeName.trim()) {
      setError('请填写受访人姓名');
      return;
    }
    const payload = {
      intervieweeName: draft.intervieweeName.trim(),
      contactInfo: draft.contactInfo.trim(),
      scope: draft.scope,
      startAt: fromDateInput(draft.startAt) ?? new Date().toISOString(),
      endAt: fromDateInput(draft.endAt, true),
      signature: draft.signature.trim(),
      evidenceRef: draft.evidenceRef.trim(),
      notes: draft.notes.trim(),
      recordingIds: draft.recordingIds,
    };

    setSaving(true);
    setError('');
    try {
      if (editingId) {
        const current = consents.find((item) => item.id === editingId);
        const { intervieweeName: _name, contactInfo: _contact, ...mutable } = payload;
        await api(`/v1/consents/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...mutable, version: current?.version }),
        });
      } else {
        await api(`/v1/workspaces/${workspaceId}/consents`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      setEditingId(null);
      onChanged();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (consent: Consent) => {
    const reason = withdrawReason.trim();
    if (!window.confirm('撤回后该授权将永久失效并禁止相关内容发布，但登记记录会依法保留。确认撤回？')) {
      return;
    }
    setError('');
    try {
      await api(`/v1/consents/${consent.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setWithdrawReason('');
      setDetailId(null);
      onChanged();
    } catch (withdrawError) {
      setError((withdrawError as Error).message);
    }
  };

  const detail = consents.find((item) => item.id === detailId) || null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">合规</span>
          <h2>访谈授权登记</h2>
          <p className="muted small">
            登记受访人的授权范围、期限与签署凭证。撤回授权会立即限制相关章节发布；所有登记与撤回记录仅追加、不可删除，作为法定留痕保留。
          </p>
        </div>
        {!showForm && (
          <button type="button" className="primary" onClick={startCreate}>
            + 登记授权
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {showForm && (
        <div className="card consent-form">
          <div className="section-title">{editingId ? '变更授权' : '登记授权'}</div>
          <div className="form-grid">
            <label>
              受访人姓名
              <input
                value={draft.intervieweeName}
                disabled={Boolean(editingId)}
                onChange={(event) => setDraft({ ...draft, intervieweeName: event.target.value })}
                placeholder="如：张某某"
              />
            </label>
            <label>
              联系方式
              <input
                value={draft.contactInfo}
                disabled={Boolean(editingId)}
                onChange={(event) => setDraft({ ...draft, contactInfo: event.target.value })}
                placeholder="电话 / 邮箱（可选）"
              />
            </label>
            <label>
              授权范围
              <select
                value={draft.scope}
                onChange={(event) => setDraft({ ...draft, scope: event.target.value as ConsentScope })}
              >
                <option value="TRANSCRIPT">仅文字整理（不得发布）</option>
                <option value="FAMILY">家族内部发布</option>
                <option value="PUBLIC">公开发布</option>
              </select>
            </label>
            <label>
              授权开始日期
              <input
                type="date"
                value={draft.startAt}
                onChange={(event) => setDraft({ ...draft, startAt: event.target.value })}
              />
            </label>
            <label>
              授权截止日期（留空为长期）
              <input
                type="date"
                value={draft.endAt}
                onChange={(event) => setDraft({ ...draft, endAt: event.target.value })}
              />
            </label>
            <label>
              签署方式 / 签名
              <input
                value={draft.signature}
                onChange={(event) => setDraft({ ...draft, signature: event.target.value })}
                placeholder="如：纸质签字、电子签名、口头知情同意见证人"
              />
            </label>
            <label>
              凭证编号 / 文件位置
              <input
                value={draft.evidenceRef}
                onChange={(event) => setDraft({ ...draft, evidenceRef: event.target.value })}
                placeholder="如：档案柜 A-03 / 对象存储路径"
              />
            </label>
            <label className="span-2">
              备注
              <input
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </label>
          </div>

          <div className="recording-picker">
            <div className="picker-title">授权覆盖的访谈录音</div>
            {recordings.length === 0 && <p className="empty">暂无录音，可先保存登记，之后再补充关联。</p>}
            <div className="picker-list">
              {recordings.map((recording) => (
                <label key={recording.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.recordingIds.includes(recording.id)}
                    onChange={() => toggleRecording(recording.id)}
                  />
                  <span>{recording.title}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              取消
            </button>
            <button type="button" className="primary" disabled={saving} onClick={submit}>
              {saving ? '保存中...' : editingId ? '保存变更（留痕）' : '保存登记'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title">授权记录 <span>{consents.length}</span></div>
        {consents.map((consent) => (
          <div className="consent-row" key={consent.id}>
            <div className="consent-main" onClick={() => setDetailId(detailId === consent.id ? null : consent.id)}>
              <b>{consent.intervieweeName}</b>
              <small>
                <ConsentStateBadge state={consent.state} />
                <span className="scope-pill">{SCOPE_LABELS[consent.scope]}</span>
                {toDateInput(consent.startAt)} 起 ·{' '}
                {consent.endAt ? `至 ${toDateInput(consent.endAt)}` : '长期有效'} ·
                覆盖 {consent.recordingIds.length} 段录音
              </small>
              {consent.state === 'WITHDRAWN' && (
                <small className="risk-text blocked">
                  已于 {toDateInput(consent.withdrawnAt)} 撤回（记录依法保留，不可删除）
                  {consent.withdrawReason ? `：${consent.withdrawReason}` : ''}
                </small>
              )}
            </div>
            <div className="consent-actions">
              <button type="button" className="ghost" onClick={() => setDetailId(detailId === consent.id ? null : consent.id)}>
                留痕
              </button>
              {consent.state === 'ACTIVE' && (
                <>
                  <button type="button" className="ghost" onClick={() => startEdit(consent)}>
                    变更
                  </button>
                  <button type="button" className="danger" onClick={() => withdraw(consent)}>
                    撤回
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {!consents.length && <p className="empty clip-empty">还没有授权登记。发布章节前必须为相关访谈登记有效授权。</p>}
      </div>

      {detail && (
        <ConsentAuditPanel
          consent={detail}
          reason={withdrawReason}
          onReasonChange={setWithdrawReason}
          onWithdraw={() => withdraw(detail)}
        />
      )}
    </div>
  );
}

function ConsentAuditPanel({
  consent,
  reason,
  onReasonChange,
  onWithdraw,
}: {
  consent: Consent;
  reason: string;
  onReasonChange: (value: string) => void;
  onWithdraw: () => void;
}) {
  const [logs, setLogs] = useState<ConsentAuditEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setLoadError('');
    void api<ConsentAuditEntry[]>(`/v1/consents/${consent.id}/audit-log`)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((error) => {
        if (!cancelled) setLoadError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [consent.id]);

  const actionLabels: Record<ConsentAuditEntry['action'], string> = {
    CREATED: '登记',
    UPDATED: '变更',
    WITHDRAWN: '撤回',
  };

  return (
    <div className="card audit-panel">
      <div className="section-title">法定留痕 · {consent.intervieweeName}</div>
      <p className="muted small">
        以下审计记录仅追加保存，任何角色都不能修改或删除，用于证明授权的取得、变更与撤回过程。
      </p>
      {loadError && <div className="error">{loadError}</div>}
      {logs === null && !loadError && <p className="empty">正在载入留痕...</p>}
      {logs?.map((log) => (
        <div className="audit-row" key={log.id}>
          <span className={`audit-action ${log.action.toLowerCase()}`}>{actionLabels[log.action]}</span>
          <small>{new Date(log.createdAt).toLocaleString('zh-CN')}</small>
        </div>
      ))}
      {logs?.length === 0 && <p className="empty">暂无记录。</p>}

      {consent.state === 'ACTIVE' && (
        <div className="withdraw-box">
          <label>
            撤回原因（将随撤回记录永久留存）
            <input value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="如：受访人要求停止公开" />
          </label>
          <button type="button" className="danger" onClick={onWithdraw}>
            确认撤回授权
          </button>
          <p className="risk-text blocked small">
            撤回即时生效：相关章节将无法发布；历史内容与本登记记录依法保留，仅做风险提示。
          </p>
        </div>
      )}
    </div>
  );
}

function RiskBanner({ risk, status }: { risk: ChapterConsentRisk; status: Chapter['status'] }) {
  if (risk.level === 'OK') return null;
  return (
    <div className={`risk-banner ${risk.level.toLowerCase()}`}>
      <b>{risk.level === 'BLOCKED' ? '⛔ 授权风险 · 禁止发布' : '⚠ 授权即将到期'}</b>
      {status === 'PUBLISHED' && (
        <span className="history-note">
          该章节已发布。依授权规则不得删除历史内容（法定留痕保留），请尽快下架公开渠道或补登授权。
        </span>
      )}
      <ul>
        {risk.issues.map((issue) => (
          <li key={`${issue.code}-${issue.recordingId}`}>{issue.message}</li>
        ))}
        {risk.warnings.map((warning) => (
          <li key={`${warning.code}-${warning.recordingId}`}>{warning.message}</li>
        ))}
      </ul>
    </div>
  );
}

function Chapters({
  workspaceId,
  chapters,
  recordings,
  onChanged,
}: {
  workspaceId: string;
  chapters: Chapter[];
  recordings: RecordingWithConsent[];
  onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<ConsentScope>('FAMILY');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim()) {
      setError('请填写章节标题');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/v1/workspaces/${workspaceId}/chapters`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), audience }),
      });
      setTitle('');
      onChanged();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeAudience = async (chapter: Chapter, next: ConsentScope) => {
    setError('');
    try {
      await api(`/v1/chapters/${chapter.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ audience: next, version: chapter.version }),
      });
      onChanged();
    } catch (changeError) {
      setError((changeError as Error).message);
    }
  };

  const publish = async (chapter: Chapter) => {
    setPublishingId(chapter.id);
    setError('');
    try {
      await api(`/v1/chapters/${chapter.id}/publish`, { method: 'POST' });
      onChanged();
    } catch (publishError) {
      setError((publishError as Error).message);
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">发布</span>
          <h2>章节与授权合规</h2>
          <p className="muted small">
            发布前系统会逐段校验访谈授权：范围必须覆盖目标发布渠道、在期限内且未被撤回。撤回或过期后，已发布章节保留并标记风险，新发布将被拦截。
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card chapter-create">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新章节标题"
        />
        <select value={audience} onChange={(event) => setAudience(event.target.value as ConsentScope)}>
          <option value="TRANSCRIPT">仅文字整理</option>
          <option value="FAMILY">家族内部发布</option>
          <option value="PUBLIC">公开发布</option>
        </select>
        <button type="button" className="primary" disabled={saving} onClick={create}>
          {saving ? '创建中...' : '新建章节'}
        </button>
      </div>

      <div className="card">
        <div className="section-title">章节列表 <span>{chapters.length}</span></div>
        {chapters.map((chapter) => (
          <div className="chapter-row" key={chapter.id}>
            <div className="chapter-head">
              <div>
                <b>{chapter.title}</b>
                <small>
                  <span className={`status-chip ${chapter.status.toLowerCase()}`}>
                    {chapter.status === 'PUBLISHED' ? '已发布' : '草稿'}
                  </span>
                  {chapter.blocks.length} 个内容块 · 更新于{' '}
                  {new Date(chapter.updatedAt).toLocaleDateString('zh-CN')}
                </small>
              </div>
              <div className="chapter-controls">
                <label className="audience-select">
                  发布范围
                  <select
                    value={chapter.audience}
                    onChange={(event) => changeAudience(chapter, event.target.value as ConsentScope)}
                  >
                    <option value="TRANSCRIPT">仅文字整理</option>
                    <option value="FAMILY">家族内部</option>
                    <option value="PUBLIC">公开发布</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    chapter.consentRisk.level === 'BLOCKED' ||
                    publishingId === chapter.id ||
                    chapter.blocks.length === 0
                  }
                  title={
                    chapter.blocks.length === 0
                      ? '章节至少需要一个内容块'
                      : chapter.consentRisk.level === 'BLOCKED'
                        ? '访谈授权校验未通过'
                        : ''
                  }
                  onClick={() => publish(chapter)}
                >
                  {publishingId === chapter.id
                    ? '发布中...'
                    : chapter.status === 'PUBLISHED'
                      ? '重新发布'
                      : '发布'}
                </button>
              </div>
            </div>
            <RiskBanner risk={chapter.consentRisk} status={chapter.status} />
          </div>
        ))}
        {!chapters.length && (
          <p className="empty clip-empty">还没有章节。可先在「访谈录音」中整理片段，再创建章节并添加内容块。</p>
        )}
      </div>

      {recordings.some((recording) => recording.consent.activeCount === 0) && (
        <div className="card warning-card">
          <b>存在未登记授权的访谈录音</b>
          <p className="muted small">
            引用这些录音的章节将无法发布。请先到「授权登记」页取得并登记受访人授权。
          </p>
        </div>
      )}
    </div>
  );
}

function formatTime(milliseconds: number) {
  const safeMs = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(safeMs % 1000);
  const prefix = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function Editor({
  recording,
  clips,
  setClips,
}: {
  recording: Recording;
  clips: Clip[];
  setClips: React.Dispatch<React.SetStateAction<Clip[]>>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const playbackEnd = useRef<number | null>(null);
  const [duration, setDuration] = useState(recording.durationMs || 0);
  const [draft, setDraft] = useState({
    title: '新片段',
    startMs: 0,
    endMs: Math.min(recording.durationMs || 10_000, 10_000),
    summary: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const token = localStorage.getItem('token') || '';
  const audioUrl = `${API}/v1/recordings/${recording.id}/file?token=${encodeURIComponent(token)}`;
  const timelineDuration = duration > 0 ? duration : recording.durationMs;

  useEffect(() => {
    setDuration(recording.durationMs || 0);
    setDraft({
      title: '新片段',
      startMs: 0,
      endMs: Math.min(recording.durationMs || 10_000, 10_000),
      summary: '',
    });
    setError('');
  }, [recording.id, recording.durationMs]);

  const addClip = async () => {
    const title = draft.title.trim();
    if (!title) {
      setError('请输入片段标题');
      return;
    }
    if (
      !Number.isInteger(draft.startMs) ||
      !Number.isInteger(draft.endMs) ||
      draft.startMs < 0 ||
      draft.endMs <= draft.startMs
    ) {
      setError('出点必须大于入点');
      return;
    }
    if (timelineDuration > 0 && draft.endMs > timelineDuration) {
      setError('出点不能超过录音时长');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const created = await api<Clip>(`/v1/recordings/${recording.id}/clips`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          title,
          transcript: '',
        }),
      });
      setClips((current) =>
        [...current, created].sort((a, b) => a.startMs - b.startMs),
      );
      setDraft((current) => ({
        title: '新片段',
        startMs: current.endMs,
        endMs: Math.min(current.endMs + 10_000, timelineDuration),
        summary: '',
      }));
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const playClip = (clip: Clip) => {
    const element = audio.current;
    if (!element) return;
    playbackEnd.current = clip.endMs / 1000;
    element.currentTime = clip.startMs / 1000;
    void element.play().catch((playError) => {
      setError((playError as Error).message);
    });
  };

  if (recording.status !== 'READY') {
    return (
      <div className="editor">
        <div className="editor-head">
          <div>
            <span className="eyebrow">录音</span>
            <h2>{recording.title}</h2>
          </div>
          <span className={`status ${recording.status.toLowerCase()}`}>
            {recording.status}
          </span>
        </div>
        <div className="processing">
          {recording.status === 'FAILED'
            ? `处理失败：${recording.processingError || '请稍后重试'}`
            : '录音正在处理中，完成后即可创建片段。'}
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <div>
          <span className="eyebrow">录音</span>
          <h2>{recording.title}</h2>
        </div>
        <span className="status">READY</span>
      </div>

      <audio
        ref={audio}
        controls
        src={audioUrl}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration * 1000;
          if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setDuration(nextDuration);
          }
        }}
        onTimeUpdate={(event) => {
          const end = playbackEnd.current;
          if (end !== null && event.currentTarget.currentTime >= end) {
            event.currentTarget.pause();
            playbackEnd.current = null;
          }
        }}
        onEnded={() => {
          playbackEnd.current = null;
        }}
      />

      <div className="timeline">
        <div className="ruler">
          <span>00:00.000</span>
          <span>{formatTime(timelineDuration / 2)}</span>
          <span>{formatTime(timelineDuration)}</span>
        </div>
        <div className="waveform">
          {Array.from({ length: 80 }, (_, index) => (
            <i
              key={index}
              style={{ height: `${18 + Math.abs(Math.sin(index * 1.7)) * 60}%` }}
            />
          ))}
          {timelineDuration > 0 &&
            clips.map((clip) => (
              <div
                className="clip"
                key={clip.id}
                style={{
                  left: `${Math.max(0, Math.min(100, (clip.startMs / timelineDuration) * 100))}%`,
                  width: `${Math.max(
                    1,
                    Math.min(
                      100,
                      ((clip.endMs - clip.startMs) / timelineDuration) * 100,
                    ),
                  )}%`,
                }}
                title={clip.title}
              >
                {clip.title}
              </div>
            ))}
        </div>
      </div>

      <div className="clip-form">
        <div className="form-title">新建片段</div>
        <label className="title-field">
          标题
          <input
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="片段标题"
          />
        </label>
        <label>
          入点 (毫秒)
          <input
            type="number"
            min="0"
            step="1"
            value={draft.startMs}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                startMs: Number(event.target.value),
              }))
            }
          />
        </label>
        <label>
          出点 (毫秒)
          <input
            type="number"
            min="1"
            step="1"
            value={draft.endMs}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                endMs: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="summary-field">
          摘要
          <input
            value={draft.summary}
            onChange={(event) =>
              setDraft((current) => ({ ...current, summary: event.target.value }))
            }
            placeholder="摘要（可选）"
          />
        </label>
        <button type="button" onClick={addClip} disabled={saving}>
          {saving ? '保存中...' : '保存片段'}
        </button>
      </div>

      {error && <div className="error editor-error">{error}</div>}

      <div className="clips">
        <div className="section-title">
          片段列表 <span>{clips.length}</span>
        </div>
        {clips.map((clip) => (
          <div className="clip-row" key={clip.id}>
            <button
              type="button"
              className="icon"
              aria-label={`播放 ${clip.title}`}
              onClick={() => playClip(clip)}
            >
              ▶
            </button>
            <div>
              <b>{clip.title}</b>
              <small>
                {formatTime(clip.startMs)} - {formatTime(clip.endMs)} ·{' '}
                {clip.summary || '暂无摘要'}
              </small>
            </div>
          </div>
        ))}
        {!clips.length && <p className="empty clip-empty">还没有片段。</p>}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载节点');
createRoot(root).render(<App />);
