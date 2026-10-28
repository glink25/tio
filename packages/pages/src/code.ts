import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeText, valueText, type Block, type TioObject } from '@tio/core';
import { build } from 'esbuild';
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
} from 'shiki';

import { renderDiagrams, type MermaidOptions } from './mermaid';
import { escapeHtml as e, type RenderContext } from './ssr';

export type CodeDisplayMode = 'code' | 'preview' | 'split';
export interface CodeOptions {
  themes?: { light: string; dark: string };
  defaultMode?: CodeDisplayMode;
  previews?: ('html' | 'mermaid')[];
  assetDirectory?: string;
  mermaid?: MermaidOptions;
  labels?: Partial<Record<CodeDisplayMode | 'displayMode' | 'htmlPreview', string>>;
}
export interface CodeRenderer {
  renderBlock: NonNullable<RenderContext['renderBlock']>;
  files: Map<string, Uint8Array>;
  scripts: string[];
}
const modes: CodeDisplayMode[] = ['code', 'preview', 'split'];
const aliases = new Map(
  bundledLanguagesInfo.flatMap((language) =>
    [language.id, ...(language.aliases ?? [])].map((alias) => [alias, language.id]),
  ),
);
const languageOf = (block: Block) => {
  const input = valueText(block.props.language).trim().toLowerCase();
  return aliases.get(input) ?? input;
};
function codeBlocks(objects: readonly TioObject[]) {
  const result: Block[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === 'codeBlock') result.push(block);
      walk(block.children);
    }
  };
  for (const object of objects) walk(object.blocks ?? []);
  return result;
}
/** Build-time highlighting, with browser enhancement emitted only for enabled previews. */
export async function createCodeRenderer(
  objects: readonly TioObject[],
  options: CodeOptions = {},
): Promise<CodeRenderer> {
  const blocks = codeBlocks(objects);
  const themes = (options.themes ?? { light: 'light-plus', dark: 'dark-plus' }) as {
    light: BundledTheme;
    dark: BundledTheme;
  };
  const langs = [
    ...new Set(
      blocks
        .map(languageOf)
        .filter((lang): lang is BundledLanguage => Object.hasOwn(bundledLanguages, lang)),
    ),
  ];
  const highlighter = blocks.length
    ? await createHighlighter({ langs, themes: [themes.light, themes.dark] })
    : undefined;
  const highlighted = new Map<string, string>();
  const key = (block: Block) => JSON.stringify([languageOf(block), codeText(block.content)]);
  try {
    for (const block of blocks) {
      const lang = languageOf(block);
      highlighted.set(
        key(block),
        highlighter!.codeToHtml(codeText(block.content), {
          lang: Object.hasOwn(bundledLanguages, lang) ? (lang as BundledLanguage) : 'text',
          themes,
          defaultColor: false,
        }),
      );
    }
  } finally {
    highlighter?.dispose();
  }
  const labels = {
    code: 'Code',
    preview: 'Preview',
    split: 'Split',
    displayMode: 'Display mode',
    htmlPreview: 'HTML preview',
    ...options.labels,
  };
  const canPreview = (block: Block) =>
    options.previews?.includes(languageOf(block) as 'html' | 'mermaid') ?? false;
  const files = new Map<string, Uint8Array>();
  const scripts: string[] = [];
  const directory = options.assetDirectory ?? 'tio-code';
  if (
    !/^[A-Za-z0-9_/-]+$/.test(directory) ||
    directory.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid code asset directory');
  const diagrams = await renderDiagrams(
    blocks
      .filter((block) => canPreview(block) && languageOf(block) === 'mermaid')
      .map((block) => codeText(block.content)),
    files,
    directory,
    options.mermaid,
  );
  if (blocks.some((block) => canPreview(block) && languageOf(block) === 'html')) {
    const result = await build({
      entryPoints: { client: fileURLToPath(import.meta.resolve('@glink25/tio-pages/client')) },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
      minify: true,
      outfile: 'client.js',
    });
    for (const file of result.outputFiles)
      files.set(directory + '/' + basename(file.path), file.contents);
    scripts.push('/' + directory + '/client.js');
  }
  return {
    files,
    scripts,
    renderBlock(block, context) {
      if (block.type !== 'codeBlock') return undefined;
      const source = highlighted.get(key(block));
      if (source === undefined) throw new Error(`Code block was not prepared: ${block.id}`);
      const preview = canPreview(block);
      const requested = block.props.displayMode ?? options.defaultMode ?? 'preview';
      if (!modes.includes(requested as CodeDisplayMode))
        throw new Error(`Invalid code display mode: ${block.id}`);
      const mode = preview ? requested : 'code';
      if (!preview)
        return (
          source.replace('<pre ', `<pre id="${e(block.id)}" `) +
          (block.children.length ? context.renderChildren(block.children) : '')
        );
      const language = languageOf(block);
      if (language === 'html') context.requireScript?.(scripts[0]);
      const toolbar = `<fieldset aria-label="${e(labels.displayMode)}">${modes.map((value) => `<label><input type="radio" name="mode-${e(block.id)}" value="${value}"${value === mode ? ' checked' : ''}>${e(labels[value])}</label>`).join('')}</fieldset>`;
      const image = diagrams.get(codeText(block.content));
      const picture =
        language === 'mermaid' && image
          ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${e(image.dark)}"><img src="${e(image.light)}" alt="Mermaid diagram" loading="lazy"></picture>`
          : '';
      return `<section id="${e(block.id)}" class="tio-code-block" data-mode="${e(mode)}" data-code-preview="${language}"><div class="tio-code-toolbar"><span>${e(valueText(block.props.language))}</span>${toolbar}</div><div class="tio-code-body"><div class="tio-code-source">${source}</div><div class="tio-code-preview"${language === 'html' ? ` data-preview-title="${e(labels.htmlPreview)}"` : ''}>${picture}</div></div></section>${block.children.length ? context.renderChildren(block.children) : ''}`;
    },
  };
}
