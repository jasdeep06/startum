import { readFile, writeFile } from 'node:fs/promises';
import { HarnessRouter } from '../src/harnessrouter.js';
import { builderAgent } from '../src/plugin.js';

const router = new HarnessRouter();
const catalog = await router.catalog();
const name = 'Stratum application builder v1';
let harness = catalog.harnesses.find((h: any) => h.name === name);
if (!harness) harness = await (await router.request('/v1/harnesses', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name, base: 'codex', default_model: 'gpt-5.4-mini',
    system_prompt: builderAgent.instructions, max_step: 20, timeout_seconds: 300 }),
})).json();
let env = await readFile('.env', 'utf8');
env = env.replace(/^HARNESSROUTER_HARNESS_ID=.*$/m, `HARNESSROUTER_HARNESS_ID=${harness.id}`);
await writeFile('.env', env, { mode: 0o600 });
console.log(`Local builder configured: ${name}. Restart Stratum to load the binding.`);
