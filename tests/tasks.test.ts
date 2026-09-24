import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectKernel } from '@objectstack/core';
import { defineAgent } from '@objectstack/spec';
import { StratumIntelligencePlugin, builderAgent, builderTask, builderBinding, builderPolicy, defaultTaskRef } from '../src/plugin.js';
import { IntelligenceService, type ApplicationProject, type Run } from '../src/intelligence.js';
import { HarnessRouter } from '../src/harnessrouter.js';

const context = { actorId: 'local-builder', projectId: 'stratum-demo', canEdit: true };
const input = { taskRef: defaultTaskRef, prompt: 'Change the application name', baseVersion: 'initial' };

class Provider extends HarnessRouter {
  calls: Parameters<HarnessRouter['run']>[0][] = [];
  gate?: Promise<void>;
  waitForAbort = false;
  result = '';
  override async run(args: Parameters<HarnessRouter['run']>[0]) {
    this.calls.push(args);
    if (this.waitForAbort) await delay(10000, undefined, { signal: args.signal });
    await this.gate;
    const current = JSON.parse(args.files.find(file => file.name === 'app.json')!.content);
    current.manifest.name = `Registry-driven app ${this.calls.length}`;
    this.result = JSON.stringify(current);
    return { id: 'test-response', metadata: { session_id: 'test-session' }, output: [] };
  }
  override async appFile() { return this.result; }
  override async cancel() {}
}

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'stratum-native-agent-'));
  const metadata = new MetadataManager({ formats: ['json'] });
  const provider = new Provider();
  const project: ApplicationProject = {
    ready: false, url: 'http://127.0.0.1/test-preview',
    directory: version => join(dir, 'versions', version),
    async prepare(version, text) {
      const path = this.directory(version); await mkdir(path, { recursive: true });
      await writeFile(join(path, 'app.json'), text); return path;
    },
    async validate() { return 'CLI validation test double'; },
    async start(version) { this.current = version; this.ready = true; },
    async verify() {}, async login() { return []; }, async stop() { this.ready = false; },
  };
  const service = new IntelligenceService(metadata, project, provider, dir);
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false, logger: { level: 'error' } });
  kernel.registerService('metadata', metadata);
  await kernel.use(new StratumIntelligencePlugin(service));
  await kernel.bootstrap();
  await service.init();
  t.after(async () => { await service.shutdown(); await kernel.shutdown(); await rm(dir, { recursive: true, force: true }); });
  return { dir, metadata, provider, project, service };
}
async function finished(run: Run) {
  for (let i = 0; i < 300; i++) {
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) { await delay(20); return; }
    await delay(10);
  }
  assert.fail(`Run did not finish: ${run.status}`);
}

test('execution resolves a different native Agent and binding from the registry, then persists its exact snapshots', async t => {
  const { metadata, provider, service, dir } = await fixture(t);
  const agent = defineAgent({ ...builderAgent, name: 'registry_builder', role: 'Registry-specific author', instructions: 'UNIQUE REGISTRY INSTRUCTIONS' });
  await metadata.register('agent', agent.name, agent);
  await metadata.register('stratum_execution_binding', 'alternate_builder', { ...builderBinding, name: 'alternate_builder', version: '2', harnessId: 'registry-harness', model: 'registry-model' });
  await metadata.register('stratum_task', 'alternate_task', { ...builderTask, name: 'alternate_task', version: '2', agentRef: agent.name, executionBindingRef: 'alternate_builder@2' });
  const run = await service.start({ ...input, taskRef: 'alternate_task@2' }, context);
  await finished(run);
  assert.equal(run.status, 'succeeded', run.error);
  assert.match(provider.calls[0].prompt, /Registry-specific author[\s\S]*UNIQUE REGISTRY INSTRUCTIONS/);
  assert.equal(provider.calls[0].harnessId, 'registry-harness');
  assert.equal(provider.calls[0].model, 'registry-model', 'Omitting a UI model must preserve the registered default');
  assert.deepEqual(run.agent, agent);
  assert.deepEqual(run.checks?.map(check => check.name), ['project_edit_permission', 'objectstack_validation', 'preview_verification']);
  const persisted = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(persisted.runs[0].definitionFormat, 'objectstack-agent');
  assert.deepEqual(persisted.runs[0].agent, agent);
  assert.deepEqual(persisted.runs[0].policy, builderPolicy);
});

test('in-flight runs keep their snapshot while the next run reads changed Agent instructions and explicit model selection', async t => {
  const { metadata, provider, service } = await fixture(t);
  let release!: () => void;
  provider.gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const run = await service.start(input, context);
  await metadata.register('agent', builderAgent.name, { ...builderAgent, instructions: 'UPDATED AFTER START' });
  release(); await finished(run);
  assert.equal(run.status, 'succeeded', run.error);
  assert.equal(run.agent.instructions, builderAgent.instructions);
  assert.ok(!provider.calls[0].prompt.includes('UPDATED AFTER START'));
  const second = await service.start({ ...input, baseVersion: run.id, harnessId: 'selected-harness', model: 'selected-model' }, context);
  await finished(second);
  assert.equal(second.status, 'succeeded', second.error);
  assert.match(provider.calls[1].prompt, /UPDATED AFTER START/);
  assert.equal(provider.calls[1].harnessId, 'selected-harness');
  assert.equal(provider.calls[1].model, 'selected-model');
});

test('invalid Agent/Task references and unsupported controls fail before a provider call', async t => {
  const { metadata, provider, service } = await fixture(t);
  const reject = (pattern: RegExp) => assert.rejects(service.start(input, context), pattern);
  await assert.rejects(service.start({ ...input, taskRef: 'missing_task@1' }, context), /not found/);
  await metadata.register('stratum_task', builderTask.name, { ...builderTask, agentRef: 'missing_agent' });
  await reject(/not found/);
  await metadata.register('stratum_task', builderTask.name, builderTask);
  await metadata.register('agent', builderAgent.name, { ...builderAgent, active: false });
  await reject(/inactive/);
  for (const extra of [{ skills: ['unbound_skill'] }, { permissions: ['admin'] }, { guardrails: { maxExecutionTimeSec: 1 } }]) {
    await metadata.register('agent', builderAgent.name, { ...builderAgent, ...extra });
    await reject(/not supported/);
  }
  await metadata.register('agent', builderAgent.name, builderAgent);
  for (const patch of [
    { checks: [...builderTask.checks, 'invented_check'] },
    { checks: ['project_edit_permission'] },
    { executionBindingRef: 'missing_binding@1' },
    { policyRef: 'missing_policy@1' },
    { implementation: 'constructor' },
    { version: '2' },
  ]) {
    await metadata.register('stratum_task', builderTask.name, { ...builderTask, ...patch });
    await reject(/Unsupported|required|not found|not supported|version/);
  }
  assert.equal(provider.calls.length, 0);
  assert.equal(service.state.runs.length, 0);
});

test('the registered execution timeout aborts the harness and preserves the accepted version', async t => {
  const { metadata, provider, service } = await fixture(t);
  provider.waitForAbort = true;
  await metadata.register('stratum_execution_policy', 'metadata_only', { ...builderPolicy, timeoutMs: 40 });
  const run = await service.start(input, context);
  await finished(run);
  assert.equal(run.status, 'failed');
  assert.match(run.error!, /configured time limit/);
  assert.equal(service.state.currentVersion, 'initial');
});

test('registry I/O cannot allow two simultaneous edits', async t => {
  const { metadata, service } = await fixture(t);
  const get = metadata.get.bind(metadata);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  metadata.get = async (type, name) => { await gate; return get(type, name); };
  const first = service.start(input, context);
  await assert.rejects(service.start(input, context), /already running/);
  release(); const run = await first; await finished(run);
  assert.equal(run.status, 'succeeded', run.error);
  assert.equal(service.state.runs.length, 1);
});

test('restarting preserves old custom-Agent run history without rewriting it as native', async t => {
  const { dir, metadata, project, provider, service } = await fixture(t);
  const legacy = {
    id: '00000000-0000-0000-0000-000000000001', prompt: 'Legacy request', baseVersion: 'initial',
    createdAt: '2026-09-23T00:00:00Z', status: 'succeeded', actorId: 'local-builder',
    agent: { name: 'application_builder', version: '1', instructions: 'Old instructions', executionBindingRef: 'local_builder', policyRef: 'metadata_only' },
    task: { name: 'modify_application', version: '1', agentRef: 'application_builder@1', checks: ['project_edit_permission', 'objectstack_validation'] },
    binding: { provider: 'harnessrouter-local', harnessId: 'codex' }, summary: 'Old result', events: [],
  };
  await service.shutdown();
  await writeFile(join(dir, 'state.json'), JSON.stringify({ currentVersion: legacy.id, runs: [legacy] }));
  const restored = new IntelligenceService(metadata, project, provider, dir);
  await restored.init();
  assert.deepEqual(restored.state.runs, [legacy]);
  assert.equal(restored.state.currentVersion, legacy.id);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).runs, [legacy]);
  await restored.shutdown();
});
