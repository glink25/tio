import { blockToNode, createExtension, type BlockNoteEditorOptions } from '@blocknote/core';
import type { Block } from '@tio/core';
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

/** Require an actual HTML tag, rather than treating every angle bracket as markup. */
export function isHTMLSource(text: string): boolean {
  const source = text.trim();
  return (
    !/^(`{3,}|~{3,})/.test(source) &&
    /^(?:<!doctype\s+html\s*>\s*)?<(?:html|head|body|div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|code|strong|em|b|i|a|u|s|del|mark|sup|sub|span|img|hr|br|article|section|main|header|footer|nav|aside|figure|figcaption|dl|dt|dd|video|audio)(?:\s[^<>]*|\s*)>/i.test(
      source,
    )
  );
}

export const paste: NonNullable<BlockNoteEditorOptions<any, any, any>['pasteHandler']> = ({
  event,
  editor,
  defaultPasteHandler,
}) => {
  const data = event.clipboardData;
  if (!data) return false;
  const text = data.getData('text/plain');
  const { $from } = editor.prosemirrorState.selection;
  let inCode = !!$from.parent.type.spec.code;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'codeBlock') inCode = true;
  }
  // ProseMirror tracks Shift for Cmd/Ctrl+Shift+V; ClipboardEvent has no shiftKey.
  if (
    inCode ||
    (editor.prosemirrorView as unknown as { input: { shiftKey: boolean } }).input.shiftKey
  ) {
    editor.pasteText(text);
    return true;
  }
  const insert = (blocks: ReturnType<typeof editor.tryParseHTMLToBlocks>) => {
    const prepare = (items: typeof blocks) =>
      items.forEach((block) => {
        if (
          block.type === 'codeBlock' &&
          editor.schema.blockSchema.codeBlock?.propSchema.displayMode
        )
          block.props.displayMode = 'code';
        prepare(block.children);
      });
    prepare(blocks);
    if (!blocks.length) {
      editor.pasteText(text);
      return;
    }
    // An open HTML clipboard slice can merge a heading into the surrounding paragraph.
    // Keep structural imports closed, while ordinary inline prose retains native insertion.
    if (blocks.every((block) => block.type === 'paragraph' && !block.children.length)) {
      editor.pasteHTML(editor.blocksToFullHTML(blocks), true);
    } else {
      const nodes = blocks.map((block) => blockToNode(block, editor.prosemirrorState.schema));
      editor.transact((tr) =>
        tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView(),
      );
    }
  };
  try {
    if (data.types.includes('blocknote/html')) {
      const native = new DOMParser().parseFromString(data.getData('blocknote/html'), 'text/html');
      const root = native.body.firstElementChild;
      // Select-all serializes the document's blockGroup, which otherwise becomes
      // a nested group underneath the destination paragraph.
      if (
        root?.getAttribute('data-node-type') === 'blockGroup' &&
        root.getAttribute('data-pm-slice') === '0 0 []'
      ) {
        root.firstElementChild?.setAttribute('data-pm-slice', '0 0 []');
        editor.pasteHTML(root.innerHTML, true);
        return true;
      }
      return defaultPasteHandler();
    }
    if (isHTMLSource(text)) {
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      parsed
        .querySelectorAll('script,style,iframe,object,embed,link,meta')
        .forEach((el) => el.remove());
      for (const el of parsed.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (
            /^on/i.test(attr.name) ||
            attr.name === 'srcdoc' ||
            (['href', 'src'].includes(attr.name) &&
              /^\s*(?:javascript|vbscript|data):/i.test(attr.value))
          )
            el.removeAttribute(attr.name);
        }
      }
      if (!parsed.body.textContent?.trim() && !parsed.body.querySelector('img,hr,br')) {
        editor.pasteText(text);
      } else insert(editor.tryParseHTMLToBlocks(parsed.body.innerHTML));
      return true;
    }
    if (data.types.includes('text/markdown')) {
      insert(editor.tryParseMarkdownToBlocks(data.getData('text/markdown')));
      return true;
    }
    if (data.types.includes('text/html') && !data.types.includes('vscode-editor-data')) {
      insert(editor.tryParseHTMLToBlocks(data.getData('text/html')));
      return true;
    }
    if (text && !data.types.includes('vscode-editor-data')) {
      insert(editor.tryParseMarkdownToBlocks(text));
      return true;
    }
    return defaultPasteHandler({ prioritizeMarkdownOverHTML: false });
  } catch {
    editor.pasteText(text);
    return true;
  }
};

/** Carry fields outside BlockNote's schema through its native, selection-aware clipboard. */
export const ClipboardMetadata = createExtension(
  ({ editor, options }: { editor: any; options: { originals: () => Block[] } }) => ({
    key: 'tioClipboardMetadata',
    tiptapExtensions: [
      Extension.create({
        name: 'tioClipboardAttributes',
        addGlobalAttributes() {
          return [
            {
              types: ['blockContainer'],
              attributes: {
                tioMetadata: {
                  default: null,
                  parseHTML: (el: HTMLElement) => el.getAttribute('data-tio-metadata'),
                  renderHTML: (attrs: Record<string, unknown>) =>
                    attrs.tioMetadata ? { 'data-tio-metadata': attrs.tioMetadata } : {},
                },
              },
            },
          ];
        },
      }),
    ],
    prosemirrorPlugins: [
      new Plugin({
        props: {
          transformCopied(slice) {
            const originals = new Map<string, Block>();
            const collect = (blocks: Block[]) =>
              blocks.forEach((b) => {
                originals.set(b.id, b);
                collect(b.children);
              });
            collect(options.originals());
            const convert = (fragment: Fragment): Fragment => {
              const nodes: Node[] = [];
              fragment.forEach((node) => {
                const original = originals.get(node.attrs.id);
                if (
                  node.type.name === 'blockContainer' &&
                  original &&
                  node.firstChild?.type.name !== 'unsupported'
                ) {
                  const {
                    id: _id,
                    type: _type,
                    content: _content,
                    children: _children,
                    props,
                    ...extra
                  } = original;
                  const schemaProps = editor.schema.blockSchema[original.type]?.propSchema ?? {};
                  const unknownProps = Object.fromEntries(
                    Object.entries(props).filter(([key]) => !Object.hasOwn(schemaProps, key)),
                  );
                  nodes.push(
                    node.type.create(
                      {
                        ...node.attrs,
                        tioMetadata: JSON.stringify({
                          extra,
                          type: original.type,
                          props: unknownProps,
                        }),
                      },
                      convert(node.content),
                      node.marks,
                    ),
                  );
                } else nodes.push(node.isText ? node : node.copy(convert(node.content)));
              });
              return Fragment.from(nodes);
            };
            return new Slice(convert(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
    ],
  }),
);

export function clipboardOriginals(doc: Node, previous: Block[]): Block[] {
  const originals = new Map<string, Block>();
  doc.descendants((node) => {
    if (node.type.name !== 'blockContainer' || !node.attrs.tioMetadata) return;
    try {
      const metadata = JSON.parse(node.attrs.tioMetadata);
      if (metadata && typeof metadata.extra === 'object' && typeof metadata.props === 'object')
        originals.set(node.attrs.id, {
          ...metadata.extra,
          id: node.attrs.id,
          type: metadata.type,
          props: metadata.props,
          content: [],
          children: [],
        });
    } catch {
      /* Malformed clipboard metadata is not part of the document. */
    }
  });
  const collect = (blocks: Block[]) =>
    blocks.forEach((block) => {
      originals.set(block.id, block);
      collect(block.children);
    });
  collect(previous);
  return [...originals.values()];
}
