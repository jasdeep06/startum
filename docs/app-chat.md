# In-app chat milestone

The user-facing application is now ObjectStack itself. The previous Stratum builder frontend, Express API, custom Task registry, metadata editing, version promotion and preview processes have been removed. Their implementation remains in Git history at `3663945`.

The existing Credit Review application is now `app.json`. `objectstack.config.ts` registers a native persistent datasource and one custom plugin, `com.stratum.app-chat`. There is no ObjectStack source fork or additional frontend build.

## How the integration works

1. ObjectStack serves its stock console, login, records, Ask dock and full-page chat.
2. `StratumChatPlugin` supplies the catalogue and conversation endpoints those chat screens expect. It registers the native `ask` Agent with ObjectStack metadata.
3. The plugin authenticates each request using ObjectStack's auth service, verifies conversation ownership and checks the request origin.
4. Each question gets a temporary token that can access only this app's read tools. The user's login cookie remains inside the app server.
5. Local HarnessRouter receives the question, recent server-owned conversation history and the temporary token in an additional header. Its configured Codex harness connects to `/api/v1/ai/mcp`.
6. This small gateway allows only `list_objects`, `describe_object`, `query_records`, `get_record` and `aggregate_records`. It forwards them to ObjectStack's existing `/api/v1/mcp` endpoint with the original user's session. It rejects writes, actions, other objects and other MCP methods before forwarding.
7. The completed answer is displayed through ObjectStack's native chat transport. Progress narration from the coding harness is omitted. A live-data source link is added after successful retrieval. Without a successful data read, a business answer is withheld.
8. The conversation is saved and the temporary token revoked. Stop disconnects the request and cancels the remote run. Runs also have a time limit.

The gateway is the read-only enforcement mechanism for this prototype. It does not mint an OAuth `data:read` grant. Native MCP continues to enforce the user's application permissions on every forwarded data call. A shared administrator API key is not handed to the harness.

Each turn starts a fresh harness sandbox; recent conversation text provides continuity. This keeps old turn credentials out of the next sandbox. No app source files or database files are uploaded to HarnessRouter. The model still receives the authorised records returned by its tools.

## Reference-inspired drawer

See the [desktop and mobile screenshot gallery](screenshots.md).

`src/chat-ui.ts` serves two local assets and adds them to the console HTML through the existing HTTP service. `ui/chat-drawer.js` adds the top-bar **Ask Stratum** button, scope/read-only badges, introductory note and relevant suggested questions. `ui/chat-drawer.css` presents the native dock as a right-hand drawer over a dimmed application. The stock composer, conversation state, message rendering, cancellation and backend remain in use. Clicking a suggestion fills the native composer without sending it automatically. The history icon delegates to the console's existing full-page chat.

This is a small presentation adapter for the pinned 17.4.0 console, not an official metadata setting or a fork of ObjectStack. It targets native DOM selectors and must be checked on console upgrades. It does not inspect React internals, duplicate chat API calls or patch installed packages. The scope badge reflects this server's fixed Credit Review app; it does not imply that selected rows or list filters are automatically passed into chat. The source note refers to the app link already supplied by the backend, not per-record citations.

Drawer verification on 24 September: Chrome confirmed the top-bar launcher, close/reopen, Escape with focus returned to the launcher, native history and new-conversation round trip, suggestion prefilling, submission and Stop controls, existing-answer rendering, and layouts at desktop size and 390 × 844. The temporary viewport override was reset. A fresh live answer after this presentation change remains unverified: local Docker and HarnessRouter became unresponsive, and the pending request was cancelled. The successful end-to-end data checks below were completed before the presentation change. Type checking and all five existing tests pass.

## Browser verification — 24 September 2026

Verified through the connected Chrome extension against the real local ObjectStack runtime and local HarnessRouter/OpenAI integration, not a mock chat backend.

| Check | Result |
|---|---|
| Native login, Credit Review list and in-app Ask dock | Passed |
| List requests under review and calculate total | Two requests; 217,000, matching the database |
| Follow-up identifying the high-risk request | Blue Harbor Logistics; correct reviewer notes |
| Fresh data after a normal UI create | Added a disposable 1,000 request; chat returned three requests and 218,000, including its new notes |
| Ask chat to approve/change that record | Refused; status remained under review and amount remained 1,000 |
| Full-page chat, reload and rename | Saved conversation reopened and renamed correctly |
| App restart | Sign-in, conversation and newly created business record survived |
| Regenerate answer | New harness run; current record values retrieved again |
| Stop response | Browser stopped; HarnessRouter reported the actual run cancelled |
| HarnessRouter stopped temporarily | Visible “The local assistant service is unavailable. Start it and retry.” message; no fabricated answer |

Additional access checks used a separate demo user without permission to read credit requests. API checks returned 403 for its business-record access and 404 for attempts to read or delete another user's conversation. Anonymous chat catalogue access returned 401. The browser also verified this user saw neither the administrator’s history nor any credit records; the assistant reported that it could not verify the live data. The disposable business record was removed after testing, restoring the original five examples.

## Automated checks

`npm test` covers the MCP read allowlist, rejection of direct write/action calls and cross-app reads, token expiry/revocation, forwarding distinct user identities, conversation isolation and persistence, cross-origin refusal, anonymous refusal, fragmented event streams, and final-answer extraction. `npm run typecheck` checks all application and test TypeScript.

## Scope and remaining limits

- One local application and one app-server process. Conversation ownership is enforced, but this is not a multi-tenant deployment or distributed job system.
- Native `ask` Agent metadata is reused. The broader Stratum Task, policy and workflow system is deliberately outside this smaller milestone.
- Answers cover records and summaries. No business actions, app editing, document RAG or autonomous approvals.
- App scope is fixed server-side from `app.json`; the stock chat does not yet receive the currently selected record or list filter. Name those explicitly in the question.
- Conversation storage is a local file store. Production would require managed persistence, retention, audit, concurrency and deployment controls.
- The native console includes additional controls, such as sharing and system-oriented starter questions. Sharing and attachments are not implemented by this adapter; system objects are excluded from its MCP access.
- The five fictional seed records are upserted on restart. Records created through the UI persist, but edits to seed fixtures can be reset by seeding.
- The source link identifies the app; full per-record citations and an immutable tool-call audit are future work.
- This is a development server with a seeded administrator. It needs production authentication, hosting and security review before financial-company deployment.
