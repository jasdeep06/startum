import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './config.js';

export type Conversation = {
  id: string; userId: string; title: string; agent: string; createdAt: string; updatedAt: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string }[];
};
export class Conversations {
  constructor(private directory = join(root, '.stratum', 'conversations')) {}
  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    return join(this.directory, `${id}.json`);
  }
  async save(conversation: Conversation) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(conversation.id);
    await writeFile(`${file}.tmp`, JSON.stringify(conversation), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async create(userId: string) {
    const now = new Date().toISOString();
    const conversation: Conversation = { id: randomUUID(), userId, title: 'New conversation', agent: 'ask', createdAt: now, updatedAt: now, messages: [] };
    await this.save(conversation); return conversation;
  }
  async get(id: string, userId: string) {
    const conversation: Conversation = await readFile(this.file(id), 'utf8').then(JSON.parse).catch(() => {
      throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    });
    if (conversation.userId !== userId) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    return conversation;
  }
  async list(userId: string) {
    const files = await readdir(this.directory).catch(() => []);
    const rows = await Promise.all(files.filter(f => f.endsWith('.json')).map(f => this.get(f.slice(0, -5), userId).catch(() => undefined)));
    return rows.filter((c): c is Conversation => !!c).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async remove(id: string, userId: string) { await this.get(id, userId); await unlink(this.file(id)); }
}
