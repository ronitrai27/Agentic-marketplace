"use strict";

const API = "/api";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 200 * 1024;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const tabs = document.querySelectorAll(".tab");
const panels = {
  paste: $("panel-paste"),
  upload: $("panel-upload"),
  repo: $("panel-repo"),
};

const codeInput = $("codeInput");
const charCount = $("charCount");
const reviewPasteBtn = $("reviewPasteBtn");

const dropzone = $("dropzone");
const fileInput = $("fileInput");
const fileList = $("fileList");
const reviewFilesBtn = $("reviewFilesBtn");
const clearFilesBtn = $("clearFilesBtn");
const uploadContext = $("uploadContext");

const repoUrl = $("repoUrl");
const repoFocus = $("repoFocus");
const reviewRepoBtn = $("reviewRepoBtn");
const clearRepoBtn = $("clearRepoBtn");

const progress = $("progress");
const progressText = $("progressText");

const emptyState = $("emptyState");
const results = $("results");

const historyList = $("historyList");
const historyBadge = $("historyBadge");

let selectedFiles = [];
let lastResult = null;

// ---------- Tabs ----------
function activateTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  Object.entries(panels).forEach(([key, panel]) => {
    if (panel) panel.classList.toggle("active", key === tab.dataset.tab);
  });
}

tabs.forEach((tab, i) => {
  tab.tabIndex = tab.classList.contains("active") ? 0 : -1;
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (e) => {
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); activateTab(next); next.focus(); }
  });
});

// ---------- Paste mode ----------
codeInput.addEventListener("input", () => {
  charCount.textContent = `${codeInput.value.length.toLocaleString()} chars`;
});

reviewPasteBtn.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (!code) return toast("Paste some code first.");

  const payload = {
    code,
    language: $("pasteLanguage").value.trim() || null,
    filename: $("pasteFilename").value.trim() || null,
    context: $("pasteContext").value.trim() || null,
  };

  await runReview("/review/paste", { method: "POST", body: JSON.stringify(payload), json: true }, "Analysing pasted code…");
});

// ---------- Upload mode ----------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

clearFilesBtn.addEventListener("click", () => {
  selectedFiles = [];
  renderFiles();
});

reviewFilesBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return toast("Add at least one file.");

  const fd = new FormData();
  selectedFiles.forEach((f) => fd.append("files", f, f.name));
  const ctx = uploadContext.value.trim();
  if (ctx) fd.append("context", ctx);

  await runReview("/review/files", { method: "POST", body: fd }, `Analysing ${selectedFiles.length} file(s)…`);
});

// ---------- Repo mode ----------
reviewRepoBtn.addEventListener("click", async () => {
  const url = repoUrl.value.trim();
  if (!url) return toast("Paste a public repository URL first.");

  const payload = { url, context: repoFocus.value.trim() || null };
  await runReview(
    "/review/repo",
    { method: "POST", body: JSON.stringify(payload), json: true },
    "Cloning repo and selecting files…",
  );
});

clearRepoBtn.addEventListener("click", () => {
  repoUrl.value = "";
  repoFocus.value = "";
  repoUrl.focus();
});

function addFiles(fileCollection) {
  const incoming = Array.from(fileCollection || []);
  for (const file of incoming) {
    if (selectedFiles.length >= MAX_FILES) {
      toast(`Max ${MAX_FILES} files allowed.`);
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} is larger than 200 KB and was skipped.`);
      continue;
    }
    if (selectedFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
    selectedFiles.push(file);
  }
  renderFiles();
}

function renderFiles() {
  fileList.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const li = document.createElement("li");
    li.className = "file-item";

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatBytes(file.size);

    const remove = document.createElement("button");
    remove.className = "file-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      selectedFiles.splice(idx, 1);
      renderFiles();
    });

    li.append(name, size, remove);
    fileList.appendChild(li);
  });
  reviewFilesBtn.disabled = selectedFiles.length === 0;
}

// ---------- Run review ----------
async function runReview(path, options, busyMessage) {
  setBusy(true, busyMessage);
  try {
    const opts = { ...options };
    if (opts.json) {
      opts.headers = { "Content-Type": "application/json" };
    }
    const res = await fetch(`${API}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    lastResult = data.result;
    renderResult(data.result, data.mode);
    loadHistory();
  } catch (err) {
    toast(err.message || "Review failed.");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy, message) {
  progress.hidden = !busy;
  progressText.textContent = message || "Analysing code…";
  reviewPasteBtn.disabled = busy;
  reviewFilesBtn.disabled = busy || selectedFiles.length === 0;
  reviewRepoBtn.disabled = busy;
}

// ---------- Render result ----------
function renderResult(result, mode) {
  emptyState.hidden = true;
  results.hidden = false;

  // score ring
  const ring = $("scoreRing");
  const score = clamp(result.score, 0, 100);
  ring.style.setProperty("--pct", score);
  ring.style.setProperty("--ring", scoreColor(score));
  animateNumber($("scoreNum"), score);

  // verdict + summary
  const verdict = $("verdict");
  verdict.textContent = (result.verdict || "").replace("-", " ");
  verdict.className = `verdict ${result.verdict || ""}`;
  $("summary").textContent = result.summary || "";

  const issues = result.issues || [];
  const sevCounts = countBy(issues, (i) => i.severity);
  $("issueCount").textContent = issues.length === 0
    ? "No issues found"
    : `${issues.length} issue(s): ${formatCounts(sevCounts)}`;
  $("reviewMeta").textContent = `mode: ${mode || "—"} · model review`;

  // issues
  $("issueBadge").textContent = issues.length;
  const issuesList = $("issuesList");
  issuesList.innerHTML = "";
  if (issues.length === 0) {
    issuesList.innerHTML = `<p class="muted">No issues detected in this code.</p>`;
  } else {
    issues.forEach((issue) => issuesList.appendChild(buildIssue(issue)));
  }

  // risks
  const risks = result.risks || [];
  $("riskBadge").textContent = risks.length;
  const risksList = $("risksList");
  risksList.innerHTML = "";
  if (risks.length === 0) {
    risksList.innerHTML = `<p class="muted">No significant risks flagged.</p>`;
  } else {
    risks.forEach((risk) => risksList.appendChild(buildRisk(risk)));
  }

  // strengths / recommendations
  fillBullets($("strengthsList"), result.strengths || []);
  fillBullets($("recommendationsList"), result.recommendations || []);

  results.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildIssue(issue) {
  const el = document.createElement("div");
  el.className = `issue ${issue.severity || "info"}`;

  const head = document.createElement("div");
  head.className = "issue-head";
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  head.setAttribute("aria-expanded", "false");
  const toggle = () => {
    const open = el.classList.toggle("open");
    head.setAttribute("aria-expanded", String(open));
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });

  const sev = document.createElement("span");
  sev.className = `sev ${issue.severity || "info"}`;
  sev.textContent = issue.severity || "info";

  const titleWrap = document.createElement("div");
  titleWrap.style.flex = "1";
  const title = document.createElement("div");
  title.className = "issue-title";
  title.textContent = issue.title || "Untitled issue";
  const cat = document.createElement("div");
  cat.className = "issue-cat";
  cat.textContent = issue.category || "";
  titleWrap.append(title, cat);

  const loc = document.createElement("span");
  loc.className = "issue-loc";
  loc.textContent = formatLoc(issue.file, issue.line);

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "›";

  head.append(sev, titleWrap, loc, chevron);

  const body = document.createElement("div");
  body.className = "issue-body";

  const desc = document.createElement("p");
  desc.className = "issue-desc";
  desc.textContent = issue.description || "";
  body.appendChild(desc);

  if (issue.suggestion) {
    const fix = document.createElement("div");
    fix.className = "issue-fix";
    const label = document.createElement("strong");
    label.textContent = "Suggested fix";
    const text = document.createElement("span");
    text.textContent = issue.suggestion;
    fix.append(label, text);
    body.appendChild(fix);
  }

  if (issue.snippet) {
    const pre = document.createElement("pre");
    pre.className = "snippet";
    pre.textContent = issue.snippet;
    body.appendChild(pre);
  }

  el.append(head, body);
  return el;
}

function buildRisk(risk) {
  const card = document.createElement("div");
  card.className = "card";

  const h = document.createElement("h4");
  h.textContent = risk.title || "Risk";

  const p = document.createElement("p");
  p.textContent = risk.description || "";

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.innerHTML = `
    <span><b>Impact:</b> <span class="impact-${risk.impact || "low"}">${esc(risk.impact || "low")}</span></span>
    <span><b>Likelihood:</b> <span class="impact-${risk.likelihood || "low"}">${esc(risk.likelihood || "low")}</span></span>`;

  card.append(h, p, meta);
  return card;
}

function fillBullets(listEl, items) {
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = `<li class="muted" style="border:0;background:transparent;padding-left:12px">None</li>`;
    return;
  }
  items.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    listEl.appendChild(li);
  });
}

// ---------- Copy report (label-swap feedback, no toast) ----------
$("copyBtn").addEventListener("click", async () => {
  if (!lastResult) return;
  const btn = $("copyBtn");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    btn.textContent = "Copied ✓";
    btn.dataset.state = "success";
  } catch {
    btn.textContent = "Copy failed";
    btn.dataset.state = "error";
  }
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.textContent = original;
    delete btn.dataset.state;
  }, 2000);
});

// ---------- History ----------
async function loadHistory() {
  try {
    const res = await fetch(`${API}/reviews`);
    const data = await res.json();
    const reviews = data.reviews || [];
    historyBadge.textContent = reviews.length;
    historyList.innerHTML = "";
    if (reviews.length === 0) {
      historyList.innerHTML = `<p class="muted">No reviews saved yet.</p>`;
      return;
    }
    reviews.forEach((r) => historyList.appendChild(buildHistoryItem(r)));
  } catch {
    historyList.innerHTML = `<p class="muted">Could not load history.</p>`;
  }
}

function buildHistoryItem(r) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "history-item";
  el.title = "Open saved review";
  el.addEventListener("click", () => openSavedReview(r.id));

  const score = clamp(Number(r.overall_score), 0, 100);
  const top = document.createElement("div");
  top.className = "history-top";

  const mode = document.createElement("span");
  mode.className = "history-mode";
  mode.textContent = `${r.mode} · ${r.file_count || 1} file(s)`;

  const scoreEl = document.createElement("span");
  scoreEl.className = "history-score";
  scoreEl.style.color = scoreColor(score);
  scoreEl.textContent = `${score}`;

  top.append(mode, scoreEl);

  const sum = document.createElement("p");
  sum.className = "history-summary";
  sum.textContent = r.summary || "";

  el.append(top, sum);
  return el;
}

async function openSavedReview(id) {
  try {
    const res = await fetch(`${API}/reviews/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load review");

    const files = data.files || [];
    const issues = (data.issues || []).map((i) => ({
      severity: i.severity,
      category: i.category,
      title: i.title,
      description: i.description,
      file: i.file,
      line: i.line,
      suggestion: i.suggestion,
      snippet: i.code_snippet,
    }));

    const sevCounts = countBy(issues, (i) => i.severity);
    renderResult(
      {
        summary: data.review.summary,
        score: data.review.overall_score,
        verdict: data.review.verdict,
        issues,
        risks: [],
        strengths: [],
        recommendations: [],
      },
      data.review.mode
    );

    restoreSourcePanel(data.review, files);
    toast(`Opened saved review #${id} (issues: ${issues.length}, files: ${files.length}).`);
  } catch (err) {
    toast(err.message || "Could not open saved review.");
  }
}

/**
 * Put the originally-reviewed source back on the left (Source) panel so a
 * saved review reads as a full picture: code on the left, findings on the right.
 * Handles both modes — paste (single snippet) and upload (file list).
 */
function restoreSourcePanel(review, files) {
  const mode = review.mode;

  // switch to the matching tab
  const tab = $(`tab-${mode}`);
  if (tab) activateTab(tab);

  if (mode === "paste") {
    const f = files[0] || {};
    codeInput.value = f.content || "";
    charCount.textContent = `${codeInput.value.length.toLocaleString()} chars`;
    $("pasteFilename").value = f.filename || "";
    $("pasteLanguage").value = review.language || "";
    $("pasteContext").value = review.context || "";
  } else if (mode === "repo") {
    // restore the scanned URL + the reviewer's instructions
    repoUrl.value = review.repo_url || "";
    repoFocus.value = review.context || "";
  } else {
    // rebuild File objects from stored content so the file list renders
    selectedFiles = (files || [])
      .filter((f) => f.filename)
      .map((f) => {
        const blob = new Blob([f.content || ""], { type: "text/plain" });
        const file = new File([blob], f.filename, { type: "text/plain" });
        return file;
      });
    $("uploadContext").value = review.context || "";
    renderFiles();
  }
}

// ---------- Helpers ----------
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function clamp(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function scoreColor(score) {
  if (score >= 80) return "var(--green)";
  if (score >= 55) return "var(--yellow)";
  if (score >= 35) return "var(--orange)";
  return "var(--red)";
}

function countBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item) || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function formatCounts(counts) {
  const order = ["critical", "high", "medium", "low", "info"];
  return order
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${k}`)
    .join(" · ");
}

function formatLoc(file, line) {
  if (!file && !line) return "";
  if (file && line) return `${file}:${line}`;
  return file || `line ${line}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function animateNumber(el, target) {
  const start = Number(el.textContent) || 0;
  const duration = 600;
  const t0 = performance.now();
  function frame(t) {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Init ----------
loadHistory();
