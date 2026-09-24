import 'dotenv/config';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const stateDir = resolve(root, '.stratum');
export const port = Number(process.env.STRATUM_PORT || 3000);
export const previewPort = Number(process.env.PREVIEW_PORT || 3002);
export const origin = `http://127.0.0.1:${port}`;
export const harnessBase = process.env.HARNESSROUTER_BASE_URL || 'http://127.0.0.1:3100/api/harness';
const target = new URL(harnessBase);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.protocol !== 'http:') {
  throw new Error('Use a local HarnessRouter HTTP address. Cloud routing is disabled for this milestone.');
}
export const binding = {
  provider: 'harnessrouter-local' as const,
  harnessId: process.env.HARNESSROUTER_HARNESS_ID || 'codex',
  model: process.env.HARNESSROUTER_MODEL || undefined,
};
