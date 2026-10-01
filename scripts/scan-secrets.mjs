import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) throw new Error('Cannot list source files');
const findings = [];
for (const file of result.stdout.split('\0').filter(Boolean)) {
  let data;
  try { data = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
  const forbiddenName = /(^|\/)(secrets|\.aws)(\/|$)|\.(pem|key|p12|pfx)$/i.test(file) ||
    /(^|\/)\.env(?:$|\.(?!.*example$))/.test(file);
  const secretContent = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(data) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(data) || /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(data) ||
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(data);
  if (forbiddenName || secretContent) findings.push(file);
}
if (findings.length) {
  // Never print matching lines, snippets, or secret values.
  console.error('Secret scan flagged these filenames:');
  for (const file of findings) console.error(file);
  process.exitCode = 1;
} else console.log('Secret scan passed');
