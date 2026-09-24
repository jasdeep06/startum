import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const base = 'http://127.0.0.1:3000';
let cookie = (await fetch(base)).headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
async function api(path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: base, 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}
assert.equal((await fetch(`${base}/api/state`)).status, 401); pass('Unauthenticated API access is rejected');
const registry = (await api('/api/registry')).data;
assert.equal(registry.schemasRegistered, true);
assert.ok(registry.types.includes('agent') && registry.types.includes('stratum_task'));
assert.ok(!registry.types.includes('stratum_agent'));
assert.ok(registry.bindings.length && registry.policies.length); pass('Native Agent and separate Task, binding and policy registrations are available');
let state = (await api('/api/state')).data;
const input = { prompt: 'This request must be rejected', baseVersion: state.currentVersion, harnessId: state.binding.harnessId };
assert.equal((await api('/api/tasks', input, { origin: 'https://untrusted.example' })).response.status, 403); pass('Cross-origin task creation is rejected');
assert.equal((await api('/api/tasks', { ...input, baseVersion: 'stale' })).response.status, 409); pass('Stale versions are rejected');
assert.equal((await api('/api/tasks', { ...input, actorId: 'admin' })).response.status, 400); pass('Client-supplied actor identity is rejected');
assert.equal((await api('/api/tasks', { ...input, taskRef: 'missing_task@1' })).response.status, 404); pass('Unknown Tasks are rejected before provider execution');

if (process.argv.includes('--live')) {
  const oldVersion = state.currentVersion;
  if (oldVersion !== 'initial') {
    const existing = (await api('/api/metadata')).data;
    assert.equal(existing.objects?.[0]?.name, 'stratum_demo_credit_request', 'The live scenario expects the Credit Review demo. Use the UI for other applications.');
    assert.ok(!existing.objects[0].fields.risk_grade, 'Both live scenario stages are already complete. Run npm run verify for repeat checks, or use the UI for another change. No provider call was made.');
  }
  const prompt = oldVersion === 'initial'
    ? 'Create Credit Review with borrower name, requested amount, review status (New, Under review, Approved) and notes. Include five fictional records and list and create/edit forms.'
    : 'Add a required Risk grade field to Credit Review, with Low, Medium and High choices. Include it in the list and the form. Give all five existing sample borrowers a risk grade. Keep every existing field and borrower.';
  const start = await api('/api/tasks', { prompt, baseVersion: oldVersion, harnessId: state.binding.harnessId, model: 'gpt-5.4-mini' });
  assert.equal(start.response.status, 202);
  assert.equal((await api('/api/tasks', input)).response.status, 409); pass('Concurrent edits are rejected');
  let run;
  for (let i = 0; i < 400; i++) {
    state = (await api('/api/state')).data;
    run = state.runs.find(r => r.id === start.data.id);
    if (i % 10 === 0) console.log(`Live task: ${run.status}`);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break;
    await delay(1500);
  }
  assert.equal(run.status, 'succeeded', run.error);
  assert.notEqual(state.currentVersion, oldVersion);
  assert.ok(run.responseId && run.sessionId && run.validation && run.changes.length);
  pass('Real local HarnessRouter execution produces a new validated ObjectStack version');
  const definition = (await api('/api/metadata')).data;
  if (oldVersion !== 'initial') {
    const fields = definition.objects[0].fields;
    assert.ok(fields.risk_grade?.required);
    assert.deepEqual(fields.risk_grade.options.map(o => o.label).sort(), ['High', 'Low', 'Medium']);
    assert.ok(fields.borrower && fields.amount && fields.status && fields.notes);
    assert.equal(definition.data[0].records.length, 5);
    pass('Follow-up adds required risk grade while preserving the existing application');
    assert.equal((await api(`/api/metadata?version=${oldVersion}`)).response.status, 200);
    pass('Previous successful application version remains available');
  }
}
state = (await api('/api/state')).data;
if (state.currentVersion !== 'initial') {
  const preview = await api('/api/preview', {}); assert.equal(preview.response.status, 200, preview.data.error);
  const runtime = new URL(preview.data.url).origin;
  const runtimeCookie = preview.response.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  const definition = (await api('/api/metadata')).data;
  const object = definition.objects[0].name;
  const data = await fetch(`${runtime}/api/v1/data/${object}`, { headers: { cookie: runtimeCookie } });
  assert.equal(data.status, 200);
  const records = await data.json();
  const rows = records.data?.records || records.data?.items || records.data || records.records || records.items;
  assert.ok(Array.isArray(rows), JSON.stringify(records).slice(0,500));
  assert.ok(rows.length >= 5); pass('Running ObjectStack API returns the generated sample records');
  if (object === 'stratum_demo_credit_request') {
    const headers = { cookie: runtimeCookie, origin: runtime, 'content-type': 'application/json' };
    const collection = `${runtime}/api/v1/data/${object}`;
    const invalid = await fetch(collection, { method: 'POST', headers, body: JSON.stringify({ amount: 1200 }) });
    assert.ok([400, 422].includes(invalid.status), `Expected required-field validation, got ${invalid.status}`);
    pass('ObjectStack rejects a record missing required fields');
    const record = { borrower: `Stratum verification ${Date.now()}`, amount: 12500, status: 'new', notes: 'Temporary local verification record', risk_grade: 'low' };
    const created = await fetch(collection, { method: 'POST', headers, body: JSON.stringify(record) });
    const result = await created.json(); assert.ok(created.ok, JSON.stringify(result));
    const id = result.data?.record?.id || result.data?.id || result.record?.id || result.id;
    assert.ok(id, JSON.stringify(result));
    try {
      const updated = await fetch(`${collection}/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ notes: 'Updated through the real ObjectStack API' }) });
      assert.ok(updated.ok, await updated.text());
      const read = await (await fetch(`${collection}/${id}`, { headers })).json();
      const row = read.data?.record || read.data || read.record || read;
      assert.equal(row.notes, 'Updated through the real ObjectStack API');
      pass('ObjectStack creates, updates and reads a real application record');
    } finally {
      const removed = await fetch(`${collection}/${id}`, { method: 'DELETE', headers });
      assert.ok(removed.ok, 'Temporary verification record could not be deleted');
    }
    pass('Temporary verification record is deleted');
  }
  assert.equal((await fetch(preview.data.url)).status, 200); pass('Native ObjectStack application route is served');
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/verification.json', JSON.stringify({ at: new Date().toISOString(), live: process.argv.includes('--live'), checks, currentVersion: state.currentVersion }, null, 2));
console.log(`Verified ${checks.length} checks.`);
