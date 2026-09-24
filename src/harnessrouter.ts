import { harnessBase } from './config.js';

export type HarnessEvent = { type: string; [key: string]: any };
export class HarnessRouter {
  constructor(private base = harnessBase, private key = process.env.HARNESSROUTER_API_KEY || '') {}

  async request(path: string, options: RequestInit = {}) {
    if (!this.key) throw new Error('Connect local HarnessRouter first: run node scripts/setup.mjs --connect.');
    const response = await fetch(`${this.base}${path}`, {
      ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.key}`, ...options.headers },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Local HarnessRouter returned ${response.status}: ${body.slice(0,1200).replaceAll(this.key, '[redacted]')}`);
    }
    return response;
  }
  async catalog() {
    const [harnesses, models] = await Promise.all([
      this.request('/v1/harnesses').then(r => r.json()),
      this.request('/v1/models').then(r => r.json()),
    ]);
    return { harnesses: harnesses.harnesses || [], models: models.backends || {} };
  }
  async run(args: {
    runId: string; harnessId: string; model?: string; prompt: string;
    files: { name: string; content: string }[]; signal: AbortSignal;
    onEvent: (event: HarnessEvent) => Promise<void>;
  }) {
    const content: any[] = [{ type: 'input_text', text: args.prompt }];
    for (const file of args.files) content.push({
      type: 'input_file', filename: file.name,
      file_data: `data:application/octet-stream;base64,${Buffer.from(file.content).toString('base64')}`,
    });
    const response = await this.request('/v1/responses', {
      method: 'POST', signal: args.signal,
      headers: { 'content-type': 'application/json', 'Idempotency-Key': args.runId },
      body: JSON.stringify({ input: [{ role: 'user', content }], model: args.model,
        metadata: { harness_id: args.harnessId }, stream: true }),
    });
    if (!response.body) throw new Error('HarnessRouter returned no event stream.');
    let completed: any;
    for await (const event of parseSse(response.body)) {
      await args.onEvent(event);
      if (event.type === 'response.completed') completed = event.response;
      if (['response.failed', 'response.incomplete', 'response.cancelled', 'error'].includes(event.type)) {
        throw new Error(event.response?.error?.message || event.error?.message || event.message || `Harness execution ${event.type}.`);
      }
    }
    if (!completed || completed.status !== 'completed') throw new Error('HarnessRouter disconnected before successful completion.');
    return completed;
  }
  async appFile(sessionId: string, signal: AbortSignal) {
    const sid = encodeURIComponent(sessionId);
    const listing = await (await this.request(`/v1/sessions/${sid}/files`, { signal })).json();
    const file = listing.files?.find((f: any) => (f.path || f.filename).replace(/^\.\//, '') === 'app.json');
    if (!file) throw new Error('The harness did not return app.json. Ask it to edit the supplied application file.');
    if (file.bytes > 2_000_000) throw new Error('Generated app.json exceeds the 2 MB prototype limit.');
    // Construct a same-server URL; never follow model-controlled download URLs.
    const response = await this.request(`/v1/containers/${sid}/files/${encodeURIComponent(file.id || file.file_id)}/content`, { signal });
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('Generated app.json is too large.');
    return text;
  }
  async cancel(responseId: string) {
    await this.request(`/v1/responses/${encodeURIComponent(responseId)}/cancel`, { method: 'POST' });
  }
}

// SSE chunks need not align with either JSON, lines, or UTF-8 characters.
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<HarnessEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string) => {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return undefined;
    return JSON.parse(data) as HarnessEvent;
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
      if (buffer.length > 4_000_000) throw new Error('HarnessRouter event exceeds the limit.');
      if (done) { const event = parse(buffer); if (event) yield event; break; }
    }
  } finally { reader.releaseLock(); }
}
