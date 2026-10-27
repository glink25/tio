import { createCodeBlockSpec } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { codeText } from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { lazy, Suspense, useState } from 'react';

import { languages, languageId } from './languages';
import { PreviewBoundary } from './preview-boundary';

const MermaidPreview = lazy(() => import('./preview'));
const base = createCodeBlockSpec({ supportedLanguages: languages });
type Mode = 'code' | 'preview' | 'split';
export const CodeBlock = createReactBlockSpec(
  {
    ...base.config,
    propSchema: {
      ...base.config.propSchema,
      displayMode: { default: 'preview' as const, values: ['code', 'preview', 'split'] as const },
    },
  },
  {
    parse: base.implementation.parse,
    parseContent: base.implementation.parseContent,
    meta: {
      ...base.implementation.meta,
      highlight: (block) => {
        const id = languageId(block.props.language);
        return id === 'text' || !Object.hasOwn(languages, id) ? undefined : id;
      },
    },
    render: function CodeBlockView({ block, editor, contentRef }) {
      const { i18n } = useTranslation();
      const zh = i18n.language === 'zh';
      const [temporaryMode, setTemporaryMode] = useState<Mode>();
      const id = languageId(block.props.language);
      const diagram = id === 'mermaid';
      const mode = editor.isEditable
        ? block.props.displayMode
        : (temporaryMode ?? block.props.displayMode);
      return (
        <div className="tio-code-block" data-mode={diagram ? mode : 'code'}>
          <div className="tio-code-toolbar" contentEditable={false}>
            <select
              aria-label={zh ? '代码语言' : 'Code language'}
              value={id}
              disabled={!editor.isEditable}
              onChange={(event) => {
                const language = event.target.value;
                editor.updateBlock(block, {
                  props: { language, ...(language === 'mermaid' ? { displayMode: 'split' } : {}) },
                });
              }}
            >
              {!Object.hasOwn(languages, id) && <option value={id}>{block.props.language}</option>}
              {Object.entries(languages).map(([value, item]) => (
                <option key={value} value={value}>
                  {value === 'text' && zh ? '纯文本' : item.name}
                </option>
              ))}
            </select>
            {diagram && (
              <fieldset aria-label={zh ? '图表显示模式' : 'Diagram display mode'}>
                {(['code', 'preview', 'split'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={mode === value}
                    onClick={() => {
                      if (editor.isEditable)
                        editor.updateBlock(block, { props: { displayMode: value } });
                      else setTemporaryMode(value);
                    }}
                  >
                    {zh
                      ? { code: '代码', preview: '预览', split: '分屏' }[value]
                      : { code: 'Code', preview: 'Preview', split: 'Split' }[value]}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
          <div className="tio-code-body">
            <pre className="tio-code-source" hidden={diagram && mode === 'preview'}>
              <code ref={contentRef} />
            </pre>
            {diagram && mode !== 'code' && (
              <div className="tio-code-preview" contentEditable={false}>
                <PreviewBoundary
                  message={
                    zh
                      ? '预览加载失败，请重新打开页面。源码仍可编辑。'
                      : 'Preview could not load. Reopen the page to retry. Source remains editable.'
                  }
                >
                  <Suspense fallback={<output>{zh ? '正在加载…' : 'Loading…'}</output>}>
                    <MermaidPreview source={codeText(block.content)} />
                  </Suspense>
                </PreviewBoundary>
              </div>
            )}
          </div>
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <pre>
        <code className={'language-' + block.props.language}>{codeText(block.content)}</code>
      </pre>
    ),
  },
  base.extensions,
)();
