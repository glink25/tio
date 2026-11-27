import { blockHasType, type BlockNoteEditor } from '@blocknote/core';
import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import { useT } from '@tio/i18n';
import { type PreviewImage } from '@tio/ui';
import { Expand } from 'lucide-react';
import { createContext, useContext, useEffect } from 'react';

type OpenImage = (blockId: string, trigger: HTMLElement) => void;

export const OpenEditorImage = createContext<OpenImage>(() => {});

export function documentImageGallery(editor: BlockNoteEditor<any, any, any>, blockId: string) {
  const images: PreviewImage[] = [];
  let index = -1;
  const collect = (blocks: typeof editor.document) => {
    for (const block of blocks) {
      if (
        blockHasType(block, editor, 'image', { url: 'string', name: 'string' }) &&
        block.props.url
      ) {
        if (block.id === blockId) index = images.length;
        images.push({ ref: block.props.url, name: block.props.name });
      }
      collect(block.children);
    }
  };
  collect(editor.document);
  return index >= 0 ? { images, index } : undefined;
}

function imageBlockId(image: HTMLImageElement) {
  return image
    .closest('[data-content-type="image"]')
    ?.closest('[data-id]')
    ?.getAttribute('data-id');
}

function selectClickedImage(editor: BlockNoteEditor<any, any, any>, event: MouseEvent) {
  const image = event.target;
  if (
    !editor.isEditable ||
    event.button !== 0 ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !(image instanceof HTMLImageElement) ||
    !image.classList.contains('bn-visual-media') ||
    image.closest('.bn-editor') !== editor.domElement
  )
    return;
  const id = imageBlockId(image);
  if (!id) return;
  // The DOM identifies the image precisely even when ProseMirror maps the click to a block edge.
  editor.setTextCursorPosition(id);
  editor.focus();
  event.preventDefault();
  event.stopPropagation();
}

export function EditorImagePreviewButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const open = useContext(OpenEditorImage);
  const t = useT();
  const imageId = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined;
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      const block = blocks.length === 1 ? blocks[0] : undefined;
      return block &&
        blockHasType(block, editor, 'image', { url: 'string', name: 'string' }) &&
        block.props.url
        ? block.id
        : undefined;
    },
  });
  if (!imageId) return null;
  const label = t('imageViewer.open');
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<Expand size={18} />}
      onClick={(event) => {
        if (event.currentTarget instanceof HTMLElement) open(imageId, event.currentTarget);
      }}
    />
  );
}

export function useEditorImages(
  editor: BlockNoteEditor<any, any, any>,
  readOnly: boolean | undefined,
  open: OpenImage,
) {
  const t = useT();
  useEffect(() => {
    let detach: (() => void) | undefined;
    const attach = () => {
      const root = editor.domElement;
      if (!root) return;
      detach?.();
      if (!readOnly) {
        const select = (event: MouseEvent) => selectClickedImage(editor, event);
        root.addEventListener('click', select, true);
        detach = () => root.removeEventListener('click', select, true);
        return;
      }

      // Enhance the stock image node views without replacing their rendering or serialization.
      const selector = '[data-content-type="image"] img.bn-visual-media';
      const enhanced = new Set<HTMLImageElement>();
      const owns = (element: Element) => element.closest('.bn-editor') === root;
      const enhance = () => {
        for (const image of enhanced) if (!root.contains(image)) enhanced.delete(image);
        for (const image of root.querySelectorAll<HTMLImageElement>(selector)) {
          if (!owns(image) || enhanced.has(image)) continue;
          enhanced.add(image);
          image.tabIndex = 0;
          image.setAttribute('role', 'button');
          image.setAttribute(
            'aria-label',
            image.alt ? `${t('imageViewer.open')} · ${image.alt}` : t('imageViewer.open'),
          );
        }
      };
      const activate = (event: MouseEvent | KeyboardEvent) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !enhanced.has(image)) return;
        if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
        const id = imageBlockId(image);
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        open(id, image);
      };
      enhance();
      const observer = new MutationObserver(enhance);
      observer.observe(root, { childList: true, subtree: true });
      root.addEventListener('click', activate, true);
      root.addEventListener('keydown', activate, true);
      detach = () => {
        observer.disconnect();
        root.removeEventListener('click', activate, true);
        root.removeEventListener('keydown', activate, true);
        for (const image of enhanced) {
          image.removeAttribute('tabindex');
          image.removeAttribute('role');
          image.removeAttribute('aria-label');
        }
      };
    };
    const stop = editor.onMount(attach);
    attach();
    return () => {
      stop();
      detach?.();
    };
  }, [editor, readOnly, open, t]);
}
