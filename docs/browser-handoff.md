# Browser verification handoff

## Project and running services

- Project: `/Users/codecaffiene/Desktop/jas-proj/stratum`
- Stratum: <http://127.0.0.1:3000>
- HarnessRouter Community Edition: <http://127.0.0.1:3100>, running in Docker
- Native ObjectStack runtime: port 3002, managed by Stratum
- Current application: **Credit Review**, version 6, with five fictional borrowers, a required risk grade and a Reviewer notes label

The native Agent refactor is complete; see `docs/native-agent-refactor.md`. Versions 5 and 6 were browser-submitted verification changes (rename the notes label, then restore it). Version 6 metadata exactly matches the pre-refactor version 4, including its red-font configuration. All older runs remain intact. Fifteen automated tests, type checking and eleven HTTP checks passed.

Read `README.md` and `docs/milestone-1.md` before making changes. Use the existing application and provider integration. Do not recreate the OpenAI project or key.

The user's explicit browser preference is **the connected ChatGPT Chrome extension**. Do not substitute Playwright or AppleScript. Chrome Person 1 was connected and used successfully for the completed verification pass. Discover the current extension connection rather than assuming browser/tab IDs persist across threads.

## Already verified

Three real local HarnessRouter → Codex → ObjectStack runs succeeded. The first created Credit Review; the second added risk grade; the third, submitted through Chrome, renamed Notes to Reviewer notes. Only the requested label changed in that last run. Earlier successful metadata versions are retained.

Nine automated tests, TypeScript checking and ten HTTP integration checks passed. The HTTP checks include native ObjectStack required-field rejection and creating, updating, reading and deleting a temporary record. The new tests cover occupied preview ports and cleanup after an abrupt parent-process exit.

The extension pass verified the embedded list, required fields, dropdown choices, form scrolling, a complete temporary-record lifecycle, Open app, history, Changes, Activity and Metadata. It also verified a live prompt, disabled editing while the task ran and the updated list/form after completion. See `docs/browser-verification.md`. Screenshots already stored in `docs/screenshots/` show version 1; they are historical.

## Scenarios for future regression checks

1. Open Stratum and confirm its connection status, six successful requests and version 6. The embedded preview should open Credit Review with no login prompt.
2. Confirm the native list shows the five fictional borrowers and the requested columns, including risk grade. Check that the preview fits inside Stratum and scrolling works.
3. Open New. Verify borrower, amount and risk grade are required; check the status and risk-grade choices. Try submitting without a required value.
4. Create a clearly named temporary test record, open it, change its notes and risk grade, save, then reload. Confirm the values persisted. Delete only that temporary record.
5. Check the Changes, Activity and Metadata tabs and Open app. Reload Stratum and confirm the preview signs in again.
6. If a generation check is needed, request a small visible change through the prompt UI. Confirm progress, prevent a second concurrent submission, then verify the requested change in the actual preview. This calls OpenAI and incurs API usage.

The current two-step `verify:live` scenario is already complete; rerunning it will stop before another model call. Use the UI for a new change.

## Resume after a machine restart

From the project folder, use Node 22 or newer:

```sh
nvm use
npm run harness:up
npm run dev
```

On this machine Node 22 is installed at `/Users/codecaffiene/.nvm/versions/node/v22.15.0/bin`; the parent folder's shell may otherwise select Node 16.

The verification session left Stratum running as a background process so it can survive the terminal session. Its PID is in `.stratum/server.pid` and output in `.stratum/server.log`. Check the process and its project before stopping it; do not start a second server on the same port. Normal foreground `npm run dev` remains available after it is stopped.

Do not delete `.stratum/` or the Docker volume. They hold the accepted versions, local preview credential, provider setup and run history. `.env` and `.stratum/` are intentionally gitignored; do not print their credentials.

## Known scope limits

Each generated version has its own preview database. A manually entered record is not migrated into a later generated version. Seed upserts may overwrite changes to fixture records on restart. The single local actor is not a financial company's authentication or tenant model. The ObjectStack development preview listens on all interfaces on port 3002, unlike the loopback-only Stratum and HarnessRouter services.

Focus this pass on browser behavior and the requested integration. Record findings separately from features intentionally outside milestone 1.
