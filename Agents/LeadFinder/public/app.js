// LeadFinder Linear-Style Frontend Controller
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
  const leadsTableBody = document.getElementById("leadsTableBody");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const downloadJsonBtn = document.getElementById("downloadJsonBtn");

  let timerInterval = null;
  let startTime = null;
  let currentEventSource = null;
  let visitedSitesSet = new Set();
  let collectedLeads = [];

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

  function appendLeadToTable(lead, index) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index}</td>
      <td class="lead-title-cell">${escapeHtml(lead.title)}</td>
      <td>
        <a class="lead-link" href="${lead.primary_url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(lead.primary_url)}
        </a>
      </td>
      <td>${escapeHtml(lead.phone || "—")}</td>
      <td>${escapeHtml(lead.email || "—")}</td>
      <td>${escapeHtml(lead.contact_name || "—")}</td>
      <td>${escapeHtml(lead.location || "—")}</td>
      <td class="match-reason-cell">${escapeHtml(lead.match_reason || "")}</td>
    `;
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
    const target = parseInt(targetCount.value, 10) || 20;

    if (!query) return;

    // Reset UI State
    if (currentEventSource) {
      currentEventSource.close();
    }

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>Running...</span>`;

    monitorSection.classList.remove("hidden");
    resultsSection.classList.add("hidden");

    visitedSitesSet.clear();
    collectedLeads = [];
    sitesList.innerHTML = `<div class="empty-state">Waiting for first site visit...</div>`;
    sitesVisitedCount.textContent = "0";
    eventLogs.innerHTML = "";
    leadsTableBody.innerHTML = "";
    leadsCountBadge.textContent = `0 / ${target}`;
    currentAction.textContent = "Connecting to agent stream...";

    startTimer();
    appendLog(`Initializing discovery stream for: "${query}" (Target: ${target})`, "highlight");

    // Connect to SSE Endpoint
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
        appendLog(data.message, "info");
        break;

      case "site_visited":
        addSiteVisited(data.title, data.url);
        appendLog(`Visited: ${data.title} (${data.url})`, "info");
        break;

      case "lead_discovered":
        collectedLeads.push(data.lead);
        leadsCountBadge.textContent = `${collectedLeads.length} / ${target}`;
        appendLeadToTable(data.lead, collectedLeads.length);
        appendLog(`Found match: ${data.lead.title} (${data.lead.primary_url})`, "success");
        break;

      case "jev":
        renderJevCard(data.telemetry);
        appendLog(`JEV satisfaction evaluated: ${data.telemetry.satisfied ? "SATISFIED" : "REJECTED"} (Score: ${data.telemetry.confidence})`, "highlight");
        break;

      case "complete":
        stopTimer();
        runBtn.disabled = false;
        runBtn.innerHTML = `<span>Run Agent</span><kbd>↵</kbd>`;
        currentAction.textContent = `Completed (${collectedLeads.length} leads found)`;
        appendLog(`Agent completed! Total leads: ${collectedLeads.length}. Stopped reason: ${data.report.stopped_reason}`, "success");

        // Reveal results section
        resultsSection.classList.remove("hidden");
        resultsHeading.textContent = `Extracted Leads (${collectedLeads.length})`;
        stoppedReasonTag.textContent = data.report.stopped_reason || "COMPLETE";

        // Setup download links
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
    const isSatisfied = jev.satisfied === true;

    jevDecisionPill.textContent = isSatisfied ? "SATISFIED (PASS)" : "NEEDS ADJUSTMENT";
    jevDecisionPill.className = `decision-pill ${isSatisfied ? "satisfied" : "unsatisfied"}`;

    jevConfidence.textContent = jev.confidence ? `${Math.round(jev.confidence * 100)}%` : "N/A";
    jevMatchStatus.textContent = isSatisfied ? "Fulfilled User Intent" : "Partial / Deviated";

    jevVerdict.textContent = `TypeSafe JEV evaluation completed on ${jev.model || "typesafe/jev-1.14"}. Predicate 'query_satisfied' determined output aligns with requested domain and volume.`;
  }
});
