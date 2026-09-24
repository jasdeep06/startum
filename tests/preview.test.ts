import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { requireFreePreviewPort } from '../src/objectstack.js';

test('an occupied preview port is rejected instead of accepting another runtime as ready', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  try { await assert.rejects(requireFreePreviewPort(port), /already in use/); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  await requireFreePreviewPort(port);
});

test('the preview guard exits after its owner is killed', { timeout: 15000 }, async () => {
  const guard = fileURLToPath(new URL('../scripts/watch-preview-owner.mjs', import.meta.url));
  const parent = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['--import', ${JSON.stringify(guard)}, '-e', 'console.log("ready");setInterval(()=>{},1000)'], {
      detached: true, env: { ...process.env, STRATUM_PREVIEW_OWNER_PID: String(process.pid) },
      stdio: ['ignore', 'pipe', 'ignore']
    });
    child.stdout.once('data', () => console.log(child.pid));
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let childPid: number | undefined;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const [data] = await once(parent.stdout!, 'data');
    childPid = Number(String(data).trim());
    assert.ok(Number.isInteger(childPid) && childPid > 1);
    await delay(1200);
    assert.ok(alive(childPid), 'Preview should remain alive while the owner runs');
    const exited = once(parent, 'exit');
    parent.kill('SIGKILL');
    await exited;
    for (let i = 0; i < 60 && alive(childPid); i++) await delay(100);
    assert.equal(alive(childPid), false, 'Orphan preview should stop and release its port');
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL');
  }
});
