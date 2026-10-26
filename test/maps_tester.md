# MAPS Agent Protocol Tester

A browser-based inspector to test, validate, and debug Catelog/MAPS agents (`/health`, `/schema`, `/execute`, task polling, and live telemetry).

---

## 1. How to Run the Server

From the project root (`r:\marketplace`), run any static server:

### Option A: Using `npx serve` (Node.js)
```bash
npx serve test -p 8080
```

### Option B: Using Python
```bash
python -m http.server 8080 -d test
```

### Option C: VS Code / IDE
Right-click `test/index.html` → **Open with Live Server**.

Then open **`http://localhost:8080`** in your browser.

---

## 2. How to Use It

### Step 1: Configure Connection
1. **Backend URL:** Enter your deployed agent URL:
   ```text
   https://p01--claude-agent--k8clc8rvc9fq.code.run
   ```
2. **Catelog / Secret Key:** Enter your `CATELOG_SECRET_KEY` (if authentication is enabled in production).

### Step 2: Validate Endpoints
* Click **Check `/health`** → Confirms the service is live.
* Click **Fetch `/schema`** → Inspects agent manifest, input schema, and output schema.

### Step 3: Execute Agent
1. In the **Execution Dispatcher**, enter your JSON input:
   ```json
   {
     "query": "senior remote typescript developer"
   }
   ```
   *(Optional: pass `"resume_base64"` and `"resume_filename"`)*
2. Click **Execute Agent**.
3. Watch:
   * **Real-time Progress:** Live step status & progress bar.
   * **Task Output:** Structured job listings and summary response.
   * **Telemetry Dashboard:** Model used, prompt/completion tokens, and execution cost.
