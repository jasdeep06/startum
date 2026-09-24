# Stratum — first milestone

Describe an application, let a coding harness edit its native ObjectStack metadata, and try the result inside Stratum. Follow-up requests produce another validated version.

The working demonstration is **Credit Review**: five fictional borrowers, a list and create/edit forms, followed by a required Low/Medium/High risk grade. The first three real runs through local HarnessRouter and Codex produced the application, added risk grade and renamed Notes to Reviewer notes. See [the implementation notes](docs/milestone-1.md), [browser verification results](docs/browser-verification.md) and [the handoff](docs/browser-handoff.md).

## Open the running application

- **Stratum:** <http://127.0.0.1:3000>
- **Local HarnessRouter console:** <http://127.0.0.1:3100>
- **ObjectStack preview:** launched and signed in through Stratum.

This machine is already configured with a separate OpenAI project named Stratum. Its provider key has a 30-day expiration. It is held by local HarnessRouter, not the browser or source files.

HarnessRouter and its coding harness run locally. Model inference still calls OpenAI and incurs API usage; this is not offline generation.

## Parts

```text
Stratum prompt UI
    → Stratum Task / Agent registry and execution service
    → local HarnessRouter HTTP API → Codex harness → OpenAI
    → edited app.json
    → native ObjectStack validation and runtime check
    → versioned application + embedded ObjectStack Console
```

`app.json` is native ObjectStack metadata. There is no separate Stratum application format. The plugin uses ObjectStack's unchanged `defineAgent` and native `agent` registry. Stratum adds separate Task, execution-binding and execution-policy metadata. Each request resolves these definitions from the registry before invoking local HarnessRouter; there is no `stratum_agent` registration. See [the native Agent refactor](docs/native-agent-refactor.md).

## Set up on another machine

Requirements: Node.js 22 or newer and Docker with Compose running.

```sh
nvm use
npm ci
npm run setup
npm run harness:up
node scripts/setup.mjs --connect
```

Allow HarnessRouter to finish starting before the connect command. In its local console, sign in with `HR_AUTH_USER` and `HR_AUTH_PASSWORD` from your generated `.env`. Add an OpenAI provider integration and map the model you want to use to it. The default builder uses `gpt-5.4-mini`.

```sh
npm run setup:harness
npm run dev
```

Open Stratum at <http://127.0.0.1:3000>. The development command does not watch server files: restart it after changing TypeScript or `.env`.

ObjectStack packages are pinned to 17.4.0; the HarnessRouter image is pinned by digest in `compose.yaml`.

## Try it

First prompt:

> Create an app called Credit Review. Give it a list of credit requests with borrower name, requested amount, review status (New, Under review, Approved) and notes. Add five fictional examples so I can try the list and forms.

Follow-up:

> Add a required Risk grade field to Credit Review, with Low, Medium and High choices. Include it in the list and the form. Give all five existing sample borrowers a risk grade. Keep every existing field and borrower.

These two steps are already complete on the configured machine. You can now describe another change. The Changes, Activity and Metadata tabs show what happened.

## Checks

```sh
npm test
npm run typecheck
npm run verify
```

`verify` needs Stratum running. It checks API access, metadata registration, version conflicts, and the current preview; for Credit Review it also creates, updates, reads and removes a temporary record. It does not call the model.

`npm run verify:live` performs one stage of the two-prompt scenario above through the real provider and costs API usage. Use it once on an empty project and once on the first Credit Review version. It refuses another paid run once the risk-grade stage is present. Use the UI for further changes.

## Files and local state

| File | Responsibility |
| --- | --- |
| `src/plugin.ts` | Native Agent definition and ObjectStack plugin registration |
| `src/tasks.ts` | Stratum execution schemas, registry resolution, version checks and implementation dispatch |
| `src/intelligence.ts` | Permission check, run lifecycle, snapshots, promotion and failure handling |
| `src/harnessrouter.ts` | Local endpoint client, streamed events, generated-file retrieval |
| `src/objectstack.ts` | Metadata checks, native CLI validation, preview and runtime checks |
| `src/server.ts` | Small local API and browser session |
| `public/` | Prompt, activity, changes and embedded preview UI |
| `template/` | Native ObjectStack starting definition and authoring instructions |

Generated versions and run history live in `.stratum/`. Local integration credentials live in `.env`. Provider configuration and harness sessions live in the Docker volume. These are separate stores; back up all of them if you need to preserve this local setup. Never commit `.env`, `.stratum/`, or a Docker volume export.

Stop Stratum with Ctrl+C and stop HarnessRouter with `npm run harness:down`. The named Docker volume is retained.

## Scope

This demonstrates integration, not a financial-services production platform. It supports one local builder and one project, native objects, views, app navigation and fictional seed data. Preview databases belong to individual versions; records entered in a preview are not migrated to the next version. Seed records are upserted on restart and can overwrite edits to those sample records.

Stratum and HarnessRouter listen on loopback. The upstream ObjectStack development server currently listens on all interfaces on port 3002; authenticated preview access does not make that a production deployment. Network isolation, real user and tenant authorization, durable job execution, data migrations, approval policies and financial controls remain future work.

Chrome extension verification passed for required fields, dropdown choices, creating/editing/reading/deleting a temporary record, Open app, Changes, Activity, Metadata and a complete prompt-to-preview update. Those initial results cover **version 3**. The subsequent native Agent refactor and its verification are recorded in [the refactor report](docs/native-agent-refactor.md). This verifies the tested prototype workflows, not the production controls listed above.
