import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ObjectKernel } from '@objectstack/core';
import { MetadataManager } from '@objectstack/metadata';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { root, port, origin, harnessBase, binding } from './config.js';
import { StratumIntelligencePlugin, defaultTaskRef } from './plugin.js';
import { IntelligenceService } from './intelligence.js';
import { HarnessRouter } from './harnessrouter.js';

const metadata = new MetadataManager({ formats: ['json'] });
const service = new IntelligenceService(metadata);
await service.init();
// Builder host: metadata + our execution plugin, not an application data runtime.
const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false, logger: { level: 'error' } });
kernel.registerService('metadata', metadata);
await kernel.use(new StratumIntelligencePlugin(service));
await kernel.bootstrap();

const app = express();
const session = randomBytes(32).toString('hex');
const context = { actorId: 'local-builder', projectId: 'stratum-demo', canEdit: true };
const origins = new Set([origin, `http://localhost:${port}`]);
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!origins.has(`http://${req.headers.host}`)) { res.status(403).json({ error: 'Local access only.' }); return; }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path === '/') {
    // Canonical host makes the preview's development sign-in cookie work across ports.
    if (req.hostname !== '127.0.0.1') { res.redirect(origin); return; }
    res.cookie('stratum_session', session, { httpOnly: true, sameSite: 'strict', path: '/' });
  }
  if (!req.path.startsWith('/api/')) { next(); return; }
  res.setHeader('Cache-Control', 'no-store');
  const cookie = req.headers.cookie?.split('; ').find(c => c.startsWith('stratum_session='))?.slice(16) || '';
  if (cookie.length !== session.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(session))) { res.status(401).json({ error: 'Open Stratum in your browser to start a local session.' }); return; }
  if (!['GET', 'HEAD'].includes(req.method) && !origins.has(req.headers.origin || '')) { res.status(403).json({ error: 'Request origin is not allowed.' }); return; }
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(join(root, 'public')));
app.get('/api/state', (_req, res) => res.json({ ...service.state, preview: { ready: service.project.ready, url: service.project.url }, binding }));
app.get('/api/connection', async (_req, res) => {
  try { res.json({ connected: true, consoleUrl: new URL(harnessBase).origin, ...await new HarnessRouter().catalog() }); }
  catch (error: any) { res.json({ connected: false, error: error.message, consoleUrl: new URL(harnessBase).origin }); }
});
app.get('/api/registry', async (_req, res) => res.json({
  types: await metadata.getRegisteredTypes(),
  agents: await metadata.list('agent'), tasks: await metadata.list('stratum_task'),
  bindings: await metadata.list('stratum_execution_binding'), policies: await metadata.list('stratum_execution_policy'),
  schemasRegistered: ['agent', 'stratum_task', 'stratum_execution_binding', 'stratum_execution_policy'].every(type => !!getMetadataTypeSchema(type)),
}));
app.get('/api/metadata', async (req, res) => res.json(await service.metadata(typeof req.query.version === 'string' ? req.query.version : undefined)));
app.post('/api/tasks', async (req, res) => {
  const input = z.strictObject({ taskRef: z.string().default(defaultTaskRef), prompt: z.string().trim().min(5).max(12000), baseVersion: z.string(), harnessId: z.string().min(1).max(160).optional(), model: z.string().max(160).optional() }).parse(req.body);
  res.status(202).json(await service.start(input, context));
});
app.post('/api/tasks/:id/cancel', async (req, res) => { await service.cancel(req.params.id, context); res.json({ ok: true }); });
app.post('/api/preview', async (_req, res) => {
  if (service.state.currentVersion === 'initial') { res.status(409).json({ error: 'Create an application first.' }); return; }
  if (service.state.runs.some(run => !['succeeded', 'failed', 'cancelled'].includes(run.status))) {
    res.status(409).json({ error: 'Wait for the current change before restarting the preview.' }); return;
  }
  await service.project.start(service.state.currentVersion);
  await service.project.verify();
  res.setHeader('Set-Cookie', await service.project.login());
  res.json({ url: service.project.url });
});
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({ error: error.message });
});
const server = app.listen(port, '127.0.0.1', () => console.log(`Stratum is ready at ${origin}`));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (closing) return; closing = true;
  server.close(); await service.shutdown(); await kernel.shutdown(); process.exit(0);
});
