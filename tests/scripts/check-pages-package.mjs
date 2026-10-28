import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { auditPagesOutput } from './audit-pages-output.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifact = join(repo, 'tests/.cache/pages-package');
await rm(artifact, { recursive: true, force: true });
await mkdir(artifact, { recursive: true });
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: 'true',
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH ?? chromium.executablePath(),
    },
  });
const [packed] = JSON.parse(
  run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', artifact],
    join(repo, 'packages/pages'),
  ),
);
assert.equal(packed.name, '@glink25/tio-pages');
assert(packed.files.some((file) => file.path === 'dist/cli.js'));
assert(packed.files.some((file) => file.path === 'dist/client/code-client.js'));
assert(packed.files.some((file) => file.path === 'LICENSE'));
assert(
  !packed.files.some(
    (file) => file.path.startsWith('src/') || file.path.startsWith('node_modules/'),
  ),
);
const consumer = join(artifact, 'consumer');
await mkdir(consumer);
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run(
  'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', join(artifact, packed.filename)],
  consumer,
);
const installed = join(consumer, 'node_modules/@glink25/tio-pages');
const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(pkg.private, undefined);
assert(
  !Object.entries(pkg.dependencies).some(
    ([name, version]) => name.startsWith('@tio/') || String(version).startsWith('workspace:'),
  ),
);
assert(!pkg.dependencies.tsx);
for (const file of await readdir(join(installed, 'dist'), { recursive: true })) {
  if (!/\.(?:js|ts)$/.test(file)) continue;
  const code = await readFile(join(installed, 'dist', file), 'utf8');
  assert(
    !/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]@tio\//.test(code),
    `Private import in ${file}`,
  );
}
const workspace = join(consumer, 'workspace');
await mkdir(join(workspace, 'workspaces/isolated/objects'), { recursive: true });
await mkdir(join(workspace, '.tio-page'));
const object = (type, id, props) => ({
  id,
  type,
  workspaceId: 'isolated',
  schemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...props,
});
const block = (id, language, text) => ({
  id,
  type: 'codeBlock',
  props: { language, displayMode: 'split' },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
await writeFile(
  join(workspace, 'workspaces/isolated/objects/isolated.json'),
  JSON.stringify(object('workspace', 'isolated', { name: 'Independent install' })),
);
await writeFile(
  join(workspace, 'workspaces/isolated/objects/article.json'),
  JSON.stringify(
    object('page', 'article', {
      title: 'Article',
      blocks: [
        block('js', 'js', 'const answer = 42;'),
        block('html', 'html', '<h1>Preview</h1>'),
        block('diagram', 'mermaid', 'graph LR\n A --> B'),
      ],
    }),
  ),
);
await writeFile(
  join(workspace, '.tio-page/config.ts'),
  `import { defineSite, slug, type TioObject } from '@glink25/tio-pages';
export default defineSite({ workspaceId: 'isolated', code: { previews: ['html', 'mermaid'] }, template: (objects: readonly TioObject[], { headHtml }) => ({ routes: [{ path: '/' + slug('Hello', false), pageId: 'article', render: (site) => '<html><head>' + headHtml() + '</head><body>' + site.renderPage('article') + '</body></html>' }] }) });`,
);
// The installed binary runs with Node alone; no TypeScript runner or private package is installed.
const cli = join(installed, pkg.bin['tio-pages']);
const log = run(process.execPath, [cli, 'build', workspace], consumer);
const output = join(workspace, '.tio-page/dist');
const html = await readFile(join(output, 'hello/index.html'), 'utf8');
assert(html.includes('--shiki-light'));
assert(html.includes('data-code-preview="html"'));
assert(html.includes('data-code-preview="mermaid"'));
const client = await readFile(join(output, 'tio-code/client.js'), 'utf8');
assert(client.length > 0);
const resources = await readdir(join(output, 'tio-code'));
assert.equal(resources.filter((file) => file.endsWith('.js')).length, 1);
assert.equal(resources.filter((file) => file.endsWith('.svg')).length, 2);
assert(!/mermaid|shiki|BlockNote|React|import\(/i.test(client));
await auditPagesOutput(output);
const objectPath = join(workspace, 'workspaces/isolated/objects/article.json');
const original = await readFile(objectPath, 'utf8');
await writeFile(
  objectPath,
  JSON.stringify(
    object('page', 'article', {
      title: 'Invalid',
      blocks: [block('invalid', 'mermaid', 'graph ???? invalid')],
    }),
  ),
);
assert.throws(() => run(process.execPath, [cli, 'build', workspace], consumer));
assert.equal(await readFile(join(output, 'hello/index.html'), 'utf8'), html);
await writeFile(objectPath, original);
// Check shipped declarations from a normal consumer configuration.
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['workspace/.tio-page/config.ts'],
  }),
);
run(
  process.execPath,
  [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')],
  consumer,
);
// The workspace itself contains no package.json; the CLI discovers its config directly.
assert(!(await readdir(workspace)).includes('package.json'));
console.log(
  `Verified ${packed.name}@${packed.version}: installed tarball, CLI, public types, Shiki and local HTML/Mermaid assets.`,
);
console.log(log.trim());
await cp(join(repo, 'examples/blog/.tio-page'), join(workspace, '.tio-page/blog-template'), {
  recursive: true,
});
// The actual blog template must also use public package exports only.
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['workspace/.tio-page/blog-template/*.ts'],
  }),
);
run(
  process.execPath,
  [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')],
  consumer,
);
console.log(`Package artifact: ${join(artifact, packed.filename)}`);
