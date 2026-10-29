import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
  defaultBlockSpecs,
  filterSuggestionItems,
} from '@blocknote/core';
import { SyntaxHighlightingExtension } from '@blocknote/core/extensions';
import { zh, en } from '@blocknote/core/locales';
import {
  createReactInlineContentSpec,
  createReactBlockSpec,
  useCreateBlockNote,
  SuggestionMenuController,
  DesktopFormattingToolbarController,
  SideMenuController,
  FilePanelController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';

import { paste, ClipboardMetadata, clipboardOriginals } from './clipboard';
import { CodeBlock } from './code-block';
import {
  toEditor,
  fromEditor,
  validateOperationBlocks as validateBlocksForSchema,
  type BlockContentCodec,
} from './codec';
import { EditorLinkToolbar, EditorSideMenu, shadCNComponents } from './components';
import { EditorFilePanel, EditorFormattingToolbar } from './file-panel';
import { insertTransferredFiles } from './file-transfer';
import { EditorInteraction, isolateInteractionNodeView } from './interaction';
import { MentionMenu, SlashMenu } from './mention-menu';
import { MobileEditorToolbar, TouchScroll, useTouchEditing } from './mobile-toolbar';
import { useEditorMotion } from './motion';
export { toEditor, fromEditor, type BlockContentCodec } from './codec';
import type { Block } from '@tio/core';
import { errorMessage, useT, useTranslation } from '@tio/i18n';
import {
  MentionLabel,
  EmptyNotice,
  useTheme,
  useAssetPolicy,
  useNotify,
  PortalContext,
  EditHistoryContext,
  InteractionBoundary,
} from '@tio/ui';
import type { NodeView } from '@tiptap/pm/view';
import { FilePlus, Database, Code } from 'lucide-react';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/shadcn/style.css';
const EmbedContext = createContext<(db: string, view: string) => React.ReactNode>(() => null);
const DatabaseBlock = createReactBlockSpec(
  {
    type: 'databaseView',
    propSchema: { databaseId: { default: '' }, viewId: { default: '' } },
    content: 'none',
  },
  {
    render: function DatabaseBlockRenderer({ block }) {
      const render = useContext(EmbedContext);
      return (
        <InteractionBoundary className="database-embed my-5 block w-full min-w-0">
          {render(block.props.databaseId, block.props.viewId)}
        </InteractionBoundary>
      );
    },
  },
)();
// Keep the block selectable/movable, while its embedded application owns
// events inside the non-editable content. Do not use selectable:false: its
// upstream implementation schedules a blur that can steal an input's focus.
const renderDatabaseBlock = DatabaseBlock.implementation.render!;
DatabaseBlock.implementation.render = function (...args) {
  const rendered = renderDatabaseBlock.apply(this, args);
  if (this.renderType === 'nodeView') {
    isolateInteractionNodeView(rendered as NodeView);
  }
  return rendered;
};
const AppSliceContext = createContext<(block: Block) => React.ReactNode>(() => null);
const AppSliceBlock = createReactBlockSpec(
  {
    type: 'appSlice',
    content: 'none',
    propSchema: {
      title: { default: 'App Slice' },
      html: { default: '<h2>App Slice</h2>' },
      runtimeVersion: { default: 1 },
      height: { default: 320 },
      autoHeight: { default: true },
    },
  },
  {
    render: function AppSliceRenderer({ block }) {
      const render = useContext(AppSliceContext);
      return (
        <div className="w-full min-w-0" contentEditable={false}>
          {render({ ...block, content: [], children: [] } as Block)}
        </div>
      );
    },
  },
)();
const MentionInline = createReactInlineContentSpec(
  {
    type: 'mention',
    propSchema: {
      workspaceId: { default: '' },
      kind: { default: 'page', values: ['page', 'database', 'record', 'github-user'] as const },
      id: { default: '' },
      login: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const { login, ...reference } = inlineContent.props;
      return (
        <MentionLabel
          reference={
            reference.kind === 'github-user'
              ? { ...reference, kind: 'github-user', login }
              : { ...reference, kind: reference.kind }
          }
        />
      );
    },
  },
);
const OpaqueBlock = createReactBlockSpec(
  {
    type: 'unsupported',
    propSchema: { raw: { default: '' }, label: { default: '' } },
    content: 'none',
  },
  {
    render: function UnknownRenderer({ block }) {
      const t = useT();
      return (
        <div contentEditable={false}>
          <EmptyNotice>{t('document.unknownBlock', { type: block.props.label })}</EmptyNotice>
        </div>
      );
    },
  },
)();
export const defaultEditorSchema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: MentionInline },
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: CodeBlock,
    databaseView: DatabaseBlock,
    appSlice: AppSliceBlock,
    unsupported: OpaqueBlock,
  },
});
export interface EditorSchema {
  schema: BlockNoteSchema<any, any, any>;
  codecs?: Record<string, BlockContentCodec>;
  slashItems?: (
    editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  ) => ReturnType<typeof getDefaultReactSlashMenuItems>;
}
export const EditorSchemaContext = createContext<EditorSchema>({ schema: defaultEditorSchema });
export interface EditorProps {
  placeholder?: string;
  renderAppSlice?: (block: Block) => React.ReactNode;
  onSubpage?: () => void;
  onDatabase?: () => void;
  blocks: Block[];
  readOnly?: boolean;
  onChange: (blocks: Block[], previous: Block[], group?: string | null) => void;
  upload: (file: File) => Promise<string>;
  resolve: (url: string) => Promise<string>;
  renderDatabase: (db: string, view: string) => React.ReactNode;
}
/** Renderer defaults are equivalent to omitted properties in the stored document. */
function comparableBlocks(blocks: Block[], schema: EditorSchema['schema']): Block[] {
  return blocks.map((block) => ({
    ...block,
    props: {
      ...Object.fromEntries(
        Object.entries(schema.blockSchema[block.type]?.propSchema ?? {}).map(
          ([key, definition]) => [key, (definition as { default: unknown }).default],
        ),
      ),
      ...block.props,
    },
    children: comparableBlocks(block.children, schema),
  }));
}
function typingBlock(before: Block[], after: Block[]): string | undefined {
  if (before.length !== after.length || before.some((block, i) => block.id !== after[i].id)) return;
  const changed = after.filter((block, i) => JSON.stringify(block) !== JSON.stringify(before[i]));
  if (changed.length !== 1) return;
  const next = changed[0];
  const old = before.find((block) => block.id === next.id)!;
  if (old.type !== next.type || JSON.stringify(old.props) !== JSON.stringify(next.props)) return;
  if (JSON.stringify(old.children) !== JSON.stringify(next.children))
    return JSON.stringify(old.content) === JSON.stringify(next.content)
      ? typingBlock(old.children, next.children)
      : undefined;
  if (!Array.isArray(old.content) || !Array.isArray(next.content)) return;
  const atoms = (parts: unknown[]) =>
    parts.filter(
      (part) => !part || typeof part !== 'object' || !('type' in part) || part.type !== 'text',
    );
  return JSON.stringify(atoms(old.content)) === JSON.stringify(atoms(next.content))
    ? next.id
    : undefined;
}
export function EditorContent({
  placeholder,
  blocks,
  onSubpage,
  onDatabase,
  readOnly,
  onChange,
  upload,
  resolve,
  renderDatabase,
  renderAppSlice,
}: EditorProps) {
  const attachmentPolicy = useAssetPolicy();
  const notify = useNotify();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const floatingMotion = useEditorMotion();
  const t = useT();
  const { schema, codecs, slashItems } = useContext(EditorSchemaContext);
  const { i18n } = useTranslation();
  const theme = useTheme();
  const touch = useTouchEditing();
  const portal = useContext(PortalContext);
  const [chromePortal, setChromePortal] = useState<HTMLDivElement | null>(null);
  const history = useContext(EditHistoryContext);
  const original = useRef(blocks);
  const applying = useRef(false);
  const sent = useRef(new Set<string>());
  const editor = useCreateBlockNote({
    schema,
    _tiptapOptions: {
      editorProps: {
        handleDOMEvents: {
          drop: (_view, event): boolean =>
            insertTransferredFiles(
              event,
              editor,
              attachmentPolicy,
              (error) => notify(errorMessage(error, t)),
              () => active.current,
            ),
        },
      },
    },
    disableExtensions: history ? ['history'] : undefined,
    extensions: [
      TouchScroll(),
      EditorInteraction(),
      ClipboardMetadata({ originals: () => original.current }),
      SyntaxHighlightingExtension({
        createHighlighter: () =>
          import('./code-block/highlighter').then((m) => m.createHighlighter()),
      }),
    ],
    pasteHandler: (context) => {
      history?.breakGroup();
      try {
        if (
          insertTransferredFiles(
            context.event,
            context.editor,
            attachmentPolicy,
            (error) => notify(errorMessage(error, t)),
            () => active.current,
          )
        )
          return true;
        return paste(context);
      } finally {
        history?.breakGroup();
      }
    },
    dictionary: {
      ...(i18n.language === 'zh' ? zh : en),
      placeholders: {
        ...(i18n.language === 'zh' ? zh.placeholders : en.placeholders),
        ...(placeholder ? { default: placeholder, emptyDocument: placeholder } : {}),
      },
    },
    initialContent: blocks.length ? toEditor(blocks, schema, codecs) : undefined,
    uploadFile: upload,
    dropCursor: { color: 'var(--color-muted)', width: 2 },
    resolveFileUrl: resolve,
  });
  useEffect(() => {
    let cancelled = false;
    // BlockNote mounts React node views synchronously; run outside React's effect commit.
    queueMicrotask(() => {
      if (cancelled) return;
      const serialized = JSON.stringify(blocks);
      if (sent.current.delete(serialized)) return;
      const current = fromEditor(
        editor.document,
        clipboardOriginals(editor.prosemirrorState.doc, original.current),
        codecs,
      );
      original.current = blocks;
      if (
        JSON.stringify(comparableBlocks(current, schema)) !==
        JSON.stringify(comparableBlocks(blocks, schema))
      ) {
        applying.current = true;
        try {
          const reconcile = (before: Block[], after: Block[], parentId?: string) => {
            const oldIds = new Set(before.map((b) => b.id));
            const nextIds = new Set(after.map((b) => b.id));
            const retainedBefore = before.filter((b) => nextIds.has(b.id)).map((b) => b.id);
            const retainedAfter = after.filter((b) => oldIds.has(b.id)).map((b) => b.id);
            if (
              JSON.stringify(retainedBefore) !== JSON.stringify(retainedAfter) ||
              !retainedBefore.length
            ) {
              const encoded = toEditor(after, schema, codecs);
              if (parentId) editor.updateBlock(parentId, { children: encoded });
              else
                editor.replaceBlocks(
                  editor.document,
                  encoded.length ? encoded : [{ type: 'paragraph' }],
                );
              return;
            }
            const removed = before.filter((b) => !nextIds.has(b.id));
            if (removed.length) editor.removeBlocks(removed.map((b) => b.id));
            for (let i = 0; i < after.length; i++) {
              const next = after[i];
              const old = before.find((b) => b.id === next.id);
              if (!old) {
                const previous = after[i - 1];
                const following = after.slice(i + 1).find((b) => oldIds.has(b.id));
                editor.insertBlocks(
                  toEditor([next], schema, codecs),
                  previous?.id ?? following!.id,
                  previous ? 'after' : 'before',
                );
              } else if (JSON.stringify(old) !== JSON.stringify(next)) {
                const encoded = toEditor([next], schema, codecs)[0];
                if (old.type !== next.type || encoded.type === 'unsupported')
                  editor.updateBlock(next.id, encoded);
                else {
                  const { children: _children, ...body } = encoded;
                  if (
                    JSON.stringify({ ...old, children: [] }) !==
                    JSON.stringify({ ...next, children: [] })
                  )
                    editor.updateBlock(next.id, body);
                  if (JSON.stringify(old.children) !== JSON.stringify(next.children))
                    reconcile(old.children, next.children, next.id);
                }
              }
            }
          };
          // Preserve unchanged React node views (notably running App Slice channels)
          // while applying external edits and newly inserted database references.
          reconcile(current, blocks);
        } finally {
          applying.current = false;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blocks, editor, schema, codecs]);
  return (
    <EmbedContext.Provider value={renderDatabase}>
      <AppSliceContext.Provider value={renderAppSlice ?? (() => null)}>
        <BlockNoteView
          shadCNComponents={shadCNComponents}
          editor={editor}
          portalElements={
            touch && chromePortal
              ? { default: chromePortal }
              : portal
                ? { default: portal }
                : undefined
          }
          filePanel={false}
          slashMenu={false}
          sideMenu={false}
          linkToolbar={false}
          formattingToolbar={false}
          editable={!readOnly}
          theme={theme}
          onChange={() => {
            if (applying.current) return;
            const previous = original.current;
            const next = fromEditor(
              editor.document,
              clipboardOriginals(editor.prosemirrorState.doc, previous),
              codecs,
            );
            if (
              JSON.stringify(comparableBlocks(next, schema)) ===
              JSON.stringify(comparableBlocks(previous, schema))
            )
              return;
            original.current = next;
            sent.current.add(JSON.stringify(next));
            if (sent.current.size > 500) sent.current.delete(sent.current.values().next().value!);
            const normalizedBefore = comparableBlocks(previous, schema);
            const normalizedAfter = comparableBlocks(next, schema);
            onChange(next, previous, typingBlock(normalizedBefore, normalizedAfter) ?? null);
          }}
        >
          {!readOnly && <MentionMenu />}
          {!readOnly && (
            <FilePanelController filePanel={EditorFilePanel} floatingUIOptions={floatingMotion} />
          )}
          {!readOnly &&
            (touch ? (
              <MobileEditorToolbar onPortal={setChromePortal} />
            ) : (
              <>
                <DesktopFormattingToolbarController
                  formattingToolbar={EditorFormattingToolbar}
                  floatingUIOptions={floatingMotion}
                />
                <EditorLinkToolbar />
                <SideMenuController sideMenu={EditorSideMenu} floatingUIOptions={floatingMotion} />
              </>
            ))}
          <SuggestionMenuController
            floatingUIOptions={{
              ...floatingMotion,
              elementProps: { className: 'tio-suggestion-floating' },
            }}
            triggerCharacter="/"
            suggestionMenuComponent={SlashMenu}
            getItems={async (query) =>
              filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
                  ...(schema.blockSchema.codeBlock?.propSchema.displayMode
                    ? [
                        {
                          title: 'Mermaid',
                          group: t('workspace.name'),
                          aliases: ['diagram', 'flowchart', '流程图', '图表'],
                          icon: <Code size={18} />,
                          onItemClick: () =>
                            editor.insertBlocks(
                              [
                                {
                                  type: 'codeBlock',
                                  props: { language: 'mermaid', displayMode: 'split' },
                                },
                              ],
                              editor.getTextCursorPosition().block,
                              'after',
                            ),
                        },
                      ]
                    : []),
                  ...(renderAppSlice
                    ? [
                        {
                          title: 'App Slice',
                          group: t('workspace.name'),
                          aliases: ['app', 'slice', 'html', '应用'],
                          icon: <Code size={18} />,
                          onItemClick: () => {
                            editor.insertBlocks(
                              [{ type: 'appSlice' }],
                              editor.getTextCursorPosition().block,
                              'after',
                            );
                          },
                        },
                      ]
                    : []),
                  ...(slashItems?.(editor) ?? []),
                  ...(onSubpage
                    ? [
                        {
                          title: t('page.child'),
                          group: t('workspace.name'),
                          aliases: ['page', 'subpage', '子页面'],
                          icon: <FilePlus size={18} />,
                          onItemClick: onSubpage,
                        },
                      ]
                    : []),
                  ...(onDatabase
                    ? [
                        {
                          title: t('document.embed'),
                          group: t('workspace.name'),
                          aliases: ['database', '数据库'],
                          icon: <Database size={18} />,
                          onItemClick: onDatabase,
                        },
                      ]
                    : []),
                ],
                query,
              )
            }
          />
        </BlockNoteView>
      </AppSliceContext.Provider>
    </EmbedContext.Provider>
  );
}

export function Editor(props: EditorProps) {
  const { i18n } = useTranslation();
  return <EditorContent key={i18n.language} {...props} />;
}

export function validateOperationBlocks(before: Block[], after: Block[]) {
  validateBlocksForSchema(before, after, defaultEditorSchema);
}

/** Serializable metadata only; no editor instance or DOM is needed for discovery. */
export function operationContentSchema() {
  return {
    blocks: Object.fromEntries(
      Object.entries(defaultEditorSchema.blockSchema)
        .filter(([name]) => name !== 'unsupported')
        .map(([name, spec]) => [name, { content: spec.content, props: spec.propSchema }]),
    ),
    styles: Object.fromEntries(
      Object.entries(defaultEditorSchema.styleSchema).map(([name, spec]) => [
        name,
        { propSchema: spec.propSchema },
      ]),
    ),
    inlineTypes: Object.keys(defaultEditorSchema.inlineContentSchema),
    textExample: { type: 'text', text: 'Text', styles: {} },
    mentionExample: {
      type: 'mention',
      props: { workspaceId: 'current_workspace', kind: 'page', id: 'page_id' },
    },
  };
}
