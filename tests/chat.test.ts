import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadOnlyMcp, readTools } from '../src/read-mcp.js';
import { Conversations } from '../src/conversations.js';
import { finalAnswer, parseSse } from '../src/harnessrouter.js';

const rpc = (name: string, args: any = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('MCP restricts calls and keeps the caller identity at the native boundary', async t => {
  const received: { body: any; cookie?: string }[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); received.push({ body, cookie: req.headers.cookie });
    res.setHeader('content-type', 'application/json');
    if (req.headers.cookie === 'revoked') { res.writeHead(401).end('{}'); return; }
    const result = body.method === 'tools/list'
      ? { tools: [...readTools, 'create_record', 'update_record', 'delete_record', 'run_action'].map(name => ({ name })) }
      : { content: [{ type: 'text', text: JSON.stringify(body.params?.name === 'list_objects' ? { objects: [{ name: 'credits' }, { name: 'other_app' }], totalCount: 2 } : { records: [{ borrower: 'Example' }] }) }] };
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => upstream.close());
  const port = (upstream.address() as any).port;
  const mcp = new ReadOnlyMcp(new Set(['credits']), `http://127.0.0.1:${port}/api/v1/mcp`);
  const alice = mcp.issue('alice-session'); const bob = mcp.issue('bob-session');
  const listed = await mcp.dispatch(alice.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(listed.body.result.tools.map((v: any) => v.name), [...readTools]);
  for (const name of ['create_record', 'update_record', 'delete_record', 'run_action', 'validate_expression']) {
    assert.ok((await mcp.dispatch(alice.token, rpc(name, { objectName: 'credits' }))).body.error);
  }
  assert.ok((await mcp.dispatch(alice.token, rpc('query_records', { objectName: 'other_app' }))).body.error);
  assert.ok((await mcp.dispatch(alice.token, [rpc('delete_record')])).body.error);
  assert.ok((await mcp.dispatch(alice.token, { jsonrpc: '2.0', id: 1, method: 'resources/read' })).body.error);
  assert.equal(received.length, 1, 'rejected calls never reach ObjectStack');
  await mcp.dispatch(alice.token, rpc('query_records', { objectName: 'credits' }));
  await mcp.dispatch(bob.token, rpc('get_record', { objectName: 'credits', recordId: '1' }));
  assert.deepEqual(received.slice(-2).map(r => r.cookie), ['alice-session', 'bob-session']);
  assert.equal(alice.grant.reads, 1);
  const objects = await mcp.dispatch(alice.token, rpc('list_objects'));
  assert.deepEqual(JSON.parse(objects.body.result.content[0].text), { objects: [{ name: 'credits' }], totalCount: 1 });
  assert.equal((await mcp.dispatch('forged', rpc('query_records'))).status, 401);
  mcp.revoke(alice.token);
  assert.equal((await mcp.dispatch(alice.token, rpc('query_records'))).status, 401);
  bob.grant.expires = Date.now() - 1;
  assert.equal((await mcp.dispatch(bob.token, rpc('query_records'))).status, 401);
  const revoked = mcp.issue('revoked');
  assert.equal((await mcp.dispatch(revoked.token, rpc('query_records', { objectName: 'credits' }))).status, 401);
  assert.equal(revoked.grant.reads, 0);
});

test('conversation history survives a reload and cannot be read or deleted by another user', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stratum-chat-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Conversations(directory);
  const conversation = await store.create('alice');
  conversation.messages.push({ id: 'm1', role: 'user', content: 'Summarise my records' });
  await store.save(conversation);
  assert.equal((await new Conversations(directory).get(conversation.id, 'alice')).messages.length, 1);
  await assert.rejects(store.get(conversation.id, 'bob'), { status: 404 });
  await assert.rejects(store.remove(conversation.id, 'bob'), { status: 404 });
  await assert.rejects(store.get('../../.env', 'alice'), { status: 404 });
  assert.equal((await store.list('bob')).length, 0);
  await store.remove(conversation.id, 'alice');
  await assert.rejects(store.get(conversation.id, 'alice'), { status: 404 });
});

test('stream decoding handles split JSON, UTF-8 and multiple events', async () => {
  const bytes = Buffer.from('data: {"type":"delta","text":"₹"}\r\n\r\ndata: {"type":"done"}\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const events = []; for await (const e of parseSse(stream)) events.push(e);
  assert.deepEqual(events, [{ type: 'delta', text: '₹' }, { type: 'done' }]);
});

test('only the final answer is shown, without coding-harness progress narration', () => {
  const output = ['Checking tools...', 'Two credit requests.'].map(text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }));
  assert.equal(finalAnswer({ output }), 'Two credit requests.');
});

test('app chat endpoints require a real session, reject cross-origin writes and isolate conversations', async t => {
  const { StratumChatPlugin } = await import('../src/plugin.js');
  const { origin } = await import('../src/config.js');
  const directory = await mkdtemp(join(tmpdir(), 'stratum-routes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const routes = new Map<string, any>();
  const server = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path: string, handler: any) => routes.set(`${method} ${path}`, handler)]));
  const plugin = new StratumChatPlugin({ objects: [{ name: 'credits' }] });
  (plugin as any).conversations = new Conversations(directory);
  await plugin.init({ registerService() {}, getService(name: string) { return name === 'http.server' ? server : { api: { async getSession({ headers }: any) { const id = headers.get('cookie'); return id ? { user: { id } } : null; } } }; }, logger: { error() {} } } as any);
  const call = async (method: string, path: string, user?: string, body = {}, params = {}, requestOrigin = origin) => {
    let status = 200; let result: any;
    const res: any = { header() { return res; }, status(s: number) { status = s; return res; }, json(b: any) { result = b; } };
    await routes.get(`${method} /api/v1/ai${path}`)({ headers: { origin: requestOrigin, ...user ? { cookie: user } : {} }, body, params, query: {} }, res);
    return { status, result };
  };
  assert.equal((await call('get', '/agents')).status, 401);
  assert.equal((await call('post', '/conversations', 'alice', {}, {}, 'https://elsewhere.example')).status, 403);
  const created = await call('post', '/conversations', 'alice');
  assert.equal(created.status, 201);
  const params = { id: created.result.id };
  assert.equal((await call('get', '/conversations/:id', 'bob', {}, params)).status, 404);
  assert.equal((await call('patch', '/conversations/:id', 'bob', { title: 'stolen' }, params)).status, 404);
  assert.equal((await call('delete', '/conversations/:id', 'bob', {}, params)).status, 404);
  assert.equal((await call('patch', '/conversations/:id', 'alice', { title: 'Review' }, params)).result.title, 'Review');
});
