import { readFileSync } from 'node:fs';
import { defineStack } from '@objectstack/spec';
import { DefaultDatasourcePlugin } from '@objectstack/runtime';
import { StratumChatPlugin } from './src/plugin.js';

const app = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8'));
export default defineStack({
  ...app,
  plugins: [
    new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: '.objectstack/data/objectstack.db', persist: 'on-write' } }, { dev: true }),
    new StratumChatPlugin(app),
  ],
});
