# Study OS

A local-first study planner (timetable, tasks, exams, homework, notes, flashcards, Pomodoro, revision) with an
optional **AI tutor** powered by **OpenAI** or **Google Gemini** through a small, secure Node.js server.

* **Everything except the AI buttons works with no account, no key and no internet.**
* AI keys live **only** on the server (`.env`). They are never in the web page, browser storage, backups or logs.
* AI never changes your data by itself: every AI suggestion (flashcards, questions, revision plans, sessions) is shown as a **preview** and only saved when you press Save.

```
index.html     the whole app (one file, no build step)
server.js      backend: serves index.html and proxies AI requests securely
package.json   dependencies and scripts
.env.example   settings template (copy to .env)
test/          automated tests (mocked providers, no API credits used)
legacy/        your original file, untouched, for reference
TESTING.md     bug list, fixes, and the honest test report
```

---

## 1. Setup on Windows 11 (beginner friendly)

1. **Install Node.js** (LTS version, 20.6 or newer): download from <https://nodejs.org>, run the installer, accept the defaults.
   Check it worked: open **PowerShell** and run `node --version`.
2. **Unzip** this project, e.g. to `C:\Users\you\study-os`.
3. Open PowerShell **in that folder** (File Explorer → click the address bar → type `powershell` → Enter).
4. Install the dependencies (one time):
   ```powershell
   npm install
   ```
5. Create your settings file:
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   Paste your API key(s) after `OPENAI_API_KEY=` and/or `GEMINI_API_KEY=` (see section 2). Save and close. You only need **one** provider. You can skip this step to use the app without AI.
6. Start the app:
   ```powershell
   npm start
   ```
7. Open **<http://localhost:3000>** in your browser. Keep the PowerShell window open while you use the app (close it or press `Ctrl+C` to stop).
8. In the app: **Settings → AI provider → Test connection**. “Verified” appears only after a real request succeeds.

> Do **not** open `index.html` by double-clicking it if you want AI. Open it through `http://localhost:3000` so it can reach the server. (Double-clicked, the rest of the app still works.)

Run the automated tests any time with `npm test`.

## 2. Getting API keys

| Provider | Where | Notes |
|---|---|---|
| OpenAI | <https://platform.openai.com> → API keys | API use is **pay-as-you-go**; you add credit first. A ChatGPT subscription does not include API credit. |
| Google Gemini | <https://aistudio.google.com> → *Get API key* | Some models have a **free tier** (see below). |

Menu names on those sites change; if you cannot find “API keys”, search their help pages. Treat a key like a password: never paste it into the app, into chat, or into a file you share.

## 3. Costs and free-tier limits

Checked against the providers' official pages on **14 Oct 2026**. These change; always re-check.

* **OpenAI** (`developers.openai.com/api/docs/models`): `gpt-6-luna` $0.10 in / $0.50 out per 1M tokens; `gpt-6.1-sol` $2 / $10; `gpt-6-astra` $10 / $50 (not enabled by default here). I did not find a free API tier. Assume you pay for what you use.
* **Gemini** (`ai.google.dev/gemini-api/docs/pricing`): `gemini-3.5-flash-lite` and `gemini-3.8-flash` list a **free tier**. The page does not publish request limits; they depend on your account and are shown in Google AI Studio. Paid rates: flash-lite $0.30 / $2.50, 3.8-flash $0.75 / $3.75 per 1M tokens (rising on 1 Jan 2027). **On the free tier Google states your content may be used to improve its products**: do not send private information there.
* A typical tutor answer is a few thousand tokens, i.e. a fraction of a cent on the cheap models. Free access is never guaranteed to last.
* Cost controls (in `.env`): `RATE_LIMIT_PER_MINUTE`, `DAILY_REQUEST_LIMIT`, `MAX_INPUT_CHARS`, `MAX_OUTPUT_TOKENS`, `REQUEST_TIMEOUT_MS`. The model list you can pick from is `OPENAI_MODELS` / `GEMINI_MODELS`; the server **refuses any model not on that list**.
* Study OS **never switches provider on its own**; if the selected provider fails you see an error.

## 4. What needs what

| Feature | Account/key | Internet | Server |
|---|---|---|---|
| Timetable, tasks, exams, homework, notes, flashcards, Pomodoro, revision, library, quizzes (manual), Smart Plan (offline mode), analytics, streaks | no | no (fonts need it for the original look) | no |
| Translator (MyMemory, original feature) | no | yes | no |
| AI tutor, AI flashcards/questions/summaries/plans | provider key | yes | yes (`npm start`) |

## 5. Privacy

* The first time you use AI you are asked for permission. You can revoke it in **Settings → AI privacy**.
* **Share study data with AI** is **off** by default. It is required for tools that use your deadlines, scores or weak topics (exam revision plan, next session, weekly analysis, AI-refined plan). Before each such send you see the exact text.
* Notes, flashcards and library text are sent only when you choose them, truncated to 6000 characters.
* Chats are kept in memory only, unless you turn on **Save AI conversations** (then they are stored in this browser). You can delete them at any time.
* AI text is rendered as inert text (HTML is escaped); it can never run as code.
* Your data lives in **this browser's localStorage**. It is **not encrypted**, not synced between devices, and clearing site data or using a private window can erase it. Use **Settings → Export a backup** regularly. The app also keeps up to 3 local safety snapshots (same browser storage, so they are *not* a substitute for a downloaded backup).

## 6. Local use vs public deployment

**Local (default):** `HOST=127.0.0.1` means only your own computer can reach the server. No token is needed. A DNS-rebinding guard and an origin allow-list are applied.

**Public (website/phone/other devices):** anyone who can reach the server can spend *your* API credit, so:
1. Set a long random `ACCESS_TOKEN` in `.env`. The server **refuses to start** on a non-local `HOST` without one. In the app, enter it under *Settings → AI settings → Advanced connection*.
2. Put it behind HTTPS (a reverse proxy such as Caddy/nginx, or a platform that terminates TLS). Without HTTPS the token travels in clear text.
3. Set `ALLOWED_ORIGINS` to your site's origin if the page is hosted elsewhere.
4. Keep the daily limit low. **CORS is not security**: it only tells *browsers* which pages may read responses; `curl` ignores it. The token and limits are what protect you.
5. Limits are counted in server memory (reset on restart) and per IP. Behind a proxy all visitors share the proxy's IP unless you configure Express `trust proxy` yourself.
6. The token is a single shared secret, not per-user login. For many users you need real accounts (not included).
Hosting on a cloud platform may cost money; for building and testing, run it locally.

## 7. Feature guide

* **AI Tutor** (sidebar): chat, homework helper (steps / check my work / hints / similar practice), and Study tools. Pick subject, topic, grade and language.
* **Smart Plan**: pick a day and available time → suggested sessions from deadlines, exams, revision due, weak topics, quiz results and missed sessions. Edit/reject/accept, then add. Works with no AI; “Refine with AI” only re-orders candidates. Also edit your **fixed weekly routine** there.
* **Practice**: question bank (multiple choice, true/false, short answer), timed quizzes, results, mistakes, AI-generated questions (preview first). Only MC and T/F are auto-graded; short answers are self-checked.
* **Revision**: Forgot/Hard/Good/Easy sets the next review (1, 3, 7, 14, 30, 60 day steps, capped to the day before a linked exam). Dates can be edited by hand.
* **Library**: lessons, notes, links, tags. You can import **plain-text** files (.txt .md .csv, ≤ 300 KB). **PDF text cannot be read** in the browser: importing a PDF only saves its name; paste the text yourself.
* **Progress**: streaks, weekly challenge, quiz/exam/revision/difficult-topic summaries from recorded data only.

## 8. Troubleshooting

* “Cannot reach the Study OS server” → run `npm start` and open `http://localhost:3000`.
* “No API key on the server” → fill `.env`, then stop and restart `npm start`.
* “rejected the API key” → key wrong/expired/no credit. “model not available” → pick another model in settings or edit `*_MODELS` in `.env`.
* “Rate limit” → wait, or check your usage and billing on the provider site.
