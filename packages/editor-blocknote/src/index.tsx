import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core';
import { zh, en } from '@blocknote/core/locales';
import {
  createReactBlockSpec,
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react';
import { BlockNoteView, ShadCNDefaultComponents } from '@blocknote/shadcn';
import type { Block } from '@tio/core';
import { useT, useTranslation } from '@tio/i18n';
import { EmptyNotice, useTheme, useMobile, IconButton, PortalContext } from '@tio/ui';
import { FilePlus, Link, Database, Bold, Italic, Code, Undo2, Redo2, Plus } from 'lucide-react';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/shadcn/style.css';
// The upstream shadcn render functions accept React 19 ref props. Bridge the
// two trigger components to React 18 without changing their Base UI behavior.
const shadCNComponents = {
  Button: {
    Button: React.forwardRef<
      HTMLButtonElement,
      React.ComponentProps<typeof ShadCNDefaultComponents.Button.Button>
    >((props, ref) =>
      ShadCNDefaultComponents.Button.Button({ ...props, ref }),
    ) as typeof ShadCNDefaultComponents.Button.Button,
  },
  DropdownMenu: {
    ...ShadCNDefaultComponents.DropdownMenu,
    DropdownMenuTrigger: React.forwardRef<
      HTMLButtonElement,
      React.ComponentProps<typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuTrigger>
    >((props, ref) =>
      ShadCNDefaultComponents.DropdownMenu.DropdownMenuTrigger({ ...props, ref }),
    ) as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuTrigger,
  },
};
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
        <div className="database-embed my-5 block w-full min-w-0" contentEditable={false}>
          {render(block.props.databaseId, block.props.viewId)}
        </div>
      );
    },
  },
)();
const PageContext = createContext<(id: string) => React.ReactNode>(() => null);
const PageReferenceBlock = createReactBlockSpec(
  {
    type: 'pageReference',
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  {
    render: function PageReferenceRenderer({ block }) {
      const render = useContext(PageContext);
      return (
        <div className="w-full" contentEditable={false}>
          {render(block.props.pageId)}
        </div>
      );
    },
  },
)();
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
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    databaseView: DatabaseBlock,
    pageReference: PageReferenceBlock,
    unsupported: OpaqueBlock,
  },
});
const blockTypes = new Set(Object.keys(schema.blockSchema));
const styles = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'textColor',
  'backgroundColor',
]);
function safeInline(content: any): boolean {
  if (!Array.isArray(content)) return true;
  return content.every(
    (c) =>
      typeof c === 'string' ||
      (c.type === 'text' &&
        Object.keys(c).every((k) => ['type', 'text', 'styles'].includes(k)) &&
        Object.keys(c.styles ?? {}).every((s) => styles.has(s))) ||
      (c.type === 'link' &&
        Object.keys(c).every((k) => ['type', 'href', 'content'].includes(k)) &&
        typeof c.href === 'string' &&
        /^(https?:|mailto:|#)/.test(c.href) &&
        safeInline(c.content)),
  );
}
export function toEditor(blocks: Block[]): any[] {
  return blocks.map((b) =>
    !blockTypes.has(b.type) || b.type === 'unsupported' || !safeInline(b.content)
      ? { id: b.id, type: 'unsupported', props: { raw: JSON.stringify(b), label: b.type } }
      : {
          id: b.id,
          type: b.type,
          props: b.props,
          ...(['databaseView', 'pageReference'].includes(b.type) ? {} : { content: b.content }),
          children: toEditor(b.children),
        },
  );
}
export function fromEditor(blocks: any[], previous: Block[]): Block[] {
  const originals = new Map<string, Block>();
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      originals.set(b.id, b);
      walk(b.children);
    }
  };
  walk(previous);
  const convert = (b: any): Block => {
    if (b.type === 'unsupported') {
      const raw = JSON.parse(b.props.raw);
      return { ...raw, id: b.id };
    }
    const old = originals.get(b.id);
    return {
      ...old,
      id: b.id,
      type: b.type,
      props: { ...(old?.type === b.type ? old?.props : {}), ...b.props },
      content: b.content ?? [],
      children: (b.children ?? []).map(convert),
    };
  };
  return blocks.map(convert);
}
export interface EditorProps {
  onSubpage?: () => void;
  onReference?: () => void;
  onDatabase?: () => void;
  blocks: Block[];
  readOnly?: boolean;
  onChange: (blocks: Block[], previous: Block[]) => void;
  upload: (file: File) => Promise<string>;
  resolve: (url: string) => Promise<string>;
  renderPageReference?: (id: string) => React.ReactNode;
  renderDatabase: (db: string, view: string) => React.ReactNode;
}
export function EditorContent({
  blocks,
  onSubpage,
  onReference,
  onDatabase,
  readOnly,
  onChange,
  upload,
  resolve,
  renderDatabase,
  renderPageReference,
}: EditorProps) {
  const t = useT();
  const { i18n } = useTranslation();
  const theme = useTheme();
  const mobile = useMobile();
  const portal = useContext(PortalContext);
  const [focused, setFocused] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      setKeyboardOffset(
        Math.max(
          0,
          window.innerHeight -
            (viewport?.height ?? window.innerHeight) -
            (viewport?.offsetTop ?? 0),
        ),
      );
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    update();
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, []);
  const original = useRef(blocks);
  const applying = useRef(false);
  const sent = useRef(new Set<string>());
  const editor = useCreateBlockNote({
    schema,
    dictionary: i18n.language === 'zh' ? zh : en,
    initialContent: blocks.length ? toEditor(blocks) : undefined,
    uploadFile: upload,
    resolveFileUrl: resolve,
  });
  useEffect(() => {
    let cancelled = false;
    // BlockNote mounts React node views synchronously; run outside React's effect commit.
    queueMicrotask(() => {
      if (cancelled) return;
      const serialized = JSON.stringify(blocks);
      if (sent.current.delete(serialized)) return;
      const current = fromEditor(editor.document, original.current);
      original.current = blocks;
      if (JSON.stringify(current) !== serialized) {
        applying.current = true;
        editor.replaceBlocks(
          editor.document,
          toEditor(
            blocks.length
              ? blocks
              : [
                  {
                    id: crypto.randomUUID(),
                    type: 'paragraph',
                    props: {},
                    content: [],
                    children: [],
                  },
                ],
          ),
        );
        applying.current = false;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blocks, editor]);
  return (
    <PageContext.Provider
      value={renderPageReference ?? (() => <EmptyNotice>{t('page.missing')}</EmptyNotice>)}
    >
      <EmbedContext.Provider value={renderDatabase}>
        <BlockNoteView
          shadCNComponents={shadCNComponents}
          editor={editor}
          portalElements={portal ? { default: portal } : undefined}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
          slashMenu={false}
          editable={!readOnly}
          theme={theme}
          onChange={() => {
            if (applying.current) return;
            const previous = original.current;
            const next = fromEditor(editor.document, previous);
            original.current = next;
            sent.current.add(JSON.stringify(next));
            if (sent.current.size > 500) sent.current.delete(sent.current.values().next().value!);
            onChange(next, previous);
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
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
                  ...(onReference
                    ? [
                        {
                          title: t('page.reference'),
                          group: t('workspace.name'),
                          aliases: ['link', 'reference', '引用'],
                          icon: <Link size={18} />,
                          onItemClick: onReference,
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
        {mobile && focused && !readOnly && (
          <div
            role="toolbar"
            aria-label={t('common.edit')}
            className="fixed inset-x-0 z-40 flex items-center justify-center gap-2 border-t border-line bg-panel px-3 py-1 shadow-lg"
            style={{
              bottom: keyboardOffset,
              paddingBottom: 'max(4px, env(safe-area-inset-bottom))',
            }}
            onPointerDown={(e) => e.preventDefault()}
          >
            <IconButton
              label={t('common.create')}
              onClick={() => {
                editor.focus();
                editor.insertInlineContent('/');
              }}
            >
              <Plus size={18} />
            </IconButton>
            <IconButton
              label={i18n.language === 'zh' ? '粗体' : 'Bold'}
              onClick={() => editor.toggleStyles({ bold: true })}
            >
              <Bold size={18} />
            </IconButton>
            <IconButton
              label={i18n.language === 'zh' ? '斜体' : 'Italic'}
              onClick={() => editor.toggleStyles({ italic: true })}
            >
              <Italic size={18} />
            </IconButton>
            <IconButton
              label={i18n.language === 'zh' ? '代码' : 'Code'}
              onClick={() => editor.toggleStyles({ code: true })}
            >
              <Code size={18} />
            </IconButton>
            <IconButton label={t('common.undo')} onClick={() => editor.undo()}>
              <Undo2 size={18} />
            </IconButton>
            <IconButton
              label={i18n.language === 'zh' ? '重做' : 'Redo'}
              onClick={() => editor.redo()}
            >
              <Redo2 size={18} />
            </IconButton>
          </div>
        )}
      </EmbedContext.Provider>
    </PageContext.Provider>
  );
}

export function Editor(props: EditorProps) {
  const { i18n } = useTranslation();
  return <EditorContent key={i18n.language} {...props} />;
}
