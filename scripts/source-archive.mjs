import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? join(tmpdir(), 'wallet-backend-source.tar.gz'));
const excludedDirs = new Set(['.git', '.aws', '.agents', '.codex', 'secrets', 'node_modules', '.pnpm-store',
  'dist', 'build', 'coverage', '.nyc_output', 'logs', '.cache', '.idea', '.vscode']);
const excludedFile = (name, relative) => relative === 'assets/tesseract/eng.traineddata.gz' ? false : /^\.env(?:\.|$)/i.test(name) ||
  /\.(?:env|pem|key|p12|pfx|jks|secret|secrets|log|tsbuildinfo|zip|gz|tgz|tar)$/i.test(name) ||
  /(?:private[-_]?key|keyring|credentials|id_rsa|id_ed25519)/i.test(name) ||
  ['.DS_Store', 'ngrok.yml', 'ngrok.yaml'].includes(name);
const files = [];
function collect(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink() || excludedDirs.has(entry.name) || excludedFile(entry.name, relative)) continue;
    if (entry.isDirectory()) collect(join(directory, entry.name), relative + '/');
    else if (entry.isFile() && resolve(root, relative) !== output) files.push('./' + relative);
  }
}
collect(root);
const temp = mkdtempSync(join(tmpdir(), 'wallet-source-'));
try {
  const list = join(temp, 'files');
  writeFileSync(list, files.sort().join('\0') + '\0');
  const result = spawnSync('tar', ['-czf', output, '-C', root, '--null', '-T', list], {
    stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (result.status !== 0) throw new Error('Source archive failed');
  console.log(`Source archive: ${output} (${files.length} files)`);
} finally { rmSync(temp, { recursive: true, force: true }); }
