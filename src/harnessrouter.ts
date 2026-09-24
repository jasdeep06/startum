import { harnessBase, model } from './config.js';

export class HarnessRouter {
  async request(path: string, options: RequestInit = {}) {
    const key = process.env.HARNESSROUTER_API_KEY;
    if (!key) throw new Error('The assistant is not connected. Ask your administrator to configure it.');
    const response = await fetch(`${harnessBase}${path}`, {
      ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${key}`, ...options.headers },
    }).catch(() => { throw new Error('The local assistant service is unavailable. Start it and retry.'); });
    if (!response.ok) throw new Error(`Local HarnessRouter returned ${response.status}. Check its local console.`);
    return response;
  }

  async *answer(input: string, token: string, turnId: string, signal: AbortSignal) {
    const harnessId = process.env.HARNESSROUTER_CHAT_HARNESS_ID;
    if (!harnessId) throw new Error('The app assistant has not been configured yet.');
    const response = await this.request('/v1/responses', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'Idempotency-Key': turnId, 'X-Stratum-Read-Token': token },
      body: JSON.stringify({ input, model, metadata: { harness_id: harnessId }, stream: true, timeout_seconds: 180, max_step: 12 }),
    });
    if (!response.body) throw new Error('HarnessRouter returned no stream.');
    let completed = false;
    for await (const event of parseSse(response.body)) {
      if (['response.failed', 'response.incomplete', 'response.cancelled', 'error'].includes(event.type)) {
        throw new Error('The assistant could not complete this request. Check local HarnessRouter and retry.');
      }
      if (event.type === 'response.completed') completed = event.response?.status === 'completed';
      yield event;
    }
    if (!completed) throw new Error('HarnessRouter disconnected before completing the answer.');
  }

  async cancel(id: string) {
    await this.request(`/v1/responses/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }
}

// Coding harnesses emit progress messages too; only the final assistant message
// belongs in the business user's answer.
export function finalAnswer(response: any): string {
  const message = response?.output?.filter((item: any) => item.type === 'message' && item.role === 'assistant').at(-1);
  return message?.content?.filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('\n') || '';
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string) => {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    return data && data !== '[DONE]' ? JSON.parse(data) : undefined;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
        if (event) yield event;
      }
      if (buffer.length > 1_000_000) throw new Error('HarnessRouter event is too large.');
      if (done) { const event = parse(buffer); if (event) yield event; break; }
    }
  } finally { reader.releaseLock(); }
}
