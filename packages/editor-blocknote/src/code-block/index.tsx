import { createCodeBlockSpec } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { codeText } from '@tio/core';
import { useT } from '@tio/i18n';
import { SelectInput } from '@tio/ui';
import { LoadingIndicator } from '@tio/ui';
import { lazy, Suspense, useState } from 'react';

import { languages, languageId } from './languages';
import { PreviewBoundary } from './preview-boundary';

const previews = {
  mermaid: lazy(() => import('./preview')),
  html: lazy(() => import('./html-preview')),
};
function previewFor(language: string) {
  return Object.hasOwn(previews, language)
    ? previews[language as keyof typeof previews]
    : undefined;
}
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
      const t = useT();
      const [temporaryMode, setTemporaryMode] = useState<Mode>();
      const id = languageId(block.props.language);
      const Preview = previewFor(id);
      const mode = editor.isEditable
        ? block.props.displayMode
        : (temporaryMode ?? block.props.displayMode);
      return (
        <div className="tio-code-block" data-mode={Preview ? mode : 'code'}>
          <div className="tio-code-toolbar" contentEditable={false}>
            <SelectInput
              aria-label={t('codeBlock.language')}
              value={id}
              disabled={!editor.isEditable}
              onValueChange={(value) => {
                const language = value;
                editor.updateBlock(block, {
                  props: { language, ...(previewFor(language) ? { displayMode: 'split' } : {}) },
                });
              }}
            >
              {!Object.hasOwn(languages, id) && <option value={id}>{block.props.language}</option>}
              {Object.entries(languages).map(([value, item]) => (
                <option key={value} value={value}>
                  {value === 'text' ? t('codeBlock.plainText') : item.name}
                </option>
              ))}
            </SelectInput>
            {Preview && (
              <fieldset aria-label={t('codeBlock.displayMode')}>
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
                    {t(`codeBlock.${value}`)}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
          <div className="tio-code-body">
            <pre className="tio-code-source" hidden={Preview && mode === 'preview'}>
              <code ref={contentRef} />
            </pre>
            {Preview && mode !== 'code' && (
              <div className="tio-code-preview" contentEditable={false}>
                <PreviewBoundary key={id} message={t('codeBlock.previewFailed')}>
                  <Suspense fallback={<LoadingIndicator />}>
                    <Preview source={codeText(block.content)} />
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
