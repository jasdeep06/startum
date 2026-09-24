import { defineAgent } from '@objectstack/spec';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { registerMetadataTypeSchema } from '@objectstack/spec/kernel';
import { binding } from './config.js';
import { TaskSchema, ExecutionBindingSchema, ExecutionPolicySchema } from './tasks.js';

// Reuse the upstream Agent contract unchanged. Harness settings live in a
// separate Stratum binding instead of being injected into the native schema.
export const builderAgent = defineAgent({
  name: 'application_builder', label: 'Application Builder',
  role: 'ObjectStack application author', surface: 'build',
  instructions: 'Edit the supplied native ObjectStack app.json using AUTHORING.md. Implement the user request in the file, then summarize the changes. Never claim that runtime validation passed; Stratum checks it separately.',
});
export const defaultTaskRef = 'modify_application@1';
export const builderTask = TaskSchema.parse({
  name: 'modify_application', version: '1', agentRef: builderAgent.name,
  implementation: 'edit_application', executionBindingRef: 'local_builder@1',
  policyRef: 'metadata_only@1',
  checks: ['project_edit_permission', 'objectstack_validation', 'preview_verification'],
});
export const builderBinding = ExecutionBindingSchema.parse({ name: 'local_builder', version: '1', ...binding });
export const builderPolicy = ExecutionPolicySchema.parse({ name: 'metadata_only', version: '1', timeoutMs: 600000 });

export class StratumIntelligencePlugin implements Plugin {
  name = 'com.stratum.intelligence';
  version = '0.2.0';
  providesServices = ['stratum.intelligence'];
  constructor(private service: unknown) {}
  async init(ctx: PluginContext) {
    registerMetadataTypeSchema('stratum_task', TaskSchema);
    registerMetadataTypeSchema('stratum_execution_binding', ExecutionBindingSchema);
    registerMetadataTypeSchema('stratum_execution_policy', ExecutionPolicySchema);
    ctx.registerService('stratum.intelligence', this.service);
  }
  async start(ctx: PluginContext) {
    const metadata = ctx.getService<IMetadataService>('metadata');
    await metadata.register('agent', builderAgent.name, builderAgent);
    await metadata.register('stratum_task', builderTask.name, builderTask);
    await metadata.register('stratum_execution_binding', builderBinding.name, builderBinding);
    await metadata.register('stratum_execution_policy', builderPolicy.name, builderPolicy);
  }
}
