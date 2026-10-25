import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  type AnalysisDetail,
  type AnalysisPublic,
  type Health,
  type Meta,
  askGrounded,
  deleteAnalysis,
  fetchHealth,
  fetchMeta,
  getAnalysis,
  listAnalyses,
  streamAnalysis,
  uploadDraft,
} from './api';
import { ariLine, railLine } from './templates';

/* ── constants ─────────────────────────────────────────────── */
const STAGES = ['ingest', 'retrieve', 'chart', 'score'] as const;
const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued', ingest: 'Ingest', retrieve: 'Search',
  chart: 'Chart', score: 'Score', done: 'Verdict',
};
type StageKey = (typeof STAGES)[number] | 'queued' | 'done';

interface RailItem {
  seq: number; from: string; to: string;
  template_id: string; payload: Record<string, unknown>;
}
interface AriItem { id: string; text: string; }
interface ChatEntry {
  q: string; answer: string;
  evidence: { kind: string; ref: string | null; content: string; similarity: number }[];
  pending?: boolean;
}

/* ════════════════════════════════════════════════════════════
   SHELL
   ════════════════════════════════════════════════════════════ */
export function Shell({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { fetchHealth().then(setHealth).catch(() => setHealth(null)); }, []);

  const live       = health?.status === 'ok';
  const sourcesOk  = health?.sources.filter(s => s.state === 'ok').length ?? 0;
  const sourcesAll = health?.sources.length ?? 0;
  const onRun      = useLocation().pathname.startsWith('/analyses/');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">PA</span>
            <span className="brand-name">Prior&#8209;Art</span>
          </Link>

          <div className="topbar-meta">
            <span className={`status-chip ${live ? 'ok' : health ? 'warn' : 'bad'}`}
              role="status" aria-label={live ? 'Online' : health ? 'Degraded' : 'Connecting'}>
              <span className="chip-dot" aria-hidden="true" />
              {health ? (live ? 'Online' : 'Degraded') : 'Connecting'}
              <span className="status-sep" aria-hidden="true">·</span>
              <span className="status-mode">{health?.free_mode ? 'free mode' : 'paid'}</span>
            </span>
            {onRun && (
              <Link to="/" className="ghost small">New analysis</Link>
            )}
          </div>
        </div>
      </header>

      <div className="shell-body" id="main">
        {children}

        <footer className="colophon">
          <div className="colophon-inner">
            <p className="colophon-legal">
              Not legal advice — a novelty score is a decision-support tool, not a patentability or
              freedom-to-operate opinion. Have a registered Indian Patent Agent review any invention
              before filing with the IPO/CGPDTM. Results are algorithmic approximations under the
              Indian Patents Act 1970 (as amended).
            </p>
            <details className="disclosure" style={{ marginTop: 'var(--space-sm)', maxWidth: '44rem' }}>
              <summary>How this run was priced and sourced</summary>
              <div className="disclosure-body">
                <p className="colophon-meta" style={{ marginTop: 0 }}>
                  sources {sourcesOk}/{sourcesAll} &middot; llm{' '}
                  {health?.llm.env === 'free-first' ? 'free-first' : 'paid'}
                  {health ? ` · cap $${health.pricing.max_fee.toFixed(2)} · $${health.pricing.rate.toFixed(2)}/min` : ''}{' '}
                  &middot; PayPal {health?.pricing.paypal ?? '—'} &middot; metered by task-time
                </p>
              </div>
            </details>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   INTAKE — HOMEPAGE
   ════════════════════════════════════════════════════════════ */
export function Intake() {
  const nav = useNavigate();
  const [text,   setText]   = useState('');
  const [file,   setFile]   = useState<File | null>(null);
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const [recent, setRecent] = useState<AnalysisPublic[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [meta,   setMeta]   = useState<Meta | null>(null);

  useEffect(() => {
    listAnalyses().then(r => setRecent(r.analyses)).catch(() => undefined);
    fetchHealth().then(setHealth).catch(() => undefined);
    fetchMeta().then(setMeta).catch(() => undefined);
  }, []);

  const run = async () => {
    setErr(null);
    if (!text.trim() && !file) { setErr('Paste a draft or choose a file first.'); return; }
    setBusy(true);
    try {
      const res = await uploadDraft({ text: text.trim() || undefined, file: file ?? undefined, name: file?.name });
      nav(`/analyses/${res.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteAnalysis(id).catch(() => undefined);
    setRecent(r => r.filter(a => a.id !== id));
  };

  return (
    <main className="intake">

      {/* ── One job: start an analysis ─────────────────── */}
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-grid">

          <div className="hero-copy">
            <h1 className="hero-title" id="hero-h">Is your invention patentable in India?</h1>
            <p className="hero-lede">
              Paste an invention disclosure — an architecture doc, an algorithm writeup, a claim
              sketch. The agent searches the Indian Patent Office (IPO/CGPDTM) and arXiv, then
              returns a <strong>novelty scorecard</strong> under the Indian Patents Act 1970.
            </p>
            <p className="hero-note">
              Research aid, not legal advice. A score never replaces a registered Indian Patent Agent.
            </p>
          </div>

          <div>
            <form className="composer" onSubmit={e => { e.preventDefault(); void run(); }}>
              <div className="composer-head">
                <span className="composer-label">Invention disclosure</span>
                <span className="composer-meta">
                  {meta
                    ? `≤ ${meta.limits.max_draft_chars.toLocaleString()} chars`
                    : 'PDF · DOCX · MD · LaTeX · TXT'}
                </span>
              </div>

              <textarea
                className="composer-input"
                value={text}
                onChange={e => setText(e.target.value)}
                aria-label="Invention disclosure draft"
                placeholder={
                  '1. A method for on-device inference comprising:\n' +
                  '   receiving a quantized transformer model;\n' +
                  '   partitioning attention heads across neural-engine cores; and\n' +
                  '   streaming KV-cache blocks from unified memory…\n\n' +
                  '// Or attach a PDF, DOCX, Markdown or LaTeX file.'
                }
              />

              <div className="composer-foot">
                <label className="file-btn">
                  <input
                    type="file"
                    accept=".pdf,.docx,.md,.markdown,.tex,.txt"
                    onChange={e => setFile(e.target.files?.[0] ?? null)}
                  />
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M7 1v9M3 6l4-5 4 5M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {file ? file.name : 'Attach file'}
                </label>

                <button className="btn-primary" type="submit" disabled={busy}>
                  {busy ? <><span className="spin" aria-hidden="true" /> Queuing…</> : 'Run analysis'}
                </button>
              </div>

              {health && (
                <p className="source-line">
                  sources:{' '}
                  {health.sources.map((s, i) => (
                    <span key={s.source}>
                      {i > 0 ? ' · ' : ''}
                      <span className={s.state === 'ok' ? 'ok' : s.state === 'error' ? 'bad' : 'warn'}>
                        {s.source} {s.state === 'ok' ? 'ready' : s.state === 'error' ? 'error' : 'skipped'}
                      </span>
                    </span>
                  ))}
                </p>
              )}
            </form>

            {err && <div className="error-banner" role="alert">{err}</div>}
          </div>
        </div>
      </section>

      {/* ── How it works — the only ordinal strip ───────── */}
      <section className="steps" aria-labelledby="steps-h">
        <div className="steps-head">
          <h2 className="section-title" id="steps-h">How it works</h2>
        </div>

        <ol className="steps-list">
          {[
            { n: '01', h: 'Read your draft',
              p: 'PDF, DOCX, Markdown or LaTeX is parsed and split into independent and dependent claims.' },
            { n: '02', h: 'Search prior art',
              p: 'Indian Patent Office records and arXiv papers, matched by classification, wording and similarity.' },
            { n: '03', h: 'Chart every element',
              p: 'Each element of each claim is checked against each reference, with the matching passage quoted verbatim.' },
            { n: '04', h: 'Score novelty',
              p: 'Overlap becomes a 0–100 score with a §2(1)(j) / §2(1)(ja) verdict, red flags and rewrite suggestions.' },
          ].map(s => (
            <li key={s.n}>
              <span className="step-n">{s.n}</span>
              <h3 className="step-h">{s.h}</h3>
              <p className="step-p">{s.p}</p>
            </li>
          ))}
        </ol>

        <p className="steps-caveat">
          Every chart cell must quote a verbatim substring of the source — a hallucinated quote
          invalidates that cell. No signup and no API keys: the run works on free sources alone.
        </p>
      </section>

      {/* ── Recent runs ──────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="recent" aria-labelledby="recent-h">
          <div className="runs-head">
            <h2 className="section-title" id="recent-h">Recent runs</h2>
          </div>
          <ul className="runs-list">
            {recent.map(a => (
              <li className="run-row" key={a.id}>
                <span className={`run-score mono ${
                  a.verdict === 'lack_of_novelty'          ? 'score-risk'
                  : a.verdict === 'lack_of_inventive_step' ? 'score-partial'
                  : a.verdict === 'clear'                  ? 'score-clear'
                  : a.novelty_score !== null               ? 'score-partial'
                  : 'score-none'
                }`}>{a.novelty_score ?? '—'}</span>
                <div className="run-main">
                  <Link to={`/analyses/${a.id}`} className="run-name">
                    {a.input_name ?? a.input_kind ?? 'draft'}
                  </Link>
                  <div className="run-meta">
                    <span className={`tag ${a.status === 'complete' ? 'ok' : a.status === 'failed' ? 'bad' : 'warn'}`}>
                      {a.status}
                    </span>
                    {a.verdict && (
                      <span className="tag">
                        {a.verdict === 'lack_of_novelty'          ? '§2(1)(j) no novelty'
                          : a.verdict === 'lack_of_inventive_step' ? '§2(1)(ja) no inv. step'
                          : a.verdict === 'partial_overlap'        ? 'partial overlap'
                          : a.verdict}
                      </span>
                    )}
                    <span className="mono">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <button className="ghost small danger"
                  onClick={() => remove(a.id)}
                  aria-label={`Delete run ${a.input_name ?? a.id}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

    </main>
  );
}

/* ════════════════════════════════════════════════════════════
   WORKBENCH
   ════════════════════════════════════════════════════════════ */
export function Workbench() {
  const { id = '' } = useParams();
  const nav = useNavigate();

  const [detail,   setDetail]   = useState<AnalysisDetail | null>(null);
  const [meta,     setMeta]     = useState<Meta | null>(null);
  const [rail,     setRail]     = useState<RailItem[]>([]);
  const [ari,      setAri]      = useState<AriItem[]>([]);
  const [stage,    setStage]    = useState<StageKey>('queued');
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [found,    setFound]    = useState(0);
  const [cells,    setCells]    = useState(0);
  const [tab,      setTab]      = useState<'scorecard' | 'chart' | 'candidates'>('scorecard');
  const [inspect,  setInspect]  = useState<{ elementId: number; refId: number } | null>(null);
  const [chat,     setChat]     = useState<ChatEntry[]>([]);
  const [q,        setQ]        = useState('');
  const [qBusy,    setQBusy]    = useState(false);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      getAnalysis(id).then(setDetail).catch(e => setLoadErr(String(e)));
    }, 500);
  }, [id]);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => undefined);
    getAnalysis(id)
      .then(d => {
        setDetail(d);
        if (d.analysis.status === 'complete') setStage('done');
        else if (d.analysis.stage) setStage(d.analysis.stage as StageKey);
        setRail(d.messages.map(m => ({
          seq: m.seq, from: m.from_agent, to: m.to_agent,
          template_id: m.template_id, payload: m.payload,
        })));
      })
      .catch(e => setLoadErr(String(e)));

    const stop = streamAnalysis(id, ev => {
      switch (ev['type']) {
        case 'agent_msg': {
          const m = ev as unknown as RailItem;
          setRail(prev => prev.some(x => x.seq === m.seq) ? prev : [...prev, m].sort((a, b) => a.seq - b.seq));
          break;
        }
        case 'ari_line': {
          const t = String(ev['template_id']);
          const p = (ev['payload'] ?? {}) as Record<string, unknown>;
          setAri(prev => [...prev, { id: `${prev.length}-${t}`, text: ariLine(t, p) }]);
          break;
        }
        case 'stage':    setStage(String(ev['stage']) as StageKey); refresh(); break;
        case 'progress': setProgress({ label: String(ev['label']), done: Number(ev['done']), total: Number(ev['total']) }); break;
        case 'candidate_found': setFound(Number(ev['count'] ?? 0)); break;
        case 'cell_decided':    setCells(c => c + 1); break;
        case 'partial_result':  refresh(); break;
        case 'complete': setStage('done'); setProgress(null); refresh(); break;
        case 'failed':   setStage('done'); refresh(); break;
        default: break;
      }
    });

    return () => { stop(); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [id, refresh]);

  const running = detail ? !['complete', 'failed'].includes(detail.analysis.status) : stage !== 'done';
  const result  = detail?.result ?? null;
  const score   = detail?.analysis.novelty_score ?? result?.novelty_score ?? null;

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question || qBusy) return;
    setQ(''); setQBusy(true);
    setChat(c => [...c, { q: question, answer: '', evidence: [], pending: true }]);
    try {
      const r = await askGrounded(id, question);
      setChat(c => [...c.slice(0, -1), { q: question, answer: r.answer, evidence: r.evidence }]);
    } catch (err) {
      setChat(c => [...c.slice(0, -1), { q: question, answer: `Error: ${err instanceof Error ? err.message : err}`, evidence: [] }]);
    } finally { setQBusy(false); }
  };

  if (loadErr) {
    return (
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem' }}>
        <div style={{ maxWidth: '28rem', width: '100%', textAlign: 'center' }}>
          <div className="error-banner" style={{ marginTop: 0 }}>{loadErr}</div>
          <button className="btn-primary" style={{ marginTop: '1.25rem' }} onClick={() => nav('/')}>
            ← Back to home
          </button>
        </div>
      </main>
    );
  }

  const stageIdx = stage === 'done' ? STAGES.length : STAGES.indexOf(stage as (typeof STAGES)[number]);

  return (
    <main className="wb">

      {/* ── One header row: title · stages · progress ──── */}
      <div className="wb-head">
        <div className="wb-head-inner">
          <div className="wb-id">
            <h1>{detail?.analysis.input_name ?? detail?.analysis.input_kind ?? 'Analysis'}</h1>
            <span className={`tag ${running ? 'warn' : detail?.analysis.status === 'failed' ? 'bad' : 'ok'}`}>
              {detail?.analysis.status ?? 'loading'}
            </span>
          </div>

          <ol className="wb-steps" aria-label="Run progress">
            {STAGES.map((s, i) => {
              const state = stage === 'done' || stageIdx > i ? 'done' : stageIdx === i ? 'active' : 'todo';
              return (
                <li key={s} className={`wb-step ${state}`}>
                  <span className="wb-num">{String(i + 1).padStart(2, '0')}</span>
                  {STAGE_LABEL[s]}
                </li>
              );
            })}
          </ol>

          <div className="wb-progress">
            <span className="meter" role="progressbar"
              aria-label="Run progress"
              aria-valuenow={progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : running ? 15 : 100}
              aria-valuemin={0} aria-valuemax={100}>
              <span className={`meter-fill ${running && !progress ? 'indeterminate' : ''}`} style={{
                transform: `scaleX(${(progress
                  ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
                  : running ? 15 : 100) / 100})`,
              }} />
            </span>
            <span className="wb-caption">
              {progress?.label ?? (running ? 'working…' : (detail?.analysis.stage ?? ''))}
              {running ? ` · ${found} documents · ${cells} comparisons` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main grid ─────────────────────────────────── */}
      <div className="wb-grid">

        {/* doc panel */}
        <section className="doc">
          <div className="doc-tabs" role="tablist" aria-label="Run sections">
            {(['scorecard', 'chart', 'candidates'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab === t}
                className={`doc-tab ${tab === t ? 'active' : ''}`}
                title={t === 'chart' ? 'Side-by-side comparison: your invention vs. each document we found' : undefined}
                onClick={() => setTab(t)}>
                {t === 'scorecard' ? 'Scorecard'
                  : t === 'chart' ? 'Claim chart'
                  : 'Candidates'}
                {t === 'chart'      && cells > 0   ? ` (${cells})`              : ''}
                {t === 'candidates' && detail       ? ` (${detail.references.length})` : ''}
              </button>
            ))}
          </div>

          <div className="doc-body">
            {!detail && <div className="skeleton"><span className="spin" aria-hidden="true" /> loading run…</div>}
            {detail && tab === 'scorecard'  && <ScorecardTab  detail={detail} running={running} score={score} progress={progress} />}
            {detail && tab === 'chart'      && <ChartTab      detail={detail} inspect={inspect} setInspect={setInspect} running={running} />}
            {detail && tab === 'candidates' && <CandidatesTab detail={detail} />}
          </div>
        </section>

        {/* margin — narration first; docket + wire behind one disclosure */}
        <aside className="rail">

          {/* examiner / Ari */}
          <section className="examiner">
            <div className="panel-head">
              <h2 className="panel-label">Examiner</h2>
              <span className="panel-note">Ari · plain english</span>
            </div>
            <div className="examiner-log">
              <p className="examiner-intro">
                Running your novelty scorecard. Scout is on search, Cartographer is building the chart —
                I translate what they find into plain English here.
              </p>
              {ari.map(a => <p className="examiner-note" key={a.id}>{a.text}</p>)}
              {running && (
                <p className="examiner-note live">
                  {stage === 'ingest'   && 'Splitting your draft into claims under the Indian Patents Act 1970…'}
                  {stage === 'retrieve' && `Searching IPO/CGPDTM + global sources — ${found} candidates so far…`}
                  {stage === 'chart'    && `Charting elements × references under §2(1)(j) — ${cells} cells decided…`}
                  {stage === 'score'    && 'Computing novelty score + §3 exclusion flags and rewrite suggestions…'}
                  {stage === 'queued'   && 'Queued — the durable runner picks this up within seconds.'}
                </p>
              )}
              {detail?.analysis.status === 'failed' && (
                <p className="examiner-note fail">
                  Run failed — {detail.error?.message ?? 'unknown error'}
                  {detail.error?.retriable ? ' (retriable — earlier stages are checkpointed)' : ''}
                </p>
              )}
              {result && !running && (
                <div className="examiner-final">
                  <p className="examiner-verdict-line">
                    Final verdict: <strong className="mono">{result.novelty_score}/100</strong>{' '}
                    — {result.verdict === 'lack_of_novelty'
                        ? 'nothing new here; one document already covers every part'
                        : result.verdict === 'lack_of_inventive_step'
                          ? 'new, but only by a small step — strengthen the claims before filing'
                          : result.verdict === 'partial_overlap'
                            ? 'some parts already exist, some do not'
                            : 'nothing we found matches your invention'}
                  </p>
                  <p className="examiner-verdict-gloss">
                    <span className="gloss-term mono">
                      {result.verdict === 'lack_of_novelty'          ? '§2(1)(j) · novelty'
                        : result.verdict === 'lack_of_inventive_step' ? '§2(1)(ja) · inventive step'
                        : result.verdict === 'partial_overlap'        ? 'partial overlap'
                        : 'appears novel'}
                    </span>
                    {' '}is the formal finding a patent agent would read on the report.
                  </p>
                  {result.closest_reference_note && (
                    <p className="examiner-verdict-ref">
                      {result.closest_reference_note.replace(/^Closest reference:\s*/, 'Nearest document: ')}
                    </p>
                  )}
                </div>
              )}
              {chat.map((c, i) => (
                <div className="thread" key={i}>
                  <p className="ask-q">{c.q}</p>
                  <div className="ask-a">
                    {c.pending ? <span className="spin" aria-hidden="true" /> : c.answer}
                    {c.evidence.map((e, j) => (
                      <div className="evidence" key={j}>
                        <span className="evidence-src mono">{e.ref ?? e.kind}</span>
                        <span className="evidence-sim mono">match {Math.round(e.similarity * 100)}%</span>
                        <p>{clipText(e.content, 300)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <form className="ask-form" onSubmit={ask}>
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Which elements kill claim 1?"
                aria-label="Ask about this run" disabled={qBusy} />
              <button className="btn-primary" type="submit" disabled={qBusy || !q.trim()}>
                {qBusy ? '…' : 'Ask'}
              </button>
            </form>
          </section>

          {/* run details — billing + agent wire, collapsed by default */}
          <details className="disclosure">
            <summary>
              Run details
              {meta?.ui.showTeamRail && <span className="disclosure-count">{rail.length} wire</span>}
            </summary>
            <div className="disclosure-body">
              <dl className="docket-spec">
                <div><dt>Input</dt>   <dd className="mono">{detail?.analysis.input_name ?? '—'}</dd></div>
                <div><dt>Chars</dt>   <dd className="mono">{detail?.analysis.draft_chars?.toLocaleString() ?? '—'}</dd></div>
                <div>
                  <dt>Metered</dt>
                  <dd className="mono">
                    {detail?.billing
                      ? `${detail.billing.billable_seconds}s · $${Number(detail.billing.price ?? 0).toFixed(2)}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Billing</dt>
                  <dd><span className="tag">{detail?.billing?.state ?? '—'}</span></dd>
                </div>
              </dl>

              <div className="docket-actions">
                <button className="ghost small" onClick={() => nav('/')}>New draft</button>
                <button className="ghost small danger"
                  onClick={async () => { await deleteAnalysis(id).catch(() => undefined); nav('/'); }}>
                  Delete run
                </button>
              </div>

              {meta?.ui.showTeamRail && (
                <div className="wire-log">
                  <div className="panel-head">
                    <h2 className="panel-label">Wire</h2>
                    <span className="panel-note">agent → agent</span>
                  </div>
                  {rail.length === 0 && <p className="wire-empty">Transmissions appear here live…</p>}
                  {rail.map(m => {
                    const line = railLine(m.template_id, m.payload);
                    return (
                      <article className="wire-msg" key={m.seq}>
                        <header className="wire-route">
                          <span className="wire-from-pill">{m.from}</span>
                          <span className="wire-arrow" aria-hidden="true">→</span>
                          <span className="wire-to">{m.to}</span>
                          <span className="wire-seq mono">#{m.seq}</span>
                        </header>
                        <p>{line ? line.text : `${m.template_id} ${JSON.stringify(m.payload).slice(0, 140)}`}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

        </aside>
      </div>
    </main>
  );
}

/* ════════════════════════════════════════════════════════════
   SCORECARD TAB — three-layer output
   Layer 1: Plain-English summary (anyone can read)
   Layer 2: Visual risk dashboard (business / founder view)
   Layer 3: Technical legal detail (patent attorney view)
   ════════════════════════════════════════════════════════════ */
function ScorecardTab({
  detail, running, score, progress,
}: {
  detail: AnalysisDetail;
  running: boolean;
  score: number | null;
  progress: { label: string; done: number; total: number } | null;
}) {
  const r = detail.result;

  if (running || !r) {
    return (
      <div className="stack">
        <div className="skeleton">
          {running
            ? <><span className="spin" aria-hidden="true" /> {progress?.label ?? 'pipeline running'} — scorecard lands at completion.</>
            : 'No scorecard yet.'}
        </div>
        {detail.error && <div className="error-banner">{detail.error.message}</div>}
      </div>
    );
  }

  const v    = r.verdict;
  const tone = v === 'clear' ? 'clear' : v === 'partial_overlap' ? 'partial' : 'disclosed';
  const pct  = Math.max(0, Math.min(100, r.novelty_score));

  /* ── Plain-English headline ── */
  const plainHeadline =
    v === 'lack_of_novelty'
      ? 'This invention already exists in prior art'
      : v === 'lack_of_inventive_step'
        ? 'Your invention is close to existing work — needs strengthening'
        : v === 'partial_overlap'
          ? 'Some parts overlap with existing patents or papers'
          : 'Your invention looks novel — no blocking prior art found';

  const plainBody =
    v === 'lack_of_novelty'
      ? <span>The AI found at least one existing patent or research paper that <strong>covers your idea almost completely</strong>. Your invention as written may not be granted a patent in India. You need to significantly change or narrow your claims before filing.</span>
      : v === 'lack_of_inventive_step'
        ? <span>Your invention is <strong>new but close</strong> to existing work. On its own, each piece already exists — but the <strong>combination may still be patentable</strong> if you add more specific technical details. A patent attorney can help you rewrite the claims to highlight what's truly unique.</span>
        : v === 'partial_overlap'
          ? <span>Some claims <strong>partially match</strong> existing patents or papers. The parts that are unique are strong — narrow your claims to focus on what's genuinely new and avoid the overlapping areas.</span>
          : <span>The AI searched the Indian Patent Office and research papers and <strong>found no blocking prior art</strong>. Your invention appears to be novel. Consider filing a patent application with a registered Indian Patent Agent.</span>;

  /* ── Three-audience meaning ── */
  const meanings = {
    normal:
      v === 'lack_of_novelty'
        ? "Think of it like this: someone already built and described your product before you. Like inventing WhatsApp after WhatsApp already exists."
        : v === 'lack_of_inventive_step'
          ? "Your product is new, but it combines existing ideas in a way experts might consider obvious. Like putting a camera on a phone — novel in 2000, obvious by 2010."
          : v === 'partial_overlap'
            ? "Parts of your idea exist elsewhere, but not the whole thing. Like a recipe that uses common ingredients in a genuinely new combination."
            : "Great news — no one has done this before (in what we searched). You're in clear territory to file a patent.",
    business:
      v === 'lack_of_novelty'
        ? "Patent filing risk: HIGH. Filing as-is would likely be rejected by IPO. Restructure claims with a Patent Agent before spending on the filing fee (₹1,600–₹8,000)."
        : v === 'lack_of_inventive_step'
          ? "Patent filing risk: MEDIUM. The core idea is protectable but claims need rewriting. A provisional application (₹1,600) buys 12 months to strengthen the claims."
          : v === 'partial_overlap'
            ? "Patent filing risk: LOW–MEDIUM. Select the unique parts and narrow your claims. Partial protection is still valuable IP."
            : "Patent filing risk: LOW. Proceed to a full patent application. File a provisional first to lock in your priority date.",
    technical:
      v === 'lack_of_novelty'
        ? `§2(1)(j) novelty fails — prior art discloses every element of at least one independent claim. Score: ${pct}/100. Closest reference anticipates at ≥85% element overlap.`
        : v === 'lack_of_inventive_step'
          ? `§2(1)(ja) inventive step fails — combination of 2–3 references covers ≥90% of independent claim elements. Score: ${pct}/100. Consider adding narrowing limitations absent from the prior art.`
          : v === 'partial_overlap'
            ? `Score: ${pct}/100. Partial overlap — some elements disclosed in prior art but no complete §2(1)(j) anticipation. Inventive step likely defensible with targeted claim amendments.`
            : `Score: ${pct}/100. No reference reaches anticipation threshold. §2(1)(j) novelty and §2(1)(ja) inventive step appear satisfied on current search corpus.`,
  };

  /* ── Risk helpers ── */
  const riskLevel = (risk: string) =>
    risk === 'lack_of_novelty' ? 'high' : risk === 'lack_of_inventive_step' ? 'medium' : 'low';
  const riskLabel = (risk: string) =>
    risk === 'lack_of_novelty' ? 'No Novelty'
      : risk === 'lack_of_inventive_step' ? 'Needs Work'
      : 'Looks Good';
  const claimPlain = (risk: string, overlap: number) =>
    risk === 'lack_of_novelty'
      ? `Very similar (${overlap}%) to existing work — needs major changes.`
      : risk === 'lack_of_inventive_step'
        ? `Somewhat similar (${overlap}%) — adding more specific details could help.`
        : overlap > 20
          ? `Minor similarity (${overlap}%) — mostly looks original.`
          : `Looks original — low similarity to prior art.`;

  return (
    <div className="stack">

      {/* 1 · Verdict — the number, the legal verdict, nothing else */}
      <div className="verdict-card">
        <div
          className={`gauge-circle tone-${tone}`}
          style={{ ['--pct' as string]: `${pct}%` }}
          aria-label={`Novelty score ${pct} out of 100`}
        >
          <div className="gauge-inner">
            <span className={`gauge-n tone-${tone}`}>{pct}</span>
            <span className="gauge-label">/ 100</span>
          </div>
        </div>
        <div>
          <p className={`gauge-verdict tone-${tone}`}>
            {v === 'lack_of_novelty'          ? 'Lacks Novelty — §2(1)(j)'
              : v === 'lack_of_inventive_step' ? 'Lacks Inventive Step — §2(1)(ja)'
              : v === 'partial_overlap'        ? 'Partial Overlap'
              : 'Appears Novel'}
          </p>
          {/* the legal label above is for a patent agent; this line is for everyone else */}
          <p className="gauge-gloss">
            {v === 'lack_of_novelty'
              ? 'One existing document already describes every part of your claim — so it is not new.'
              : v === 'lack_of_inventive_step'
                ? 'Nothing out there matches your invention exactly, but the gap to the closest work is small enough that an examiner could call it obvious.'
                : v === 'partial_overlap'
                  ? 'Some parts of your claims already exist; the rest do not.'
                  : 'Nothing we found describes your invention.'}
          </p>
          {r.closest_reference_note && (
            <p className="gauge-sub">
              <span className="gauge-sub-label">Nearest document</span>
              {r.closest_reference_note.replace(/^Closest reference:\s*/, '')}
              <span className="gauge-sub-note">
                {' '}— the ID is an arXiv number, read as year + month + paper number.
              </span>
            </p>
          )}
          <div className="gauge-tags">
            <span className={`tag ${r.coverage?.llm_mode === 'full' ? 'ok' : 'warn'}`}>
              AI: {r.coverage?.llm_mode === 'full' ? 'full analysis' : 'offline mode'}
            </span>
            {r.coverage?.refined && <span className="tag warn">widened search</span>}
          </div>
        </div>
      </div>

      {/* 2 · Plain English — what the number means */}
      <div className={`plain-card tone-${tone}`}>
        <p className="plain-kicker">In plain English</p>
        <p className="plain-headline">{plainHeadline}</p>
        <p className="plain-body">{plainBody}</p>
        <div className="plain-alt">
          <p><strong>Think of it like this:</strong> {meanings.normal}</p>
        </div>
      </div>
      {(r.per_claim ?? []).length > 0 && (
        <section className="doc-section">
          <h2 className="rule-head">
            <span>Claim-by-claim breakdown</span>
            <span className="rule-line" aria-hidden="true" />
            <span className="rule-meta">
              {(r.per_claim ?? []).length} claim{(r.per_claim ?? []).length !== 1 ? 's' : ''} analysed
            </span>
          </h2>
          <div className="claim-cards">
            {(r.per_claim ?? []).map(c => {
              const level = riskLevel(c.risk);
              return (
                <div className="claim-card" key={c.claimId}>
                  <div className={`claim-card-num risk-${level}`}>{c.claimNo}</div>
                  <div className="claim-card-body">
                    <div className="claim-card-label">
                      Claim {c.claimNo}
                      <span className="claim-card-type">
                        {c.type === 'independent' ? 'independent' : 'dependent'}
                      </span>
                      <span className={`claim-card-badge risk-${level}`}>
                        {riskLabel(c.risk)}
                      </span>
                    </div>
                    <p className="claim-card-plain">{claimPlain(c.risk, c.overlapPct)}</p>
                  </div>
                  <div className={`claim-card-pct pct-${level}`}>{c.overlapPct}%</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4 · What to do next — the rewrites, out of any accordion */}
      {(r.rewrite_suggestions ?? []).length > 0 && (
        <section className="doc-section">
          <h2 className="rule-head">
            <span>What to do next</span>
            <span className="rule-line" aria-hidden="true" />
            <span className="rule-meta">how to strengthen your claims</span>
          </h2>
          <div className="plain-card">
            <ol className="next-list">
              {(r.rewrite_suggestions ?? []).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </section>
      )}

      {/* Everything else — one disclosure, closed by default */}
      <details className="disclosure">
        <summary>Detailed analysis</summary>
        <div className="disclosure-body">

          <div className="detail-block">
            <h3 className="detail-title">For your business</h3>
            <p className="detail-text">{meanings.business}</p>
          </div>

          <div className="detail-block">
            <h3 className="detail-title">Technical / legal</h3>
            <p className="detail-text">{meanings.technical}</p>
          </div>

          {(r.red_flags ?? []).length > 0 && (
            <div className="detail-block">
              <h3 className="detail-title">Risk flags</h3>
              <ul className="notes">
                {(r.red_flags ?? []).map((f, i) => (
                  <li className="note flag" key={i}>
                    <span className="note-mark" aria-hidden="true">▲</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="detail-block">
            <h3 className="detail-title">What we searched</h3>
            <ul className="notes">
              {(r.coverage?.warnings ?? []).length === 0 && (
                <li className="note fix">
                  <span className="note-mark" aria-hidden="true">✔</span>
                  All configured sources were searched — no coverage gaps.
                </li>
              )}
              {(r.coverage?.warnings ?? []).map((w, i) => (
                <li className="note warn" key={i}>
                  <span className="note-mark" aria-hidden="true">●</span>
                  {w}
                </li>
              ))}
              {(r.coverage?.sources ?? []).map(s => (
                <li key={s.source}
                  className={`note ${s.state === 'ok' ? 'fix' : s.state === 'error' ? 'flag' : 'warn'}`}>
                  <span className="note-mark" aria-hidden="true">
                    {s.state === 'ok' ? '✔' : s.state === 'error' ? '▲' : '●'}
                  </span>
                  <span>
                    <span className="mono">{s.source}</span>
                    {s.state === 'ok'
                      ? ` — searched, ${s.count} result${s.count !== 1 ? 's' : ''} found`
                      : ` — ${s.reason ?? s.state}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="detail-block">
            <h3 className="detail-title">How the score was computed</h3>
            <ul className="notes">
              <li className="note">
                <span className="note-mark" aria-hidden="true">·</span>
                <span><strong>Jurisdiction:</strong> India — Indian Patents Act 1970 (as amended).
                  §2(1)(j) novelty, §2(1)(ja) inventive step, §3 exclusions checked.</span>
              </li>
              <li className="note">
                <span className="note-mark" aria-hidden="true">·</span>
                <span><strong>Scoring:</strong> weighted element overlap — disclosed=1.0,
                  partial=0.5, not_found=0.0. Independent claims weight 1.0, dependent 0.7.
                  Novelty score = 100 − (100 × max_risk).</span>
              </li>
              <li className="note">
                <span className="note-mark" aria-hidden="true">·</span>
                <span><strong>Sources:</strong> IPO/CGPDTM (Indian patents), arXiv (NPL).
                  Chart mode: <span className="mono">{r.coverage?.chart_mode}</span>.
                  LLM: <span className="mono">{r.coverage?.llm_mode}</span>.
                  {r.coverage?.refined ? ' One widening re-retrieval pass performed.' : ''}</span>
              </li>
              <li className="note warn">
                <span className="note-mark" aria-hidden="true">!</span>
                <span>Algorithmic triage only — not a legal opinion. Always verify with a registered
                  Indian Patent Agent before filing with IPO/CGPDTM.</span>
              </li>
            </ul>

            {(r.per_claim ?? []).length > 0 && (
              <div className="claim-bars" style={{ marginTop: 'var(--space-md)' }}>
                {(r.per_claim ?? []).map(c => (
                  <div className="claim-bar" key={c.claimId}>
                    <span className="claim-lbl">
                      Claim {c.claimNo}
                      <span className="claim-type"> {c.type.slice(0, 3)}.</span>
                    </span>
                    <span className="claim-track">
                      <span className={`claim-fill tone-${
                        c.risk === 'lack_of_novelty' ? 'disclosed'
                          : c.risk === 'lack_of_inventive_step' ? 'partial'
                          : 'clear'}`}
                        style={{ width: `${Math.max(3, c.overlapPct)}%` }} />
                    </span>
                    <span className="claim-pct mono">{c.overlapPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </details>

    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   CHART TAB
   ════════════════════════════════════════════════════════════ */

/** Plain-English wording for a cell verdict — the raw enum means nothing to a first-time reader. */
/** Trim to n characters on a word boundary, and only add an ellipsis when we actually cut. */
function clipText(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s+\S*$/, '') + ' …';
}

function matchPlain(match: string): { label: string; note: string } {
  switch (match) {
    case 'disclosed':
      return {
        label: 'described in this document',
        note: 'This old document says this exact part — it counts against your novelty.',
      };
    case 'partial':
      return {
        label: 'partly described',
        note: 'It covers some of this part, not all of it — read the quote and judge for yourself.',
      };
    case 'not_found':
      return {
        label: 'not found',
        note: 'Nothing in this document describes this part — good for you.',
      };
    default:
      return { label: match, note: '' };
  }
}

function ChartTab({
  detail, inspect, setInspect, running,
}: {
  detail: AnalysisDetail;
  inspect: { elementId: number; refId: number } | null;
  setInspect: (v: { elementId: number; refId: number } | null) => void;
  running: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(true);

  const { claims, elements, references, matches } = detail;
  const selectedRefs = references.filter(r => r.selected);

  const cellHint: Record<string, string> = {
    disclosed: 'Already described in this document — counts against your novelty. Click for the exact sentence.',
    partial: 'Partly described in this document — needs a closer look. Click for the exact sentence.',
    not_found: 'Not found in this document — nothing here describes this part. Good for you.',
  };

  if (!claims.length) {
    return (
      <div className="skeleton">
        {running ? <><span className="spin" aria-hidden="true" /> waiting for claims…</> : 'No claims extracted.'}
      </div>
    );
  }

  const cellKey = (eId: number, rId: number) => `${eId}:${rId}`;
  const cellMap = new Map(matches.map(m => [cellKey(m.element_id, m.reference_id), m]));
  const inspectedMatch = inspect ? (cellMap.get(cellKey(inspect.elementId, inspect.refId)) ?? null) : null;
  const inspectedRef   = inspect ? (references.find(r => r.id === inspect.refId) ?? null)  : null;
  const inspectedEl    = inspect ? (elements.find(e => e.id === inspect.elementId) ?? null) : null;

  return (
    <div className="stack">
      {/* plain-language explainer — "what am I looking at?" */}
      <section className="readme" aria-label="How to read this claim chart">
        <div className="readme-head">
          <span className="readme-mark" aria-hidden="true">?</span>
          <div className="readme-titles">
            <h3 className="readme-title">What am I looking at?</h3>
            <p className="readme-sub">
              A <strong>claim chart</strong> puts your invention side by side with every older document we found,
              one small piece at a time — so you can see <em>exactly</em> which parts of your idea already exist.
            </p>
          </div>
          <button className="ghost small" onClick={() => setHelpOpen(o => !o)} aria-expanded={helpOpen}>
            {helpOpen ? 'Hide details' : 'Explain this table'}
          </button>
        </div>

        {helpOpen && (
          <div className="readme-body">
            <ul className="readme-axes">
              <li>
                <span className="axis-pill">Rows ↓</span>
                <span>Each numbered line is <strong>one part of your invention</strong> — a clause of your patent claim.</span>
              </li>
              <li>
                <span className="axis-pill">Columns →</span>
                <span>Each column is <strong>one document that already exists</strong> — an old patent or research paper we found.</span>
              </li>
              <li>
                <span className="axis-pill">Box</span>
                <span>One question per box: <em>“does that old document already describe this part?”</em> — coloured by the answer.</span>
              </li>
            </ul>

            <ul className="readme-keys">
              <li className="rkey rkey-disclosed">
                <span className="rkey-glyph" aria-hidden="true">●</span>
                <span className="rkey-label">Disclosed</span>
                <span className="rkey-text">
                  The old document <strong>already says this exact part</strong>. It counts against your novelty —
                  this is the kind of line an examiner would cite.
                </span>
              </li>
              <li className="rkey rkey-partial">
                <span className="rkey-glyph" aria-hidden="true">◑</span>
                <span className="rkey-label">Partly</span>
                <span className="rkey-text">
                  It says <strong>some of it, not all of it</strong>. Worth a closer look — click the box to read
                  the matching sentence.
                </span>
              </li>
              <li className="rkey rkey-not_found">
                <span className="rkey-glyph" aria-hidden="true">○</span>
                <span className="rkey-label">Not found</span>
                <span className="rkey-text">
                  The old document <strong>never mentions this part</strong>. Green here is <strong>good for you</strong> —
                  that is the room you have to claim.
                </span>
              </li>
              <li className="rkey rkey-empty">
                <span className="rkey-glyph" aria-hidden="true">–</span>
                <span className="rkey-label">Not checked</span>
                <span className="rkey-text">
                  Not compared yet — the run is still going, or this document was not shortlisted.
                </span>
              </li>
            </ul>

            <p className="readme-tip">
              <strong>Tip —</strong> click any coloured box to open the <strong>exact quote</strong> from
              that document, with a link to the source.
            </p>
          </div>
        )}
      </section>

      <div className="matrix-scroll">
        <table className="matrix" aria-label="Claim chart matrix">
          <thead>
            <tr>
              <th className="matrix-claim" scope="col">
                Claim / Element
                <span className="matrix-axis">your invention — one part per row ↓</span>
              </th>
              {selectedRefs.map(ref => (
                <th key={ref.id} scope="col">
                  <a className="matrix-pub" href={ref.url} target="_blank" rel="noreferrer"
                    title={ref.title ?? undefined}>
                    {ref.publication_number ?? ref.office ?? '—'}
                  </a>
                  <span className="matrix-title">
                    {(ref.title ?? '').slice(0, 38)}{(ref.title?.length ?? 0) > 38 ? '…' : ''}
                  </span>
                  <span className="matrix-axis">already-published document</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {claims.map(claim => {
              const claimEls = elements.filter(e => e.claim_id === claim.id);
              return (
                <Fragment key={claim.id}>
                  <tr className="claim-group">
                    <td colSpan={selectedRefs.length + 1}>
                      <span className="claim-group-num mono">Claim {claim.claim_no}{' '}</span>
                      {claim.provisional && (
                        <span className="tag warn claim-group-tag">provisional</span>
                      )}
                      {claim.text.slice(0, 90)}{claim.text.length > 90 ? '…' : ''}
                    </td>
                  </tr>
                  {claimEls.map(el => (
                    <tr key={el.id}>
                      <td className="matrix-el">
                        <span className="el-no mono">{el.element_no}.</span>
                        {el.text.slice(0, 80)}{el.text.length > 80 ? '…' : ''}
                      </td>
                      {selectedRefs.map(ref => {
                        const cell = cellMap.get(cellKey(el.id, ref.id));
                        const m    = cell?.match;
                        const active = inspect?.elementId === el.id && inspect?.refId === ref.id;
                        return (
                          <td key={ref.id}>
                            <button
                              className={`cellbtn ${m ?? 'empty'}`}
                              title={m ? cellHint[m] : 'Not compared yet'}
                              onClick={() => m ? setInspect(active ? null : { elementId: el.id, refId: ref.id }) : undefined}
                              aria-label={m ? `${matchPlain(m).label} — click to read the exact quote` : 'not compared yet'}
                              aria-pressed={active}
                              style={active ? { outline: '2px solid var(--color-accent)', outlineOffset: '2px' } : undefined}
                            >
                              {m === 'disclosed' ? '●' : m === 'partial' ? '◑' : m === 'not_found' ? '○' : '–'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* legend */}
      <div className="matrix-foot">
        <span className="foot-key key-disclosed">● described in that document</span>
        <span className="foot-key key-partial">◑ partly described</span>
        <span className="foot-key key-not-found">○ not described — good for you</span>
        <span className="foot-key muted">– not checked yet</span>
        <span className="foot-count mono">
          {running
            ? `${matches.length} comparisons so far…`
            : `${matches.length} comparisons · ${selectedRefs.length} document${selectedRefs.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* inspector */}
      {inspect && inspectedMatch && inspectedRef && inspectedEl && (
        <div className="inspector">
          <h3 className="panel-label">
            Evidence inspector
            <span className="tag">{matchPlain(inspectedMatch.match).label}</span>
            <button className="ghost small panel-close"
              onClick={() => setInspect(null)} aria-label="Close inspector">✕</button>
          </h3>
          <p className="inspector-commentary">
            <strong>Element {inspectedEl.element_no}:</strong> {inspectedEl.text}
          </p>
          {matchPlain(inspectedMatch.match).note && (
            <p className="inspector-commentary">
              {matchPlain(inspectedMatch.match).note}
            </p>
          )}
          {inspectedMatch.quote ? (
            <blockquote className="quote">
              <span className="quote-badge">
                exact quote
                {inspectedMatch.locator ? ` · ${inspectedMatch.locator}` : ' — copied word for word from the document'}
              </span>
              {inspectedMatch.quote}
            </blockquote>
          ) : (
            <p className="inspector-commentary muted">No quote available.</p>
          )}
          {inspectedMatch.commentary && (
            <p className="inspector-commentary">{inspectedMatch.commentary}</p>
          )}
          <a className="ghost small" href={inspectedRef.url} target="_blank" rel="noreferrer">
            Open reference ↗
          </a>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   CANDIDATES TAB
   ════════════════════════════════════════════════════════════ */
function CandidatesTab({ detail }: { detail: AnalysisDetail }) {
  const { references } = detail;
  if (!references.length) {
    return <div className="skeleton">No candidates retrieved yet.</div>;
  }
  return (
    <ul className="refs">
      {references.map((ref, i) => (
        <li key={ref.id} className={`ref ${ref.selected ? 'selected' : ''}`}>
          <span className="ref-rank mono">#{i + 1}</span>
          <div className="ref-main">
            <a className="ref-title" href={ref.url} target="_blank" rel="noreferrer">
              {ref.title ?? ref.publication_number ?? 'Untitled'}
            </a>
            <div className="ref-meta">
              {ref.publication_number && <span className="tag mono">{ref.publication_number}</span>}
              {ref.office  && <span className="tag">{ref.office}</span>}
              {ref.kind    && <span className="tag">{ref.kind}</span>}
              {ref.source  && <span className="tag">{ref.source}</span>}
              {ref.priority_date && <span>priority {ref.priority_date.slice(0, 7)}</span>}
              {ref.rank_score != null && <span className="mono">rank {Number(ref.rank_score).toFixed(3)}</span>}
              {ref.selected && <span className="tag ok">charted</span>}
            </div>
            {ref.snippet && (
              <p className="ref-summary">
                {ref.snippet.slice(0, 220)}{ref.snippet.length > 220 ? '…' : ''}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
