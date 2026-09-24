# Milestone 1: local HarnessRouter → ObjectStack

> Historical builder milestone at commit `3663945`. The current application supports in-app questions and summaries; see the [README](../README.md) and [in-app chat guide](app-chat.md).

## Result

The integration produced a real ObjectStack application from a plain-language request, then modified it through follow-up requests. The app displayed inside Stratum is ObjectStack's own Console backed by its runtime and data API. A subsequent [Chrome extension verification pass](browser-verification.md) confirmed native record operations and a third prompt-to-preview run.

The demonstration used local HarnessRouter Community Edition, a Codex harness, and `gpt-5.4-mini` through a separate OpenAI provider integration. A local router does not mean local model inference: prompts and supplied application metadata are sent to OpenAI by the harness.

## How the document's primitives are represented

This is a deliberately limited implementation of the previously discussed Stratum Agent/Task integration, not the document's entire platform.

| Concept | Implementation | Limit |
| --- | --- | --- |
| Agent | Native `defineAgent`: `application_builder`, registered as `agent` | One platform builder; supported native fields are explicitly checked |
| Task | `modify_application@1`: native Agent reference, implementation, binding/policy references and required checks | Registry-driven dispatch; one application-editing implementation |
| Execution binding | Server-owned `local_builder` configuration points to local HarnessRouter; a run snapshots the selected harness/model | No credential-management UI in Stratum |
| Policy | Local edit permission plus metadata restrictions, native validation and runtime checks | No financial approval or tenant policy engine |
| Run | Prompt, actor, base version, definition snapshots, provider IDs, events, diff, result and validation log | Local JSON persistence, not a distributed job queue |
| Application | Native ObjectStack `app.json` consumed by `defineStack` | No intermediate Stratum application schema |

`StratumIntelligencePlugin` uses the native `defineAgent` schema unchanged and registers `application_builder` under the built-in `agent` type. Custom schemas are limited to `stratum_task`, `stratum_execution_binding` and `stratum_execution_policy`. The published `stratum.intelligence` service resolves these records for each invocation and dispatches the configured implementation. Native fields the local executor cannot enforce are rejected. See [the refactor report](native-agent-refactor.md) for compatibility and verification details.

The builder host has a small ObjectStack kernel with metadata and the integration plugin. Each accepted application version runs in a separate ObjectStack application process. The prompt UI itself is plain HTML/CSS/JavaScript with a small Express API.

## Request path

1. The browser submits a prompt and its current application version. The server supplies the local actor identity and checks edit permission, the version and the single-active-run lock.
2. Stratum resolves the Task, its native Agent, execution binding and policy from ObjectStack metadata. It validates references, required checks and supported settings, then snapshots the definitions. The requested Task/binding/policy versions must match their registered versions; the registry holds one active version per name. It sends the current native `app.json` and `AUTHORING.md` to local HarnessRouter's streamed `POST /api/harness/v1/responses` endpoint.
3. The Codex harness edits files in its HarnessRouter session. Each request starts a fresh harness session; follow-up context comes from the accepted application metadata rather than continuing the provider's conversation.
4. Stratum requires a completed provider response and retrieves only the resulting `app.json` from the session's file API. It does not import a generated server, dependency manifest or executable config.
5. Native ObjectStack parsing and the milestone restrictions check the JSON. Stratum prepares a candidate directory with a fixed trusted config, then runs ObjectStack's own CLI validation.
6. The preview starts, signs in and checks that generated object APIs work and expected seed data is not entirely missing. Only then does the candidate become the current version.

Failures and cancellation are designed to preserve the previous accepted metadata version. Interrupted runs are marked failed after a Stratum restart. A preview restart causes a short interruption; there is no zero-downtime promotion mechanism.

## Evidence from this machine

| Check | Result |
| --- | --- |
| First real provider run | Created Credit Review, four requested fields, list/form definitions and five fictional borrowers |
| Follow-up real provider run | Added required `risk_grade` with Low/Medium/High choices, included it in list/form, and assigned grades to all five sample records |
| Native ObjectStack CLI validation | Passed for both generated versions |
| Previous version | Remained readable after the follow-up |
| First-version browser check | Native list displayed five rows; native create form opened with the requested inputs |
| Current runtime API | Returned the generated records; rejected missing required fields |
| Record operations | Created a temporary credit request, updated it, read the update back, and deleted that record |
| Local API boundaries | Rejected missing session, foreign origin, stale base version and client-supplied actor identity |
| Concurrent editing | Second request rejected while the live follow-up was running |
| Restart | Accepted version, preview sign-in and sample records retained |
| Chrome extension record workflow | Required-field validation, dropdown choices, create, update, separate-tab readback and cleanup passed |
| Third real provider run, submitted through Chrome | Changed only the Notes label to Reviewer notes; list and form reflected it in version 3 |

Recorded successful versions:

- First app: `33f27d29-1b79-4214-a144-befa0b94c6ed`
- Risk-grade follow-up: `e65f2876-1977-41e8-b134-f59dd35eb9aa`
- Browser-submitted label change: `7963de2e-1f9c-4c00-aa35-db10b02ddd6d`

The local `.stratum/state.json` records provider response/session IDs, events, diffs and validation output. Repeat API checks write `test-results/verification.json`. Unit checks exercise real ObjectStack plugin registration, metadata restrictions, authorization, diffs, streamed response parsing, incomplete-stream failure and seed restart rules.

Browser screenshots from version 1 are retained under `docs/screenshots/`. They predate the instruction to use only the ChatGPT browser extension and should not be mistaken for the current UI. Once the extension connected, versions 2 and 3 were verified through Chrome Person 1, using the extension for every browser interaction. See the separate verification report for observed issues and fixes.

## What needed attention

- **Metadata registration has two parts.** Registering a schema alone does not create discoverable Agent/Task instances. The plugin registers both schemas and instances.
- **Objects alone are insufficient for the intended UI.** Explicit list columns and form sections were added to the authoring guidance so new fields appear in the native UI.
- **Seed insertion is not restart-safe.** Early setup exposed duplicate seed attempts. The final template and validator require upsert with a stable external key.
- **Preview sign-in must survive host restarts.** A fresh random password on every Stratum boot conflicted with an existing preview database. The final implementation persists its own local preview credential in a gitignored file with restricted file permissions.
- **A running process is not proof of a working app.** Promotion now checks native object APIs and nonempty expected seed data after startup, in addition to CLI validation.
- **Provider completion is not application correctness.** The response parser rejects an incomplete stream; returned metadata still has to pass independent application checks. Those checks establish structural/runtime validity, not complete business correctness.
- **Polling must preserve interactive UI state.** Changes and Activity now redraw when their contents change, keeping expanded diffs readable between polls. The welcome section collapses after the first request, leaving room for the conversation; detailed harness output is available under Builder notes.
- **A preview needs an owner.** Browser verification found an orphan preview after the Stratum process had stopped. A small parent watcher now stops the preview process group when its owner disappears. Startup also rejects an occupied preview port, preventing a different runtime from being mistaken for the new preview. Both cases have regression tests.

## Boundaries before the next milestone

The current implementation is a single-user local experiment. The fixed local identity and in-process edit lock are not real tenant authorization or distributed concurrency control. JSON run records are useful for debugging but not a tamper-resistant financial audit trail.

Preview data is isolated by version. User-entered records do not move into a new version. Upserted fixtures can reset edits to the sample borrowers when a preview restarts. A production version model must separate metadata releases from business data and introduce migrations and rollback rules.

Native metadata parsing does not prove financial correctness. Requested amounts currently use a generic number field. There are no money/currency invariants, immutable decisions, maker/checker controls, transactional workflow transitions, document provenance or retention rules in this milestone.

Only the returned JSON enters the ObjectStack app. The metadata allow/block rules reduce what the app can express, but they are not a complete security boundary for arbitrary future metadata features. The local harness still executes in its Docker environment and can access the network. Untrusted multi-user builds need dedicated execution isolation, resource limits and an explicit network policy.

Stratum (3000) and HarnessRouter (3100) bind to loopback. The upstream ObjectStack development CLI binds port 3002 on all interfaces. That preview is authenticated but should be isolated before shared use; the present setup has no production TLS/reverse proxy or tenant boundary.

Claude Code is installed in the local HarnessRouter image but was not tested with an Anthropic integration. The real verified path is Codex with OpenAI. Financial workflows, RAG, document ingestion, production deployment and a broader integration registry are outside this first milestone.

The next useful experiment is a small approval workflow with explicit transition rules and durable business records across application revisions. That will test the platform assumptions that a successful metadata-generation demo cannot establish.
