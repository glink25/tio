import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const pure = [
  'core',
  'storage',
  'serialization',
  'database',
  'merge',
  'sync',
  'workspace',
  'host-protocol',
];
const forbidden =
  /^(react|react-dom|@blocknote\/|@glideapps\/|@tio\/(ui|i18n|editor-blocknote|views|provider-local-folder|adapter-local-folder|local-store))/;
for (const name of pure) {
  const pkg = JSON.parse(readFileSync(join('packages', name, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (forbidden.test(dependency)) throw new Error(`${pkg.name} cannot depend on ${dependency}`);
  }
}
for (const name of readdirSync('packages')) {
  const pkg = JSON.parse(readFileSync(join('packages', name, 'package.json'), 'utf8'));
  for (const [dependency, version] of Object.entries(pkg.dependencies ?? {})) {
    if (dependency.startsWith('@tio/') && version !== 'workspace:*')
      throw new Error(`${pkg.name}: ${dependency} must use workspace:*`);
  }
}
console.log('Package boundaries verified.');

for (const name of ['core', 'workspace', 'sync', 'host-protocol', 'serialization']) {
  for (const file of sourceFiles(join('packages', name, 'src'))) {
    const source = readFileSync(file, 'utf8');
    if (/\b(document|window|navigator|indexedDB|localStorage)\s*[.]/.test(source))
      throw new Error(`${name}/${file}: browser dependency in core`);
  }
}
const editor = JSON.parse(readFileSync('packages/web-editor/package.json', 'utf8'));
for (const dependency of Object.keys(editor.dependencies))
  if (/^@tio\/(local-store|adapter-|provider-)/.test(dependency))
    throw new Error(`Editor depends on concrete host: ${dependency}`);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
}
const graph = new Map(
  readdirSync('packages').map((name) => {
    const pkg = JSON.parse(readFileSync(join('packages', name, 'package.json'), 'utf8'));
    return [pkg.name, Object.keys(pkg.dependencies ?? {})];
  }),
);
function visit(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const dependency of graph.get(name) ?? []) visit(dependency, seen);
  return seen;
}
for (const name of pure)
  for (const dependency of visit('@tio/' + name)) {
    if (forbidden.test(dependency))
      throw new Error(`${name}: forbidden transitive dependency ${dependency}`);
  }
for (const dependency of visit('@tio/web-editor'))
  if (/^@tio\/(local-store|adapter-|provider-)/.test(dependency))
    throw new Error(`Editor transitive host dependency: ${dependency}`);
for (const name of pure)
  for (const file of sourceFiles(join('packages', name, 'src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /(?:from|import)\s*['"]([^'"]+)['"]/g,
    )) {
      if (forbidden.test(match[1]) || match[1].includes('/apps/'))
        throw new Error(`${relative('.', file)}: forbidden source import ${match[1]}`);
    }
  }
