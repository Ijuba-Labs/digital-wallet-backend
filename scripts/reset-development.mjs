import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = resolve(import.meta.dirname, '..');
const compose = ['compose', '--project-name', 'wallet-backend', '--env-file', '.env',
  '-f', 'docker/base/docker-compose.yml', '-f', 'docker/dev/docker-compose.yml'];
const run = (args) => {
  const result = spawnSync('docker', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Development setup command failed');
};
run([...compose, 'down']);
for (const purpose of ['pgdata', 'redis-data']) {
  const name = `wallet-backend_${purpose}`;
  const result = spawnSync('docker', ['volume', 'inspect', name], { cwd, encoding: 'utf8' });
  if (result.status !== 0) continue;
  const [volume] = JSON.parse(result.stdout);
  if (volume.Labels?.['com.docker.compose.project'] !== 'wallet-backend' ||
      volume.Labels?.['com.docker.compose.volume'] !== purpose) throw new Error('Volume ownership mismatch');
  run(['volume', 'rm', name]);
}
run([...compose, '--profile', 'seed', 'build', 'db-migrate', 'db-seed', 'wallet-api', 'payment-worker']);
run([...compose, 'up', '-d', '--wait', 'shared-database', 'shared-redis']);
run([...compose, 'run', '--rm', 'db-migrate']);
run([...compose, '--profile', 'seed', 'run', '--rm', 'db-seed']);
run([...compose, 'up', '-d', 'wallet-api', 'payment-worker']);
