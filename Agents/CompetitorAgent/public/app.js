/* Competitor Agent — chat workbench. Vanilla JS, no framework, no build step. */

const $ = (id) => document.getElementById(id);
const STAGES = ["validating", "scouting", "analysing", "verdict"];
const STAGE_NAMES = {
  validating: "Validating the idea",
  scouting: "Scouting competitors",
  analysing: "Reading what & how they build",
  verdict: "Writing the verdict",
};

let pollTimer = null;
let activeId = null;
let health = null;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "source"; }
};

/* ───────────────────────── health ───────────────────────── */

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    health = await response.json();
    const ok = health.llm_configured;
    $("healthDot").className = "dot " + (ok ? "ok" : "bad");
    $("heroDot").className = "dot " + (ok ? "ok" : "bad");
    $("modelBadge").textContent = health.model ? health.model.split("/").pop() : "no model";
    $("heroStatus").textContent = ok
      ? (health.search_configured ? "online · tinyfish search" : "online · model knowledge only")
      : "offline — set OPENAI_API_KEY in .env";
    if (!ok) setHint("Set OPENAI_API_KEY in .env first.");
    else if (!health.search_configured) setHint("No search key — results come from model knowledge.");
  } catch {
    health = null;
    $("healthDot").className = "dot bad";
    $("heroDot").className = "dot bad";
    $("heroStatus").textContent = "offline — backend unreachable";
  }
}

const setHint = (text) => { $("hint").textContent = text || ""; };

/* ───────────────────────── sidebar ───────────────────────── */

async function loadConversations() {
  try {
    const response = await fetch("/api/analyses?limit=50");
    const items = await response.json();
    const nav = $("convos");
    if (!items.length) {
      nav.innerHTML = '<p class="convos-empty">No analyses yet. Describe an idea below to start.</p>';
      return;
    }
    nav.innerHTML = items
      .map((item) => {
        const date = (item.created_at || "").slice(0, 10);
        return `
        <div class="convo${item.id === activeId ? " is-active" : ""}" data-id="${esc(item.id)}">
          <button class="convo-open" type="button"
                  data-id="${esc(item.id)}" aria-label="Open analysis">
            <span class="convo-idea">${esc(item.idea)}</span>
            <span class="convo-meta">
              <span class="convo-status ${esc(item.status)}"></span>
              ${esc(date)} · ${item.competitor_count} rival${item.competitor_count === 1 ? "" : "s"}
            </span>
          </button>
          <button class="convo-del" type="button" data-del="${esc(item.id)}" aria-label="Delete analysis">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>`;
      })
      .join("");

    nav.querySelectorAll(".convo-open").forEach((node) =>
      node.addEventListener("click", () => openAnalysis(node.dataset.id)));
    nav.querySelectorAll(".convo-del").forEach((node) =>
      node.addEventListener("click", (event) => { event.stopPropagation(); deleteAnalysis(node.dataset.del); }));
  } catch {
    /* sidebar is best-effort */
  }
}

async function deleteAnalysis(id) {
  try {
    await fetch(`/api/analyses/${id}`, { method: "DELETE" });
    if (activeId === id) newChat();
    loadConversations();
  } catch {
    setHint("Could not delete that analysis.");
  }
}

function markActive() {
  document.querySelectorAll(".convo").forEach((node) =>
    node.classList.toggle("is-active", node.dataset.id === activeId));
}

/* ───────────────────────── chat flow ───────────────────────── */

/* the one composer parks in the hero card when idle, in the bottom dock during a thread */
function parkComposer(where) {
  const form = $("composer");
  const slot = $(where);
  if (form.parentElement !== slot) slot.appendChild(form);
}

function showWelcome() {
  $("welcome").hidden = false;
  $("thread").hidden = true;
  $("thread").innerHTML = "";
  $("threadTitle").textContent = "New analysis";
  $("threadMeta").textContent = "";
  parkComposer("heroSlot");
}

function newChat() {
  stopPolling();
  activeId = null;
  markActive();
  showWelcome();
  closeDrawer();
  $("ideaInput").focus();
}

async function openAnalysis(id) {
  try {
    const response = await fetch(`/api/analyses/${id}`);
    if (!response.ok) return;
    const record = await response.json();
    stopPolling();
    activeId = id;
    markActive();
    render(record);
    if (record.status === "queued" || record.status === "running") startPolling(id);
    closeDrawer();
  } catch {
    /* ignore */
  }
}

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const idea = $("ideaInput").value.trim();
  if (idea.length < 10) {
    setHint("Describe the idea in at least a few words (10+ characters).");
    $("ideaInput").focus();
    return;
  }

  const button = $("sendBtn");
  button.disabled = true;
  setHint("Queueing…");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea,
        audience: $("audienceInput").value.trim(),
        max_competitors: Number($("maxCompetitors").value),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${response.status}`);
    }
    const record = await response.json();
    activeId = record.id;
    $("ideaInput").value = "";
    autosize();
    stopPolling();
    render(record);
    startPolling(record.id);
    loadConversations();
    setHint("");
  } catch (error) {
    setHint(`Could not start: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".example").forEach((node) =>
  node.addEventListener("click", () => {
    $("ideaInput").value = node.dataset.fill || node.textContent.trim();
    autosize();
    $("ideaInput").focus();
  }));

/* ── composer niceties ── */

/* dictation — only offered where the browser really supports it (no dead control) */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRec) {
  const micBtn = $("micBtn");
  micBtn.hidden = false;
  let rec = null;
  micBtn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SpeechRec();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const said = event.results[0][0].transcript;
      const area = $("ideaInput");
      area.value = (area.value ? area.value + " " : "") + said;
      autosize();
    };
    rec.onend = () => { rec = null; micBtn.classList.remove("is-live"); };
    rec.onerror = () => { rec = null; micBtn.classList.remove("is-live"); };
    micBtn.classList.add("is-live");
    rec.start();
  });
}

function autosize() {
  const area = $("ideaInput");
  area.style.height = "auto";
  area.style.height = Math.min(area.scrollHeight, 180) + "px";
}
$("ideaInput").addEventListener("input", autosize);
$("ideaInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

/* ── mobile drawer ── */

function openDrawer() {
  $("sidebar").classList.add("is-open");
  $("scrim").hidden = false;
  $("menuBtn").setAttribute("aria-expanded", "true");
}
function closeDrawer() {
  $("sidebar").classList.remove("is-open");
  $("scrim").hidden = true;
  $("menuBtn").setAttribute("aria-expanded", "false");
}
$("menuBtn").addEventListener("click", () =>
  $("sidebar").classList.contains("is-open") ? closeDrawer() : openDrawer());
$("scrim").addEventListener("click", closeDrawer);
$("newChatBtn").addEventListener("click", newChat);

/* ───────────────────────── polling ───────────────────────── */

function startPolling(id) {
  stopPolling();
  const tick = async () => {
    if (activeId !== id) return;
    try {
      const response = await fetch(`/api/analyses/${id}`);
      if (response.ok) {
        const record = await response.json();
        render(record);
        if (record.status === "completed" || record.status === "failed") {
          stopPolling();
          loadConversations();
          return;
        }
      }
    } catch { /* transient — keep polling */ }
    pollTimer = setTimeout(tick, 1500);
  };
  pollTimer = setTimeout(tick, 1200);
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/* ───────────────────────── render ───────────────────────── */

function render(record) {
  $("welcome").hidden = true;
  const thread = $("thread");
  thread.hidden = false;
  parkComposer("dock");

  const done = record.status === "completed";
  const failed = record.status === "failed";
  $("threadTitle").textContent = record.idea;
  $("threadMeta").textContent = done
    ? `${(record.result?.competitors || []).length} rivals · ${(record.result?.verdict?.overall_score ?? "—")}/100`
    : record.stage_label || record.status;

  const running = record.status === "queued" || record.status === "running";
  const hasReport = record.result && done;

  thread.innerHTML = `
    <article class="msg msg--user">
      <div class="msg-label">You</div>
      <div class="msg-body">
        ${esc(record.idea)}
        ${record.audience ? `<div class="msg-sub">audience · ${esc(record.audience)}</div>` : ""}
      </div>
    </article>
    ${running || failed ? `<article class="msg msg--agent" id="workMsg">
      <div class="msg-label">Competitor Agent</div>
      <div id="workBody">${renderWorking(record, failed)}</div>
    </article>` : ""}
    ${hasReport ? renderReport(record.result) : ""}`;

  thread.scrollTop = thread.scrollHeight;
}

function renderWorking(record, failed) {
  const stage = record.stage || "queued";
  const index = STAGES.indexOf(stage);
  const rows = STAGES.map((key, i) => {
    let cls = "wstage";
    if (failed && i === index) cls += " failed";
    else if (record.status === "queued") cls += "";
    else if (i < index) cls += " done";
    else if (i === index) cls += " active";
    const mark = failed && i === index ? " · failed" : "";
    return `<li class="${cls}"><span class="wstage-dot"></span>${STAGE_NAMES[key]}${mark}</li>`;
  }).join("");

  const note = failed
    ? `Analysis failed — ${esc(record.error || "unknown error")}`
    : record.status === "queued" ? "Waiting for a worker…" : "Researching live sources…";

  return `<div class="working">
    <ol class="working-stages">${rows}</ol>
    <p class="msg-label working-note">${note}</p>
  </div>`;
}

/* ── full report ── */

function renderReport(result) {
  const v = result.verdict || {};
  const val = result.validation || {};
  const rivals = result.competitors || [];
  const warnings = (result.warnings || [])
    .map((w) => `<div class="banner banner--warn">${esc(w)}</div>`).join("");

  return `
  <article class="msg msg--agent">
    <div class="msg-label">Competitor Agent · report</div>
    <div class="report">

      ${warnings ? `<div class="banners">${warnings}</div>` : ""}

      <!-- 1 · verdict — the one raised panel -->
      <section class="verdict">
        <h3 class="rhead">Verdict</h3>
        <div class="verdict-grid">
          ${gaugeSVG(Number(v.overall_score || 0))}
          <div class="verdict-body">
            <span class="pill pill--${esc(v.recommendation || "unclear")}">${esc((v.recommendation || "unclear").replace("-", " "))}</span>
            <p class="verdict-summary">${esc(v.summary) || "—"}</p>
          </div>
        </div>
      </section>

      <!-- 2 · charts — bare on the paper, hairline-ruled -->
      <section class="rsec">
        <h3 class="rhead">At a glance</h3>
        <div class="charts">
          ${threatChartSVG(rivals)}
          ${scoresChartSVG(val)}
        </div>
      </section>

      <!-- 3 · validation — ruled definition list, no boxes -->
      <section class="rsec">
        <h3 class="rhead">The idea, validated</h3>
        <dl class="dl">
          <div class="dl-item"><dt>Verdict</dt><dd>${esc(val.verdict) || "—"}</dd></div>
          <div class="dl-item"><dt>Refined idea</dt><dd>${esc(val.refined_idea) || "—"}</dd></div>
          <div class="dl-item"><dt>Category</dt><dd>${esc(val.category) || "—"}</dd></div>
          <div class="dl-item"><dt>Audience</dt><dd>${esc(val.target_audience) || "—"}</dd></div>
          <div class="dl-item"><dt>Problem solved</dt><dd>${esc(val.problem_solved) || "—"}</dd></div>
        </dl>
        ${val.summary ? `<p>${esc(val.summary)}</p>` : ""}
        <div class="cols">
          <div>
            <h4 class="rsub">Demand signals</h4>
            ${listHTML(val.demand_signals, "good")}
          </div>
          <div>
            <h4 class="rsub">Risks spotted early</h4>
            ${listHTML(val.risks, "bad")}
          </div>
        </div>
        ${(val.search_queries || []).length ? `
        <details class="queries">
          <summary>${val.search_queries.length} search queries used</summary>
          <ul class="list list--mono">${val.search_queries.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
        </details>` : ""}
      </section>

      <!-- 4 · rivals — the only repeated-card moment -->
      <section class="rsec">
        <h3 class="rhead">Competitors · ${rivals.length}</h3>
        <div class="rivals">${rivals.map(rivalHTML).join("") || "<p>None identified.</p>"}</div>
      </section>

      <!-- 5 · playbook — ruled columns -->
      <section class="rsec">
        <h3 class="rhead">Playbook</h3>
        <div class="cols">
          <div><h4 class="rsub">Whitespace &amp; gaps</h4>${gapsHTML(v.gaps)}</div>
          <div><h4 class="rsub">How to differentiate</h4>${listHTML(v.differentiators, "accent")}</div>
        </div>
        <div class="cols">
          <div><h4 class="rsub">Risks</h4>${listHTML(v.risks, "bad")}</div>
          <div><h4 class="rsub">Next two weeks</h4>${listHTML(v.next_steps, "accent")}</div>
        </div>
      </section>

    </div>
  </article>`;
}

function listHTML(items, kind) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '<ul class="list"><li class="dash">—</li></ul>';
  return `<ul class="list${kind ? " list--" + kind : ""}">${list.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function gapsHTML(gaps) {
  const list = (gaps || []).filter((g) => g && (g.gap || typeof g === "string"));
  if (!list.length) return '<ul class="list"><li class="dash">—</li></ul>';
  return `<ul class="list list--accent">${list
    .map((g) => `<li class="gap-item"><strong>${esc(g.gap || g)}</strong>${
      g.how_to_capitalize ? `<span>${esc(g.how_to_capitalize)}</span>` : ""}</li>`)
    .join("")}</ul>`;
}

function rivalHTML(rival) {
  const threat = (rival.threat_level || "medium").toLowerCase();
  const link = rival.website
    ? `<a href="${esc(rival.website)}" target="_blank" rel="noopener noreferrer">${esc(rival.name)}</a>`
    : esc(rival.name);
  const chips = (items, kind) =>
    (items || []).length
      ? `<div class="chips">${items.map((i) => `<span class="chip chip--${kind}">${esc(i)}</span>`).join("")}</div>`
      : "";
  const sources = (rival.sources || []).slice(0, 5);

  return `
  <article class="rival">
    <div class="rival-head">
      <h4 class="rival-name">${link}</h4>
      <div class="rival-line">
        <p class="rival-one">${esc(rival.one_liner)}</p>
        <span class="threat threat-${esc(threat)}">${esc(threat)}</span>
      </div>
    </div>
    <div class="rival-body">
      <div><p class="rsub">What they do</p><p>${esc(rival.what_they_do) || "—"}</p></div>
      <div><p class="rsub">How they do it</p><p>${esc(rival.how_they_do_it) || "—"}</p></div>
      <div><p class="rsub">Pricing &amp; who pays</p><p>${esc(rival.pricing_model) || "—"} · ${esc(rival.target_users) || "—"}</p></div>
      ${(rival.strengths || []).length ? `<div><p class="rsub">Strengths</p>${chips(rival.strengths, "good")}</div>` : ""}
      ${(rival.weaknesses || []).length ? `<div><p class="rsub">Weaknesses</p>${chips(rival.weaknesses, "bad")}</div>` : ""}
    </div>
    ${sources.length ? `<div class="sources">${sources
      .map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(hostOf(url))}</a>`)
      .join("")}</div>` : ""}
  </article>`;
}

/* ───────────────────────── SVG charts (real data only) ───────────────────────── */

/* Score gauge — verdict.overall_score, 0–100 */
function gaugeSVG(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const r = 34, cx = 44, cy = 44;
  const start = -220, sweep = 260;                       /* open-bottom arc */
  const rad = (deg) => (deg * Math.PI) / 180;
  const arc = (from, to) => {
    const x1 = cx + r * Math.cos(rad(from)), y1 = cy + r * Math.sin(rad(from));
    const x2 = cx + r * Math.cos(rad(to)), y2 = cy + r * Math.sin(rad(to));
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const end = start + sweep * (clamped / 100);
  return `
  <svg class="gauge" width="88" height="80" viewBox="0 0 88 80" role="img"
       aria-label="Overall score ${clamped} out of 100">
    <path d="${arc(start, start + sweep)}" fill="none" stroke="var(--rule-strong)"
          stroke-width="7" stroke-linecap="round"/>
    ${clamped > 0 ? `<path d="${arc(start, end)}" fill="none" stroke="var(--accent)"
          stroke-width="7" stroke-linecap="round"/>` : ""}
    <text class="gauge-num" x="44" y="52" text-anchor="middle" font-size="26">${clamped}</text>
    <text class="gauge-cap" x="44" y="68" text-anchor="middle" font-size="10">/ 100</text>
  </svg>`;
}

/* Threat distribution — counts of high/medium/low among rivals */
function threatChartSVG(rivals) {
  const counts = { high: 0, medium: 0, low: 0 };
  rivals.forEach((r) => {
    const t = (r.threat_level || "medium").toLowerCase();
    if (t in counts) counts[t] += 1;
  });
  const total = rivals.length || 1;
  const colors = { high: "var(--bad)", medium: "var(--warn)", low: "var(--good)" };
  const W = 300, barY = 30, barH = 26;
  let x = 0;
  const segs = ["high", "medium", "low"]
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const w = (counts[k] / total) * W;
      const rect = `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w - 2, 1).toFixed(1)}"
        height="${barH}" rx="3" fill="${colors[k]}"/>`;
      x += w;
      return rect;
    }).join("");
  const legend = ["high", "medium", "low"]
    .map((k, i) => `<g transform="translate(${(i * 96).toFixed(0)},74)">
      <rect width="9" height="9" rx="2" y="-8" fill="${colors[k]}"/>
      <text class="chart-label" x="14" y="0">${k} ${counts[k]}</text></g>`).join("");

  return `
  <div class="datum">
    <p class="datum-label">Threat landscape</p>
    ${rivals.length ? `
    <svg class="chart-svg" viewBox="0 0 ${W} 82" role="img"
         aria-label="Threat distribution: ${counts.high} high, ${counts.medium} medium, ${counts.low} low">
      ${segs}
      ${legend}
    </svg>` : `<p class="dash">No rivals to chart.</p>`}
  </div>`;
}

/* Novelty vs feasibility — validation scores. The crew may answer on a 0–10
   or a 0–100 scale; detect it so the bar and label are always honest. */
function scoresChartSVG(val) {
  const raw = [
    { name: "Novelty", value: Number(val.novelty_score || 0) },
    { name: "Feasibility", value: Number(val.feasibility_score || 0) },
  ];
  const scale = raw.some((r) => r.value > 10) ? 100 : 10;
  const W = 300, labelW = 78, trackX = labelW + 8, trackW = W - trackX - 38;
  const bars = raw.map((row, i) => {
    const y = 14 + i * 30;
    const clamped = Math.max(0, Math.min(scale, row.value));
    const w = (clamped / scale) * trackW;
    return `
      <text class="chart-name" x="0" y="${y + 12}">${row.name}</text>
      <rect x="${trackX}" y="${y}" width="${trackW}" height="14" rx="3" fill="var(--rule-strong)"/>
      <rect x="${trackX}" y="${y}" width="${Math.max(w, 1).toFixed(1)}" height="14" rx="3" fill="var(--accent)"/>
      <text class="chart-value" x="${W - 30}" y="${y + 12}">${row.value}/${scale}</text>`;
  }).join("");

  return `
  <div class="datum">
    <p class="datum-label">Novelty vs feasibility</p>
    <svg class="chart-svg" viewBox="0 0 ${W} ${raw.length * 30 + 10}" role="img"
         aria-label="Novelty ${raw[0].value} out of ${scale}, Feasibility ${raw[1].value} out of ${scale}">
      ${bars}
    </svg>
  </div>`;
}

/* ───────────────────────── boot ───────────────────────── */

loadHealth();
loadConversations();
setInterval(loadHealth, 30000);
showWelcome();
