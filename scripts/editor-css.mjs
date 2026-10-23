/** Scope the compiled editor stylesheet, including third-party rules, in dev and production. */
export function editorCss() {
  return {
    postcssPlugin: 'tio-editor-boundary',
    OnceExit(root) {
      const file = root.source?.input.file ?? '';
      if (!/web-editor\/src\/style\.css|@blocknote|@glideapps/.test(file)) return;
      root.walkRules((rule) => {
        let parent = rule.parent;
        while (parent && parent !== root) {
          if (
            parent.type === 'rule' ||
            (parent.type === 'atrule' && /keyframes$/.test(parent.name))
          )
            return;
          parent = parent.parent;
        }
        rule.selectors = rule.selectors.map((selector) => {
          if (selector.includes('.tio-editor')) return selector;
          if (
            selector === ':root' ||
            selector === ':host' ||
            selector === 'html' ||
            selector === 'body'
          )
            return '.tio-editor';
          return ':where(.tio-editor) ' + selector;
        });
      });
    },
  };
}
