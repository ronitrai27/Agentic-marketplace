# AI Patent & Prior-Art Research Agent — UI/UX Specification

The differentiator is not only *what* the agent finds — it's that **the user watches a team of specialists work, live, and works alongside them**. This document specifies that experience end-to-end: the design system, the visible agent-to-agent collaboration, and every interaction standard.
Companion documents: [`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`FEATURES.md`](./FEATURES.md).

---

## 1. Design Philosophy: "Working With a Team, Not Using a Form"

Competitors give you: upload box → spinner → PDF report. We give you: **a live working session with a patent research firm in your browser** — a lead analyst (Ari) who talks to *you*, and a visible team of specialist sub-agents who talk to *each other* while you watch.

**Four rules the whole UI obeys:**

1. **Work is visible, never hidden behind a spinner.** Every find, every read, every agent handoff is rendered as it happens.
2. **Conversation is the primary interface.** Chat with Ari is how the session starts, how findings are delivered, and how follow-ups are answered.
3. **Every statement is clickable evidence.** No unsupported sentence exists in the UI — every claim links to a quote + highlighted passage.
4. **Craft is the brand.** Cinematic motion, opinionated typography, rich structured outputs — the interface itself must feel like a $500/hr expert's tool, because that's what it replaces.

---

## 2. Design System — "Blackglass Workbench"

Dark-first, precision-instrument aesthetic: legal-tech gravity meets mission-control clarity.

### 2.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0B0E` | app background |
| `--surface-1` | `#12141A` | panes, cards |
| `--surface-2` | `#191C24` | elevated cards, hovers |
| `--glass` | `rgba(255,255,255,0.04)` + `backdrop-blur: 16px` | floating panels (inspector, command palette) |
| `--line` | `rgba(255,255,255,0.08)` | hairline borders — depth comes from lines + light, not shadows |
| `--accent` | `#6E7BFF` (indigo) | primary actions, Ari's voice |
| `--verdict-clear` | `#3ECF8E` | 🟢 clean |
| `--verdict-warn` | `#F5B14C` | 🟡 obviousness |
| `--verdict-risk` | `#FF5C5C` | 🔴 anticipation |
| `--mono` | `"JetBrains Mono"` | publication numbers, claim text, evidence quotes |
| `--sans` | `"Geist Sans"` / Inter | UI copy |
| spacing scale | 4 / 8 / 12 / 16 / 24 / 40 | strict rhythm |
| radius | 8 / 12 / 20 | controls / cards / panels |

### 2.2 Surface & depth language
- Panes separated by **hairline borders + subtle top-light gradient**, never drop shadows.
- **Glass** only for overlays that float above work (inspector, palette, toasts) — the workbench itself stays solid and calm.
- **Office color-coding** as a persistent legend: US 🟦 `#5AA2FF` · WO 🟪 `#B78BFF` · EP 🟩 `#4CD0A0` · arXiv 🟧 `#FF9F5C` — used on cards, matrix column headers, and inspector accents. Power users learn the palette in one session.

### 2.3 Motion language
- **Springs, not easings** — everything settles like a physical object (stiffness 300 / damping 30).
- Durations: micro 120 ms (hovers, toggles) · reveal 220 ms (cards, chips) · verdict 700 ms once (gauge) — never blocking.
- **Signature motions:** candidate cards *flip* in (Y-axis 90°→0°) · matrix cells *snap* color (150 ms) with percentage count-up · agent messages *arrive* with a one-line type-on effect · live DAG edges *pulse* light when a message travels them.
- Full `prefers-reduced-motion` fallback: instant states, colors preserved.

### 2.4 Typography rules
- Claim text, evidence quotes, publication numbers → **mono**, always. It signals "this is the actual legal text, not our words."
- Ari's voice → sans, 15/24. Legal terms auto-link to hover-definitions (§102 → "anticipation — one existing document already contains your whole claim").
- Verdict numbers → tabular figures, oversized (48px+) — the score is the one place we allow drama.

---

## 3. The Agent Team — Visible Sub-Agent Collaboration (the signature)

The pipeline is a team. The UI renders them as **named specialists with roles, avatars, and a live conversation the user can read** — agent-to-agent communication is a first-class visual object, not a log line.

### 3.1 The team

| Agent | Role | Avatar language | Speaks when |
|---|---|---|---|
| **Ari** — Lead Patent Analyst | talks to *you*, owns the verdict | indigo, calm | always (left chat) |
| **Scout** — Prior-Art Hunter | BigQuery / ODP / OPS / arXiv retrieval | amber, goggles motif | candidates found, sources throttled |
| **Clerk** — Records & Family | normalization, family de-dup, ranking | green, filing-cabinet motif | dedupe results, rank cuts |
| **Cartographer** — Claim Chart Builder | element × reference mapping | violet, grid motif | per-claim progress, notable matches |
| **Examiner** — Novelty Judge | §102/§103 verdict + score | red/gold, gavel-free scale motif | final verdict, red flags |

### 3.2 The Team Rail — agent-to-agent messages, live

A collapsible right-edge rail (or bottom strip on mobile) streams the **structured messages agents send each other** — the real workflow events, rendered as a readable professional dialogue:

```
Ari ──▶ Scout     "Priorities: CPC G06N3/08, drafts in /drafts/a9f3…"
Scout ──▶ Ari     "312 candidates from Google Patents · 41 from ODP · 3 arXiv"
Ari ──▶ Clerk     "De-dup + rank these 356."
Clerk ──▶ Ari     "50 finalists after family merge. Top: US11234567B2 (0.86)."
Ari ──▶ Cartographer  "Chart 4 claims × 10 refs. Element weights attached."
Cartographer ──▶ Ari  "Claim 1 · element 3: PARTIAL in US11234567B2 — '…shards are
                      assigned to nodes based on available memory…' ¶0031"
Cartographer ──▶ Scout "Need depth on CPC G06N3/09 — no strong hits on element 5."
Scout ──▶ Cartographer "6 new candidates (one refinement pass, bounded)."
Ari ──▶ Examiner   "Chart complete. Claim 1: 71% overlap. Request verdict."
Examiner ──▶ Ari   "§103 on claim 1 (combination). §102 clear. Score 62."
```

Design rules:
- **Real messages only** — rail entries are generated from the same SSE events that drive the pipeline (`agent_msg` events with template ids + payload), so the dialogue can never depict something that didn't happen.
- **Evidence inline** — matches quoted in the rail are tappable → open the Evidence Inspector (§4.5).
- **Click a message → highlight the source** on The Desk (candidate card, matrix cell, claim element) — conversation and work surface are one system.
- **Honest friction** — retries, throttles, and the bounded refinement pass appear as real messages ("Cartographer → Scout: element 5 uncovered — requesting one bounded re-scan"), turning failure handling into trust theater (the honest kind).

### 3.3 Mission-Control view (toggle)

A full-screen **live orchestration graph** for those who want the whole picture:

```
        [ Ari ]
       ╱   │   ╲
  [Scout] [Clerk] [Cartographer] ──▶ [ Examiner ]
       ╲   │   ╱
     (postgres checkpoints glow on each node)
```

- Nodes = agents; avatar + status ring (idle/working/speaking/done).
- Edges = message channels; a **light pulse travels the edge** exactly when an `agent_msg` fires.
- Working nodes show a live counter ("Scout · 312 scanned"); done nodes settle into a calm glow.
- Click any node → drawer with that agent's inputs/outputs (raw JSON available for API buyers — transparency to the byte).
- This view doubles as the run's **timeline scrubber** when re-opening a finished session.

---

## 4. Screen-by-Screen Flow

### 4.1 Intake — the interview
Ari asks 3–5 short questions in chat (what it does, software vs. hardware, closest pre-existing thing, priority dates). The **team rail shows the team assembling** — each specialist wakes as their brief arrives. Dragging a draft PDF/DOCX into the workbench skips the interview.

### 4.2 The Workbench — split view during the run

```
┌──────────────────┬──────────────────────────────┬──────────────┐
│ ARI (chat)        │ THE DESK                      │ TEAM RAIL    │
│ narration +       │ Claims │ Candidates │ Chart   │ Ari ⇄ Scout  │
│ your messages     │ (fills live, flip/snap)       │ ⇄ Clerk ⇄ …  │
│                   │                              │ (agent talk) │
│ [ask anytime]     │                              │ [collapse]   │
└──────────────────┴──────────────────────────────┴──────────────┘
```

Mobile: Ari full-screen · Desk = swipe-up sheet · Rail = expandable ticker.

### 4.3 Claim Workshop — collaborate mid-run
Hover any claim element → ✎ edit / ✂ split / ➕ add limitation. Edits create a **sub-run** (stage ③ only, top-3 references, ~15 s) under the same analysis with a `revision` counter. Ari offers proactive "what-if" chips when the chart exposes a gap. Watch Cartographer re-chart only the affected cells — the incremental behavior is *visible*, which is the point.

### 4.4 The Verdict Moment
Ari walks through the scorecard conversationally ("Claim 3 is clean. Claim 1 is one element from anticipation…"), then the full scorecard renders: animated gauge, verdict badge, per-claim overlap bars, closest-reference callout, red flags, rewrite suggestions — every element linked to evidence. The Examiner's node in the rail settles with the final score. No confetti — a single attention pulse. This is serious work.

### 4.5 Evidence Inspector
Any cell / red flag / citation / rail quote opens the glass inspector: the reference's real text with the quoted passage highlighted, office metadata (dates, assignee, legal status), deep link to patents.google.com/arXiv, and Ari's one-line commentary. Sticky on desktop, bottom-sheet on mobile.

### 4.6 Follow-up — the analysis stays alive
Grounded Q&A over the stored analysis only (pgvector over the run's own references): "closest arXiv papers?", "explain like I'm a designer", "draft the email version for my co-founder." When the answer isn't in the evidence set, Ari refuses with a link — never a fabricated patent.

---

## 5. Interaction Quality Standards

| Area | Standard |
|---|---|
| Message rendering | Ari's messages support **rich blocks**: evidence cards, overlap chips, mini-matrices, action buttons ("Re-check with this limitation") — not walls of text |
| Command palette | `Cmd/Ctrl+K` everywhere: jump to claim, reference, stage, export, settings |
| Keyboard | full nav; matrix cells announce `claim · reference · match` to screen readers |
| Copy affordances | every publication number, quote, and formula has one-click copy with mono styling |
| Empty/skeleton states | typed skeleton lines in mono ("fetching US11234567B2 claims…") — never spinners |
| Errors | Ari speaks them plainly ("USPTO throttled me 30 s — retrying automatically"), with a collapsible technical detail for devs |
| Interruptibility | you can chat, edit claims, or leave mid-run at any time — nothing blocks |
| Share/export | session link (redacted, tenant-scoped) + PDF/JSON export from the verdict screen |
| Session memory | re-opening a run restores chat + desk + rail exactly — like reopening a meeting |
| Onboarding | first-run has a 30-second "watch the team work" demo draft pre-loaded |

---

## 6. Why This UX Is the Moat

1. **Visible multi-agent work is unbeatable trust theater** — watching Scout quote a real patent paragraph back to Cartographer is what separates us from "ChatGPT with a search box." The agent-to-agent rail makes competence *observable*.
2. **The claim workshop creates value no report can** — users leave with a *redesigned, stronger claim set*, and re-checks are inherently repeatable (retention).
3. **Conversation lowers the expertise barrier** — first-timers can't operate a CPC query builder, but they can answer "what's the closest thing before this?"
4. **Craft signals price** — the Blackglass system, motion language, and rich message types make a $0.20 run feel like a $500 expert session. Design *is* the margin.

---

## 7. Implementation Notes (for the build)

- **SSE event set:** `stage`, `progress`, `candidate_found`, `cell_decided`, `agent_msg {from,to,template_id,payload}`, `ari_line {template_id,payload}`, `partial_result` (JSON patches). Narration and rail dialogue use **pre-authored templates bound to real events** — the LLM never composes free narration mid-run (truthful + cheap).
- **Team rail + DAG** render purely from `agent_msg` events; node states derive from stage events. Mission-Control doubles as the replay scrubber.
- **Incremental rendering:** desk rehydrates from the DB row on refresh; sub-runs share the analysis id with a `revision` counter.
- **Follow-up chat:** grounded generation over that run's stored passages; refusal path returns the nearest citation instead.
- **Persona & rail toggles:** `UI_MODE=persona|form`, `SHOW_TEAM_RAIL=true|false` — API/batch buyers get the same engine with the plain form.
- **Design system** ships as CSS custom properties (§2.1) in `web/src/styles/tokens.css`, consumed by CSS Modules per component; motion via `motion/react` (springs, flips, snaps) with a `useReducedMotion` fallback — React 19 + Vite keeps the component model clean while the token layer stays framework-agnostic.
