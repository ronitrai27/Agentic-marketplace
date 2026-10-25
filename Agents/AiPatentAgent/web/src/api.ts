/** REST + SSE client. Tenant header keeps three concurrent rentals isolated. */

const TENANT_KEY = 'patent_agent_tenant';

export function tenantId(): string {
  let t = localStorage.getItem(TENANT_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TENANT_KEY, t);
  }
  return t;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-tenant-id': tenantId() };
  if (!opts.raw && (opts.body !== undefined || opts.method === 'POST')) headers['content-type'] = 'application/json';
  Object.assign(headers, opts.headers ?? {});

  const res = await fetch(path, {
    method: opts.method ?? (opts.raw || opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { code: string; message: string } };
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

export interface Health {
  status: string;
  free_mode: boolean;
  jurisdiction: string;
  db: { ok: boolean; detail: string };
  llm: { configured: string; env: string };
  sources: { source: string; state: string; count: number; reason?: string }[];
  pricing: { mode: string; rate: number; min_fee: number; max_fee: number; paypal: string };
}

export interface Meta {
  templates: Record<string, string>;
  team: { id: string; name: string; role: string }[];
  ui: { showTeamRail: boolean; uiMode: string };
  limits: { max_draft_chars: number; max_file_bytes: number };
}

export interface AnalysisPublic {
  id: string;
  status: string;
  stage: string | null;
  input_kind: string | null;
  input_name: string | null;
  draft_chars: number | null;
  novelty_score: number | null;
  verdict: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ClaimRow {
  id: number;
  claim_no: number;
  type: string;
  provisional: boolean;
  text: string;
}
export interface ElementRow {
  id: number;
  claim_id: number;
  element_no: number;
  text: string;
  weight: number;
}
export interface ReferenceRow {
  id: number;
  publication_number: string | null;
  kind: string;
  office: string | null;
  title: string | null;
  assignee: string | null;
  priority_date: string | null;
  publication_date: string | null;
  url: string;
  rank_score: number | null;
  selected: boolean;
  snippet: string | null;
  source: string | null;
}
export interface MatchRow {
  id: number;
  element_id: number;
  reference_id: number;
  match: 'disclosed' | 'partial' | 'not_found';
  quote: string | null;
  locator: string | null;
  commentary: string | null;
}
export interface AgentMessage {
  seq: number;
  from_agent: string;
  to_agent: string;
  template_id: string;
  payload: Record<string, unknown>;
}
export interface Billing {
  mode: string;
  billable_seconds: number;
  price: number | null;
  state: string;
}

export interface ScoreResult {
  novelty_score: number;
  verdict: string;
  per_claim: {
    claimId: number;
    claimNo: number;
    type: string;
    overlapPct: number;
    risk: string;
    perRef: { referenceId: number; overlap: number }[];
  }[];
  red_flags: string[];
  rewrite_suggestions: string[];
  closest_reference_note: string;
  coverage: {
    sources: { source: string; state: string; count: number; reason?: string }[];
    warnings: string[];
    refined: boolean;
    llm_mode: string;
    chart_mode: string;
  };
  billing?: Billing;
}

export interface AnalysisDetail {
  analysis: AnalysisPublic;
  claims: ClaimRow[];
  elements: ElementRow[];
  references: ReferenceRow[];
  matches: MatchRow[];
  messages: AgentMessage[];
  billing: Billing | null;
  result: ScoreResult | null;
  error: { message: string; retriable: boolean } | null;
}

export function uploadDraft(input: { text?: string; file?: File; name?: string }): Promise<{ id: string; cached?: boolean; status: string }> {
  if (input.file) {
    const fd = new FormData();
    fd.append('file', input.file);
    if (input.name) fd.append('name', input.name);
    return api('/api/analyses', { raw: fd });
  }
  return api('/api/analyses', { body: { text: input.text, name: input.name } });
}

export const getAnalysis = (id: string) => api<AnalysisDetail>(`/api/analyses/${id}`);
export const listAnalyses = () => api<{ analyses: AnalysisPublic[] }>('/api/analyses?limit=10');
export const deleteAnalysis = (id: string) => api(`/api/analyses/${id}`, { method: 'DELETE' });
export const askGrounded = (id: string, q: string) =>
  api<{ answer: string; evidence: { kind: string; ref: string | null; content: string; similarity: number }[] }>(
    `/api/analyses/${id}/ask`,
    { body: { q } },
  );
export const fetchHealth = () => api<Health>('/health');
export const fetchMeta = () => api<Meta>('/api/meta');

/** SSE subscription — replays persisted Team Rail messages, then streams live. */
export function streamAnalysis(id: string, onEvent: (ev: Record<string, unknown>) => void): () => void {
  // EventSource cannot send custom headers — pass tenant as query param instead
  const url = `/api/analyses/${id}/stream?tenant=${encodeURIComponent(tenantId())}`;
  const es = new EventSource(url);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as Record<string, unknown>);
    } catch {
      /* malformed frame — ignore */
    }
  };
  es.onerror = () => {
    /* EventSource auto-reconnects; DB remains truth */
  };
  return () => es.close();
}
