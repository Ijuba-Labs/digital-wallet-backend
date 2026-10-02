import { readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.env.CI || process.env.NODE_ENV === 'production') {
  throw new Error('Local package installation is for development; CI/deployment must use the committed registry lockfile');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const source = realpathSync(resolve(root, process.env.PAYMENT_PRIMITIVES_PATH ?? manifest.config.localPaymentPrimitivesPath));
const pkg = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
if (pkg.name !== '@ijuba-labs/payment-primitives') throw new Error('Unexpected local package');
function run(args, env = process.env, cwd = root) {
  const child = spawnSync('pnpm', args, { cwd, env: { ...env, CI: 'true' }, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
run(['install', '--frozen-lockfile'], process.env, source);
run(['build'], process.env, source);
// Seed the development lock from the release lock so unrelated dependencies
// keep the same versions. Its importer is two directories above this lockfile.
mkdirSync(resolve(root, '.local/dependencies'), { recursive: true });
writeFileSync(resolve(root, '.local/dependencies/pnpm-lock.yaml'),
  readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8').replace(/\n  \.:\n/, '\n  ../..:\n'));
run(['install', '--no-frozen-lockfile', '--lockfile-dir', '.local/dependencies',
  '--config.pnpmfile=' + resolve(root, 'scripts/local-primitives.cjs'), ...process.argv.slice(2)],
  { ...process.env, PAYMENT_PRIMITIVES_LOCAL_PATH: source, PAYMENT_PRIMITIVES_CONSUMER: manifest.name });
console.info('Using the local payment primitives folder. The committed production manifest and lockfile were preserved.');
