const chatFeed = document.getElementById("chat-feed");
const chatForm = document.getElementById("chat-form");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const statusBadge = document.getElementById("status-badge");
const clearBtn = document.getElementById("clear-btn");
const welcomeCard = document.getElementById("welcome-card");

// Auto-expand textarea
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";
});

// Submit on Enter without Shift
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// Quick prompt pills
document.querySelectorAll(".pill-btn").forEach((pill) => {
  pill.addEventListener("click", () => {
    promptInput.value = pill.getAttribute("data-query");
    chatForm.dispatchEvent(new Event("submit"));
  });
});

clearBtn.addEventListener("click", () => {
  chatFeed.innerHTML = "";
  if (welcomeCard) {
    chatFeed.appendChild(welcomeCard);
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  promptInput.value = "";
  promptInput.style.height = "auto";
  promptInput.disabled = true;
  sendBtn.disabled = true;
  statusBadge.textContent = "Processing";
  statusBadge.className = "badge running";

  if (welcomeCard && welcomeCard.parentNode) {
    welcomeCard.parentNode.removeChild(welcomeCard);
  }

  // 1. Add User Message
  appendUserMessage(prompt);

  // 2. Add Assistant Message Container
  const assistantRow = document.createElement("div");
  assistantRow.className = "message-row assistant";
  
  const telemetryContainer = document.createElement("div");
  telemetryContainer.className = "telemetry-card";
  telemetryContainer.innerHTML = `
    <div class="telemetry-line">
      <span class="spinner"></span>
      <span>Evaluating prompt with <strong>TypeSafe JEV-1.14</strong>...</span>
    </div>
  `;
  assistantRow.appendChild(telemetryContainer);

  const progressContainer = document.createElement("div");
  progressContainer.className = "progress-container";
  assistantRow.appendChild(progressContainer);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble prose";
  assistantRow.appendChild(bubble);

  chatFeed.appendChild(assistantRow);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  try {
    const response = await fetch("/api/chat-sse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const block of lines) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/event:\s*(.+)/);
        const dataMatch = block.match(/data:\s*(.+)/s);

        if (eventMatch && dataMatch) {
          const eventType = eventMatch[1].trim();
          let data;
          try {
            data = JSON.parse(dataMatch[1].trim());
          } catch {
            data = dataMatch[1].trim();
          }

          handleSSEEvent(eventType, data, {
            telemetryContainer,
            progressContainer,
            bubble,
          });
        }
      }
    }

    statusBadge.textContent = "Ready";
    statusBadge.className = "badge";
  } catch (err) {
    console.error("[Chat Error]:", err);
    bubble.innerHTML = `<p style="color: #f87171;">Error: ${err.message}</p>`;
    statusBadge.textContent = "Error";
    statusBadge.className = "badge blocked";
  } finally {
    promptInput.disabled = false;
    sendBtn.disabled = false;
    promptInput.focus();
  }
});

function appendUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatFeed.appendChild(row);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function handleSSEEvent(type, data, elements) {
  const { telemetryContainer, progressContainer, bubble } = elements;

  if (type === "jev_telemetry") {
    // Console log the JEV decision directly
    console.group("%c[JEV Guardrails & Intent Telemetry]", "color: #10a37f; font-weight: bold; font-size: 13px;");
    console.log("Input Prompt:", data.prompt);
    console.log("Decision Model:", data.model);
    console.log("Inappropriate Probability:", data.scores.inappropriateProb);
    console.log("Needs Research Probability:", data.scores.needsResearchProb);
    console.log("Is Allowed:", data.isAllowed);
    console.log("Selected Route:", data.route);
    console.log("Execution Engine:", data.targetModel);
    console.log("Trigger.dev Task ID:", data.triggerTaskId);
    console.groupEnd();

    const routePill = data.needsResearch
      ? `<span class="telemetry-pill pill-research">Deep Research</span>`
      : `<span class="telemetry-pill pill-chitchat">Chit-chat</span>`;

    const statusPill = data.isAllowed
      ? `<span class="telemetry-pill pill-research">Safe (P=${data.scores.inappropriateProb})</span>`
      : `<span class="telemetry-pill pill-blocked">Blocked</span>`;

    telemetryContainer.innerHTML = `
      <div class="telemetry-line">
        <strong>JEV 1.14:</strong> ${statusPill} &bull; Route: ${routePill} &bull; Engine: <code>${data.targetModel}</code>
      </div>
      <div class="telemetry-line" style="font-size: 11px;">
        Research Prob: ${(data.scores.needsResearchProb * 100).toFixed(1)}% &bull; Task: <code>${data.triggerTaskId || "local-sync"}</code>
      </div>
    `;
  }

  if (type === "progress") {
    const step = document.createElement("div");
    step.className = "progress-step active";
    step.innerHTML = `<span class="spinner"></span> <span>${data.step}</span>`;

    // Remove active spinner on previous step
    const prev = progressContainer.querySelector(".progress-step.active");
    if (prev) {
      prev.className = "progress-step";
      prev.innerHTML = `✓ <span>${prev.textContent.replace("✓", "").trim()}</span>`;
    }

    progressContainer.appendChild(step);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  if (type === "result") {
    // Hide progress container once result arrives
    progressContainer.style.display = "none";
    if (window.marked) {
      bubble.innerHTML = window.marked.parse(data.answer);
    } else {
      bubble.textContent = data.answer;
    }
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  if (type === "done") {
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }
}
