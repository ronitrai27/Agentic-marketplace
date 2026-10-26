// State management
let activePollInterval = null;
let pollStartTime = null;

const backendUrlInput = document.getElementById("backend-url");
const secretKeyInput = document.getElementById("secret-key");
const toggleKeyBtn = document.getElementById("toggle-key-btn");
const connectionStatus = document.getElementById("connection-status");
const promptInput = document.getElementById("prompt-input");

const btnHealth = document.getElementById("btn-health");
const btnSchema = document.getElementById("btn-schema");
const healthSpinner = document.getElementById("health-spinner");
const schemaSpinner = document.getElementById("schema-spinner");
const btnExecute = document.getElementById("btn-execute");
const execSpinner = document.getElementById("exec-spinner");

const taskBanner = document.getElementById("task-banner");
const taskBadge = document.getElementById("task-badge");
const taskIdDisplay = document.getElementById("task-id-display");
const pollingTimer = document.getElementById("polling-timer");
const answerContent = document.getElementById("answer-content");
const rawTaskJson = document.getElementById("raw-task-json");

const healthJson = document.getElementById("health-json");
const schemaJson = document.getElementById("schema-json");
const timelineList = document.getElementById("timeline-list");
const btnClearLogs = document.getElementById("btn-clear-logs");

// Live Progress & Telemetry DOM Elements
const liveProgressCard = document.getElementById("live-progress-card");
const liveStepLabel = document.getElementById("live-step-label");
const liveProgressPct = document.getElementById("live-progress-pct");
const progressBarFill = document.getElementById("progress-bar-fill");

const telemetryDashboard = document.getElementById("telemetry-dashboard");
const telemModel = document.getElementById("telem-model");
const telemPromptTokens = document.getElementById("telem-prompt-tokens");
const telemCompletionTokens = document.getElementById("telem-completion-tokens");
const telemTotalTokens = document.getElementById("telem-total-tokens");
const telemCost = document.getElementById("telem-cost");
const telemDuration = document.getElementById("telem-duration");

// Toggle key visibility
toggleKeyBtn.addEventListener("click", () => {
  if (secretKeyInput.type === "password") {
    secretKeyInput.type = "text";
    toggleKeyBtn.textContent = "Hide Key";
  } else {
    secretKeyInput.type = "password";
    toggleKeyBtn.textContent = "Show Key";
  }
});

// Quick prompt chips
document.querySelectorAll(".prompt-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    promptInput.value = chip.getAttribute("data-text");
  });
});

// Tabs switching
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.getAttribute("data-tab");
    document.getElementById(`tab-${target}`).classList.add("active");
  });
});

// Clear logs
btnClearLogs.addEventListener("click", () => {
  timelineList.innerHTML = "";
  logEvent("Logs cleared", "info");
});

function getBaseUrl() {
  let url = backendUrlInput.value.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
    backendUrlInput.value = url;
  }
  if (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (text.startsWith("<!DOCTYPE") || text.includes("<html")) {
      throw new Error(`Server returned HTML (${res.status} ${res.statusText}). Check endpoint URL or proxy.`);
    }
    throw new Error(`Invalid JSON: ${text.slice(0, 150)}`);
  }
}

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  const key = secretKeyInput.value.trim();
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function logEvent(msg, type = "info") {
  const now = new Date().toTimeString().split(" ")[0];
  const li = document.createElement("li");
  li.className = `timeline-item ${type}`;
  li.innerHTML = `<span class="time">${now}</span><span class="msg">${escapeHtml(msg)}</span>`;
  timelineList.prepend(li);
}

function updateConnectionIndicator(status, text) {
  const indicator = connectionStatus.querySelector(".indicator");
  const label = connectionStatus.querySelector(".status-text");
  indicator.className = `indicator ${status}`;
  label.textContent = text;
}

// 1. Health Probe
btnHealth.addEventListener("click", async () => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    alert("⚠️ Please enter your Backend URL first!\nExample: https://p01--seoagent-test--k8clc8rvc9fq.code.run");
    backendUrlInput.focus();
    return;
  }

  const healthUrl = `${baseUrl}/health`;
  const schemaUrl = `${baseUrl}/schema`;
  logEvent(`Probing GET ${healthUrl}...`, "info");

  btnHealth.disabled = true;
  btnHealth.classList.add("loading");
  healthSpinner.classList.add("active");
  updateConnectionIndicator("working", "Checking /health & /schema...");
  healthJson.textContent = `Connecting to ${healthUrl} ...\nPlease wait (cold start or live server probe)...`;

  try {
    const res = await fetch(healthUrl, { headers: getHeaders() });
    const healthData = await parseJsonResponse(res);
    healthJson.textContent = JSON.stringify(healthData, null, 2);

    if (!res.ok) {
      logEvent(`Health check returned status ${res.status}`, "warning");
      updateConnectionIndicator("working", `Status ${res.status}`);
      alert(`⚠️ Health check failed with status ${res.status}`);
      return;
    }

    logEvent(`Backend is HEALTHY (status ${res.status})`, "success");
    updateConnectionIndicator("working", "Health OK! Fetching /schema...");

    // Also fetch & verify /schema immediately
    const schemaRes = await fetch(schemaUrl, { headers: getHeaders() });
    const schemaData = await parseJsonResponse(schemaRes);
    schemaJson.textContent = JSON.stringify(schemaData, null, 2);

    if (schemaRes.ok) {
      logEvent(`Loaded schema successfully (${schemaData.name || 'Agent'})`, "success");
      if (schemaData.input_schema) {
        renderSchemaTable(inputSchemaTable, schemaData.input_schema);
      }
      if (schemaData.output_schema) {
        renderSchemaTable(outputSchemaTable, schemaData.output_schema);
      }
      updateConnectionIndicator("online", `Online: ${schemaData.name || 'Agent'} (v${schemaData.version || '1.0.0'})`);
      document.querySelector('[data-tab="schema-view"]').click();

      // Show verification alert as requested!
      setTimeout(() => {
        alert(`✅ /health /schema verified!\n\nAgent: ${schemaData.name || "SeoAgent"}\nVersion: ${schemaData.version || "1.0.0"}\nStatus: 200 OK (MAPS Protocol Verified)`);
      }, 50);
    } else {
      updateConnectionIndicator("online", "Health OK, schema returned " + schemaRes.status);
      alert(`⚠️ /health passed (200 OK) but /schema returned status ${schemaRes.status}`);
    }
  } catch (err) {
    healthJson.textContent = `Error: ${err.message}`;
    logEvent(`Health check failed: ${err.message}`, "error");
    updateConnectionIndicator("failed", "Unreachable / Network Error");
    alert(`❌ Connection failed to ${baseUrl}:\n${err.message}\n\nPlease check your URL and make sure the server is awake.`);
  } finally {
    btnHealth.disabled = false;
    btnHealth.classList.remove("loading");
    healthSpinner.classList.remove("active");
  }
});

const inputSchemaTable = document.getElementById("input-schema-table");
const outputSchemaTable = document.getElementById("output-schema-table");

function renderSchemaTable(tableElement, schemaObj) {
  const tbody = tableElement.querySelector("tbody");
  tbody.innerHTML = "";

  if (!schemaObj || !schemaObj.properties) {
    tbody.innerHTML = `<tr><td colspan="4" class="loading-td">No schema properties found.</td></tr>`;
    return;
  }

  const requiredFields = new Set(schemaObj.required || []);
  const properties = schemaObj.properties;

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = requiredFields.has(key);
    const row = document.createElement("tr");

    let typeStr = prop.type || "any";
    if (prop.enum) {
      typeStr = `enum (${prop.enum.join(" | ")})`;
    }

    row.innerHTML = `
      <td><span class="field-name">${key}</span></td>
      <td><span class="type-tag">${typeStr}</span></td>
      <td><span class="req-badge ${isRequired ? 'yes' : 'no'}">${isRequired ? 'Required' : 'Optional'}</span></td>
      <td class="field-desc">${prop.description || '—'}</td>
    `;
    tbody.appendChild(row);
  }
}

// 2. Schema Fetch
btnSchema.addEventListener("click", async () => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    alert("⚠️ Please enter your Backend URL first!\nExample: https://p01--seoagent-test--k8clc8rvc9fq.code.run");
    backendUrlInput.focus();
    return;
  }

  const url = `${baseUrl}/schema`;
  logEvent(`Fetching schema from ${url}`, "info");

  btnSchema.disabled = true;
  btnSchema.classList.add("loading");
  schemaSpinner.classList.add("active");
  schemaJson.textContent = `Fetching schema from ${url} ...\nPlease wait...`;

  try {
    const res = await fetch(url, { headers: getHeaders() });
    const data = await parseJsonResponse(res);
    schemaJson.textContent = JSON.stringify(data, null, 2);

    if (res.ok) {
      logEvent(`Loaded schema successfully (${data.name || 'Agent'})`, "success");
      if (data.input_schema) {
        renderSchemaTable(inputSchemaTable, data.input_schema);
      }
      if (data.output_schema) {
        renderSchemaTable(outputSchemaTable, data.output_schema);
      }
      // Switch to schema tab to show output
      document.querySelector('[data-tab="schema-view"]').click();
      setTimeout(() => {
        alert(`✅ /schema verified!\n\nAgent: ${data.name || "Agent"}\nVersion: ${data.version || "1.0.0"}\nInput fields: ${Object.keys(data.input_schema?.properties || {}).join(", ")}`);
      }, 50);
    } else {
      logEvent(`Schema fetch error: status ${res.status}`, "error");
      alert(`⚠️ /schema returned status ${res.status}`);
    }
  } catch (err) {
    schemaJson.textContent = `Error: ${err.message}`;
    logEvent(`Failed to fetch schema: ${err.message}`, "error");
    alert(`❌ Failed to fetch /schema: ${err.message}`);
  } finally {
    btnSchema.disabled = false;
    btnSchema.classList.remove("loading");
    schemaSpinner.classList.remove("active");
  }
});

// 3. Execute & Task Poller
btnExecute.addEventListener("click", async () => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    alert("⚠️ Please enter your Backend URL first!\nExample: https://p01--seoagent-test--k8clc8rvc9fq.code.run");
    backendUrlInput.focus();
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Please enter a prompt");

  const url = `${baseUrl}/execute`;
  btnExecute.disabled = true;
  execSpinner.classList.add("active");
  document.querySelector('[data-tab="live-execution"]').click();

  logEvent(`Dispatching POST ${url} with prompt: "${prompt}"`, "info");
  answerContent.className = "answer-card placeholder-state";
  answerContent.textContent = "Dispatched! Waiting for task execution...";
  rawTaskJson.textContent = "{}";

  // Reset progress and telemetry
  liveProgressCard.style.display = "none";
  telemetryDashboard.style.display = "none";
  liveStepLabel.textContent = "Connecting to agent...";
  liveProgressPct.textContent = "0%";
  progressBarFill.style.width = "0%";

  activePollInterval = null; // stop any previous poll loop

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        input: { prompt }
      })
    });

    const data = await parseJsonResponse(res);
    rawTaskJson.textContent = JSON.stringify(data, null, 2);

    if (res.status === 202 && data.run_id) {
      logEvent(`Job accepted (Run ID: ${data.run_id}). Polling ${data.poll_url}...`, "info");
      startPolling(data.run_id, data.poll_url);
    } else if (res.status === 200) {
      // Sync response (e.g. Groq direct answer)
      logEvent(`Job executed synchronously`, "success");
      displayFinalResult(data);
    } else {
      logEvent(`Execute failed (${res.status}): ${data.error?.message || JSON.stringify(data)}`, "error");
      answerContent.textContent = `Error: ${data.error?.message || "Execution request rejected."}`;
    }
  } catch (err) {
    logEvent(`Execute network error: ${err.message}`, "error");
    answerContent.textContent = `Network / CORS Error: ${err.message}`;
  } finally {
    btnExecute.disabled = false;
    execSpinner.classList.remove("active");
  }
});

// Consecutive poll failures before we tell the user the agent is unreachable (x 2s).
const MAX_POLL_FAILURES = 5;

function setTaskState(label, cls) {
  taskBadge.className = cls ? `task-pill ${cls}` : "task-pill";
  taskBadge.textContent = label;
}

function describeEvent(evt) {
  const name = evt.message || evt.name || evt.type;
  const data = evt.data && typeof evt.data === "object" ? evt.data : null;
  if (!data) return name;
  // Compact one-line summary so heartbeats / retries are readable instead of identical rows
  const bits = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`);
  return bits.length ? `${name} (${bits.join(", ")})` : name;
}

function eventLevel(evt) {
  const name = evt.name || "";
  if (/failed|error/i.test(name)) return "error";
  if (/retrying|not_responding/i.test(name)) return "warning";
  return evt.type === "step" ? "info" : "success";
}

function startPolling(runId, pollUrl) {
  taskBanner.style.display = "flex";
  setTaskState("WORKING", "");
  taskIdDisplay.textContent = runId;

  // Activate live progress indicator
  liveProgressCard.style.display = "block";
  liveStepLabel.textContent = "Task submitted. Waiting for stream...";
  liveProgressPct.textContent = "0%";
  progressBarFill.style.width = "0%";

  pollStartTime = Date.now();
  let lastSeq = 0;
  let failures = 0;
  let finished = false;
  const baseUrl = pollUrl.startsWith("http") ? pollUrl : `${getBaseUrl()}${pollUrl}`;
  const myPoll = {};
  activePollInterval = myPoll; // lets a newer run cancel this loop

  const finish = (label, cls, message, level) => {
    finished = true;
    setTaskState(label, cls);
    logEvent(message, level);
  };

  const failedWith = (error, fallback) => {
    const code = error?.code ? `[${error.code}] ` : "";
    const hint = error?.retryable ? " (retryable: you can run it again)" : "";
    return `${code}${error?.message || fallback}${hint}`;
  };

  const tick = async () => {
    if (finished || activePollInterval !== myPoll) return;
    const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
    pollingTimer.textContent = `Elapsed: ${elapsedSec}s`;

    try {
      const fetchUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}since=${lastSeq}`;
      const res = await fetch(fetchUrl, { headers: getHeaders() });
      const taskData = await parseJsonResponse(res);
      failures = 0;
      rawTaskJson.textContent = JSON.stringify(taskData, null, 2);

      // The task vanished (agent restarted, job expired) or the request was rejected: never spin forever
      if (!res.ok && !taskData.status) {
        const msg = failedWith(taskData.error, `HTTP ${res.status}`);
        finish("FAILED", "failed", `Run ${runId} lost: ${msg}`, "error");
        answerContent.textContent = `Task lost: ${msg}
The agent may have restarted. Run it again.`;
        return;
      }

      // Live events, de-duplicated by sequence number
      for (const evt of taskData.events || []) {
        if (evt.seq <= lastSeq) continue;
        lastSeq = evt.seq;
        logEvent(describeEvent(evt), eventLevel(evt));
      }
      if (taskData.last_seq > lastSeq) lastSeq = taskData.last_seq;

      if (taskData.current_step) liveStepLabel.textContent = taskData.current_step;
      if (typeof taskData.progress_pct === "number") {
        const pct = Math.max(0, Math.min(100, Math.round(taskData.progress_pct)));
        liveProgressPct.textContent = `${pct}%`;
        progressBarFill.style.width = `${pct}%`;
      }

      if (taskData.status === "completed") {
        progressBarFill.style.width = "100%";
        liveProgressPct.textContent = "100%";
        finish("COMPLETED", "completed", `Run ${runId} finished successfully in ${elapsedSec}s!`, "success");
        displayFinalResult(taskData);
        return;
      }

      if (taskData.status === "failed" || taskData.status === "canceled") {
        const canceled = taskData.status === "canceled" || taskData.error?.code === "TASK_CANCELED";
        const msg = failedWith(taskData.error, "Unknown error");
        finish(canceled ? "CANCELED" : "FAILED", "failed", `Run ${runId} ${canceled ? "canceled" : "failed"}: ${msg}`, "error");
        answerContent.classList.remove("placeholder-state");
        answerContent.textContent = `${canceled ? "Task Canceled" : "Task Failed"}: ${msg}`;
        return;
      }
    } catch (err) {
      failures += 1;
      logEvent(`Poll error (${failures}/${MAX_POLL_FAILURES}): ${err.message}`, "warning");
      if (failures >= MAX_POLL_FAILURES) {
        finish("UNREACHABLE", "failed", `Lost contact with the agent after ${failures} failed polls. The task may still be running.`, "error");
        answerContent.textContent = `Lost contact with the agent: ${err.message}
The task may still be running; try polling again later.`;
        return;
      }
    }

    // Next poll only after this one finished: no overlapping requests, no duplicate rows
    setTimeout(tick, 2000);
  };

  setTimeout(tick, 0);
}

function displayFinalResult(taskData) {
  answerContent.classList.remove("placeholder-state");
  const output = taskData.output || taskData;
  const answer = output.report || output.answer || output.response || (typeof output === "string" ? output : JSON.stringify(output, null, 2));

  let formatted = answer;
  if (output.sourcesCount !== undefined) {
    formatted += `\n\n----------------------------------------\n📊 Sources Checked: ${output.sourcesCount} | Outcome: ${output.status || 'DONE'}`;
  }
  answerContent.textContent = formatted;

  // Extract and render telemetry metrics
  const telemetry = taskData.telemetry || taskData.output?.metadata?.telemetry || (taskData.output?.metadata ? {
    model_used: taskData.output.metadata.model,
    llm_tokens: taskData.output.metadata.llm_tokens,
    cost_usd: taskData.output.metadata.cost_usd,
    duration_ms: taskData.duration_ms,
  } : null);

  if (telemetry) {
    telemModel.textContent = telemetry.model_used || "—";
    const prompt = telemetry.llm_tokens?.prompt || 0;
    const comp = telemetry.llm_tokens?.completion || 0;
    const total = telemetry.llm_tokens?.total || (prompt + comp);

    telemPromptTokens.textContent = prompt.toLocaleString();
    telemCompletionTokens.textContent = comp.toLocaleString();
    telemTotalTokens.textContent = total.toLocaleString();
    telemCost.textContent = `$${(telemetry.cost_usd || 0).toFixed(4)}`;

    const durMs = taskData.duration_ms || telemetry.duration_ms || (taskData.output?.durationSeconds ? taskData.output.durationSeconds * 1000 : null);
    telemDuration.textContent = durMs ? `${(durMs / 1000).toFixed(1)}s` : "—";

    telemetryDashboard.style.display = "grid";
  }
}

// Automatically fetch schema and health on page load
window.addEventListener("DOMContentLoaded", () => {
  btnHealth.click();
  btnSchema.click();
});
