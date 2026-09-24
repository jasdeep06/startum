import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv as parse } from 'node:util';

let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
const set = (key, value) => {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${env}\n${line}\n`;
  writeFileSync('.env', env, { mode: 0o600 });
};
for (const key of ['HR_AUTH_PASSWORD', 'HR_SECRET_KEY']) if (!parse(env)[key]) set(key, randomBytes(32).toString('hex'));
if (!existsSync('.env')) writeFileSync('.env', env, { mode: 0o600 });

if (!process.argv.includes('--connect')) {
  console.log('Local configuration created. Run npm run harness:up, then node scripts/setup.mjs --connect.');
  process.exit(0);
}
const config = parse(env);
const base = config.HARNESSROUTER_BASE_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('This milestone requires local HarnessRouter.');
if (config.HARNESSROUTER_API_KEY) {
  const check = await fetch(`${base}/v1/harnesses`, { headers: { authorization: `Bearer ${config.HARNESSROUTER_API_KEY}` } });
  if (check.ok) { console.log('Existing local HarnessRouter connection verified.'); process.exit(0); }
}
const login = await fetch(`${new URL(base).origin}/api/selfhost/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: config.HR_AUTH_USER, password: config.HR_AUTH_PASSWORD })
});
if (!login.ok) throw new Error('Could not sign in to local HarnessRouter. Check its readiness and the credentials in .env.');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Local HarnessRouter did not issue a session.');
const response = await fetch(`${base}/v1/orgs/local/keys`, {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Stratum local builder', member_id: 'local@localhost', workspace: '', workspace_default: true })
});
if (!response.ok) throw new Error(`Could not create the local integration key (${response.status}).`);
const result = await response.json();
if (!result.key) throw new Error('No integration key returned.');
set('HARNESSROUTER_API_KEY', result.key);
console.log('Stratum connected to local HarnessRouter. Add your provider key in its Integrations screen, then npm run dev.');
