import 'dotenv/config';
import { resolve } from 'node:path';

// ObjectStack bundles config imports, so module paths do not locate the project.
export const root = resolve(process.cwd());
export const origin = process.env.OS_AUTH_URL || 'http://127.0.0.1:3000';
export const harnessBase = process.env.HARNESSROUTER_BASE_URL || 'http://127.0.0.1:3100/api/harness';
for (const address of [origin, harnessBase]) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('This milestone requires local ObjectStack and HarnessRouter addresses.');
  }
}
export const model = process.env.HARNESSROUTER_MODEL || 'gpt-5.4-mini';
