import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ObjectKernel } from '@objectstack/core';
import { MetadataManager } from '@objectstack/metadata';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { StratumIntelligencePlugin, builderAgent } from '../src/plugin.js';
import { validateMetadata } from '../src/objectstack.js';
import { authorize, changes } from '../src/intelligence.js';
import { parseSse, HarnessRouter } from '../src/harnessrouter.js';

test('plugin reuses the native Agent schema and registers separate Stratum execution metadata', async () => {
  const nativeSchema = getMetadataTypeSchema('agent');
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false, logger: { level: 'error' } });
  const metadata = new MetadataManager({ formats: ['json'] });
  const execution = { marker: 'execution' };
  kernel.registerService('metadata', metadata);
  await kernel.use(new StratumIntelligencePlugin(execution));
  await kernel.bootstrap();
  assert.equal(kernel.getService('stratum.intelligence'), execution);
  assert.deepEqual((await metadata.getRegisteredTypes()).sort(), ['agent', 'stratum_execution_binding', 'stratum_execution_policy', 'stratum_task']);
  assert.deepEqual(await metadata.get('agent', 'application_builder'), builderAgent);
  assert.equal(await metadata.get('stratum_agent', 'application_builder'), undefined);
  assert.equal(getMetadataTypeSchema('agent'), nativeSchema, 'Native schema must not be replaced or extended');
  assert.ok(nativeSchema?.safeParse(builderAgent).success);
  assert.equal(nativeSchema?.safeParse({ ...builderAgent, executionBindingRef: 'local_builder' }).success, false);
  assert.ok(getMetadataTypeSchema('stratum_task'));
  await kernel.shutdown();
});
test('native ObjectStack parsing accepts the template and rejects malformed metadata', async () => {
  const raw = JSON.parse(await readFile(new URL('../template/app.json', import.meta.url), 'utf8'));
  assert.equal(validateMetadata(JSON.stringify(raw)).manifest.id, 'stratum-demo');
  assert.throws(() => validateMetadata(JSON.stringify({ ...raw, plugins: [] })), /does not support/);
  assert.throws(() => validateMetadata(JSON.stringify({ ...raw, objects: [{ name: 'other_tenant_object', fields: {} }] })), /must start/);
  assert.throws(() => validateMetadata(JSON.stringify({ ...raw, objects: [{ name: 'stratum_demo_test', fields: { name: { type: 'arbitrary-code' } } }] })), /outside/);
  assert.throws(() => validateMetadata(JSON.stringify({ ...raw, objects: [{ name: 'stratum_demo_test', fields: { name: { type: 'text', hooks: [] } } }] })), /disabled/);
});
test('project authorization refuses read-only and foreign project callers', () => {
  assert.doesNotThrow(() => authorize({ actorId: 'local-builder', projectId: 'stratum-demo', canEdit: true }));
  assert.throws(() => authorize({ actorId: 'local-builder', projectId: 'stratum-demo', canEdit: false }), /permission/);
  assert.throws(() => authorize({ actorId: 'local-builder', projectId: 'different-project', canEdit: true }), /permission/);
});
test('sample data requires an upsert key to avoid duplicate records on restart', async () => {
  const raw = JSON.parse(await readFile(new URL('../template/app.json', import.meta.url), 'utf8'));
  raw.objects = [{ name: 'stratum_demo_request', label: 'Request', fields: { borrower: { type: 'text' } } }];
  raw.data = [{ object: 'stratum_demo_request', mode: 'insert', records: [{ borrower: 'Fictional Borrower' }] }];
  assert.throws(() => validateMetadata(JSON.stringify(raw)), /upsert/);
  raw.data[0].mode = 'upsert';
  assert.throws(() => validateMetadata(JSON.stringify(raw)), /externalId/);
  raw.data[0].externalId = 'borrower';
  assert.doesNotThrow(() => validateMetadata(JSON.stringify(raw)));
});
test('changes includes additions, edits, deletions and unchanged trees', () => {
  assert.deepEqual(changes({ a: 1, b: 2 }, { a: 3, c: 4 }), [
    { path: '/a', before: 1, after: 3 }, { path: '/b', before: 2, after: null }, { path: '/c', before: null, after: 4 },
  ]);
  assert.deepEqual(changes({ a: [1] }, { a: [1] }), []);
});
test('SSE parser handles split UTF-8, CRLF, heartbeats and multiple events', async () => {
  const text = ': keepalive\r\n\r\ndata: {"type":"response.output_text.delta","delta":"₹ ready"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = []; for await (const event of parseSse(stream)) events.push(event);
  assert.equal(events.length, 2); assert.equal(events[0].delta, '₹ ready');
});
test('a truncated provider stream cannot be reported as a successful task', async () => {
  class TruncatedProvider extends HarnessRouter {
    override async request() { return new Response('data: {"type":"response.created","response":{"id":"response-1"}}\n\n'); }
  }
  await assert.rejects(() => new TruncatedProvider().run({ runId: 'r1', harnessId: 'codex', prompt: 'test', files: [], signal: new AbortController().signal, onEvent: async () => {} }), /disconnected/);
});
