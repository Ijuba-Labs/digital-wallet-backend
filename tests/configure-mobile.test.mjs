import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/configure-mobile.mjs');
const original = 'PORT=9000\nJWT_SECRET=test-placeholder\nONBOARDING_MOBILE_RETURN_URL=https://links.example/return\n';

test('mobile configuration preserves existing settings and updates the API origin', () => {
  const folder = mkdtempSync(join(tmpdir(), 'mobile-config-'));
  try {
    const path = join(folder, '.env');
    writeFileSync(path, original);
    let result = spawnSync(process.execPath, [script, 'https://mobile.example'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path, 'utf8'), original + 'API_PUBLIC_URL=https://mobile.example\n');
    assert.ok(!result.stdout.includes('test-placeholder'));
    result = spawnSync(process.execPath, [script, 'https://new-mobile.example/'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path, 'utf8'), original + 'API_PUBLIC_URL=https://new-mobile.example\n');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('invalid public origins leave configuration untouched', () => {
  const folder = mkdtempSync(join(tmpdir(), 'mobile-config-'));
  try {
    const path = join(folder, '.env');
    writeFileSync(path, original);
    for (const url of ['http://localhost:9000', 'https://localhost', 'https://user:secret@api.example', 'https://api.example/path', 'https://api.example?secret=value']) {
      const result = spawnSync(process.execPath, [script, url], { cwd: folder, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(path, 'utf8'), original);
      assert.ok(!result.stderr.includes('user:secret'));
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
