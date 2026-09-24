# Code flows: in-app questions

## Registration

```mermaid
flowchart TD
 A[ObjectStack CLI loads objectstack.config.ts] --> B[Read native app.json]
 B --> C[DefaultDatasourcePlugin opens persistent SQLite]
 B --> D[StratumChatPlugin.init]
 D --> E[Register stratum.chat service]
 D --> F[Mount native-console-compatible endpoints on http.server]
 D --> G[Mount read-only MCP gateway]
 D --> J[Mount chat UI assets and console HTML middleware]
 B --> H[StratumChatPlugin.start]
 H --> I[Register native Agent ask in ObjectStack metadata]
```

## A question

```mermaid
sequenceDiagram
 participant U as Native ObjectStack chat
 participant P as src/plugin.ts
 participant S as src/conversations.ts
 participant H as src/harnessrouter.ts
 participant G as src/read-mcp.ts
 participant O as ObjectStack native MCP
 U->>P: POST /api/v1/ai/agents/ask/chat
 P->>P: Verify ObjectStack session, origin and input
 P->>S: Load conversation owned by this user
 P->>G: Issue temporary read capability
 P->>H: Question + server-owned recent history + read token
 H->>H: POST local /api/harness/v1/responses
 H->>G: Harness calls configured MCP tools
 G->>G: Reject writes, actions and objects outside this app
 G->>O: Forward allowed call with user's cookie
 O-->>G: Permission-checked live records / aggregates
 G-->>H: Tool result
 H-->>P: Completed agent answer
 P->>S: Persist question and final answer
 P-->>U: Native UI message stream
 P->>G: Revoke read token
```

The chat adapter uses ObjectStack's public HTTP-server service. There is no independent web server or frontend build. `src/chat-ui.ts` adds the small `ui/chat-drawer.js` and CSS presentation adapter to the stock console; native chat continues to own conversations, the composer and transport. HarnessRouter uses a fresh sandbox per turn, with recent conversation text supplied by the server. This avoids carrying credentials from a previous turn's workspace forward.

## Drawer presentation

```mermaid
flowchart TD
 A[Browser requests the ObjectStack console] --> B[src/chat-ui.ts adds the local JS and CSS assets]
 B --> C[ui/chat-drawer.js adds Ask Stratum to the app header]
 C --> D[Button opens the existing native chat dock]
 D --> E[CSS presents the dock as a right-hand drawer]
 E --> F[Add app scope, read-only badge and suggested questions]
 F --> G[Suggestion fills the native composer]
 G --> H[Native Send invokes the existing chat endpoint]
```

This adapter targets the pinned console DOM. It uses the server's public HTTP service, but the browser selectors are not a public frontend extension contract. Revalidate the presentation after a console upgrade. [Screenshots](screenshots.md) show the current desktop and mobile result.

## Read boundary

```mermaid
flowchart TD
 A[MCP request from harness] --> B{Valid unexpired token?}
 B -->|No| X[Refuse]
 B -->|Yes| C{Permitted read tool and app object?}
 C -->|No| X
 C -->|Yes| D[Native ObjectStack MCP call under original user session]
 D --> E{Native permissions allow access?}
 E -->|No| X
 E -->|Yes| F[Return records or aggregate]
```

The harness sees `list_objects`, `describe_object`, `query_records`, `get_record` and `aggregate_records`. It does not receive the login cookie or a write-capable app API key. The native MCP endpoint still serves the framework's broader capabilities to independently authorised clients; this assistant receives only the restricted gateway credential.
