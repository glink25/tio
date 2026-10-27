import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const loaders = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mermaid: () => import('shiki/langs/mermaid.mjs'),
};
// Core's loadLanguage accepts registrations; the BlockNote adapter requests IDs.
export async function createHighlighter() {
  const highlighter = await createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import('shiki/themes/light-plus.mjs'), import('shiki/themes/dark-plus.mjs')],
    langs: [],
  });
  const load = highlighter.loadLanguage.bind(highlighter);
  const pending = new Map<string, Promise<void>>();
  const adapter = Object.create(highlighter) as Awaited<ReturnType<typeof createHighlighterCore>>;
  adapter.loadLanguage = async (...requested: Parameters<typeof load>) => {
    await Promise.all(
      requested.map(async (language) => {
        if (typeof language !== 'string') return load(language);
        if (!Object.hasOwn(loaders, language)) throw new Error(`Unsupported language: ${language}`);
        const loader = loaders[language as keyof typeof loaders];
        if (!pending.has(language))
          pending.set(
            language,
            loader()
              .then((m) => load(m.default))
              .catch((error) => {
                pending.delete(language);
                throw error;
              }),
          );
        await pending.get(language);
      }),
    );
  };
  return adapter;
}
