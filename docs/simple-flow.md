# Simple flow: talking to the app

```mermaid
flowchart TD
 A[Declare the Credit Review app in app.json] --> B[Register StratumChatPlugin in objectstack.config.ts]
 B --> C[ObjectStack serves its console, sign-in, data and MCP]
 C --> L[Plugin loads the small drawer presentation adapter]
 L --> D[User clicks Ask Stratum and sends a question]
 D --> E[Plugin verifies the session and conversation owner]
 E --> F[Issue a temporary read-only token for this turn]
 F --> G[Call local HarnessRouter with the question and saved conversation]
 G --> H[Harness discovers and queries data through ObjectStack MCP]
 H --> I[ObjectStack applies the user's permissions to live records]
 I --> J[Plugin returns the final answer with a source link]
 J --> K[Save the conversation and revoke the temporary token]
```

We created `com.stratum.app-chat` because ObjectStack provides the app UI and MCP data tools, while local HarnessRouter needs an adapter to power the existing chat. Registering it in `objectstack.config.ts` puts that adapter inside the app's runtime.

The native Agent is `ask`, defined with `defineAgent`. It describes the assistant's role and instructions. `StratumChatPlugin` supplies the execution integration. `ReadOnlyMcp` permits only the five read tools and forwards them to native `/api/v1/mcp` with the authenticated caller's cookie, kept server-side.

For the UI, the same plugin calls `mountChatUi` in `src/chat-ui.ts`. It serves `ui/chat-drawer.js` and `ui/chat-drawer.css` through ObjectStack's HTTP server. These add the top-bar button and decorate the existing native chat as a drawer. They reuse its composer, messages and history; they do not create another chat backend. See [screenshots](screenshots.md).

A question is a conversation turn. The previous builder's custom Task/binding/policy registry, file editing, version promotion and preview management have been removed. This milestone does not claim to implement the broader Stratum Task system.
