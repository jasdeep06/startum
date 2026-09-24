import { defineStack } from '@objectstack/spec';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { root, stateDir, previewPort } from './config.js';

export function validateMetadata(text: string) {
  const raw = JSON.parse(text);
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('app.json must be an ObjectStack definition.');
  const allowed = new Set(['manifest', 'objects', 'views', 'apps', 'data']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`This milestone does not support ${key}. Only native objects, app navigation and sample data are enabled.`);
  if (raw.manifest?.id !== 'stratum-demo' || raw.manifest?.namespace !== 'stratum_demo') throw new Error('Keep the project identity stratum-demo / stratum_demo.');
  const allowedFields = new Set(['text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'email', 'phone', 'lookup']);
  for (const object of raw.objects || []) {
    if (!object.name?.startsWith('stratum_demo_')) throw new Error('Object names must start with stratum_demo_.');
    for (const field of Object.values(object.fields || {}) as any[]) {
      if (!allowedFields.has(field.type)) throw new Error(`Field type ${field.type} is outside this milestone.`);
    }
  }
  const blocked = new Set(['script', 'hooks', 'handlers', 'plugins', 'devPlugins', 'connectors', 'apis', 'body', 'code', 'component', 'renderer', 'html']);
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (blocked.has(key)) throw new Error(`Executable/custom metadata (${key}) is disabled in this milestone.`);
      walk(item);
    }
  };
  walk(raw);
  // Authoritative native ObjectStack parsing, not a substitute Stratum app schema.
  defineStack(raw);
  const names = new Set((raw.objects || []).map((o: any) => o.name));
  for (const app of raw.apps || []) for (const item of app.navigation || []) {
    if (item.type !== 'object' || !names.has(item.objectName)) throw new Error('Navigation must reference an object in this application.');
  }
  for (const seed of raw.data || []) {
    if (!names.has(seed.object)) throw new Error(`Sample data references unknown object ${seed.object}.`);
    if (seed.mode !== 'upsert' || !seed.externalId) throw new Error('Sample data must use upsert with a stable externalId so restarts do not duplicate records.');
  }
  return raw;
}

const cli = join(root, 'node_modules/@objectstack/cli/bin/run.js');
export async function requireFreePreviewPort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Preview port ${port} is already in use. Stop the existing preview or choose another PREVIEW_PORT, then restart Stratum.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}
export class ObjectStackProject {
  private child?: ChildProcess;
  private log = '';
  private password: string;
  ready = false;
  current?: string;
  url = `http://127.0.0.1:${previewPort}/_console/`;

  constructor() {
    mkdirSync(stateDir, { recursive: true });
    const path = join(stateDir, 'preview-password');
    if (!existsSync(path)) writeFileSync(path, randomBytes(24).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.password = readFileSync(path, 'utf8');
  }

  directory(version: string) {
    if (!/^(initial|[a-f0-9-]{36})$/.test(version)) throw new Error('Invalid version ID.');
    return join(stateDir, 'versions', version);
  }
  async prepare(version: string, text: string) {
    validateMetadata(text);
    const dir = this.directory(version);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'app.json'), text);
    await copyFile(join(root, 'template/objectstack.config.ts'), join(dir, 'objectstack.config.ts'));
    // Host resolution is intentionally anchored to a package with pinned dependencies.
    const dependencies = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies;
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'stratum-demo', type: 'module', private: true, dependencies }, null, 2));
    return dir;
  }
  async validate(version: string, signal?: AbortSignal): Promise<string> {
    const dir = this.directory(version);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'validate'], { cwd: dir, env: this.env(), signal });
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('ObjectStack validation timed out.')); }, 90000);
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => { output = (output + b).slice(-24000); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`ObjectStack validation failed:\n${output}`)); });
    });
  }
  private env() {
    // Do not give the generated application's runtime provider or integration credentials.
    return {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      NODE_ENV: 'development', OS_DATABASE_DRIVER: 'sqlite-wasm',
      OS_SEED_ADMIN_EMAIL: 'builder@stratum.local', OS_SEED_ADMIN_PASSWORD: this.password,
      OS_AUTH_SECRET: this.password, OS_AUTH_URL: `http://127.0.0.1:${previewPort}`,
      OS_TELEMETRY_DISABLED: '1', NO_COLOR: '1',
    };
  }
  async start(version: string, signal?: AbortSignal) {
    if (this.ready && this.current === version) return;
    await this.stop();
    await requireFreePreviewPort(previewPort);
    const definition = JSON.parse(await readFile(join(this.directory(version), 'app.json'), 'utf8'));
    const firstObject = definition.apps?.[0]?.navigation?.[0]?.objectName;
    this.url = `http://127.0.0.1:${previewPort}/_console/` + (firstObject ? `apps/${encodeURIComponent(definition.manifest.id)}/${encodeURIComponent(firstObject)}` : '');
    this.log = ''; this.current = version;
    this.child = spawn(process.execPath, ['--import', join(root, 'scripts/watch-preview-owner.mjs'), cli, 'serve', '--dev', '--port', String(previewPort)], {
      cwd: this.directory(version), env: { ...this.env(), STRATUM_PREVIEW_OWNER_PID: String(process.pid) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const child = this.child;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => { this.log = (this.log + b).slice(-30000); });
    child.on('error', e => { this.log += e.message; this.ready = false; });
    child.on('exit', () => { if (this.child === child) this.ready = false; });
    for (let i = 0; i < 120; i++) {
      signal?.throwIfAborted();
      if (child.exitCode !== null) throw new Error(`ObjectStack could not start:\n${this.log}`);
      try {
        const response = await fetch(`http://127.0.0.1:${previewPort}/api/v1/auth/config`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { this.ready = true; return; }
      } catch {}
      await delay(500, undefined, { signal });
    }
    await this.stop();
    throw new Error(`ObjectStack preview did not become ready:\n${this.log}`);
  }
  async login() {
    if (!this.ready) throw new Error('Preview is not ready.');
    const response = await fetch(`http://127.0.0.1:${previewPort}/api/v1/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${previewPort}` },
      body: JSON.stringify({ email: 'builder@stratum.local', password: this.password }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Preview sign-in failed (${response.status}).`);
    return response.headers.getSetCookie();
  }
  async verify() {
    const definition = JSON.parse(await readFile(join(this.directory(this.current!), 'app.json'), 'utf8'));
    const cookie = (await this.login()).map(s => s.split(';')[0]).join('; ');
    for (const object of definition.objects || []) {
      const response = await fetch(`http://127.0.0.1:${previewPort}/api/v1/data/${encodeURIComponent(object.name)}`, {
        headers: { cookie }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`ObjectStack did not serve the generated ${object.label} object (${response.status}).`);
      const result = await response.json();
      const rows = result.data?.records || result.data?.items || result.data || result.records || result.items;
      if (!Array.isArray(rows)) throw new Error(`Unexpected ObjectStack data response for ${object.name}.`);
      const expected = definition.data?.find((seed: any) => seed.object === object.name)?.records?.length || 0;
      if (expected && !rows.length) throw new Error(`ObjectStack started but sample data for ${object.label} did not load.`);
    }
  }
  async stop() {
    this.ready = false;
    const child = this.child; this.child = undefined;
    if (!child?.pid || child.exitCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await Promise.race([new Promise(r => child.once('exit', r)), delay(4000)]);
    if (child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}
