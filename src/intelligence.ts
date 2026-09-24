import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, stateDir } from './config.js';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { TaskExecutor, authorize, type Context, type ResolvedTask } from './tasks.js';
import { HarnessRouter } from './harnessrouter.js';
import { ObjectStackProject, validateMetadata } from './objectstack.js';

export { authorize } from './tasks.js';
export type { Context } from './tasks.js';
// Older runs retain their original snapshots; never relabel their historical
// custom definitions as native Agents during this refactor.
type LegacyAgent = { name: string; version: string; instructions: string; executionBindingRef: string; policyRef: string };
type LegacyTask = { name: string; version: string; agentRef: string; checks: string[] };
export type Run = {
  id: string; prompt: string; baseVersion: string; createdAt: string;
  status: 'queued' | 'running' | 'validating' | 'previewing' | 'succeeded' | 'failed' | 'cancelled';
  actorId: string; agent: ResolvedTask['agent'] | LegacyAgent; task: ResolvedTask['task'] | LegacyTask;
  definitionFormat?: 'objectstack-agent'; policy?: ResolvedTask['policy'];
  checks?: { name: string; at: string }[];
  binding: { harnessId: string; model?: string; provider: string };
  responseId?: string; sessionId?: string; summary: string;
  events: { at: string; message: string }[]; validation?: string; error?: string;
  changes?: { path: string; before: unknown; after: unknown }[];
};
export type State = { currentVersion: string; runs: Run[] };
export type ApplicationProject = Pick<ObjectStackProject, 'ready' | 'current' | 'url' | 'directory' | 'prepare' | 'validate' | 'start' | 'verify' | 'login' | 'stop'>;
export function changes(before: any, after: any, path = ''): NonNullable<Run['changes']> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [{ path: path || '/', before: before ?? null, after: after ?? null }];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changes(before[key], after[key], `${path}/${key}`));
}

export class IntelligenceService {
  state: State = { currentVersion: 'initial', runs: [] };
  private active?: { run: Run; controller: AbortController };
  private starting = false;
  private saving = Promise.resolve();
  private execution?: Promise<void>;
  private executor: TaskExecutor<{ run: Run; context: Context; signal: AbortSignal }, void>;
  constructor(metadata: IMetadataService, public project: ApplicationProject = new ObjectStackProject(), private provider = new HarnessRouter(), private storageDir = stateDir) {
    this.executor = new TaskExecutor(metadata, {
      edit_application: {
        requiredChecks: ['project_edit_permission', 'objectstack_validation', 'preview_verification'],
        execute: (plan, input) => this.editApplication(plan, input.run, input.context, input.signal),
      },
    });
  }
  async init() {
    await mkdir(this.storageDir, { recursive: true });
    try { this.state = JSON.parse(await readFile(join(this.storageDir, 'state.json'), 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    for (const run of this.state.runs) if (!['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      if (run.responseId) await this.provider.cancel(run.responseId).catch(() => {});
      run.status = 'failed'; run.error = 'Stratum restarted before this run completed. The previous version was preserved.';
    }
    if (this.state.currentVersion === 'initial') await this.project.prepare('initial', await readFile(join(root, 'template/app.json'), 'utf8'));
    await this.save();
  }
  private save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.then(async () => {
      await writeFile(join(this.storageDir, 'state.json.tmp'), snapshot, { mode: 0o600 });
      await rename(join(this.storageDir, 'state.json.tmp'), join(this.storageDir, 'state.json'));
    });
    return this.saving;
  }
  async metadata(version = this.state.currentVersion) {
    if (version !== 'initial' && !this.state.runs.some(r => r.id === version && r.status === 'succeeded')) throw Object.assign(new Error('Version not found.'), { status: 404 });
    return JSON.parse(await readFile(join(this.project.directory(version), 'app.json'), 'utf8'));
  }
  async start(input: { taskRef: string; prompt: string; baseVersion: string; harnessId?: string; model?: string }, context: Context) {
    authorize(context);
    if (this.active || this.starting) throw Object.assign(new Error('A change is already running. Wait or stop it before starting another.'), { status: 409 });
    // Registry reads await I/O; reserve the slot before resolving definitions.
    this.starting = true;
    try {
      if (input.baseVersion !== this.state.currentVersion) throw Object.assign(new Error('The application changed. Refresh and try again.'), { status: 409 });
      const plan = await this.executor.resolve(input.taskRef, context, input);
      const run: Run = {
        id: randomUUID(), prompt: input.prompt, baseVersion: input.baseVersion,
        createdAt: new Date().toISOString(), status: 'queued', actorId: context.actorId,
        definitionFormat: 'objectstack-agent',
        agent: structuredClone(plan.agent), task: structuredClone(plan.task), policy: structuredClone(plan.policy),
        binding: structuredClone(plan.binding), summary: '', events: [], checks: [],
      };
      const controller = new AbortController(); this.active = { run, controller };
      this.state.runs.push(run);
      await this.save();
      this.execution = this.execute(run, plan, structuredClone(context), controller).finally(() => { if (this.active?.run.id === run.id) this.active = undefined; });
      return run;
    } finally { this.starting = false; }
  }
  private async note(run: Run, message: string) {
    run.events.push({ at: new Date().toISOString(), message });
    if (run.events.length > 100) run.events.shift();
    await this.save();
  }
  private async execute(run: Run, plan: ResolvedTask, context: Context, controller: AbortController) {
    const timer = setTimeout(() => controller.abort(new Error('The task reached its configured time limit.')), plan.policy.timeoutMs);
    const signal = controller.signal;
    try {
      await this.executor.execute(plan, { run, context, signal });
    } catch (error: any) {
      if (run.responseId && (signal.aborted || run.status === 'running')) await this.provider.cancel(run.responseId).catch(() => {});
      run.status = signal.aborted && controller.signal.reason === 'user' ? 'cancelled' : 'failed';
      run.error = String(signal.aborted ? controller.signal.reason?.message || 'Stopped by you.' : error.message).slice(-18000);
      await this.note(run, run.status === 'cancelled' ? 'Stopped. Your previous application is preserved.' : 'The change was not applied. Your previous application is preserved.');
      if (this.project.current === run.id) {
        await this.project.stop();
        if (run.baseVersion !== 'initial') await this.project.start(run.baseVersion).catch(() => {});
      }
    } finally { clearTimeout(timer); await this.save(); }
  }
  private async check(plan: ResolvedTask, run: Run, name: string, action: () => unknown | Promise<unknown>) {
    if (!plan.task.checks.includes(name)) throw new Error(`Task is missing required check '${name}'.`);
    await action();
    run.checks!.push({ name, at: new Date().toISOString() });
    await this.save();
  }
  private async editApplication(plan: ResolvedTask, run: Run, context: Context, signal: AbortSignal) {
    await this.check(plan, run, 'project_edit_permission', () => authorize(context));
    signal.throwIfAborted();
    run.status = 'running'; await this.note(run, 'Sending your current application to the local builder.');
    const before = await this.metadata(run.baseVersion);
    const response = await this.provider.run({
      runId: run.id, harnessId: run.binding.harnessId, model: run.binding.model, signal,
      prompt: `Role: ${plan.agent.role}\n\n${plan.agent.instructions}\n\nRead the supplied AUTHORING.md and edit app.json.\n\nUser request:\n${run.prompt}`,
      files: [
        { name: 'app.json', content: JSON.stringify(before, null, 2) },
        { name: 'AUTHORING.md', content: await readFile(join(root, 'template/AUTHORING.md'), 'utf8') },
      ],
      onEvent: async event => {
        if (event.response?.id) run.responseId = event.response.id;
        if (event.response?.metadata?.session_id) run.sessionId = event.response.metadata.session_id;
        if (event.type === 'response.output_text.delta') run.summary = (run.summary + (event.delta || '')).slice(-12000);
        if (event.type === 'response.created') await this.note(run, 'The coding harness is working in its local session.');
        else if (event.type === 'response.output_item.added' && event.item?.type !== 'message') await this.note(run, `Builder activity: ${event.item?.type || 'working'}`);
        else await this.save();
      },
    });
    signal.throwIfAborted();
    run.responseId = response.id; run.sessionId = response.metadata?.session_id || run.sessionId;
    const finalText = response.output?.filter((item: any) => item.type === 'message')
      .flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text')
      .map((item: any) => item.text).join('\n\n');
    if (finalText) run.summary = finalText.slice(-12000);
    if (!run.sessionId) throw new Error('HarnessRouter did not return a session ID for the generated files.');
    run.status = 'validating'; await this.note(run, 'Checking the generated application with ObjectStack.');
    const text = await this.provider.appFile(run.sessionId, signal);
    await this.check(plan, run, 'objectstack_validation', async () => {
      const after = validateMetadata(text);
      run.changes = changes(before, after);
      if (!run.changes.length) throw new Error('The harness returned an unchanged application. No new version was published.');
      await this.project.prepare(run.id, JSON.stringify(after, null, 2));
      run.validation = await this.project.validate(run.id, signal);
    });
    signal.throwIfAborted();
    run.status = 'previewing'; await this.note(run, 'Validation passed. Starting the application preview.');
    await this.project.start(run.id, signal);
    await this.check(plan, run, 'preview_verification', () => this.project.verify());
    signal.throwIfAborted();
    run.status = 'succeeded'; this.state.currentVersion = run.id;
    await this.note(run, 'Your new application version is ready.');
  }
  async cancel(id: string, context: Context) {
    authorize(context);
    if (this.active?.run.id !== id) throw Object.assign(new Error('This task is not running.'), { status: 409 });
    this.active.controller.abort('user');
    if (this.active.run.responseId) await this.provider.cancel(this.active.run.responseId).catch(() => {});
  }
  async shutdown() {
    if (this.active) await this.cancel(this.active.run.id, { actorId: 'local-builder', projectId: 'stratum-demo', canEdit: true });
    await this.execution;
    await this.project.stop();
    await this.saving;
  }
}
