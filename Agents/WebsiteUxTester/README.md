# Website UX & Conversion Tester

> **Autonomous UX & CRO Testing Agent built with Google ADK (`google.adk`), Browserbase, Stagehand, and Playwright.**

```
══════════════════════════════════════════════════════════════════════════
  🚀 WEBSITE UX & CONVERSION TESTER
  Google ADK • Browserbase Cloud Sessions • Playwright • MAPS 1.0.0
══════════════════════════════════════════════════════════════════════════
```

An enterprise-grade autonomous testing agent that opens websites like real human visitors, navigates menus, tests signup and contact forms, follows checkout funnels safely, and produces structured audit reports with replayable cloud browser sessions.

---

## 🌟 Key Capabilities

1. **Real Visitor Emulation**:
   - Opens target websites with realistic desktop and mobile viewports.
   - Automatically detects and dismisses cookie consent banners (OneTrust, CookieBot) and marketing popups.
   - Human-like scrolling, pause timings, and viewport resizing.

2. **Menu & Navigation Traversal**:
   - Discovers header, footer, and mobile hamburger navigation links.
   - Validates that routes resolve to healthy `200 OK` statuses without broken 404 links or circular redirects.

3. **Signup & Contact Form Validation**:
   - Locates registration, contact, and lead capture forms.
   - Tests empty-form submissions to verify client-side validation messages.
   - Enters safe synthetic test data to test submission handling.

4. **Checkout & Conversion Flow Testing**:
   - Identifies high-intent conversion CTAs (*Get Started*, *Add to Cart*, *Buy Now*, *Start Free Trial*).
   - Traverses checkout funnels safely without submitting real payments.
   - Uncovers checkout friction points, unexpected anchor jumps, and pricing ambiguities.

5. **Navigation Dead Ends & Confusion Detection**:
   - Detects views lacking clear next steps or prominent headings (`<h1>`).
   - Identifies rage-click candidates and excessive form fields.

6. **Verifiable Visual Evidence**:
   - **Screenshots**: High-resolution screenshots of landing pages, form states, and broken routes.
   - **Replayable Browser Sessions**: Live View and Replay URLs via **Browserbase Cloud Chrome** allowing buyers to watch the exact browser recording.

---

## 📦 Architecture & Marketplace Integration

- **Google ADK Framework**: Uses `google.adk.agents.Agent` and Gemini models (`gemini-2.5-flash`).
- **Agents CLI Setup**: Configured with `google-agents-cli` for scaffolding, eval, and deployment.
- **Marketplace Protocol (MAPS 1.0.0)**:
  - `GET /health` — Protocol version and uptime probe.
  - `GET /schema` — Self-describing AgentManifest instance with explicit JSON Schemas.
  - `POST /execute` — Streaming SSE events (`run.started`, `step.started`, `heartbeat`, `run.succeeded`, `run.failed`) or JSON batch.
  - `GET /tasks/:id` — Durable polling endpoint for asynchronous tasks.

---

## 🛠️ Standalone SDK Usage

Install and import directly in your Python projects or CI/CD pipelines:

```python
from website_ux_tester import UxConversionTester

# 1. Initialize Tester (auto-reads BROWSERBASE_API_KEY from env)
tester = UxConversionTester()

# 2. Run the audit
report = tester.test_website(
    url="https://stripe.com",
    tier="standard",  # "quick", "standard", or "comprehensive"
    safe_mode=True
)

# 3. Inspect results
print(f"Overall UX Score: {report.overall_score}/100")
print(f"Passed Journeys: {report.journeys_passed} / {report.total_journeys_tested}")

# 4. View Recommendations
for rec in report.ux_recommendations:
    print(f"[{rec.severity}] {rec.title}: {rec.recommended_fix}")

# 5. Access Replayable Browser Session
for session in report.replayable_browser_sessions:
    print(f"Watch Session Replay: {session.replay_url}")
```

---

## 🖥️ CLI Usage

Run tests directly from the command line:

```bash
# Run standard audit
python cli.py https://example.com

# Run comprehensive tier and export JSON
python cli.py https://example.com --tier comprehensive --out report.json
```

---

## 🌐 Running as a Marketplace Microservice

Start the MAPS server on port 3008:

```bash
python server.py
```

Endpoints available:
- `http://localhost:3008/` — Interactive visual developer dashboard
- `http://localhost:3008/health` — Health probe
- `http://localhost:3008/schema` — Manifest schema
- `http://localhost:3008/execute` — Execution endpoint
