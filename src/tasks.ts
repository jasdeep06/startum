import { z } from 'zod';
import { defineAgent } from '@objectstack/spec';
import type { IMetadataService } from '@objectstack/spec/contracts';

const name = z.string().regex(/^[a-z_][a-z0-9_]*$/);
const version = z.string().regex(/^\d+(?:\.\d+)*$/);
const ref = z.string().regex(/^[a-z_][a-z0-9_]*@\d+(?:\.\d+)*$/);
export const TaskSchema = z.strictObject({
  name, version, agentRef: name, implementation: name,
  executionBindingRef: ref, policyRef: ref,
  checks: z.array(z.string()).min(1),
});
export const ExecutionBindingSchema = z.strictObject({
  name, version, provider: z.literal('harnessrouter-local'),
  harnessId: z.string().min(1).max(160), model: z.string().min(1).max(160).optional(),
});
export const ExecutionPolicySchema = z.strictObject({
  name, version, timeoutMs: z.number().int().min(1).max(600000),
});
export type TaskDefinition = z.infer<typeof TaskSchema>;
export type ExecutionBinding = z.infer<typeof ExecutionBindingSchema>;
export type ResolvedTask = {
  task: TaskDefinition; agent: ReturnType<typeof defineAgent>;
  binding: ExecutionBinding; policy: z.infer<typeof ExecutionPolicySchema>;
};
export type Context = { actorId: string; projectId: string; canEdit: boolean };
export function authorize(context: Context) {
  if (context.actorId !== 'local-builder' || context.projectId !== 'stratum-demo' || !context.canEdit) {
    throw Object.assign(new Error('You do not have permission to edit this project.'), { status: 403 });
  }
}
function failure(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }

type Handler<Input, Output> = {
  requiredChecks: string[];
  execute: (plan: ResolvedTask, input: Input) => Promise<Output>;
};

// Shared resolution/dispatch; implementations own their domain-specific work.
// The local builder only supports the native fields it actually consumes.
const supportedAgentFields = new Set(['name', 'label', 'role', 'instructions', 'surface', 'active']);
export class TaskExecutor<Input, Output> {
  constructor(private metadata: IMetadataService, private handlers: Record<string, Handler<Input, Output>>) {}

  async resolve(taskRef: string, context: Context, selection: { harnessId?: string; model?: string } = {}): Promise<ResolvedTask> {
    authorize(context);
    ref.parse(taskRef);
    const get = async (type: string, key: string) => {
      const value = await this.metadata.get(type, key);
      if (!value) failure(`Registered ${type} '${key}' was not found.`, 404);
      return value;
    };
    // ObjectStack keys items by their exact name. Resolve the requested version
    // against the registered definition, then snapshot it for this invocation.
    const task = TaskSchema.parse(await get('stratum_task', taskRef.split('@')[0]));
    if (`${task.name}@${task.version}` !== taskRef) failure('Task reference does not match its registered version.');
    const handler = Object.hasOwn(this.handlers, task.implementation) ? this.handlers[task.implementation] : undefined;
    if (!handler) failure(`Task implementation '${task.implementation}' is not supported.`);
    const unknown = task.checks.filter(check => !handler.requiredChecks.includes(check));
    if (unknown.length) failure(`Unsupported task checks: ${unknown.join(', ')}.`);
    if (new Set(task.checks).size !== task.checks.length || handler.requiredChecks.some(check => !task.checks.includes(check))) {
      failure('Task must include each required implementation check exactly once.');
    }
    const agent = defineAgent(await get('agent', task.agentRef) as Parameters<typeof defineAgent>[0]);
    if (agent.name !== task.agentRef) failure('Agent reference does not match its registered name.');
    if (!agent.active) failure(`Agent '${agent.name}' is inactive.`, 403);
    if (agent.surface !== 'build') failure('The local builder requires a build-surface Agent.');
    for (const key of Object.keys(agent)) {
      if (!supportedAgentFields.has(key)) failure(`Native Agent field '${key}' is not supported by the local builder executor yet.`);
    }
    const configuredBinding = ExecutionBindingSchema.parse(await get('stratum_execution_binding', task.executionBindingRef.split('@')[0]));
    const policy = ExecutionPolicySchema.parse(await get('stratum_execution_policy', task.policyRef.split('@')[0]));
    if (`${configuredBinding.name}@${configuredBinding.version}` !== task.executionBindingRef) failure('Execution binding reference does not match its registered version.');
    if (`${policy.name}@${policy.version}` !== task.policyRef) failure('Execution policy reference does not match its registered version.');
    const binding = ExecutionBindingSchema.parse({ ...configuredBinding,
      ...(selection.harnessId ? { harnessId: selection.harnessId } : {}),
      ...(selection.model ? { model: selection.model } : {}),
    });
    return structuredClone({ task, agent, binding, policy });
  }

  async execute(plan: ResolvedTask, input: Input): Promise<Output> {
    const handler = Object.hasOwn(this.handlers, plan.task.implementation) ? this.handlers[plan.task.implementation] : undefined;
    if (!handler) failure(`Task implementation '${plan.task.implementation}' is not supported.`);
    return handler.execute(plan, input);
  }
}
