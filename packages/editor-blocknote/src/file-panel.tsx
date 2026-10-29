import {
  filenameFromURL,
  blockHasType,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
} from '@blocknote/core';
import { FilePanelExtension } from '@blocknote/core/extensions';
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  type FilePanelProps,
} from '@blocknote/react';
import { validateAssetSize } from '@tio/core';
import { errorMessage, useT } from '@tio/i18n';
import { Button, FilePicker, useAssetPolicy } from '@tio/ui';
import { FileUp, Image, Music, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function mediaKind(type?: string) {
  return type === 'image' || type === 'video' || type === 'audio' ? type : 'file';
}
function MediaIcon({ kind, size = 24 }: { kind: string; size?: number }) {
  const Icon =
    kind === 'image' ? Image : kind === 'video' ? Video : kind === 'audio' ? Music : FileUp;
  return <Icon size={size} />;
}

export function EditorFilePanel({ blockId }: FilePanelProps) {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const t = useT();
  const policy = useAssetPolicy();
  const [tab, setTab] = useState(
    editor.uploadFile ? dict.file_panel.upload.title : dict.file_panel.embed.title,
  );
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [blockId],
  );
  const block = editor.getBlock(blockId);
  if (!block) return null;
  const kind = mediaKind(block.type);
  const kindLabel = t(`upload.kind.${kind}`);
  const accept =
    editor.schema.blockSpecs[block.type].implementation.meta.fileBlockAccept?.join(',');
  const upload = async (file: File) => {
    if (pending.current || !editor.uploadFile) return;
    pending.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      validateAssetSize(file.size, policy.maxFileBytes);
      const result = await editor.uploadFile(file, blockId);
      if (token !== generation.current || !editor.getBlock(blockId) || !editor.isEditable) return;
      editor.updateBlock(
        blockId,
        typeof result === 'string' ? { props: { name: file.name, url: result } } : result,
      );
    } catch (cause) {
      if (token === generation.current) setError(errorMessage(cause, t));
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <Components.FilePanel.Root
      className="bn-panel tio-upload-panel"
      defaultOpenTab={dict.file_panel.upload.title}
      openTab={tab}
      setOpenTab={(next) => {
        if (!pending.current) {
          setError('');
          setTab(next);
        }
      }}
      loading={false}
      tabs={[
        ...(editor.uploadFile
          ? [
              {
                name: 'upload',
                tabPanel: (
                  <Components.FilePanel.TabPanel className="bn-tab-panel">
                    <div className="w-full p-4">
                      <FilePicker
                        accept={accept}
                        icon={<MediaIcon kind={kind} />}
                        label={t(`upload.${kind}`)}
                        hint={t('upload.limit', { maxMB: policy.maxFileBytes / (1024 * 1024) })}
                        busy={busy}
                        error={error}
                        onSelect={([file]) => void upload(file)}
                      />
                    </div>
                  </Components.FilePanel.TabPanel>
                ),
              },
            ]
          : []),
        {
          name: 'link',
          tabPanel: (
            <Components.FilePanel.TabPanel className="bn-tab-panel">
              <form
                className="w-full space-y-3 p-4"
                data-history="native"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = url.trim();
                  if (
                    !/^https?:\/\//i.test(value) ||
                    !editor.getBlock(blockId) ||
                    !editor.isEditable
                  )
                    return;
                  editor.updateBlock(blockId, {
                    props: { name: filenameFromURL(value), url: value },
                  } as unknown as Parameters<typeof editor.updateBlock>[1]);
                }}
              >
                <input
                  type="url"
                  required
                  className="w-full rounded border border-line bg-panel p-2 text-sm"
                  aria-label={t('upload.url', { kind: kindLabel })}
                  placeholder={t('upload.url', { kind: kindLabel })}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={!url.trim()}>
                    {t('upload.useLink', { kind: kindLabel })}
                  </Button>
                </div>
              </form>
            </Components.FilePanel.TabPanel>
          ),
        },
      ].map((item) => ({
        ...item,
        name: item.name === 'upload' ? dict.file_panel.upload.title : dict.file_panel.embed.title,
      }))}
    />
  );
}

export function EditorFileReplaceButton() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const Components = useComponentsContext()!;
  const t = useT();
  const block = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined;
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      const selected = blocks.length === 1 ? blocks[0] : undefined;
      return selected && blockHasType(selected, editor, selected.type, { url: 'string' })
        ? selected
        : undefined;
    },
  });
  if (!block) return null;
  const kind = mediaKind(block.type);
  const label = t('upload.replace', { kind: t(`upload.kind.${kind}`) });
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<MediaIcon kind={kind} size={18} />}
      onClick={() => editor.getExtension(FilePanelExtension)?.showMenu(block.id)}
    />
  );
}
export function EditorFormattingToolbar() {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems().map((item) =>
        item.key === 'replaceFileButton' ? (
          <EditorFileReplaceButton key="replaceFileButton" />
        ) : (
          item
        ),
      )}
    </FormattingToolbar>
  );
}
