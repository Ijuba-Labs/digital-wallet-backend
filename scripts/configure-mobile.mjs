import { readFileSync, writeFileSync, statSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Change only the browser-facing origin. Provider URLs, credentials, and ports
// belong to the existing backend setup and must be preserved.
try {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length !== 1) throw new Error('Usage: pnpm mobile:configure https://YOUR-DOMAIN.ngrok-free.app');
  const url = new URL(args[0]);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) {
    throw new Error('Use the reachable HTTPS API origin only, without a path, query, fragment, or credentials.');
  }
  const envPath = resolve('.env');
  const original = readFileSync(envPath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const assignment = `API_PUBLIC_URL=${url.origin}`;
  const pattern = /^\s*(?:export\s+)?API_PUBLIC_URL\s*=.*$/gm;
  const updated = pattern.test(original)
    ? original.replace(pattern, assignment)
    : original + (original.endsWith('\n') ? '' : newline) + assignment + newline;
  const temporaryPath = `${envPath}.mobile-${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, updated, { mode: statSync(envPath).mode & 0o777 });
    renameSync(temporaryPath, envPath);
  } finally { rmSync(temporaryPath, { force: true }); }
  console.log(`API_PUBLIC_URL=${url.origin}`);
  console.log(`Android API base URL: ${url.origin}`);
  console.log('Keep ngrok running and recreate the API to load its environment:');
  console.log('pnpm localenv:compose up -d --no-deps --force-recreate wallet-api');
  console.log('If running pnpm dev directly, stop and start it again. Start a NEW onboarding session after restarting.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not configure mobile API origin');
  process.exitCode = 1;
}
