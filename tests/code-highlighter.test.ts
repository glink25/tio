import { expect, it } from 'vitest';

import { createHighlighter } from '../packages/editor-blocknote/src/code-block/highlighter';
import { languageId, languages } from '../packages/editor-blocknote/src/code-block/languages';

it('loads grammars individually and produces dual-theme tokens for all offered languages', async () => {
  const highlighter = await createHighlighter();
  expect(highlighter.getLoadedLanguages()).toEqual([]);
  try {
    await highlighter.loadLanguage('javascript');
    expect(highlighter.getLoadedLanguages()).toContain('javascript');
    expect(highlighter.getLoadedLanguages()).not.toContain('python');
    const html = highlighter.codeToHtml('const answer = "hello";', {
      lang: 'javascript',
      themes: { light: 'light-plus', dark: 'dark-plus' },
      defaultColor: false,
    });
    expect(html).toContain('--shiki-light');
    expect(html).toContain('--shiki-dark');
    for (const id of Object.keys(languages).filter((id) => id !== 'text')) {
      await highlighter.loadLanguage(id);
      expect(() =>
        highlighter.codeToTokens('example', { lang: id, theme: 'light-plus' }),
      ).not.toThrow();
    }
    await expect(highlighter.loadLanguage('unknown')).rejects.toThrow('Unsupported language');
    await expect(highlighter.loadLanguage('constructor')).rejects.toThrow('Unsupported language');
  } finally {
    highlighter.dispose();
  }
});
it('normalizes language aliases without inventing support for unknown languages', () => {
  expect(languageId(' TS ')).toBe('typescript');
  expect(languageId('bash')).toBe('shellscript');
  expect(languageId('c++')).toBe('cpp');
  expect(languageId('future')).toBe('future');
});
