import { readdirSync, readFileSync } from 'node:fs';

import postcss from 'postcss';

const assets = new URL('../../packages/web-editor/dist/assets/', import.meta.url);
for (const file of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
  postcss.parse(readFileSync(new URL(file, assets), 'utf8')).walkRules((rule) => {
    let parent = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return;
      parent = parent.parent;
    }
    // Nested rules inherit their parent boundary.
    if (rule.parent?.type === 'rule') return;
    if (!rule.selector.includes('.tio-editor'))
      throw new Error(`Unscoped editor CSS in ${file}: ${rule.selector}`);
  });
}
console.log('Compiled editor CSS is scoped.');
