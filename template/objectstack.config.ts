import { readFileSync } from 'node:fs';
import { defineStack } from '@objectstack/spec';

// app.json is ordinary ObjectStack metadata. No second application model.
export default defineStack(JSON.parse(readFileSync('app.json', 'utf8')));
