import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const command = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
if (command.status !== 0) {
  process.stderr.write(command.stderr);
  process.exit(command.status ?? 1);
}
const [pack] = JSON.parse(command.stdout);
const allowed = /^(package\.json|README\.md|LICENSE|dist\/[a-z-]+\.(js|d\.ts))$/;
if (pack.name !== '@ijuba-labs/payment-primitives' || pack.files.some(f => !allowed.test(f.path)) ||
    !pack.files.some(f => f.path === 'dist/index.js') || !pack.files.some(f => f.path === 'dist/index.d.ts')) {
  throw new Error('Unexpected package contents: publish only the built public primitives and metadata');
}
if (!existsSync('dist/index.js')) throw new Error('Build the package before publishing');
await import(new URL('../packages/open-payments-primitives/dist/index.js', import.meta.url));
console.info(`Verified ${pack.name}@${pack.version}: ${pack.files.length} public files, ${pack.size} bytes`);
