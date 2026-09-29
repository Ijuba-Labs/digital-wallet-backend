import { rm } from 'node:fs/promises';
// Only generated compiler output is removed; source files are never touched.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
