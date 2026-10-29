import type { BlockNoteEditor } from '@blocknote/core';
import { validateAssetSize, type AssetPolicy } from '@tio/core';

type Editor = BlockNoteEditor<any, any, any>;

/** Own native file transfers so rejected uploads always leave an editable document. */
export function insertTransferredFiles(
  event: DragEvent | ClipboardEvent,
  editor: Editor,
  policy: AssetPolicy,
  notify: (error: unknown) => void,
  active: () => boolean,
) {
  const data = 'dataTransfer' in event ? event.dataTransfer : event.clipboardData;
  if (!editor.isEditable || !data?.files.length) return false;
  // Internal block moves and rich clipboard content retain BlockNote's normal precedence.
  if (
    ['vscode-editor-data', 'blocknote/html', 'text/markdown', 'text/html', 'text/plain'].some(
      (type) => data.types.includes(type),
    )
  )
    return false;
  event.preventDefault();
  const files = Array.from(data.files).filter((file) => {
    try {
      validateAssetSize(file.size, policy.maxFileBytes);
      return true;
    } catch (error) {
      notify(error);
      return false;
    }
  });
  if (!files.length) return true;
  let reference = editor.getTextCursorPosition().block;
  let placement: 'before' | 'after' = 'after';
  if ('dataTransfer' in event) {
    const position = editor.prosemirrorView.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    const resolved = position ? editor.prosemirrorState.doc.resolve(position.pos) : null;
    for (let depth = resolved?.depth ?? 0; resolved && depth > 0; depth--) {
      const node = resolved.node(depth);
      if (node.type.name === 'blockContainer' && typeof node.attrs.id === 'string') {
        const target = editor.getBlock(node.attrs.id);
        if (target) {
          reference = target;
          const element = editor.domElement?.querySelector(`[data-id="${CSS.escape(target.id)}"]`);
          const rect = element?.getBoundingClientRect();
          if (rect && event.clientY < (rect.top + rect.bottom) / 2) placement = 'before';
        }
        break;
      }
    }
  }
  for (const file of files) {
    let type = 'file';
    for (const spec of Object.values(editor.schema.blockSpecs)) {
      if (
        spec.implementation.meta.fileBlockAccept?.some((accept) =>
          accept.startsWith('.')
            ? file.name.toLowerCase().endsWith(accept.toLowerCase())
            : accept === file.type ||
              (accept.endsWith('/*') && file.type.startsWith(accept.slice(0, -1))),
        )
      )
        type = spec.config.type;
    }
    if (!editor.schema.blockSchema[type] || !editor.uploadFile) continue;
    const replacingEmpty =
      reference.type === 'paragraph' &&
      Array.isArray(reference.content) &&
      reference.content.length === 0 &&
      reference.children.length === 0;
    const partial = { type, props: { name: file.name } } as unknown as Parameters<
      Editor['updateBlock']
    >[1];
    const inserted = replacingEmpty
      ? editor.updateBlock(reference, partial)
      : editor.insertBlocks([partial], reference, placement)[0];
    reference = inserted;
    placement = 'after';
    void (async () => {
      try {
        const result = await editor.uploadFile!(file, inserted.id);
        if (!active() || !editor.isEditable) return;
        const target = editor.getBlock(inserted.id);
        // A replacement or user edit made while uploading owns the block now.
        if (!target || JSON.stringify(target) !== JSON.stringify(inserted)) return;
        editor.updateBlock(
          inserted.id,
          typeof result === 'string' ? { props: { name: file.name, url: result } } : result,
        );
      } catch (error) {
        if (!active()) return;
        const target = editor.getBlock(inserted.id);
        if (target && JSON.stringify(target) === JSON.stringify(inserted)) {
          if (replacingEmpty) editor.updateBlock(inserted.id, { type: 'paragraph', content: [] });
          else editor.removeBlocks([inserted.id]);
        }
        notify(error);
      }
    })();
  }
  return true;
}
