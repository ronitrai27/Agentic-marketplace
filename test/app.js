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
  if (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  const key = secretKeyInput.value.trim();
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

function logEvent(msg, type = "info") {
  const now = new Date().toTimeString().split(" ")[0];
  const li = document.createElement("li");
  li.className = `timeline-item ${type}`;
  li.innerHTML = `<span class="time">${now}</span><span class="msg">${msg}</span>`;
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
  const url = `${getBaseUrl()}/health`;
  logEvent(`Sending GET ${url}`, "info");
  btnHealth.disabled = true;

  try {
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();
    healthJson.textContent = JSON.stringify(data, null, 2);

    if (res.ok) {
      logEvent(`Backend is HEALTHY (status ${res.status})`, "success");
      updateConnectionIndicator("online", "Backend reachable & healthy");
    } else {
      logEvent(`Health check returned status ${res.status}`, "warning");
      updateConnectionIndicator("working", `Status ${res.status}`);
    }
  } catch (err) {
    healthJson.textContent = `Error: ${err.message}`;
    logEvent(`Health check failed: ${err.message}`, "error");
    updateConnectionIndicator("failed", "Unreachable / CORS error");
  } finally {
    btnHealth.disabled = false;
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
  const url = `${getBaseUrl()}/schema`;
  logEvent(`Fetching schema from ${url}`, "info");
  btnSchema.disabled = true;

  try {
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();
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
    } else {
      logEvent(`Schema fetch error: status ${res.status}`, "error");
    }
  } catch (err) {
    schemaJson.textContent = `Error: ${err.message}`;
    logEvent(`Failed to fetch schema: ${err.message}`, "error");
  } finally {
    btnSchema.disabled = false;
  }
});

// 3. Execute & Task Poller
btnExecute.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Please enter a prompt");

  const url = `${getBaseUrl()}/execute`;
  btnExecute.disabled = true;
  execSpinner.classList.add("active");
  document.querySelector('[data-tab="live-execution"]').click();

  logEvent(`Dispatching POST ${url} with prompt: "${prompt}"`, "info");
  answerContent.className = "answer-card placeholder-state";
  answerContent.textContent = "Dispatched! Waiting for task execution...";
  rawTaskJson.textContent = "{}";

  if (activePollInterval) {
    clearInterval(activePollInterval);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        input: { prompt }
      })
    });

    const data = await res.json();
    rawTaskJson.textContent = JSON.stringify(data, null, 2);

    if (res.status === 202 && data.run_id) {
      logEvent(`Job accepted (Run ID: ${data.run_id}). Polling ${data.poll_url}...`, "info");
      startPolling(data.run_id, data.poll_url);
    } else if (res.status === 200) {
      // Sync response
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

function startPolling(runId, pollUrl) {
  taskBanner.style.display = "flex";
  taskBadge.className = "task-pill";
  taskBadge.textContent = "WORKING";
  taskIdDisplay.textContent = runId;

  pollStartTime = Date.now();
  const fullPollUrl = pollUrl.startsWith("http") ? pollUrl : `${getBaseUrl()}${pollUrl}`;

  activePollInterval = setInterval(async () => {
    const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
    pollingTimer.textContent = `Elapsed: ${elapsedSec}s`;

    try {
      const res = await fetch(fullPollUrl, { headers: getHeaders() });
      const taskData = await res.json();
      rawTaskJson.textContent = JSON.stringify(taskData, null, 2);

      if (taskData.status === "completed") {
        clearInterval(activePollInterval);
        taskBadge.className = "task-pill completed";
        taskBadge.textContent = "COMPLETED";
        logEvent(`Run ${runId} finished successfully in ${elapsedSec}s!`, "success");
        displayFinalResult(taskData);
      } else if (taskData.status === "failed") {
        clearInterval(activePollInterval);
        taskBadge.className = "task-pill failed";
        taskBadge.textContent = "FAILED";
        logEvent(`Run ${runId} failed: ${taskData.error?.message || "Unknown error"}`, "error");
        answerContent.textContent = `Task Failed: ${taskData.error?.message || JSON.stringify(taskData)}`;
      } else {
        logEvent(`Task status: ${taskData.status} (${elapsedSec}s)...`, "info");
      }
    } catch (err) {
      logEvent(`Poll error: ${err.message}`, "warning");
    }
  }, 3000);
}

function displayFinalResult(taskData) {
  answerContent.classList.remove("placeholder-state");
  const output = taskData.output || taskData;
  const answer = output.answer || output.response || JSON.stringify(output, null, 2);

  let formatted = answer;
  if (output.sourcesCount !== undefined) {
    formatted += `\n\n----------------------------------------\n📊 Sources Checked: ${output.sourcesCount} | Outcome: ${output.status || 'DONE'}`;
  }
  answerContent.textContent = formatted;
}

// Automatically fetch schema and health on page load
window.addEventListener("DOMContentLoaded", () => {
  btnHealth.click();
  btnSchema.click();
});
