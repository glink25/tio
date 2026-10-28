import { createExtension } from '@blocknote/core';
import { SuggestionMenu, getDefaultSlashMenuItems } from '@blocknote/core/extensions';
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  NestBlockButton,
  UnnestBlockButton,
  TextAlignButton,
  RenderInPortalElement,
  UIModeContext,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorDOMElement,
  useEditorFocus,
  useEditorState,
  usePortalElement,
  useVirtualKeyboard,
} from '@blocknote/react';
import { useT, useTranslation } from '@tio/i18n';
import { EditHistoryContext, MentionContext, useTheme } from '@tio/ui';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import { Plugin, Selection } from '@tiptap/pm/state';
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Check,
  Image,
  MoreHorizontal,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const touchQuery = '(hover: none) and (pointer: coarse)';
export function useTouchEditing() {
  const [touch, setTouch] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(touchQuery).matches,
  );
  useEffect(() => {
    const media = matchMedia(touchQuery);
    const update = () => setTouch(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return touch;
}

/** Leave the caret clear of both the sticky header and the one-row touch toolbar. */
export const TouchScroll = createExtension(() => ({
  key: 'tioTouchScroll',
  prosemirrorPlugins: [
    new Plugin({
      props:
        typeof matchMedia !== 'undefined' && matchMedia(touchQuery).matches
          ? {
              scrollThreshold: { top: 64, right: 8, bottom: 80, left: 8 },
              scrollMargin: { top: 64, right: 8, bottom: 80, left: 8 },
            }
          : {},
    }),
  ],
}));

function MoreActions() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const history = useContext(EditHistoryContext);
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block],
  });
  const first = selected[0];
  const last = selected[selected.length - 1];
  const run = (command: () => void) => {
    if (editor.prosemirrorView.composing) return;
    history?.breakGroup();
    editor.focus();
    command();
    history?.breakGroup();
    setOpen(false);
  };
  const Button = Components.FormattingToolbar.Button;
  return (
    <Components.Generic.Popover.Root
      open={open}
      onOpenChange={setOpen}
      portalElement={portalElement}
    >
      <Components.Generic.Popover.Trigger>
        <Button label={t('common.more')} icon={<MoreHorizontal size={18} />} />
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content variant="form-popover" className="tio-mobile-more">
        <div className="grid grid-cols-1 gap-1">
          <Button
            label={t('editor.moveUp')}
            isDisabled={!first || !editor.getPrevBlock(first)}
            onClick={() => run(() => editor.moveBlocksUp())}
          >
            <ArrowUp size={18} />
            {t('editor.moveUp')}
          </Button>
          <Button
            label={t('editor.moveDown')}
            isDisabled={!last || !editor.getNextBlock(last)}
            onClick={() => run(() => editor.moveBlocksDown())}
          >
            <ArrowDown size={18} />
            {t('editor.moveDown')}
          </Button>
          <Button
            label={t('common.undo')}
            isDisabled={history ? !history.canUndo : undoDepth(editor.prosemirrorState) === 0}
            onClick={() => run(() => (history ? history.undo() : editor.undo()))}
          >
            <Undo2 size={18} />
            {t('common.undo')}
          </Button>
          <Button
            label={t('common.redo')}
            isDisabled={history ? !history.canRedo : redoDepth(editor.prosemirrorState) === 0}
            onClick={() => run(() => (history ? history.redo() : editor.redo()))}
          >
            <Redo2 size={18} />
            {t('common.redo')}
          </Button>
          <Button
            className="tio-block-delete"
            label={t('editor.deleteBlock')}
            onClick={() => run(() => editor.removeBlocks(selected))}
          >
            <Trash2 size={18} />
            {t('editor.deleteBlock')}
          </Button>
        </div>
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  );
}

function TouchToolbar() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const mentions = useContext(MentionContext);
  const history = useContext(EditHistoryContext);
  const t = useT();
  const Button = Components.FormattingToolbar.Button;
  const openSuggestions = (trigger: string) => {
    if (editor.prosemirrorView.composing) return;
    if (!editor.prosemirrorState.selection.empty) {
      editor.transact((tr) => tr.setSelection(Selection.near(tr.doc.resolve(tr.selection.to))));
    }
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu(trigger, { ignoreQueryLength: true });
  };
  return (
    <div className="tio-touch-toolbar">
      <div className="tio-touch-toolbar-scroll">
        <FormattingToolbar>
          <Button
            label={t('editor.insert')}
            icon={<Plus size={18} />}
            onClick={() => openSuggestions('/')}
          />
          <BlockTypeSelect />
          <BasicTextStyleButton basicTextStyle="bold" />
          <BasicTextStyleButton basicTextStyle="italic" />
          <BasicTextStyleButton basicTextStyle="code" />
          <BasicTextStyleButton basicTextStyle="underline" />
          <BasicTextStyleButton basicTextStyle="strike" />
          <ColorStyleButton />
          <CreateLinkButton />
          <TextAlignButton textAlignment="left" />
          <TextAlignButton textAlignment="center" />
          <TextAlignButton textAlignment="right" />
          <NestBlockButton />
          <UnnestBlockButton />
          {mentions && (
            <Button
              label={t('editor.mention')}
              icon={<AtSign size={18} />}
              onClick={() => openSuggestions('@')}
            />
          )}
          <Button
            label={t('editor.image')}
            icon={<Image size={18} />}
            isDisabled={!editor.schema.blockSchema.image}
            onClick={() => {
              if (editor.prosemirrorView.composing) return;
              history?.breakGroup();
              editor.focus();
              getDefaultSlashMenuItems(editor)
                .find((item) => item.key === 'image')
                ?.onItemClick();
              history?.breakGroup();
            }}
          />
          <MoreActions />
        </FormattingToolbar>
      </div>
      <Button
        className="tio-touch-done"
        label={t('editor.finish')}
        icon={<Check size={18} />}
        onClick={() => {
          const active = editor.domElement?.ownerDocument.activeElement;
          if (active instanceof HTMLElement) active.blur();
        }}
      />
    </div>
  );
}

/** A scoped and registered portal, outside the scroller but inside its modal focus boundary. */
export function MobileEditorToolbar({
  onPortal,
}: {
  onPortal: (portal: HTMLDivElement | null) => void;
}) {
  const keyboard = useVirtualKeyboard();
  const focused = useEditorFocus({ includeEditorUI: true });
  const dom = useEditorDOMElement();
  const theme = useTheme();
  const { i18n } = useTranslation();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      setPortal(node);
      onPortal(node);
    },
    [onPortal],
  );
  const target = dom?.closest('[role="dialog"]') ?? dom?.ownerDocument.body;
  if (!target) return null;
  return (
    <>
      {createPortal(
        <div
          ref={attach}
          className={`tio-editor tio-editor-chrome ${theme === 'dark' ? 'dark' : ''}`}
          lang={i18n.language}
          style={{ colorScheme: theme }}
        />,
        target,
      )}
      {portal && focused && (
        <RenderInPortalElement target={portal}>
          <UIModeContext.Provider value="mobile">
            <div className="tio-mobile-editor-toolbar" data-keyboard={keyboard}>
              <TouchToolbar />
            </div>
          </UIModeContext.Provider>
        </RenderInPortalElement>
      )}
    </>
  );
}
