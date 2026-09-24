import { readFile, writeFile } from 'node:fs/promises';
import { HarnessRouter } from '../src/harnessrouter.js';
import { askAgent } from '../src/plugin.js';
import { model } from '../src/config.js';

const router = new HarnessRouter();
const name = 'Stratum app questions';
const catalog = await (await router.request('/v1/harnesses')).json();
const existing = catalog.harnesses.find((h: any) => h.name === name);
const config = {
  name, base: 'codex', default_model: model, system_prompt: askAgent.instructions,
  max_step: 12, timeout_seconds: 180,
  additional_headers: ['X-Stratum-Read-Token'],
  mcp_servers: [{ name: 'objectstack', url: process.env.STRATUM_MCP_URL || 'http://host.docker.internal:3000/api/v1/ai/mcp', transport: 'http', enabled: true, auth: '$headers.X-Stratum-Read-Token' }],
};
const harness = await (await router.request(existing ? `/v1/harnesses/${existing.id}` : '/v1/harnesses', {
  method: existing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
})).json();
const id = existing?.id || harness.id;
if (!id) throw new Error('HarnessRouter did not return a harness ID.');
let env = await readFile('.env', 'utf8');
const line = `HARNESSROUTER_CHAT_HARNESS_ID=${id}`;
env = /^HARNESSROUTER_CHAT_HARNESS_ID=.*$/m.test(env) ? env.replace(/^HARNESSROUTER_CHAT_HARNESS_ID=.*$/m, line) : `${env}\n${line}\n`;
await writeFile('.env', env, { mode: 0o600 });
console.log('App assistant connected to ObjectStack MCP. Restart the app to load the configuration.');
