import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Mail,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from 'lucide-react';

type Channel = 'email';
type RunStatus = 'idle' | 'running' | 'success' | 'error';
type ConfigStatus = 'draft' | 'published';
type EmailConnection = { id: string; provider: 'gmail'; email: string; display_name: string; status: string };
type DashboardAgent = {
  id: string;
  agent_id: string;
  status: ConfigStatus;
  updated_at?: string;
  config: {
    channel?: Channel;
    objective: string;
    language?: string;
    tone?: string;
    dry_run?: boolean;
  };
};
type DashboardLog = { id: string; status: string; created_at: string; result: RunResult };

type RunResult = {
  status: string;
  results: Array<{
    recipient_id: string;
    status: string;
    outcome: Record<string, unknown>;
    error_code?: string | null;
    error_message_safe?: string | null;
    warnings?: string[];
  }>;
  warnings?: string[];
};
type EmailAttachment = { filename: string; content_type: string; content_base64: string; size: number };
type BulkPreview = {
  filename: string;
  total_rows: number;
  recipient_count: number;
  max_recipients: number;
  recipients: Array<{ row: number; name: string; email: string; subject?: string | null; body?: string | null }>;
  skipped: Array<{ row: number; reason: string }>;
  columns: Array<{ token: string; column: string; role: string }>;
};
type BulkRunResult = {
  status: string;
  dry_run: boolean;
  recipient_count: number;
  attachments?: string[];
  results: Array<{
    row: number;
    name: string;
    email: string;
    status: string;
    error_code?: string | null;
    error_message_safe?: string | null;
    subject?: string | null;
    body?: string | null;
  }>;
  skipped: Array<{ row: number; reason: string }>;
  warnings?: string[];
};

function recipientStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    submitted: 'Accepted by Gmail · delivery pending',
    delivered: 'Delivered',
    bounced: 'Bounced',
    blocked: 'Blocked',
    failed: 'Failed',
    drafted: 'Draft ready',
    suppressed: 'Suppressed',
  };
  return labels[status] ?? status;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg';

async function readAttachmentFiles(files: File[]): Promise<EmailAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
  }
  const encoded = await Promise.all(files.map(async (file) => ({
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    content_base64: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    }),
    size: file.size,
  })));
  if (encoded.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    throw new Error('Each attachment must be 10 MB or smaller.');
  }
  return encoded;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8010';

function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, credentials: 'include' });
}

function readableError(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'msg' in item) return String(item.msg);
      return JSON.stringify(item);
    });
    return messages.filter(Boolean).join('; ') || fallback;
  }
  if (detail && typeof detail === 'object') {
    if ('message' in detail) return String(detail.message);
    if ('detail' in detail) return readableError(detail.detail, fallback);
    return JSON.stringify(detail);
  }
  return fallback;
}

const DEFAULT_BULK_SUBJECT = '{{name}}, a quick note from {{sender_name}}';
const DEFAULT_BULK_BODY = [
  'Hi {{first_name}},',
  '',
  'I hope you are doing well. My name is {{sender_name}}, and I wanted to reach out personally.',
  '',
  '{{objective}}',
  '',
  'Would you be open to a short conversation this week? I would be happy to work around your schedule.',
  '',
  'Best regards,',
  '{{sender_signature}}',
].join('\n');

export function App() {
  const channel: Channel = 'email';
  const [objective, setObjective] = useState('Request an introductory meeting');
  const [tone, setTone] = useState('professional');
  const [language, setLanguage] = useState('en');
  const [dryRun, setDryRun] = useState(true);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientMode, setRecipientMode] = useState<'single' | 'bulk'>('single');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderSignature, setSenderSignature] = useState('');
  const [recipientContext, setRecipientContext] = useState(
    'Add verified agency, company, role, resume, or previous outreach facts here.',
  );
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [notice, setNotice] = useState('');
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('draft');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [dashboardAgents, setDashboardAgents] = useState<DashboardAgent[]>([]);
  const [dashboardLogs, setDashboardLogs] = useState<DashboardLog[]>([]);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkRunResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'parse' | 'run' | null>(null);
  const [bulkNotice, setBulkNotice] = useState('');
  const [bulkSubject, setBulkSubject] = useState(DEFAULT_BULK_SUBJECT);
  const [bulkBody, setBulkBody] = useState(DEFAULT_BULK_BODY);
  const [bulkAiDraft, setBulkAiDraft] = useState(true);
  const bulkBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const bulkParseSeq = useRef(0);
  const hasConnectedProvider = (provider: EmailConnection['provider']) =>
    connections.some((connection) => connection.provider === provider && connection.status === 'connected');

  async function refreshDashboard() {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/dashboard?tenant_id=demo-tenant`);
    if (!response.ok) return;
    const data = (await response.json()) as { agents?: DashboardAgent[]; logs?: DashboardLog[] };
    setDashboardAgents(data.agents ?? []);
    setDashboardLogs(data.logs ?? []);
  }

  useEffect(() => {
    async function hydrateWorkspace() {
      const sessionResponse = await apiFetch(`${API_BASE_URL}/api/v1/session`, { method: 'POST' });
      if (!sessionResponse.ok) {
        throw new Error('Could not start the workspace session.');
      }
      const dashboardResponse = await apiFetch(`${API_BASE_URL}/api/v1/dashboard?tenant_id=demo-tenant`);
      if (!dashboardResponse.ok) {
        throw new Error('Could not load the saved workspace.');
      }
      const data = (await dashboardResponse.json()) as {
        agents?: DashboardAgent[];
        logs?: DashboardLog[];
        connections?: EmailConnection[];
      };
      const agents = data.agents ?? [];
      const savedAgent = agents[0];
      setDashboardAgents(agents);
      setDashboardLogs(data.logs ?? []);
      setConnections(data.connections ?? []);
      if (savedAgent) {
        setInstanceId(savedAgent.id);
        setConfigStatus(savedAgent.status);
        setObjective(savedAgent.config.objective);
        setLanguage(savedAgent.config.language ?? 'en');
        setTone(savedAgent.config.tone ?? 'professional');
        setDryRun(savedAgent.config.dry_run ?? true);
      }
      const available = data.connections ?? [];
      if (available.length > 0) {
        const firstConnection = available[0];
        setSelectedConnectionId(firstConnection.id);
        setSenderEmail(firstConnection.email);
        setSenderName(firstConnection.display_name);
      }
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('email_connected') === '1') {
      setNotice('Email account connected. Select it as the sender before live sending.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    void hydrateWorkspace().catch((error: unknown) => {
      setConnections([]);
      setNotice(error instanceof Error ? error.message : 'Could not load the saved workspace.');
    });
  }, []);

  async function connectEmail(provider: 'gmail') {
    setNotice('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/v1/email-connections/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: 'demo-tenant',
          provider,
          return_url: window.location.origin,
        }),
      });
      const data = (await response.json()) as { authorization_url?: string; detail?: string };
      if (!response.ok || !data.authorization_url) {
        throw new Error(readableError(data.detail, `Could not start ${provider} connection.`));
      }
      window.location.href = data.authorization_url;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not connect email account.');
    }
  }

  const modeCopy = useMemo(
    () => ({
      label: 'Email mode',
      description: 'Prepare a personalized message and route it through approval.',
      icon: Mail,
      provider: 'Sarvam drafting · Gmail delivery',
    }),
    [],
  );

  async function saveAndPublish() {
    setNotice('');
    setValidationWarnings([]);
    const config = {
      channel,
      objective,
      language,
      tone,
      require_approval: true,
      dry_run: dryRun,
      max_actions_per_recipient: 1,
    };
    try {
      const validationResponse = await apiFetch(`${API_BASE_URL}/api/v1/agent-instances/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const validation = (await validationResponse.json()) as {
        valid: boolean;
        warnings?: string[];
        errors?: Array<{ message: string }>;
      };
      setValidationWarnings(validation.warnings ?? []);
      if (!validation.valid) {
        throw new Error(validation.errors?.map((error) => error.message).join(', ') || 'Configuration is invalid.');
      }

      let savedInstanceId = instanceId;
      if (!savedInstanceId) {
        const createResponse = await apiFetch(`${API_BASE_URL}/api/v1/agent-instances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: 'demo-tenant',
            agent_id: 'universal-outreach-agent',
            config,
          }),
        });
        const created = (await createResponse.json()) as { id?: string; detail?: string };
        if (!createResponse.ok || !created.id) {
          throw new Error(readableError(created.detail, 'Could not save the configuration.'));
        }
        savedInstanceId = created.id;
        setInstanceId(created.id);
      }

      const publishResponse = await apiFetch(`${API_BASE_URL}/api/v1/agent-instances/${savedInstanceId}/publish`, {
        method: 'POST',
      });
      const published = (await publishResponse.json()) as { published?: boolean; detail?: string };
      if (!publishResponse.ok || !published.published) {
        throw new Error(readableError(published.detail, 'Could not publish the configuration.'));
      }
      setConfigStatus('published');
      await refreshDashboard();
    } catch (error) {
      setConfigStatus('draft');
      setNotice(error instanceof Error ? error.message : 'Could not publish the configuration.');
    }
  }

  async function runTest() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
      setRunStatus('error');
      setNotice('Enter a valid recipient email address before running an email test.');
      return;
    }
    if (!recipientName.trim()) {
      setRunStatus('error');
      setNotice('Enter the recipient name before running an email test.');
      return;
    }
    if (!senderName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail.trim())) {
      setRunStatus('error');
      setNotice('Enter your sender name and a verified sender email before running an email test.');
      return;
    }
    if (!dryRun && !selectedConnectionId) {
      setRunStatus('error');
      setNotice('Connect and select your Gmail account before live sending.');
      return;
    }
    if (!dryRun && !window.confirm('Send one real email through your connected account to this recipient?')) {
      return;
    }
    setRunStatus('running');
    setNotice('');
    setRunResult(null);
    const idempotencyKey = `ui-${Date.now()}`;
    const payload = {
      tenant_id: 'demo-tenant',
      workflow_run_id: `workflow-${Date.now()}`,
      agent_instance_id: instanceId ?? 'universal-outreach-demo',
      idempotency_key: idempotencyKey,
      channel,
      objective,
      language,
      recipients: [
        {
          recipient_id: 'recipient-demo',
          name: recipientName.trim() || null,
          email: recipientEmail,
          locale: language,
          attributes: { consent: true, supplied_context: recipientContext },
        },
      ],
      sender_name: senderName.trim(),
      sender_email: senderEmail.trim(),
      sender_signature: senderSignature.trim() || senderName.trim(),
      connection_id: selectedConnectionId || null,
      config_version: '1.0.0',
      require_approval: true,
      approval_granted: !dryRun,
      dry_run: dryRun,
      attachments: attachments.map(({ filename, content_type, content_base64 }) => ({
        filename,
        content_type,
        content_base64,
      })),
    };

    try {
      const endpoint = dryRun
        ? `${API_BASE_URL}/api/v1/outreach/preview`
        : `${API_BASE_URL}/api/v1/outreach/send`;
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(dryRun ? {} : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as RunResult & { detail?: string };
      if (!response.ok) {
        throw new Error(readableError(data.detail, 'The API rejected this run.'));
      }

      setRunResult(data);
      setRunStatus(data.status === 'failed' ? 'error' : 'success');
      await refreshDashboard();
    } catch (error) {
      setRunStatus('error');
      setNotice(error instanceof Error ? error.message : 'Could not reach the API.');
    }
  }

  function resetRun() {
    setRunStatus('idle');
    setRunResult(null);
    setNotice('');
  }

  function selectBulkFile(file: File | null) {
    setBulkFile(file);
    setBulkPreview(null);
    setBulkResult(null);
    setBulkNotice('');
    setBulkBusy(file ? 'parse' : null);
  }

  async function parseBulkFile(file: File) {
    const sequence = ++bulkParseSeq.current;
    setBulkBusy('parse');
    try {
      const form = new FormData();
      form.append('file', file);
      // Parsing only reads the workbook — Sarvam drafting happens when the
      // user presses the run button, never on file select.
      form.append('ai_draft', 'false');
      form.append('objective', objective);
      form.append('sender_name', senderName.trim());
      form.append('sender_signature', senderSignature.trim() || senderName.trim());
      if (!bulkAiDraft) {
        form.append('subject_template', bulkSubject);
        form.append('body_template', bulkBody);
      }
      const response = await apiFetch(`${API_BASE_URL}/api/v1/outreach/bulk/parse`, { method: 'POST', body: form });
      const data = (await response.json().catch(() => ({}))) as BulkPreview & { detail?: string };
      if (sequence !== bulkParseSeq.current) return; // a newer parse superseded this one
      if (!response.ok) {
        throw new Error(readableError(data.detail, 'Could not read the Excel file.'));
      }
      setBulkPreview(data);
      setBulkNotice('');
    } catch (error) {
      if (sequence === bulkParseSeq.current) {
        setBulkNotice(error instanceof Error ? error.message : 'Could not read the Excel file.');
      }
    } finally {
      if (sequence === bulkParseSeq.current) setBulkBusy(null);
    }
  }

  function insertBulkToken(token: string) {
    const snippet = `{{${token}}}`;
    const textarea = bulkBodyRef.current;
    if (!textarea) {
      setBulkBody((previous) => `${previous}${snippet}`);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    setBulkBody(textarea.value.slice(0, start) + snippet + textarea.value.slice(end));
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + snippet.length;
      textarea.setSelectionRange(caret, caret);
    });
  }

  async function runBulk() {
    if (!bulkFile || !bulkPreview) return;
    setBulkNotice('');
    if (!objective.trim()) {
      setBulkNotice('Enter an outreach objective before the bulk send.');
      return;
    }
    if (!senderName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail.trim())) {
      setBulkNotice('Enter your sender name and a verified sender email before the bulk send.');
      return;
    }
    if (!dryRun && !selectedConnectionId) {
      setBulkNotice('Connect and select your Gmail account before live sending.');
      return;
    }
    if (
      !dryRun &&
      !window.confirm(`Send ${bulkPreview.recipient_count} real emails to every recipient in this file?`)
    ) {
      return;
    }
    setBulkBusy('run');
    setBulkResult(null);
    try {
      const form = new FormData();
      form.append('file', bulkFile);
      form.append('dry_run', String(dryRun));
      form.append('approval_granted', String(!dryRun));
      form.append('objective', objective);
      form.append('language', language);
      form.append('tone', tone);
      form.append('sender_name', senderName.trim());
      form.append('sender_email', senderEmail.trim());
      form.append('sender_signature', senderSignature.trim() || senderName.trim());
      form.append('connection_id', selectedConnectionId || '');
      form.append('ai_draft', String(bulkAiDraft));
      if (attachments.length > 0) {
        form.append(
          'attachments_json',
          JSON.stringify(attachments.map(({ filename, content_type, content_base64 }) => ({
            filename,
            content_type,
            content_base64,
          }))),
        );
      }
      if (bulkAiDraft) {
        form.append('subject_template', '');
        form.append('body_template', '');
      } else {
        form.append('subject_template', bulkSubject);
        form.append('body_template', bulkBody);
      }
      const response = await apiFetch(`${API_BASE_URL}/api/v1/outreach/bulk`, { method: 'POST', body: form });
      const data = (await response.json().catch(() => ({}))) as BulkRunResult & { detail?: string };
      if (!response.ok) {
        throw new Error(readableError(data.detail, 'The bulk run was rejected.'));
      }
      setBulkResult(data);
      await refreshDashboard();
    } catch (error) {
      setBulkNotice(error instanceof Error ? error.message : 'Could not run the bulk send.');
    } finally {
      setBulkBusy(null);
    }
  }

  useEffect(() => {
    if (!bulkFile) return;
    // Parsing is cheap now (no AI calls at parse time), so re-run it whenever
    // the file, the templates, or the sender context changes. Sarvam only
    // drafts when the user actually presses the run button.
    const timer = window.setTimeout(() => {
      void parseBulkFile(bulkFile);
    }, 350);
    return () => window.clearTimeout(timer);
    // Re-parse (and re-render every row's email) whenever the file, the
    // templates, or the sender context changes.
  }, [bulkFile, bulkAiDraft, bulkSubject, bulkBody, objective, tone, language, senderName, senderSignature]);

  const bulkTokens = useMemo(() => {
    const fromColumns = (bulkPreview?.columns ?? [])
      .filter((column) => column.role !== 'email')
      .map((column) => ({
        token: column.token,
        label: `{{${column.token}}}`,
        hint: `From row 1 column "${column.column}"`,
      }));
    const builtIns = ['first_name', 'objective', 'sender_name', 'sender_signature']
      .filter((token) => !fromColumns.some((item) => item.token === token))
      .map((token) => ({ token, label: `{{${token}}}`, hint: 'Built-in field' }));
    return [...fromColumns, ...builtIns];
  }, [bulkPreview]);

  const ModeIcon = modeCopy.icon;

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">Universal Outreach / Instance</div>
            <h1>Configure an outreach outcome.</h1>
          </div>
          <div className="topbar-actions">
            <span className={`version-pill version-pill--${configStatus}`}>v1.0.0 · {configStatus === 'published' ? 'Published' : 'Draft'}</span>
            <button className="publish-button" type="button" onClick={saveAndPublish}>
              {configStatus === 'published' ? 'Published' : 'Validate & publish'}
            </button>
            <button className="quiet-button" type="button" onClick={resetRun}><RotateCcw size={15} /> Reset</button>
          </div>
        </header>

        <section className="status-strip" aria-label="Agent readiness">
          <div className="status-item"><ShieldCheck size={17} /><span>Policy gate active</span></div>
          <div className="status-item"><Clock3 size={17} /><span>Durable execution ready</span></div>
          <div className="status-item"><Users size={17} /><span>Batch limit 500 recipients</span></div>
          <div className="status-item status-item--muted">External action: approval required</div>
        </section>

        <section className="dashboard-section" id="runs" aria-labelledby="dashboard-heading">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Persistent workspace</div>
              <h2 id="dashboard-heading">Your agents and activity.</h2>
            </div>
            <span className="step-count">Session · 1 hour</span>
          </div>
          <div className="dashboard-grid">
            <div className="dashboard-panel">
              <div className="dashboard-panel-heading"><strong>Agents</strong><span>{dashboardAgents.length}</span></div>
              {dashboardAgents.length === 0 ? (
                <p className="field-help">No saved agents yet. Publish this configuration to keep it in your workspace.</p>
              ) : dashboardAgents.map((agent) => (
                <div className="dashboard-row" key={agent.id}>
                  <span><strong>{agent.agent_id}</strong><small>{agent.config.objective}</small></span>
                  <em className={`status-badge status-badge--${agent.status}`}>{agent.status}</em>
                </div>
              ))}
            </div>
            <div className="dashboard-panel">
              <div className="dashboard-panel-heading"><strong>Recent runs</strong><span>{dashboardLogs.length}</span></div>
              {dashboardLogs.length === 0 ? (
                <p className="field-help">Run a dry test to create the first activity record.</p>
              ) : dashboardLogs.slice(0, 5).map((log) => (
                <div className="dashboard-row" key={log.id}>
                  <span><strong>{log.status}</strong><small>{new Date(log.created_at).toLocaleString()}</small></span>
                  <em className="status-badge">{log.result.results?.length ?? 0} recipient</em>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="workspace-grid" id="configure">
          <section className="config-column">
            <div className="section-heading">
              <div>
                <div className="eyebrow">01 / Intent</div>
                <h2>Tell the agent what success means.</h2>
              </div>
              <span className="step-count">1 of 3</span>
            </div>

            <div className="field-block">
              <label htmlFor="objective">Outreach objective</label>
              <textarea
                id="objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Describe the outcome, not the provider payload."
                rows={3}
              />
              <p className="field-help">This instruction is used for personalization. It cannot bypass consent, suppression, or approval rules.</p>
            </div>

            {channel === 'email' && (
              <div className="field-block">
                <label htmlFor="recipient-context">Verified recipient and agency context (optional)</label>
                <textarea
                  id="recipient-context"
                  value={recipientContext}
                  onChange={(event) => setRecipientContext(event.target.value)}
                  placeholder="Company facts, role, resume evidence, or previous outreach context"
                  rows={3}
                />
                <p className="field-help">Sarvam uses only this supplied context while drafting. Do not paste secrets or instructions for the model here.</p>
              </div>
            )}

            <div className="section-heading section-heading--spaced">
              <div>
                <div className="eyebrow">02 / Channel</div>
                <h2>Choose how to reach them.</h2>
              </div>
            </div>

            <div className="channel-switch" role="group" aria-label="Outreach channel">
              <button className="channel-card channel-card--active" type="button">
                <Mail size={19} />
                <span><strong>Email</strong><small>Draft, approve, send</small></span>
                <Check className="channel-check" size={17} />
              </button>
            </div>

            {channel === 'email' && (
              <div className="sender-card">
                <div className="sender-card-heading">
                  <div>
                    <div className="eyebrow">Sender identity</div>
                    <strong>Send from your connected Gmail</strong>
                  </div>
                  <span className="sender-card-status"><span /> Gmail</span>
                </div>
                <p className="field-help">Connect an account and select it before live sending. The connected identity is used as the sender.</p>
                <div className="connection-actions">
                  <button
                    type="button"
                    className={hasConnectedProvider('gmail') ? 'connection-button connection-button--connected' : 'connection-button'}
                    onClick={() => void connectEmail('gmail')}
                  >
                    {hasConnectedProvider('gmail') ? 'Gmail connected' : 'Connect Gmail'}
                  </button>
                </div>
                {connections.length > 0 && (
                  <>
                    <label className="field-help" htmlFor="sender-connection">
                      Connected sender
                      <select
                        id="sender-connection"
                        value={selectedConnectionId}
                        onChange={(event) => {
                          const connection = connections.find((item) => item.id === event.target.value);
                          setSelectedConnectionId(event.target.value);
                          if (connection) {
                            setSenderEmail(connection.email);
                            setSenderName(connection.display_name);
                          }
                        }}
                      >
                        <option value="">Choose a connected account</option>
                        {connections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.provider} · {connection.display_name} · {connection.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    {connections.filter((connection) => connection.id === selectedConnectionId).map((connection) => (
                      <div className="connected-identity" key={connection.id}>
                        <strong>{connection.provider.toUpperCase()} · Connected</strong>
                        <span>{connection.display_name}</span>
                        <span>{connection.email}</span>
                      </div>
                    ))}
                  </>
                )}
                {connections.length === 0 && (
                  <p className="field-help">No connected sender yet. Connect Gmail to enable live sending.</p>
                )}
                <div className="sender-fields">
                  <input aria-label="Sender name" placeholder="Your name (required)" value={senderName} onChange={(event) => setSenderName(event.target.value)} />
                  <input aria-label="Sender email" type="email" placeholder="Connected account email" value={senderEmail} readOnly={Boolean(selectedConnectionId)} onChange={(event) => setSenderEmail(event.target.value)} />
                  <input aria-label="Email signature" placeholder="Signature (optional)" value={senderSignature} onChange={(event) => setSenderSignature(event.target.value)} />
                </div>
              </div>
            )}

            <div className="mode-note">
              <ModeIcon size={17} />
              <div><strong>{modeCopy.label}</strong><p>{modeCopy.description}</p></div>
              <span>{modeCopy.provider}</span>
            </div>

            <div className="split-fields">
              <div className="field-block">
                <label htmlFor="language">Language</label>
                <div className="select-wrap">
                  <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                    <option value="en">English</option>
                    <option value="as-IN">Assamese (India)</option>
                    <option value="bn-IN">Bengali (India)</option>
                    <option value="brx-IN">Bodo (India)</option>
                    <option value="doi-IN">Dogri (India)</option>
                    <option value="gu-IN">Gujarati (India)</option>
                    <option value="hi-IN">Hindi (India)</option>
                    <option value="kn-IN">Kannada (India)</option>
                    <option value="ks-IN">Kashmiri (India)</option>
                    <option value="kok-IN">Konkani (India)</option>
                    <option value="mai-IN">Maithili (India)</option>
                    <option value="ml-IN">Malayalam (India)</option>
                    <option value="mni-IN">Manipuri (India)</option>
                    <option value="mr-IN">Marathi (India)</option>
                    <option value="ne-IN">Nepali (India)</option>
                    <option value="or-IN">Odia (India)</option>
                    <option value="pa-IN">Punjabi (India)</option>
                    <option value="sa-IN">Sanskrit (India)</option>
                    <option value="sat-IN">Santali (India)</option>
                    <option value="sd-IN">Sindhi (India)</option>
                    <option value="ta-IN">Tamil (India)</option>
                    <option value="te-IN">Telugu (India)</option>
                    <option value="ur-IN">Urdu (India)</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
              </div>
              <div className="field-block">
                <label htmlFor="tone">Tone</label>
                <div className="select-wrap">
                  <select id="tone" value={tone} onChange={(event) => setTone(event.target.value)}>
                    <option value="professional">Professional</option>
                    <option value="warm">Warm</option>
                    <option value="concise">Concise</option>
                    <option value="friendly">Friendly</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="empathetic">Empathetic</option>
                    <option value="formal">Formal</option>
                    <option value="casual">Casual</option>
                    <option value="direct">Direct</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>

            <div className="section-heading section-heading--spaced">
              <div>
                <div className="eyebrow">03 / Add recipients</div>
                <h2>One person or up to 50 from Excel.</h2>
              </div>
              <span className="step-count">{recipientMode === 'bulk' ? 'Max 50 rows' : '1 recipient'}</span>
            </div>

            <div className="mode-toggle" role="group" aria-label="Recipient mode">
              <button
                type="button"
                className={recipientMode === 'single' ? 'mode-toggle-btn mode-toggle-btn--active' : 'mode-toggle-btn'}
                aria-pressed={recipientMode === 'single'}
                onClick={() => setRecipientMode('single')}
              >
                <User size={16} />
                <span><strong>Single recipient</strong><small>Name + email</small></span>
              </button>
              <button
                type="button"
                className={recipientMode === 'bulk' ? 'mode-toggle-btn mode-toggle-btn--active' : 'mode-toggle-btn'}
                aria-pressed={recipientMode === 'bulk'}
                onClick={() => setRecipientMode('bulk')}
              >
                <Users size={16} />
                <span><strong>Bulk Excel send</strong><small>Upload a file, up to 50 rows</small></span>
              </button>
            </div>

            <label className="toggle-row">
              <span><strong>Dry run</strong><small>Never contact the provider; return a draft/result preview.</small></span>
              <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
              <span className="toggle-track" aria-hidden="true" />
            </label>

            {recipientMode === 'single' && (
              <>
            <div className="recipient-card">
              <div className="recipient-avatar">{recipientName.trim() ? recipientName.trim().slice(0, 2).toUpperCase() : 'R'}</div>
              <div className="recipient-fields">
                <strong>{recipientName.trim() || 'Recipient'}</strong>
                <span>Enter a recipient contact · consent recorded</span>
              </div>
              <div className="recipient-inputs">
                <input
                  aria-label="Recipient name"
                  placeholder="Recipient name (required)"
                  value={recipientName}
                  onChange={(event) => setRecipientName(event.target.value)}
                />
                <input
                  aria-label="Recipient email"
                  type="email"
                  placeholder="recipient@company.com"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  required
                />
              </div>
            </div>

            {channel === 'email' && (
              <div className="attachment-panel">
                <div>
                  <strong>Attachments</strong>
                  <p className="field-help">Up to 5 files, 10 MB each. PDF, Word, Excel, text, PNG, or JPEG.</p>
                </div>
                <label className="file-picker">
                  <span>Choose documents</span>
                  <input
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    onChange={async (event) => {
                      try {
                        setAttachments(await readAttachmentFiles(Array.from(event.target.files ?? [])));
                        setNotice('');
                      } catch (error) {
                        setAttachments([]);
                        setNotice(error instanceof Error ? error.message : 'Could not read attachments.');
                      }
                    }}
                  />
                </label>
                {attachments.length > 0 && (
                  <ul className="attachment-list">
                    {attachments.map((file) => (
                      <li key={file.filename}><span>{file.filename}</span><small>{Math.ceil(file.size / 1024)} KB</small></li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button className="run-button" type="button" onClick={runTest} disabled={runStatus === 'running'}>
              {runStatus === 'running' ? <><span className="spinner" /> Running validation…</> : <><Play size={17} fill="currentColor" /> Test this configuration <ArrowUpRight size={17} /></>}
            </button>
            {notice && <div className="notice notice--error"><CircleAlert size={17} /> {notice}</div>}
            {validationWarnings.length > 0 && (
              <div className="notice notice--warning"><ShieldCheck size={17} /> {validationWarnings.join(' ')}</div>
            )}
              </>
            )}

            {recipientMode === 'bulk' && (
              <>
            <div className="attachment-panel">
              <div>
                <strong>Excel recipient list (.xlsx)</strong>
                <p className="field-help">
                  Row 1 defines your fields — any headers work (email, author name, full name, company,
                  city…); the email and name columns are found automatically. Up to 50 recipient rows.
                </p>
              </div>
              <label className="file-picker">
                <span>{bulkFile ? bulkFile.name : 'Choose Excel file'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(event) => void selectBulkFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <div className="bulk-attachments">
                <div>
                  <strong>Attachments (optional)</strong>
                  <p className="field-help">
                    The same files go with every email in this batch. Up to 5 files, 10 MB each.
                  </p>
                </div>
                <label className="file-picker">
                  <span>Choose documents</span>
                  <input
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    onChange={async (event) => {
                      try {
                        setAttachments(await readAttachmentFiles(Array.from(event.target.files ?? [])));
                        setBulkNotice('');
                      } catch (error) {
                        setAttachments([]);
                        setBulkNotice(error instanceof Error ? error.message : 'Could not read attachments.');
                      }
                    }}
                  />
                </label>
                {attachments.length > 0 && (
                  <ul className="attachment-list">
                    {attachments.map((file) => (
                      <li key={file.filename}>
                        <span>{file.filename}</span>
                        <small>{Math.ceil(file.size / 1024)} KB</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bulk-write-switch" role="group" aria-label="How emails are written">
                <button
                  type="button"
                  className={bulkAiDraft ? 'write-mode write-mode--active' : 'write-mode'}
                  aria-pressed={bulkAiDraft}
                  onClick={() => setBulkAiDraft(true)}
                >
                  <Sparkles size={15} />
                  <span><strong>AI writes each email</strong><small>Sarvam drafts from your objective + row fields</small></span>
                </button>
                <button
                  type="button"
                  className={!bulkAiDraft ? 'write-mode write-mode--active' : 'write-mode'}
                  aria-pressed={!bulkAiDraft}
                  onClick={() => setBulkAiDraft(false)}
                >
                  <span className="write-mode-emoji" aria-hidden="true">✍️</span>
                  <span><strong>My own template</strong><small>Reuse one text with {'{{tokens}}'}</small></span>
                </button>
              </div>
              {bulkAiDraft ? (
                <div className="bulk-ai-note">
                  <p>
                    <Sparkles size={14} />
                    <span>
                      <strong>Sarvam writes a unique, personalized email for every row</strong> from your
                      objective, tone, language, and that row's fields — no template needed.
                    </span>
                  </p>
                  <p className="bulk-ai-step">
                    Nothing is drafted yet. Press <strong>Run</strong> below — Sarvam writes each email,
                    shows you every draft, and (in dry run) sends nothing.
                  </p>
                  {!objective.trim() && (
                    <p className="bulk-ai-warn">Add your objective above — that is what the AI writes about.</p>
                  )}
                </div>
              ) : (
              <div className="bulk-template">
                <label className="bulk-template-label" htmlFor="bulk-subject">Subject template</label>
                <input
                  id="bulk-subject"
                  className="bulk-subject-input"
                  value={bulkSubject}
                  onChange={(event) => setBulkSubject(event.target.value)}
                  placeholder="{{name}}, a quick note from {{sender_name}}"
                />
                <label className="bulk-template-label" htmlFor="bulk-body">
                  Email body — one personalized email per row
                </label>
                <textarea
                  id="bulk-body"
                  ref={bulkBodyRef}
                  rows={9}
                  value={bulkBody}
                  onChange={(event) => setBulkBody(event.target.value)}
                />
                <div className="token-chips" role="group" aria-label="Insert a field into the email">
                  <span className="field-help">Row 1 fields — click to insert:</span>
                  {bulkTokens.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      title={item.hint}
                      onClick={() => insertBulkToken(item.token)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="field-help">
                  {'{{tokens}}'} are replaced with each row's values; empty fields are removed cleanly, so
                  everyone gets the same polished text with their own details.
                </p>
              </div>
              )}
              <p className="bulk-mode">
                Mode:{' '}
                {dryRun
                  ? 'dry run — no email leaves this machine.'
                  : 'live send — emails go through your connected Gmail after approval.'}
              </p>
              {bulkBusy === 'parse' && !bulkPreview && (
                <p className="field-help">Reading the workbook…</p>
              )}
              {bulkPreview && (
                <div className="bulk-panel">
                  <p className="bulk-summary">
                    <strong>{bulkPreview.recipient_count}</strong> recipients ready · file rows{' '}
                    {bulkPreview.total_rows} · limit {bulkPreview.max_recipients}
                  </p>
                  <p className="field-help">
                    Row 1 mapping:{' '}
                    {bulkPreview.columns
                      .map((column) => `${column.token} ← "${column.column}"`)
                      .join(' · ')}
                  </p>
                  <ul className="bulk-list">
                    {bulkPreview.recipients.map((item) => (
                      <li key={item.row}>
                        <span>Row {item.row} · {item.name}</span>
                        <small>{item.email}</small>
                        {item.subject && item.body && (
                          <details className="email-preview">
                            <summary>{item.subject}</summary>
                            <pre>{item.body}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                  {bulkPreview.skipped.length > 0 && (
                    <ul className="bulk-skipped">
                      {bulkPreview.skipped.map((item) => (
                        <li key={item.row}>Row {item.row} skipped — {item.reason}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="run-button"
                    type="button"
                    onClick={() => void runBulk()}
                    disabled={bulkBusy === 'run'}
                  >
                    {bulkBusy === 'run' ? (
                      <><span className="spinner" /> {bulkAiDraft ? `Sarvam is writing & sending ${bulkPreview.recipient_count} emails…` : `Sending to ${bulkPreview.recipient_count} recipients…`}</>
                    ) : (
                      <>
                        <Play size={17} fill="currentColor" />
                        {dryRun
                          ? `Run dry test for ${bulkPreview.recipient_count} recipients`
                          : `Send ${bulkPreview.recipient_count} emails now`}
                        <ArrowUpRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              )}
              {bulkNotice && (
                <div className="notice notice--error"><CircleAlert size={17} /> {bulkNotice}</div>
              )}
            </div>

            {bulkResult && (
              <div className="attachment-panel bulk-results">
                <div className={bulkResult.dry_run ? 'bulk-verdict bulk-verdict--dry' : 'bulk-verdict bulk-verdict--live'}>
                  <strong>
                    {bulkResult.dry_run
                      ? `Dry run finished — 0 emails sent`
                      : `${bulkResult.recipient_count} emails sent through Gmail`}
                  </strong>
                  <p>
                    {bulkResult.dry_run
                      ? `${bulkResult.recipient_count} drafts below are previews only. Nothing left this machine.`
                      : 'Each recipient below shows Gmail’s accepted status.'}
                  </p>
                </div>
                <p className="field-help">
                  Run status: {bulkResult.status} · {bulkResult.recipient_count} recipients processed ·{' '}
                  {bulkResult.skipped.length} rows skipped.
                  {bulkResult.attachments && bulkResult.attachments.length > 0 && (
                    <> · Attached: {bulkResult.attachments.join(', ')}</>
                  )}
                </p>
                <ul className="bulk-list">
                  {bulkResult.results.map((item) => (
                    <li key={item.row}>
                      <span>{item.name || 'Recipient'} · row {item.row}</span>
                      <small>
                        {item.email}
                        {item.error_code ? ` · ${item.error_code}` : ''}
                      </small>
                      <em className={`bulk-status bulk-status--${item.status}`}>
                        {item.status === 'drafted' ? 'Draft · NOT sent'
                          : item.status === 'submitted' ? 'Sent ✓'
                          : recipientStatusLabel(item.status)}
                      </em>
                      {item.error_message_safe && (
                        <small className="bulk-row-error">{item.error_message_safe}</small>
                      )}
                      {item.subject && item.body && (
                        <details className="email-preview">
                          <summary>{item.subject}</summary>
                          <pre>{item.body}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
                {bulkResult.skipped.length > 0 && (
                  <ul className="bulk-skipped">
                    {bulkResult.skipped.map((item) => (
                      <li key={item.row}>Row {item.row} skipped — {item.reason}</li>
                    ))}
                  </ul>
                )}
                {bulkResult.warnings?.map((warning) => (
                  <p className="result-warning" key={warning}>{warning}</p>
                ))}
              </div>
            )}
              </>
            )}
          </section>

          <aside className="preview-column" id="runs">
            <div className="preview-header">
              <div>
                <div className="eyebrow">Live preview</div>
                <h2>Execution readout</h2>
              </div>
              <div className={`run-indicator run-indicator--${runStatus}`}><span /> {runStatus === 'idle' ? 'Waiting' : runStatus}</div>
            </div>

            <div className="execution-card">
              <div className="execution-topline"><span>Universal Outreach</span><span>{channel.toUpperCase()}</span></div>
              <div className="execution-title">{objective || 'Your objective will appear here.'}</div>
              <div className="execution-path">
                <div className="path-row"><span className="path-index">01</span><span>Validate contract</span><Check size={15} /></div>
                <div className="path-row"><span className="path-index">02</span><span>Evaluate policy</span><Check size={15} /></div>
                <div className="path-row"><span className="path-index">03</span><span>{dryRun ? 'Build safe preview' : 'Await approval and dispatch'}</span><span className="path-dot" /></div>
              </div>
              <div className="execution-footer"><span>{dryRun ? 'No provider side effect' : 'Approval gate enabled'}</span><span>Config {tone} · {language}</span></div>
            </div>

            <div className="result-panel">
              <div className="panel-heading"><span>Latest result</span>{runResult && <span className="result-status">{runResult.status}</span>}</div>
              {!runResult ? (
                <div className="empty-result"><Sparkles size={22} /><p>Run a test to see normalized recipient results, warnings, and provider evidence.</p></div>
              ) : (
                <div className="result-content">
                  {runResult.results.map((result) => (
                    <div className="result-row" key={result.recipient_id}>
                      <span className="result-icon">
                        {result.status === 'failed' ? <CircleAlert size={15} /> : <Check size={15} />}
                      </span>
                      <div>
                        <strong>{result.recipient_id}</strong>
                        <small>{recipientStatusLabel(result.status)}{result.error_code ? ` · ${result.error_code}` : ''}</small>
                        {result.error_message_safe && <small className="result-error">{result.error_message_safe}</small>}
                        {result.status === 'submitted' && (
                          <small className="result-pending">Gmail accepted the request. Waiting for delivery confirmation.</small>
                        )}
                      </div>
                      <span className="result-chevron">→</span>
                    </div>
                  ))}
                  {runResult.warnings?.map((warning) => <p className="result-warning" key={warning}>{warning}</p>)}
                </div>
              )}
            </div>

            <div className="guardrail-card">
              <ShieldCheck size={18} />
              <div><strong>Why this is safe</strong><p>Provider-specific payloads stay behind adapters. Every recipient is checked before any external action.</p></div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
