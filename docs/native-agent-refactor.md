# Native ObjectStack Agent refactor

> Historical builder milestone at commit `3663945`. Its Task and execution registries have since been removed. See the current [in-app chat integration](app-chat.md).

Date: 2026-09-24. ObjectStack packages remain pinned to 17.4.0.

## What changed

The builder now uses ObjectStack's unchanged `defineAgent` factory and the built-in `agent` metadata kind. The plugin no longer defines, registers or overrides an Agent schema. No ObjectStack package or source code was modified.

Stratum-specific execution configuration remains separate:

| Metadata kind | Registered name | Purpose |
| --- | --- | --- |
| `agent` | `application_builder` | Native identity, role, instructions, build surface and active flag |
| `stratum_task` | `modify_application` | Version, Agent reference, implementation, binding/policy references and required checks |
| `stratum_execution_binding` | `local_builder` | Local HarnessRouter provider, harness and optional default model |
| `stratum_execution_policy` | `metadata_only` | Execution timeout |

`POST /api/tasks` defaults to `modify_application@1`; callers can supply a registered `taskRef`. The executor resolves the Task and all its references through the ObjectStack metadata service. It dispatches the named implementation, currently `edit_application`. It does not import `builderAgent` or `builderTask` directly.

ObjectStack requires a registry key to match `data.name`. References such as `modify_application@1` therefore resolve the name and explicitly verify the registered version. The registry holds one current definition per name; this is not a general repository of multiple concurrently deployable releases. Each invocation snapshots the resolved Agent, Task, binding and policy. The native Agent itself has no added Stratum `version` field.

Instructions and role come from the resolved native Agent. Harness/model defaults come from the resolved binding; explicit UI choices override them. Omitting a model preserves the registered default. Timeout comes from the resolved policy. The local HarnessRouter client, metadata validator and preview runtime are reused.

The editing implementation requires `project_edit_permission`, `objectstack_validation` and `preview_verification`. Named checks execute at their appropriate stages and successful checks are recorded in each run. Removing a mandatory check or declaring an unknown one fails before provider execution. This is a fixed set of supported checks, not an arbitrary hook or financial-rule engine.

The single-run reservation now covers asynchronous metadata lookup. A second request cannot slip through while the first is resolving its definitions.

## Compatibility and scope

- Existing application versions and old run records are preserved. Historical custom-Agent snapshots are not rewritten or relabelled. New runs carry `definitionFormat: "objectstack-agent"`.
- A backup of the pre-refactor state and accepted version 4 metadata is stored locally in `.stratum/backups/native-agent-refactor-20260924/`. Its existing preview database remains in its original version directory.
- Only native `name`, `label`, `role`, `instructions`, `surface` and `active` fields are accepted by this local executor. It requires an active build-surface Agent. Unsupported native options, including Skills, permissions, model configuration and experimental guardrails, are rejected explicitly rather than silently ignored. Model selection is configured through the execution binding/UI.
- The plugin is installed in the builder host. It does not add arbitrary Agents to the generated application's Studio catalogue, implement native Skill-to-harness tool restrictions, or expose Tasks from application workflows yet.
- User authorization remains the existing single local builder/project check. This refactor does not implement tenant identity propagation, durable distributed jobs, business-record migrations or production governance.
- The application JSON still uses ObjectStack's native format. No alternate Stratum application format was introduced. The existing generated-metadata allowlist remains unchanged.

## Verification

- `npm test`: 15 tests passed, including six new registry/execution regression tests.
- `npm run typecheck`: passed.
- `npm run verify`: 11 real HTTP checks passed after restart, including native Agent registration, unknown-Task rejection and native ObjectStack create/read/update/delete checks. Temporary API test data was removed.
- Chrome Person 1 was controlled through the connected extension, with no Playwright or AppleScript browser automation.
- Restart retained all four existing requests and accepted version 4 (`b7219f57-23a2-42d8-ba18-813f6e644266`).
- A real browser-submitted request through local HarnessRouter changed Reviewer notes to Review notes. Version 5 (`da6a7b21-d570-4a7a-a0ce-e0770f9998c3`) passed all three named checks and retained provider response/session IDs.
- Browser verification showed the changed label in both the table and create form, five fictional borrowers, disabled prompt controls while building, Activity progress and an expanded Changes diff. Empty form submission was rejected for Borrower, Requested amount and Risk grade. Risk-grade choices remained Low, Medium and High.
- A full JSON comparison against the pre-refactor backup proved version 5 changed only `/objects/0/fields/notes/label`; every other metadata value, including the red-font configuration and seed records, was identical.
- A second browser-submitted request restored the original label in version 6 (`00a95cba-1509-48a2-868a-e847f8f6d1d6`). It passed all three named checks and changed only the label back. The final application metadata is structurally identical to the pre-refactor version 4 backup. All four older run records are unchanged.
- A final page reload retained all six history entries and re-opened the authenticated version 6 preview. The Chrome accessibility tree showed Reviewer notes and five records; the screenshot confirmed the existing red accents and borrower links.
- The machine-readable result is in `test-results/native-agent-refactor.json`.

## Code map

- `src/plugin.ts`: native Agent definition, Stratum execution definitions and registration.
- `src/tasks.ts`: reference/version resolution, supported-setting checks and implementation dispatch.
- `src/intelligence.ts`: run snapshots, configured timeout, builder handler and named checks.
- `src/server.ts`: shared metadata service and registry/API exposure.
- `tests/tasks.test.ts`: real metadata registry with a simulated harness and preview, testing changes reaching execution, snapshot isolation, rejection paths, timeout, concurrency and historical compatibility.
- `tests/core.test.ts`: verifies the native schema remains unchanged and no custom Agent is registered.
