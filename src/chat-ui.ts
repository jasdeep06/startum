import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IHttpServer } from '@objectstack/core';
import { root } from './config.js';

// Presentation adapter for the pinned ObjectStack 17.4 console. The framework
// owns the chat state, composer and transport; these assets only decorate it.
export async function mountChatUi(server: IHttpServer, app: any) {
  const hono = server.getRawApp?.();
  if (!hono) return;
  for (const [file, type] of [['chat-drawer.js', 'text/javascript'], ['chat-drawer.css', 'text/css']]) {
    hono.get(`/api/v1/ai/ui/${file}`, async (c: any) => {
      const content = await readFile(join(root, 'ui', file), 'utf8');
      c.header('Content-Type', `${type}; charset=utf-8`);
      c.header('Cache-Control', 'no-cache');
      return c.body(content);
    });
  }
  const appId = encodeURIComponent(app.manifest.id);
  const label = encodeURIComponent(app.manifest.name);
  hono.use('/_console/*', async (c: any, next: () => Promise<void>) => {
    await next();
    if (!c.res.headers.get('content-type')?.includes('text/html')) return;
    const html = await c.res.text();
    const assets = `<link rel="stylesheet" href="/api/v1/ai/ui/chat-drawer.css"><script defer src="/api/v1/ai/ui/chat-drawer.js" data-stratum-chat data-app-id="${appId}" data-app-label="${label}"></script>`;
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(html.replace('</head>', `${assets}</head>`), { status: c.res.status, headers });
  });
}
