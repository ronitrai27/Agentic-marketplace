# Test Files — intentionally buggy

Five source files with **deliberate mistakes** for validating the Code Review Agent.
Upload one, or all five at once (Upload Files tab, 1–10 files), and check the
reviewer flags the seeded issues below. Expect a low score and a
`request-changes` / `reject` verdict.

> These files are NOT meant to be run. They exist only to be reviewed.

---

## 1. `vulnerable-auth.js` (Node / Express)
Seeded problems:
- **SQL injection** — user input concatenated into queries (login, delete).
- **Hardcoded secrets** — DB password, JWT secret, live Stripe key in source.
- **Weak hashing** — MD5 for passwords.
- **Loose equality** (`==`) for password comparison (type-juggling risk).
- **Missing authorization** — unauthenticated delete-by-id.
- **Unhandled `JSON.parse`** + stack trace leaked to client.

## 2. `user_service.py` (Python)
Seeded problems:
- **SQL injection** via f-string.
- **Mutable default argument** (`roles=[]`) shared across calls.
- **Resource leak** — SQLite connection never closed.
- **Bare `except:`** swallows all errors incl. `KeyboardInterrupt`.
- **`eval()` on untrusted input** (RCE).
- **`pickle.loads` on untrusted data** (unsafe deserialization).
- **Division by zero** unhandled; file handle never closed.
- **Plaintext password logged**.

## 3. `order-service.ts` (TypeScript)
Seeded problems:
- **Missing `await`** — axios Promise treated as data.
- **`any` everywhere** — no type safety.
- **N+1 queries** inside a sequential loop.
- **Mutating array while iterating.**
- **Unhandled `JSON.parse`**; unbounded array push (memory growth).
- **`setInterval` never cleared** (leaks the process).
- **Division by zero** + unsafe non-null assertion (`length!`).

## 4. `file-upload-handler.js` (Node / Express)
Seeded problems:
- **Path traversal** — unsanitized filename in upload & download (LFI).
- **Command injection** — user input into `exec` shell string.
- **Blocking `writeFileSync` / `readFileSync`** on the event loop.
- **No auth / size / type checks**; unrestricted file delete.
- **ReDoS** — user-supplied regex compiled unsanitized.

## 5. `data-processor.js` (Node)
Seeded problems:
- **Off-by-one** — `i <= users.length` reads past the end.
- **Missing `await`** — async result used as a value.
- **Unhandled promise rejections** (crash in modern Node).
- **`splice` while iterating forward** — skips elements.
- **No input validation** — `NaN` propagates from `percentage()`.
- **Unhandled `JSON.parse`** on file load; blocking sync I/O.
- **String comparison of timestamps** (timezone-unsafe).

---

## How to use
1. Start the app (`pnpm dev`) and open http://localhost:3006
2. Go to **Upload Files (1–10)**
3. Drag in all five files (or a subset) and click **Review Files**
4. Compare the returned issues/risks against the list above

You can also paste a single file's contents into the **Paste Code** tab.
