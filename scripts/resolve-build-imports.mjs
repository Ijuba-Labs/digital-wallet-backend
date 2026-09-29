// Resolve TypeScript aliases and extensionless relative ESM imports after tsc.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!file.endsWith('.js')) continue;
    let source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)];
    for (const match of imports) {
      const specifier = match[1];
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      let target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(dir, specifier);
      if (!target.endsWith('.js')) {
        try { if ((await stat(target + '.js')).isFile()) target += '.js'; }
        catch { target = path.join(target, 'index.js'); }
      }
      await stat(target);
      let relative = path.relative(dir, target).split(path.sep).join('/');
      if (!relative.startsWith('.')) relative = './' + relative;
      source = source.replace(match[0], match[0].replace(specifier, relative));
    }
    await writeFile(file, source);
  }
}
await visit(root);
