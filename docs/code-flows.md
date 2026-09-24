# Stratum milestone: code flows

This guide follows the current implementation. It connects the Stratum document's Agent and Task concepts to the working application-building loop. The Mermaid diagrams render directly on GitHub.

An example request throughout is: **“Change Reviewer notes to Review notes, keeping everything else unchanged.”** The coding harness edits the native ObjectStack `app.json`; Stratum checks the result and runs it as a candidate application version.

## The concepts used here

| Concept | Meaning in this code |
| --- | --- |
| ObjectStack metadata | Structured definitions of objects, fields, views, navigation and sample data in `app.json`. |
| ObjectStack runtime | The separate process that turns those definitions into the working application, forms and record APIs. |
| Plugin | One Stratum module that registers metadata types, definitions and an execution service in the builder's ObjectStack kernel. |
| Metadata registry | ObjectStack's catalogue of named definitions. The executor reads it through an in-process library call. |
| Agent | ObjectStack's native definition of the builder's identity, role and instructions. |
| Task | Stratum's definition of an operation, linking an Agent, implementation, execution binding, policy and required checks. |
| Execution binding / policy | The binding selects local HarnessRouter, a harness and an optional model. The policy supplies the timeout. |
| Run | One execution attempt, with configuration snapshots, progress, checks, changes and an outcome. |

ObjectStack has **two roles**: its kernel and metadata registry support the Stratum builder, while a separate ObjectStack runtime runs the generated application. Stratum's prompt UI and HTTP API are our own code. Registering a native Agent supplies a definition; Stratum's execution service connects that definition to HarnessRouter.

## 1. Overall request flow

Sources: [browser UI](../public/app.js), [HTTP server](../src/server.ts), [Intelligence service](../src/intelligence.ts), [HarnessRouter client](../src/harnessrouter.ts), [ObjectStack adapter](../src/objectstack.ts).

```mermaid
flowchart TB
    Prompt["User describes an application change"]
    Api["Stratum API: POST /api/tasks<br/>Check local session, origin and request shape"]
    Plan["Stratum: authorize, reserve the execution slot<br/>Check base version and resolve Task definitions"]
    Registry[("ObjectStack metadata registry<br/>Populated by the Stratum plugin")]
    Run["Stratum: save a Run with definition snapshots<br/>Return HTTP 202 and continue in the background"]
    Router["Local HarnessRouter: POST /api/harness/v1/responses<br/>Receive prompt, app.json and AUTHORING.md"]
    Harness["Configured coding harness uses the model provider<br/>Edits app.json in its session"]
    Output["Stratum: require successful provider completion<br/>Retrieve the edited app.json from that session"]
    Validate["Stratum + ObjectStack: check metadata and changes<br/>Write candidate version and run native CLI validation"]
    Preview["ObjectStack runtime: start candidate application<br/>Stratum signs in and checks native record APIs"]
    Accept["Stratum: mark Run succeeded<br/>Set currentVersion to the Run ID and save"]
    Display["UI polls GET /api/state<br/>Fetches metadata and calls POST /api/preview"]
    App["Stratum returns preview URL and sign-in cookies<br/>Browser shows the ObjectStack app in an iframe"]

    Prompt --> Api --> Plan --> Run --> Router --> Harness --> Output
    Registry -. "Definitions read for each request" .-> Plan
    Output --> Validate --> Preview --> Accept --> Display --> App
```

The UI polls Stratum while execution is in progress, so Activity and status updates appear before completion. The chart follows the successful path; the service diagram below shows failure and cancellation.

| Interface | Owner and purpose |
| --- | --- |
| Port 3000: `/api/tasks`, `/api/state`, `/api/metadata`, `/api/registry`, `/api/preview` | Stratum's APIs for building, observing and opening applications. |
| Port 3100: `/api/harness/v1/responses` and session/file endpoints | Local HarnessRouter's APIs for invoking a harness and retrieving its output. |
| Port 3002: `/api/v1/auth/...`, `/api/v1/data/:object` and `/_console/` | The generated application's ObjectStack runtime. |

Once the application is running, ordinary record creation and editing go through ObjectStack's record APIs. They do not invoke HarnessRouter. Local HarnessRouter still calls the configured external model provider for generation.

## 2. Plugin flow: register the building blocks at startup

Source: [src/plugin.ts](../src/plugin.ts), installed by [src/server.ts](../src/server.ts).

```mermaid
flowchart TB
    Host["server.ts creates MetadataManager and IntelligenceService"]
    Recover["service.init: load saved state<br/>Handle interrupted runs and prepare initial template if needed"]
    Kernel["Create builder ObjectKernel<br/>Register the metadata service and install one Stratum plugin"]
    Init["Plugin init"]
    Schemas["Register three Stratum metadata schemas<br/>Task, execution binding and execution policy"]
    Service["Register the existing service instance<br/>Name: stratum.intelligence"]
    Start["Plugin start: obtain the metadata service"]
    Agent["Register native agent: application_builder<br/>Uses ObjectStack defineAgent unchanged"]
    Definitions["Register modify_application Task<br/>local_builder binding and metadata_only policy"]
    Ready["Kernel bootstrap completes<br/>Stratum starts its HTTP server"]

    Host --> Recover --> Kernel --> Init --> Schemas --> Service
    Service --> Start --> Agent --> Definitions --> Ready
```

The plugin runs during startup. It does not execute a model request when it registers the Agent.

| Registered kind | Default name | What it contributes |
| --- | --- | --- |
| Native `agent` | `application_builder` | Builder role, instructions and build surface. |
| `stratum_task` | `modify_application` | Version `1`, Agent reference, `edit_application` handler and required checks. |
| `stratum_execution_binding` | `local_builder` | Version `1`, local provider, harness ID and optional model. |
| `stratum_execution_policy` | `metadata_only` | Version `1` and a 600,000 ms timeout. |

There is one plugin, `com.stratum.intelligence`. The `stratum_*` entries above are metadata types, not separate plugins. There is no custom `stratum_agent` type and no replacement of ObjectStack's Agent schema.

## 3. Task flow: resolve configuration, then dispatch work

Source: [src/tasks.ts](../src/tasks.ts), called by [src/intelligence.ts](../src/intelligence.ts).

```mermaid
flowchart TB
    Request["resolve: receive Task reference and caller context<br/>Default reference: modify_application@1"]
    Auth["Authorize the local builder and project<br/>Validate the reference format"]
    Task["Read stratum_task by name from the registry<br/>Require its version to match the requested reference"]
    Handler["Require a supported implementation<br/>Require each implementation check exactly once"]
    Agent["Read and parse the native Agent<br/>Require matching name, active build surface and supported fields"]
    Binding["Read binding and policy by name<br/>Validate schemas and referenced versions"]
    Select["Apply explicit harness and model selections<br/>Otherwise keep registered defaults"]
    Snapshot["Return a cloned plan<br/>Task + Agent + binding + policy"]
    Caller["IntelligenceService creates the Run<br/>Then calls TaskExecutor.execute"]
    Dispatch["Dispatch by plan.task.implementation"]
    Edit["Current handler: edit_application<br/>Implemented by IntelligenceService.editApplication"]
    Reject["Reject the request before a provider call<br/>No runnable plan is returned"]

    Request --> Auth --> Task --> Handler --> Agent --> Binding --> Select --> Snapshot
    Auth -. "Invalid" .-> Reject
    Task -. "Missing or mismatched" .-> Reject
    Handler -. "Unsupported or invalid checks" .-> Reject
    Agent -. "Missing or unsupported" .-> Reject
    Binding -. "Missing or invalid" .-> Reject
    Snapshot --> Caller --> Dispatch --> Edit
```

`resolve()` determines **what configuration this invocation will use**. `execute()` dispatches to the implementation; it does not itself contain the application-editing logic.

The registry uses names as keys. A reference such as `modify_application@1` means “load `modify_application`, then verify version `1`.” This currently supports one registered definition per name, not multiple simultaneously addressable releases. The native Agent has no extra Stratum version field; its definition is captured in the Run snapshot.

The three required checks are `project_edit_permission`, `objectstack_validation` and `preview_verification`. They are fixed supported checks, not arbitrary executable hooks. Unsupported native Agent settings are rejected rather than silently treated as implemented.

## 4. Intelligence flow: manage one execution from request to result

Source: [src/intelligence.ts](../src/intelligence.ts).

```mermaid
flowchart TB
    Start["start: authorize and reject concurrent edits<br/>Reserve the slot before asynchronous registry reads"]
    Resolve["Require the current baseVersion<br/>Resolve the Task plan"]
    Run["Save queued Run with a new ID<br/>Snapshot definitions and create an AbortController"]
    Background["Start background execution and policy timer<br/>Return Run to the API for HTTP 202"]
    Dispatch["TaskExecutor.execute dispatches edit_application"]
    Permission["Run project_edit_permission check"]
    Generate["Status: running<br/>Send resolved Agent instructions, user request and files<br/>Record provider events, summary and session IDs"]
    Validate["Status: validating<br/>Retrieve app.json and run objectstack_validation<br/>Require a change, prepare files and validate with the CLI"]
    Preview["Status: previewing<br/>Start candidate runtime and run preview_verification"]
    Promote["Check for cancellation<br/>Mark succeeded, update currentVersion and save"]
    Abort["User cancellation or configured timeout<br/>Abort the shared signal"]
    Failure["Execution fails or observes cancellation<br/>Attempt provider cancellation when applicable<br/>Record failed or cancelled status and error"]
    Restore["If the adapter points to this candidate, stop it<br/>Attempt to restart the previous preview if one existed"]
    Finish["Clear timer, save state and release the active slot"]
    Rejected["Return request error<br/>No provider execution starts"]

    Start --> Resolve --> Run --> Background --> Dispatch --> Permission --> Generate --> Validate --> Preview --> Promote --> Finish
    Start -. "Unauthorized or busy" .-> Rejected
    Resolve -. "Stale version or invalid definitions" .-> Rejected
    Background -. "During execution" .-> Abort
    Abort --> Failure
    Dispatch -. "Error" .-> Failure
    Permission -. "Error" .-> Failure
    Generate -. "Error" .-> Failure
    Validate -. "Error" .-> Failure
    Preview -. "Error" .-> Failure
    Failure --> Restore --> Finish
```

The permission check runs before generation. Metadata validation runs after generation. Preview verification runs after the candidate runtime starts. A passed check is recorded with its name and timestamp.

User cancellation produces `cancelled`; a policy timeout produces `failed`. Before promotion, a failed candidate does not replace the accepted version. Restarting the previous preview is **best effort**: the adapter may have already stopped the old process, and recovery can also fail. This is not a guarantee of uninterrupted preview availability.

State is written through a temporary file and renamed to `.stratum/state.json`. On restart, incomplete historical runs are marked failed and provider cancellation is attempted when a response ID is available. They are not automatically resumed. This is local file-backed execution, not a durable distributed job queue.

## 5. ObjectStack adapter flow: turn edited metadata into a checked preview

Source: [src/objectstack.ts](../src/objectstack.ts). Its caller controls the sequence; this file exposes the individual operations.

```mermaid
flowchart TB
    Input["Edited app.json arrives from the Intelligence service"]
    Parse["validateMetadata<br/>Parse JSON and enforce milestone scope<br/>Run native defineStack parsing and reference checks"]
    Diff["IntelligenceService computes changes<br/>Reject an unchanged application"]
    Prepare["prepare<br/>Revalidate and write candidate app.json<br/>Copy trusted config and write pinned dependency metadata"]
    Cli["validate<br/>Run ObjectStack CLI in the candidate directory<br/>Require exit code zero"]
    Start["start<br/>Reuse an already-ready matching version<br/>Otherwise stop the old preview and require a free port"]
    Launch["Launch ObjectStack CLI serve --dev<br/>Use restricted environment and parent-process watcher"]
    Ready["Poll native auth/config endpoint<br/>Require runtime readiness"]
    Login["verify calls login<br/>Sign in using the locally stored preview credential"]
    Data["Read each defined object through native data APIs<br/>Require record arrays and nonempty data when seeds were expected"]
    Return["Return verification success to IntelligenceService<br/>The service decides when to promote the version"]
    Error["Throw an error to the caller<br/>IntelligenceService handles the failed Run and recovery"]

    Input --> Parse --> Diff --> Prepare --> Cli --> Start
    Start -->|"Launch needed"| Launch --> Ready --> Login
    Start -->|"Matching runtime already ready"| Login
    Login --> Data --> Return
    Parse -. "Invalid" .-> Error
    Diff -. "No changes" .-> Error
    Prepare -. "Invalid or write failure" .-> Error
    Cli -. "Failure or timeout" .-> Error
    Start -. "Port occupied or other error" .-> Error
    Ready -. "Process exit, timeout or cancellation" .-> Error
    Login -. "Sign-in failure" .-> Error
    Data -. "API or data-shape failure" .-> Error
```

| Operation | What the current implementation actually checks or does |
| --- | --- |
| `validateMetadata()` | Allows the milestone's native metadata sections and field types; checks project identity and namespace; rejects executable/custom metadata; uses native `defineStack`; checks navigation and seed references; requires stable seed upsert keys. |
| `prepare()` | Creates `.stratum/versions/<run-id>/` containing `app.json`, the trusted `objectstack.config.ts` and dependency metadata. |
| `validate()` | Runs the native CLI validation command with a 90-second timeout. |
| `start()` | Manages the preview process and checks its readiness endpoint. |
| `verify()` | Checks sign-in, object API responses, record-array shape and basic sample-data presence. It does not verify every requested business behaviour or every sample record. |
| `stop()` | Attempts graceful process-group shutdown, then forceful shutdown if needed. The current process handling assumes Unix semantics; native Windows portability work remains. |

The browser's later `POST /api/preview` request calls `start()`, `verify()` and `login()` again, reusing the ready runtime when possible and returning the sign-in cookies and preview URL. This is how the application becomes usable inside the Stratum iframe.

## What these flows prove, and what remains

The implemented loop connects a native Agent definition and Stratum Task to local HarnessRouter, accepts native ObjectStack metadata, checks it and opens a working application preview. No ObjectStack source modification or separate Stratum application format is involved.

The current boundaries remain: one fixed local builder/project context; one editing implementation; no Task invocation from native application workflows; no tenant permission propagation or approval/release governance. Each application version has its own preview database, so business records are not migrated between versions. Native Agent registration does not automatically add those missing execution or governance capabilities.

For implementation history and verification evidence, see [the native Agent refactor](native-agent-refactor.md) and [milestone notes](milestone-1.md).
