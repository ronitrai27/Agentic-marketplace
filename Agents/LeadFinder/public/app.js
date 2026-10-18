// Universal LeadFinder Dynamic Frontend Controller
document.addEventListener("DOMContentLoaded", () => {
  const promptInput = document.getElementById("promptInput");
  const targetCount = document.getElementById("targetCount");
  const runBtn = document.getElementById("runBtn");
  const quickChips = document.querySelectorAll(".quick-chip");

  const monitorSection = document.getElementById("monitorSection");
  const currentAction = document.getElementById("currentAction");
  const timerDisplay = document.getElementById("timerDisplay");
  const leadsCountBadge = document.getElementById("leadsCountBadge");

  const sitesList = document.getElementById("sitesList");
  const sitesVisitedCount = document.getElementById("sitesVisitedCount");
  const eventLogs = document.getElementById("eventLogs");

  const resultsSection = document.getElementById("resultsSection");
  const jevDecisionPill = document.getElementById("jevDecisionPill");
  const jevConfidence = document.getElementById("jevConfidence");
  const jevMatchStatus = document.getElementById("jevMatchStatus");
  const jevVerdict = document.getElementById("jevVerdict");

  const resultsHeading = document.getElementById("resultsHeading");
  const stoppedReasonTag = document.getElementById("stoppedReasonTag");
  const leadsTableHead = document.getElementById("leadsTableHead");
  const leadsTableBody = document.getElementById("leadsTableBody");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const downloadJsonBtn = document.getElementById("downloadJsonBtn");

  let timerInterval = null;
  let startTime = null;
  let currentEventSource = null;
  let visitedSitesSet = new Set();
  let collectedLeads = [];
  let dynamicColumns = [];

  // Quick Chips selection
  quickChips.forEach(chip => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.query;
      targetCount.value = chip.dataset.target;
      startRun();
    });
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      startRun();
    }
  });

  runBtn.addEventListener("click", () => {
    startRun();
  });

  function startTimer() {
    startTime = Date.now();
    timerDisplay.textContent = "00:00.0";
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const mins = Math.floor(elapsed / 60000).toString().padStart(2, "0");
      const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, "0");
      const ms = Math.floor((elapsed % 1000) / 100);
      timerDisplay.textContent = `${mins}:${secs}.${ms}`;
    }, 100);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  function appendLog(text, level = "info") {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const row = document.createElement("div");
    row.className = "log-entry";
    row.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-text ${level}">${escapeHtml(text)}</span>
    `;
    eventLogs.appendChild(row);
    eventLogs.scrollTop = eventLogs.scrollHeight;
  }

  function addSiteVisited(title, url) {
    if (!url || visitedSitesSet.has(url)) return;
    visitedSitesSet.add(url);

    if (visitedSitesSet.size === 1) {
      sitesList.innerHTML = "";
    }

    sitesVisitedCount.textContent = visitedSitesSet.size;

    const chip = document.createElement("div");
    chip.className = "site-chip";
    chip.innerHTML = `
      <div class="site-info">
        <span class="site-name">${escapeHtml(title || "Site")}</span>
        <a class="site-url" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
      </div>
      <span class="site-status-tag">Visited</span>
    `;
    sitesList.prepend(chip);
  }

  function setupDynamicTableHead(leadData) {
    dynamicColumns = Object.keys(leadData);
    const ths = ["<th>#</th>"]
      .concat(dynamicColumns.map(col => `<th>${escapeHtml(formatColHeader(col))}</th>`))
      .concat(["<th>Source / Evidence</th>", "<th>Critic Audit</th>"]);

    leadsTableHead.innerHTML = `<tr>${ths.join("")}</tr>`;
  }

  function formatColHeader(str) {
    return str.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function appendDynamicLeadRow(lead, index) {
    if (dynamicColumns.length === 0) {
      setupDynamicTableHead(lead.data || {});
    }

    const row = document.createElement("tr");
    let cells = [`<td>${index}</td>`];

    dynamicColumns.forEach(col => {
      const val = lead.data ? lead.data[col] : "";
      const valStr = val === null || val === undefined ? "—" : String(val);

      if (valStr.startsWith("http://") || valStr.startsWith("https://")) {
        cells.push(`<td><a class="lead-link" href="${valStr}" target="_blank" rel="noopener noreferrer">${escapeHtml(valStr)}</a></td>`);
      } else {
        cells.push(`<td>${escapeHtml(valStr)}</td>`);
      }
    });

    // Source link
    if (lead.source_url) {
      cells.push(`<td><a class="lead-link" href="${lead.source_url}" target="_blank" rel="noopener noreferrer">Source Proof</a></td>`);
    } else {
      cells.push(`<td>—</td>`);
    }

    // Critic Verdict
    cells.push(`<td class="match-reason-cell">${escapeHtml(lead.critic_verdict || "Verified")}</td>`);

    row.innerHTML = cells.join("");
    leadsTableBody.appendChild(row);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function startRun() {
    const query = promptInput.value.trim();
    const target = parseInt(targetCount.value, 10) || 10;

    if (!query) return;

    if (currentEventSource) {
      currentEventSource.close();
    }

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>Running...</span>`;

    monitorSection.classList.remove("hidden");
    resultsSection.classList.add("hidden");

    visitedSitesSet.clear();
    collectedLeads = [];
    dynamicColumns = [];
    sitesList.innerHTML = `<div class="empty-state">Inspecting sources...</div>`;
    sitesVisitedCount.textContent = "0";
    eventLogs.innerHTML = "";
    leadsTableHead.innerHTML = "";
    leadsTableBody.innerHTML = "";
    leadsCountBadge.textContent = `0 / ${target}`;
    currentAction.textContent = "Synthesizing dynamic spec...";

    startTimer();
    appendLog(`Dynamic Engine initialized for: "${query}" (Target: ${target})`, "highlight");

    const streamUrl = `/api/stream?query=${encodeURIComponent(query)}&target=${target}`;
    currentEventSource = new EventSource(streamUrl);

    currentEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleStreamEvent(data, target);
      } catch (err) {
        console.error("Failed to parse SSE event:", err, event.data);
      }
    };

    currentEventSource.onerror = (err) => {
      console.warn("SSE stream closed or encountered error:", err);
      currentEventSource.close();
      stopTimer();
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>Run Agent</span><kbd>↵</kbd>`;
      currentAction.textContent = "Run Completed";
    };
  }

  function handleStreamEvent(data, target) {
    switch (data.type) {
      case "status":
        currentAction.textContent = data.message;
        const level = data.message.includes("[Critic Approved]") ? "success" : 
                      data.message.includes("[Critic Rejected]") ? "warning" : "info";
        appendLog(data.message, level);
        break;

      case "site_visited":
        addSiteVisited(data.title, data.url);
        break;

      case "lead_discovered":
        collectedLeads.push(data.lead);
        leadsCountBadge.textContent = `${collectedLeads.length} / ${target}`;
        appendDynamicLeadRow(data.lead, collectedLeads.length);
        const nameVal = data.lead.data ? Object.values(data.lead.data)[0] : "Lead";
        appendLog(`[Verified & Saved] #${collectedLeads.length}: ${nameVal}`, "success");
        break;

      case "jev":
        renderJevCard(data.telemetry);
        break;

      case "complete":
        stopTimer();
        runBtn.disabled = false;
        runBtn.innerHTML = `<span>Run Agent</span><kbd>↵</kbd>`;
        currentAction.textContent = `Completed (${collectedLeads.length} verified leads)`;
        appendLog(`Execution Complete! Verified ${collectedLeads.length} leads strictly satisfying all constraints. Stopped reason: ${data.report.stopped_reason}`, "success");

        resultsSection.classList.remove("hidden");
        resultsHeading.textContent = `Verified Leads (${collectedLeads.length})`;
        stoppedReasonTag.textContent = data.report.stopped_reason || "COMPLETE";

        downloadCsvBtn.href = `/api/download/csv?id=${data.run_id}`;
        downloadJsonBtn.href = `/api/download/json?id=${data.run_id}`;

        if (currentEventSource) {
          currentEventSource.close();
        }
        break;

      case "error":
        stopTimer();
        runBtn.disabled = false;
        runBtn.innerHTML = `<span>Run Agent</span><kbd>↵</kbd>`;
        currentAction.textContent = "Error occurred";
        appendLog(`Error: ${data.message}`, "warning");
        if (currentEventSource) {
          currentEventSource.close();
        }
        break;
    }
  }

  function renderJevCard(jev) {
    if (!jev) return;
    const isEvaluated = jev.evaluated === true;
    const isSatisfied = jev.satisfied === true;

    if (!isEvaluated) {
      jevDecisionPill.textContent = "NOT EVALUATED";
      jevDecisionPill.className = "decision-pill";
      jevConfidence.textContent = "N/A";
      jevMatchStatus.textContent = jev.reason || "Bypassed";
      jevVerdict.textContent = "TypeSafe JEV evaluation was skipped or missing API key.";
      return;
    }

    if (isSatisfied) {
      jevDecisionPill.textContent = "AUDIT PASSED (SATISFIED)";
      jevDecisionPill.className = "decision-pill satisfied";
      jevConfidence.textContent = `${Math.round(jev.confidence * 100)}%`;
      jevMatchStatus.textContent = "100% Constraints Honored";
      jevVerdict.textContent = `TypeSafe JEV-1.14 audited the delivered data against your prompt and confirmed all constraints and required fields were genuinely populated.`;
      appendLog(`JEV Real Audit: PASSED (Confidence: ${Math.round(jev.confidence * 100)}%)`, "success");
    } else {
      jevDecisionPill.textContent = "AUDIT FAILED (REJECTED)";
      jevDecisionPill.className = "decision-pill unsatisfied";
      jevConfidence.textContent = `${Math.round(jev.confidence * 100)}%`;
      jevMatchStatus.textContent = "Constraints Violated";
      jevVerdict.textContent = `TypeSafe JEV-1.14 audited the data and flagged that the leads failed to fully honor your prompt requirements.`;
      appendLog(`JEV Real Audit: FAILED (Output did not meet constraints)`, "warning");
    }
  }
});
