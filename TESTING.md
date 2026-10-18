# Study OS: bugs found, fixes, and test report

Environment used for every test below: Node 22 on Linux, jsdom 26 (simulated browser), Chromium (Playwright) for the screenshot/e2e run, timezone `Africa/Cairo`.
**It was not run on Windows 11, Firefox, Safari or a real phone**, and **no real OpenAI or Gemini request was ever made** (no keys were available). Run `npm test` yourself to reproduce everything marked Passed.

## 1. Bugs found in the uploaded project, and what was done

"Confirmed" = reproduced by running the original file. "Code review" = found by reading the code.

| # | Problem | How found | Fix |
|---|---|---|---|
| 1 | Five pages (Smart Plan, Practice, Library, Revision, Tutor) were placed **outside** the main layout container, so they lost its padding/width. | Confirmed (DOM check) | Moved inside `.main`. |
| 2 | Smart Plan's "Add" button and the Library filter buttons had **truncated inline handlers** (`addSuggestedSession(`, `setLibraryFilter(`): clicking did nothing (sessions stayed 0). | Confirmed | Whole second script replaced; all new buttons use one delegated `data-act` handler, no inline strings. |
| 3 | Earlier new-code layer computed dates with `toISOString()` (UTC). At 00:30 in Cairo it returned *yesterday*, which breaks streaks and due dates. | Confirmed | Everything uses the original local-time helpers. Tested at 00:30. |
| 4 | **Import** accepted any JSON with an `so_` key, with no validation and no safety copy; a bad file could break the app. | Code review | Validated first (types, JSON, size); a snapshot is saved before replacing; storage-full rolls back. |
| 5 | **"Clear all"** called `localStorage.clear()`, wiping *every* app on the same origin, with no undo. | Code review | Removes only `so_` keys, after taking a snapshot you can restore from Settings. |
| 6 | `save()` **swallowed storage errors**, so a full browser silently lost changes. | Code review | `save()` returns true/false, frees old snapshots, and shows a clear message if it still cannot save. |
| 7 | Unreadable (corrupt) stored JSON was replaced by defaults, then overwritten on the next save. | Code review | A raw copy is kept in `so_corrupt_<key>` and a warning is shown. |
| 8 | Planned sessions never recorded **when** they were finished, so streaks/weekly stats could not be accurate. | Code review | `doneAt` recorded on toggle and when a Pomodoro completes the session. Older sessions without it count on their scheduled date (a stated approximation). |
| 9 | Export included everything (caches); a backup could also carry an AI token. | Code review | The AI token and snapshots are never exported, and a token inside an imported file is ignored. |
| 10 | Custom checkboxes/toggles were not keyboard operable. | Code review | `role`, `tabindex`, Enter/Space handling, visible focus ring. |
| 11 | RTL used `row-reverse` on top of `direction: rtl`, flipping rows twice. Sidebar-footer button was unstyled (white). | Code review; screenshot | RTL rewritten using `html[dir=rtl]`; footer button styled. |
| 12 | The old “Tutor” only built a prompt text (no AI). | By design of the old file | Replaced by the real tutor. |

Existing data keys were kept (`so_tasks`, `so_exams`, `so_plan`, …). Records written by the earlier layer (`so_revision_v1` with `interval`, `so_practice_v1`, `so_library_v1`, `so_routine_v1`) are normalised **in memory** and still load; the original storage is not rewritten on load.

## 2. Results

### Passed (automated, 60 tests)

**Backend (17):** health endpoint; status never leaks keys; missing keys; request validation (provider, model allow-list, empty/oversized/invalid JSON, roles, 413/404); OpenAI request shape and normalised reply; Gemini request shape (key in header, never URL), role mapping, JSON mode; provider switching; 401/403/404/429/5xx/400 mapped to friendly errors with secrets scrubbed; timeout, unreachable network, unreadable reply; blocked/refused/truncated/empty answers; connection-test endpoint; output-limit clamping; per-minute and daily limits; access token (incl. health stays open); CORS allow-list, foreign origin 403, DNS-rebinding Host 421; only `index.html` is served; refuses to start publicly without a token; secret scrubber.
These use a **local mock** standing in for the providers.

**Original features, regression (7):** Pomodoro completion logs minutes and finishes the linked session, skipped focus is not counted; themes/accent persist; tasks add/validate/complete/overdue/delete; flashcard spaced-repetition boxes and due dates; translator (mocked service) incl. cache and direction guard; checklist day rollover with history; schedule conflicts and exam %.

**Data safety and compatibility (6):** original-version data loads with nothing changed or erased; corrupt data preserved; storage-full reported; export omits secrets; invalid imports change nothing; valid import snapshots first; "Clear all" only touches `so_` keys; snapshot restore works.

**New features, with mocked AI responses (30):** revision intervals/exam cap/manual date/persistence after reload; streaks (consecutive days, gaps, duplicates, thresholds, future dates, local midnight, finished sessions); session completion date; Smart Plan (no overlap with school/lessons or each other, nothing added without accepting, reject/accept, no duplicates on regenerate, works with the server offline, lesson protected); Practice (MC/true-false auto-graded, **short answers not auto-graded**, mistakes tracked, manual-question validation, timed quiz auto-submit, “difficult topics” mode); AI tutor (consent gate before any request, request shape, safe rendering of hostile model output, error + retry, history persisted only if enabled and deletable); provider handling (unconfigured provider blocks, switching, no silent fallback, “Verified” only after a real success, clear message when the server is down); AI flashcards/questions/revision plan (preview first, validation drops malformed items, duplicates flagged, saved only on confirm, data-sharing gate, exact outgoing text shown); weekly analysis sends only recorded numbers (a secret note was not sent); homework helper modes; delimiter-injection hardening; lesson summary → note; Smart Plan “Refine with AI” validated against real slots; next-session suggestion; explain-my-mistake; weekly challenge; library search/filter/edit/delete, text import, oversize rejection, PDF = reference only; safe markdown; Arabic RTL switch; keyboard access for checkboxes/toggles.

**Real browser (Chromium, real `server.js`, mock provider; not part of `npm test`):** page loads without script errors; connection test, tutor chat through the consent dialog, note → flashcards → preview → save; Smart Plan and Progress render; no horizontal scroll at 390 px width; RTL layout renders. Only console messages were Google Fonts being blocked in the sandbox.

### Failed
Nothing in the automated suite fails. Issues found during testing and fixed: tutor defaulted to “Arabic” as the subject for general questions; chat input was cleared before the permission check; sidebar settings button unstyled.

### Not Tested (do not assume these work)
* **OpenAI against the real API: Not Tested.** **Gemini against the real API: Not Tested.** The request/response formats follow the providers' documentation, but I could not read every field in the doc excerpts: for OpenAI (`/v1/responses`) the excerpts did not confirm `max_output_tokens`, `store`, or the raw response path; for Gemini (`generateContent`, currently labelled “legacy but fully supported” by Google) they did not confirm `generationConfig.responseMimeType`/`systemInstruction`. Model IDs (`gpt-6-luna`, `gpt-6.1-sol`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`) come from the official model pages, but availability on *your* account is unknown. Use **Settings → Test connection**; if one fails, the error message says why.
* Windows 11 install steps (written for Windows, run on Linux); Firefox, Safari, Edge; a real phone; screen readers and a full keyboard audit (only checkboxes/toggles tested).
* Browser notifications and permission prompts; Pomodoro in a sleeping/backgrounded tab.
* Real storage-quota behaviour (simulated only); behaviour with several MB of data.
* Public deployment, HTTPS, reverse-proxy behaviour, and `trust proxy`.
* Arabic quality of AI replies; Arabic text in most older screens (they stay English, see below).
* The real MyMemory translation service (mocked); PDF text extraction (not implemented).
* Visual QA of every screen in every theme; only the screens in the Chromium run were looked at.

## 3. Remaining limitations
* The Arabic interface covers navigation, page headings and parts of the new pages; older screens stay English. RTL layout works. AI replies can be Arabic.
* No PDF text extraction. Only plain-text files up to 300 KB.
* Data is in browser localStorage: ~5 MB, unencrypted, per browser. Snapshots share that space.
* Daily/rate limits are in server memory (reset on restart). The access token is one shared secret, not user accounts.
* Quiz “short answer” results are self-assessed by design.
* Streak days for old sessions without `doneAt` use the scheduled date.
* The Google Fonts link from the original file needs internet; without it a fallback font is used.
