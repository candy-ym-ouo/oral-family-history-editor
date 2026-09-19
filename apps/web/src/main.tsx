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
  latestConsent?: {
    id: string;
    intervieweeName: string;
    state: ConsentState;
  } | null;
};

type Clip = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
  version: number;
};

type ConsentState = 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';

type ConsentScope = {
  usages: string[];
  channels: string[];
  attributionName?: string;
  requiresAnonymization: boolean;
  restrictions: string;
};

type Consent = {
  id: string;
  intervieweeName: string;
  intervieweeContact: string;
  grantedAt: string;
  expiresOn: string | null;
  scopeJson: ConsentScope;
  notes: string;
  status: 'ACTIVE' | 'WITHDRAWN';
  state: ConsentState;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  version: number;
};

type ConsentEvent = {
  id: string;
  type: 'GRANTED' | 'UPDATED' | 'WITHDRAWN';
  detailJson: unknown;
  createdAt: string;
};

type ConsentRisk = {
  level: 'ok' | 'warning' | 'blocked';
  reasonCode: string;
  message: string;
  recordings: Array<{
    recordingId: string;
    recordingTitle: string;
    level: 'ok' | 'warning' | 'blocked';
    reasonCode: string;
    message: string;
  }>;
};

type ChapterBlock = {
  id: string;
  type: string;
  clipId: string | null;
};

type Chapter = {
  id: string;
  title: string;
  intro: string;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  blocks: ChapterBlock[];
  updatedAt: string;
  consentRisk: ConsentRisk;
};

const USAGE_LABELS: Record<string, string> = {
  TRANSCRIPTION: '文字整理',
  EDITING: '编辑成书',
  PUBLICATION: '公开发表',
  RESEARCH: '学术研究',
  ARCHIVE: '归档保存',
};

const CHANNEL_LABELS: Record<string, string> = {
  PRINT: '纸质出版',
  WEB: '网络公开',
  SOCIAL_MEDIA: '社交媒体',
  BROADCAST: '音视频播出',
  PRIVATE_CIRCLE: '家族内部',
};

const ALL_USAGES = Object.keys(USAGE_LABELS);
const ALL_CHANNELS = Object.keys(CHANNEL_LABELS);

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
    <Workspace
      onLogout={() => {
        localStorage.removeItem('token');
        setToken(null);
      }}
    />
  );
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceModel | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [view, setView] = useState<'recordings' | 'chapters'>('recordings');
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
    const rows = await api<Recording[]>(`/v1/workspaces/${workspace.id}/recordings`);
    setRecordings(rows);
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
        const rows = await api<Recording[]>(
          `/v1/workspaces/${current.id}/recordings`,
        );
        if (cancelled) return;
        setWorkspace(current);
        setRecordings(rows);
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

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="mark small">家史</span>
          <strong>{workspace?.name || '口述家史'}</strong>
        </div>
        <nav className="topnav">
          <button
            type="button"
            className={view === 'recordings' ? 'navtab active' : 'navtab'}
            onClick={() => setView('recordings')}
          >
            录音与片段
          </button>
          <button
            type="button"
            className={view === 'chapters' ? 'navtab active' : 'navtab'}
            onClick={() => setView('chapters')}
          >
            章节与发布
          </button>
          <button className="ghost" onClick={onLogout}>
            退出
          </button>
        </nav>
      </header>

      {view === 'chapters' && workspace ? (
        <ChaptersView workspaceId={workspace.id} />
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
                    <small className="consent-line">
                      {recording.latestConsent ? (
                        <ConsentStateBadge state={recording.latestConsent.state} />
                      ) : (
                        <em className="consent-none">未登记授权</em>
                      )}
                      {recording.latestConsent
                        ? ` · ${recording.latestConsent.intervieweeName}`
                        : ''}
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
                onConsentChanged={loadRecordings}
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
  onConsentChanged,
}: {
  recording: Recording;
  clips: Clip[];
  setClips: React.Dispatch<React.SetStateAction<Clip[]>>;
  onConsentChanged: () => Promise<void> | void;
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

      <ConsentManager recordingId={recording.id} onChanged={onConsentChanged} />
    </div>
  );
}

function ConsentStateBadge({ state }: { state: ConsentState }) {
  const text =
    state === 'ACTIVE' ? '授权有效' : state === 'WITHDRAWN' ? '已撤回' : '已到期';
  return (
    <span className={`consent-badge ${state.toLowerCase()}`} title={`授权状态：${text}`}>
      {text}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

type ConsentDraft = {
  intervieweeName: string;
  intervieweeContact: string;
  grantedAt: string;
  expiresOn: string;
  usages: string[];
  channels: string[];
  requiresAnonymization: boolean;
  restrictions: string;
  notes: string;
};

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): ConsentDraft {
  return {
    intervieweeName: '',
    intervieweeContact: '',
    grantedAt: todayText(),
    expiresOn: '',
    usages: ['TRANSCRIPTION', 'PUBLICATION'],
    channels: ['WEB'],
    requiresAnonymization: false,
    restrictions: '',
    notes: '',
  };
}

function ConsentManager({
  recordingId,
  onChanged,
}: {
  recordingId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<ConsentDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, ConsentEvent[]>>({});
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');

  const load = useCallback(async () => {
    const rows = await api<Consent[]>(`/v1/recordings/${recordingId}/consents`);
    setConsents(rows);
  }, [recordingId]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then(() => onChanged())
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [load, onChanged]);

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const submit = async () => {
    const name = draft.intervieweeName.trim();
    if (!name) {
      setError('请填写受访人姓名');
      return;
    }
    if (!draft.grantedAt) {
      setError('请选择授权日期');
      return;
    }
    if (draft.expiresOn && draft.expiresOn < draft.grantedAt) {
      setError('授权到期日不能早于授权日');
      return;
    }
    if (draft.usages.length === 0) {
      setError('至少选择一个授权用途');
      return;
    }
    if (draft.channels.length === 0) {
      setError('至少选择一个发布渠道');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api<Consent>(`/v1/recordings/${recordingId}/consents`, {
        method: 'POST',
        body: JSON.stringify({
          intervieweeName: name,
          intervieweeContact: draft.intervieweeContact.trim(),
          grantedAt: draft.grantedAt,
          expiresOn: draft.expiresOn || null,
          scope: {
            usages: draft.usages,
            channels: draft.channels,
            requiresAnonymization: draft.requiresAnonymization,
            restrictions: draft.restrictions.trim(),
          },
          notes: draft.notes.trim(),
        }),
      });
      setShowForm(false);
      setDraft(emptyDraft());
      await load();
      await onChanged();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (consentId: string) => {
    const reason = withdrawReason.trim();
    if (!reason) {
      setError('请填写撤回原因（撤回原因将作为法定留痕保存）');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api<Consent>(`/v1/consents/${consentId}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setWithdrawId(null);
      setWithdrawReason('');
      await load();
      await onChanged();
    } catch (withdrawError) {
      setError((withdrawError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (consentId: string) => {
    if (expandedId === consentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(consentId);
    if (!events[consentId]) {
      try {
        const rows = await api<ConsentEvent[]>(`/v1/consents/${consentId}/events`);
        setEvents((current) => ({ ...current, [consentId]: rows }));
      } catch (historyError) {
        setError((historyError as Error).message);
      }
    }
  };

  return (
    <div className="consent-panel">
      <div className="section-title consent-head">
        <span>
          访谈授权登记 <span>{consents?.length ?? 0}</span>
        </span>
        {!showForm && (
          <button
            type="button"
            className="small-btn"
            onClick={() => {
              setError('');
              setShowForm(true);
            }}
          >
            + 登记授权
          </button>
        )}
      </div>

      <div className="consent-body">
        <p className="consent-legal-note">
          撤回授权后将阻止相关章节发布，但授权记录、撤回原因与历史章节均依法保留留痕，不可删除。
        </p>

        {error && <div className="error">{error}</div>}

        {showForm && (
          <div className="consent-form">
            <div className="form-grid">
              <label>
                受访人姓名 *
                <input
                  value={draft.intervieweeName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      intervieweeName: event.target.value,
                    }))
                  }
                  placeholder="例如：王秀英"
                />
              </label>
              <label>
                联系方式
                <input
                  value={draft.intervieweeContact}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      intervieweeContact: event.target.value,
                    }))
                  }
                  placeholder="电话 / 微信 / 地址（可选）"
                />
              </label>
              <label>
                授权日期 *
                <input
                  type="date"
                  value={draft.grantedAt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, grantedAt: event.target.value }))
                  }
                />
              </label>
              <label>
                授权到期日
                <input
                  type="date"
                  value={draft.expiresOn}
                  min={draft.grantedAt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, expiresOn: event.target.value }))
                  }
                />
              </label>
            </div>
            <small className="field-hint">到期日留空表示长期授权（直至书面撤回）。</small>

            <fieldset className="check-group">
              <legend>授权用途 *（需勾选“公开发表”才能发布章节）</legend>
              {ALL_USAGES.map((usage) => (
                <label key={usage} className="check">
                  <input
                    type="checkbox"
                    checked={draft.usages.includes(usage)}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        usages: toggleIn(current.usages, usage),
                      }))
                    }
                  />
                  {USAGE_LABELS[usage]}
                </label>
              ))}
            </fieldset>

            <fieldset className="check-group">
              <legend>授权发布渠道 *</legend>
              {ALL_CHANNELS.map((channel) => (
                <label key={channel} className="check">
                  <input
                    type="checkbox"
                    checked={draft.channels.includes(channel)}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        channels: toggleIn(current.channels, channel),
                      }))
                    }
                  />
                  {CHANNEL_LABELS[channel]}
                </label>
              ))}
            </fieldset>

            <label className="check anonym">
              <input
                type="checkbox"
                checked={draft.requiresAnonymization}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    requiresAnonymization: event.target.checked,
                  }))
                }
              />
              要求发布前进行匿名化处理
            </label>

            <label className="stacked">
              其他限制条件
              <textarea
                rows={2}
                value={draft.restrictions}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, restrictions: event.target.value }))
                }
                placeholder="如：隐去具体地名 / 仅限家族内部 / 不得用于商业用途"
              />
            </label>
            <label className="stacked">
              备注
              <textarea
                rows={2}
                value={draft.notes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="见证人、授权书编号等（可选）"
              />
            </label>

            <div className="form-actions">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="primary"
              >
                {busy ? '保存中...' : '保存授权登记'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setShowForm(false);
                  setError('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {consents && consents.length === 0 && !showForm && (
          <p className="empty">尚未登记访谈授权。未授权的录音不得用于章节发布。</p>
        )}

        {consents?.map((consent) => (
          <div
            key={consent.id}
            className={`consent-card ${consent.state.toLowerCase()}`}
          >
            <div className="consent-card-head">
              <div>
                <b>{consent.intervieweeName}</b>
                <small>
                  授权 {consent.grantedAt}
                  {consent.expiresOn ? ` 至 ${consent.expiresOn}` : ' · 长期有效'}
                  {consent.intervieweeContact ? ` · ${consent.intervieweeContact}` : ''}
                </small>
              </div>
              <ConsentStateBadge state={consent.state} />
            </div>

            <div className="consent-tags">
              {consent.scopeJson.usages.map((usage) => (
                <span key={usage} className="tag">
                  {USAGE_LABELS[usage] || usage}
                </span>
              ))}
              {consent.scopeJson.channels.map((channel) => (
                <span key={channel} className="tag channel">
                  {CHANNEL_LABELS[channel] || channel}
                </span>
              ))}
              {consent.scopeJson.requiresAnonymization && (
                <span className="tag warn">需匿名化</span>
              )}
            </div>
            {consent.scopeJson.restrictions && (
              <p className="consent-restrictions">限制：{consent.scopeJson.restrictions}</p>
            )}
            {consent.notes && <p className="consent-restrictions">备注：{consent.notes}</p>}

            {consent.state === 'WITHDRAWN' && (
              <div className="withdraw-record">
                <strong>授权已撤回（记录依法保留）</strong>
                <small>
                  {consent.withdrawnAt ? formatDateTime(consent.withdrawnAt) : ''}
                  {consent.withdrawReason ? ` · 原因：${consent.withdrawReason}` : ''}
                </small>
              </div>
            )}

            {withdrawId === consent.id && (
              <div className="withdraw-form">
                <label className="stacked">
                  撤回原因 *
                  <textarea
                    rows={2}
                    value={withdrawReason}
                    onChange={(event) => setWithdrawReason(event.target.value)}
                    placeholder="将随撤回事件永久留痕，例如：受访人口头要求撤回全部公开发表授权"
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => withdraw(consent.id)}
                  >
                    确认撤回
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      setWithdrawId(null);
                      setWithdrawReason('');
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <div className="consent-card-actions">
              {consent.state === 'ACTIVE' && withdrawId !== consent.id && (
                <button
                  type="button"
                  className="link-danger"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setWithdrawId(consent.id);
                  }}
                >
                  撤回授权
                </button>
              )}
              <button
                type="button"
                className="link"
                onClick={() => toggleHistory(consent.id)}
              >
                {expandedId === consent.id ? '隐藏留痕记录' : '查看留痕记录'}
              </button>
            </div>

            {expandedId === consent.id && (
              <ol className="event-log">
                {(events[consent.id] || []).map((event) => (
                  <li key={event.id}>
                    <span className={`event-type ${event.type.toLowerCase()}`}>
                      {event.type === 'GRANTED'
                        ? '登记'
                        : event.type === 'UPDATED'
                          ? '变更'
                          : '撤回'}
                    </span>
                    <time>{formatDateTime(event.createdAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskBanner({ risk }: { risk: ConsentRisk }) {
  if (risk.level === 'ok') return null;
  return (
    <div className={`risk-banner ${risk.level}`} role="alert">
      <strong>
        {risk.level === 'blocked' ? '⚠ 授权风险：禁止发布' : '⚠ 授权提醒'}
      </strong>
      <span>{risk.message}</span>
      {risk.recordings.some((item) => item.level !== 'ok') && (
        <ul className="risk-recordings">
          {risk.recordings
            .filter((item) => item.level !== 'ok')
            .map((item) => (
              <li key={item.recordingId}>
                《{item.recordingTitle}》：{item.message}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function ChaptersView({ workspaceId }: { workspaceId: string }) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const rows = await api<Chapter[]>(`/v1/workspaces/${workspaceId}/chapters`);
    setChapters(rows);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void load().catch((loadError) => {
      if (!cancelled) setError((loadError as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const createChapter = async () => {
    setError('');
    const title = window.prompt('新章节标题');
    if (!title?.trim()) return;
    try {
      const created = await api<Chapter>(`/v1/workspaces/${workspaceId}/chapters`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() }),
      });
      setChapters((current) => [
        {
          ...created,
          blocks: [],
          consentRisk: {
            level: 'ok',
            reasonCode: 'OK',
            message: '',
            recordings: [],
          },
        },
        ...(current || []),
      ]);
      await load();
    } catch (createError) {
      setError((createError as Error).message);
    }
  };

  const publish = async (chapter: Chapter) => {
    setError('');
    setBusyId(chapter.id);
    try {
      await api(`/v1/chapters/${chapter.id}/publish`, {
        method: 'POST',
        body: JSON.stringify(
          channels[chapter.id] ? { channel: channels[chapter.id] } : {},
        ),
      });
      await load();
    } catch (publishError) {
      setError((publishError as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="chapters-view">
      <div className="chapters-toolbar">
        <h2>章节与发布</h2>
        <button type="button" className="small-btn primary" onClick={createChapter}>
          + 新建章节
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {chapters?.length === 0 && (
        <p className="empty">还没有章节。新建章节并添加内容块后即可申请发布。</p>
      )}
      <div className="chapter-list">
        {chapters?.map((chapter) => (
          <article key={chapter.id} className="chapter-card">
            <div className="chapter-card-head">
              <div>
                <h3>{chapter.title}</h3>
                <small>
                  {chapter.status === 'PUBLISHED' ? '已发布' : '草稿'} ·{' '}
                  {chapter.blocks.length} 个内容块 · 更新于{' '}
                  {formatDateTime(chapter.updatedAt)}
                </small>
              </div>
              <span
                className={`chapter-status ${chapter.status === 'PUBLISHED' ? 'published' : 'draft'}`}
              >
                {chapter.status === 'PUBLISHED' ? '已发布' : '草稿'}
              </span>
            </div>

            <RiskBanner risk={chapter.consentRisk} />

            {chapter.status === 'PUBLISHED' &&
              chapter.consentRisk.level === 'blocked' && (
                <p className="legal-retention-note">
                  该章节发布后授权状态发生变化。历史章节与留痕依法保留、不予删除，但已不符合继续发布条件，请尽快下架或脱敏处理。
                </p>
              )}

            <div className="publish-row">
              <label className="channel-pick">
                发布渠道
                <select
                  value={channels[chapter.id] || ''}
                  onChange={(event) =>
                    setChannels((current) => ({
                      ...current,
                      [chapter.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">不指定（仅校验公开发表用途）</option>
                  {ALL_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary"
                disabled={busyId === chapter.id || chapter.consentRisk.level === 'blocked'}
                title={
                  chapter.consentRisk.level === 'blocked'
                    ? '授权未覆盖发布范围，已被阻止'
                    : undefined
                }
                onClick={() => publish(chapter)}
              >
                {busyId === chapter.id
                  ? '校验中...'
                  : chapter.status === 'PUBLISHED'
                    ? '重新发布'
                    : '发布章节'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载节点');
createRoot(root).render(<App />);
