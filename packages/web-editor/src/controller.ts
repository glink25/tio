import { AssetResolver, fileData } from '@tio/assets/browser';
import {
  id,
  object,
  textBlock,
  visibility,
  editable,
  type TioObject,
  type Field,
  type Block,
} from '@tio/core';
import type { EditorSchema } from '@tio/editor-blocknote';
import { useT, useTranslation } from '@tio/i18n';
import type { ViewExtensions } from '@tio/views';
import { newPage, newDatabase, type EditorSession } from '@tio/workspace';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { memoryPermissions, type WebSliceOptions } from './web-slice/types';
export interface EditorTarget {
  id: string;
  mode?: 'page' | 'preview';
}
export interface EditorSurfaceProps {
  webSlice?: WebSliceOptions;
  views?: ViewExtensions;
  extensions?: EditorSchema;
  runtime: EditorSession;
  workspaceId: string;
  target: EditorTarget;
  renderHeader?: (actions: ReactNode) => ReactNode;
  autoFocusTitle?: boolean;
  pageActions?: ReactNode;
  onOpen?: (target: EditorTarget) => void;
  readOnly?: boolean;
  showSaveState?: boolean;
  onNavigate: (target: EditorTarget) => void;
  onError?: (error: unknown) => void;
}
export function useEditorController(props: EditorSurfaceProps) {
  const { runtime, workspaceId, target, onNavigate } = props;
  const sliceStore = useMemo(() => {
    void runtime;
    return memoryPermissions();
  }, [runtime]);
  const webSlice = {
    ...props.webSlice,
    permissionStore: props.webSlice?.permissionStore ?? sliceStore,
  };
  const t = useT();
  const { i18n } = useTranslation();
  const state = useStore(runtime.state);
  const objects = useMemo(
    () => state.objects.filter((o) => o.workspaceId === workspaceId),
    [state.objects, workspaceId],
  );
  const [localReadOnly, setReadOnly] = useState(false);
  const readOnly = !!props.readOnly || localReadOnly;
  const can = (o: TioObject, fieldId?: string) => !readOnly && runtime.can(o, 'update', fieldId);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [fieldDb, updateFieldDb] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const setFieldDb = (value: string | null) => {
    updateFieldDb(value);
    setFieldId(null);
  };
  const [embedPicker, setEmbedPicker] = useState(false);
  const [referencePicker, setReferencePicker] = useState(false);
  const [error, setError] = useState('');
  const resolver = useMemo(() => new AssetResolver(runtime), [runtime]);
  useEffect(() => () => resolver.dispose(), [resolver]);
  useEffect(() => {
    setRecordId(null);
    setReadOnly(false);
    setFieldDb(null);
    setReferencePicker(false);
    setEmbedPicker(false);
  }, [target.id]);
  const isVisible = visibility(objects);
  const current = objects.find((o) => o.id === target.id && isVisible(o));
  const nav = objects.filter((o) => ['page', 'database'].includes(o.type) && isVisible(o));
  const record = objects.find(
    (o) => o.id === (recordId ?? (current?.type === 'record' ? current.id : null)) && !o.deleted,
  );
  const activeDb = objects.find((o) => o.id === record?.databaseId);
  const fieldTarget = objects.find((o) => o.id === fieldDb);
  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
    props.onError?.(error);
  }
  function command(action: () => void) {
    if (readOnly) return;
    try {
      action();
    } catch (error) {
      report(error);
    }
  }
  function navigate(o: TioObject) {
    if (o.type === 'record') setRecordId(o.id);
    else onNavigate({ id: o.id });
  }
  function patch(o: TioObject, changes: Partial<TioObject>, remember = false) {
    command(() => runtime.patch(o.id, changes, remember));
  }
  function addPage(parentId: string | null = null) {
    const page = newPage(workspaceId, parentId);
    page.title = t('common.untitled');
    command(() => {
      runtime.create([page]);
      (props.onOpen ?? onNavigate)({ id: page.id, mode: 'preview' });
    });
  }
  function addDatabase(embed = false) {
    if (!current) return;
    const items = newDatabase(workspaceId, embed ? current.id : null);
    items[0].name = t('workspace.newDatabase');
    if (i18n.language === 'en') {
      items[0].fields![0].name = 'Name';
      items[0].fields![1].name = 'Status';
      items[0].fields![1].options![0].label = 'To do';
      items[0].fields![1].options![1].label = 'Done';
      items[1].name = 'Default view';
    }
    command(() => {
      runtime.create(
        items,
        embed
          ? {
              pageId: current.id,
              block: {
                id: id('block'),
                type: 'databaseView',
                props: { databaseId: items[0].id, viewId: items[1].id },
                content: [],
                children: [],
              },
            }
          : undefined,
      );
      if (!embed) navigate(items[0]);
    });
    setEmbedPicker(false);
  }
  function embed(db: TioObject) {
    const view = objects.find(
      (o) => o.type === 'databaseView' && o.databaseId === db.id && !o.deleted,
    );
    if (!view || !current) return;
    command(() =>
      runtime.append(current.id, {
        id: id('block'),
        type: 'databaseView',
        props: { databaseId: db.id, viewId: view.id },
        content: [],
        children: [],
      }),
    );
    setEmbedPicker(false);
  }
  function referencePage(pageId: string) {
    if (!current) return;
    command(() =>
      runtime.append(current.id, {
        id: id('block'),
        type: 'pageReference',
        props: { pageId },
        content: [],
        children: [],
      }),
    );
    setReferencePicker(false);
  }
  function addRecord(db: TioObject) {
    const field = db.fields?.find((f) => f.type === 'title');
    const record = object('record', workspaceId, {
      databaseId: db.id,
      properties: { [field?.id ?? 'title']: t('database.recordTitle') },
      blocks: [textBlock('')],
    });
    command(() => {
      runtime.create([record]);
      setRecordId(record.id);
    });
  }
  const upload = async (file: File) => {
    if (readOnly) throw new Error('Read only');
    return runtime.upload(workspaceId, await fileData(file));
  };
  return {
    webSlice,
    hostReadOnly: !!props.readOnly,
    runtime,
    openFull: (id: string) => onNavigate({ id, mode: 'page' }),
    state,
    current,
    objects,
    nav,
    readOnly,
    can,
    setReadOnly,
    recordId,
    setRecordId,
    record,
    activeDb,
    fieldTarget,
    fieldId,
    setFieldId,
    setFieldDb,
    embedPicker,
    setEmbedPicker,
    referencePicker,
    setReferencePicker,
    error,
    setError,
    navigate,
    patch,
    addPage,
    addDatabase,
    addRecord,
    embed,
    referencePage,
    upload,
    resolve: (url: string) => resolver.resolve(url),
    cell: (record: TioObject, field: Field, value: unknown) =>
      command(() => runtime.cell(record.id, field.id, value)),
    changeFields: (db: TioObject, fields: Field[]) =>
      command(() => runtime.fields(db.id, fields, db.fields ?? [])),
    changeBlocks: (page: TioObject, blocks: Block[], previous: Block[]) =>
      command(() => {
        if (editable(page)) runtime.blocks(page.id, blocks, previous);
      }),
    undoOperation: () => command(() => runtime.undo()),
  };
}
export type EditorController = ReturnType<typeof useEditorController>;
