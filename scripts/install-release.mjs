import { mkdtempSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.NODE_AUTH_TOKEN) throw new Error('Set NODE_AUTH_TOKEN to a GitHub token with read:packages access');
// pnpm 12 permits credential environment expansion only in user-owned config.
// This temporary file contains the variable reference, never the token itself.
const directory = mkdtempSync(join(tmpdir(), 'ijuba-registry-'));
const userconfig = join(directory, 'npmrc');
const root = fileURLToPath(new URL('../', import.meta.url));
const modules = join(root, 'node_modules');
const installed = join(modules, '@ijuba-labs/payment-primitives');
// pnpm 12 can retain a same-version development symlink on an otherwise
// unchanged lockfile. Force relinking only when switching from that folder.
const localLink = existsSync(installed) && relative(modules, realpathSync(installed)).startsWith('..');
try {
  writeFileSync(userconfig, '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n', { mode: 0o600 });
  const args = process.argv.slice(2);
  const child = spawnSync('pnpm', ['install', ...(args.length ? args : ['--frozen-lockfile']), ...(localLink ? ['--force'] : [])], {
    cwd: root,
    env: { ...process.env, NPM_CONFIG_USERCONFIG: userconfig }, stdio: 'inherit'
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
