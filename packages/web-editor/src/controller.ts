import { AssetResolver, fileData } from '@tio/assets/browser';
import {
  HostError,
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
import { useNotify } from '@tio/ui';
import type { EditHistory } from '@tio/ui';
import type { ViewExtensions } from '@tio/views';
import { newPage, newDatabase, type EditorSession } from '@tio/workspace';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { memoryPermissions, type AppSliceOptions } from './app-slice/types';
import { createMentionService } from './mentions';
export interface EditorTarget {
  id: string;
  mode?: 'page' | 'preview';
}
export interface EditorSurfaceProps {
  mentions?: import('@tio/core').MentionService;
  appSlice?: AppSliceOptions;
  views?: ViewExtensions;
  extensions?: EditorSchema;
  runtime: EditorSession;
  workspaceId: string;
  target: EditorTarget;
  renderHeader?: (
    actions: ReactNode,
    layout: { appMode: boolean; navigationPageActions: ReactNode },
  ) => ReactNode;
  autoFocusTitle?: boolean;
  pageActions?: ReactNode;
  onOpen?: (target: EditorTarget) => void;
  readOnly?: boolean;
  onNavigate: (target: EditorTarget) => void;
  onError?: (error: unknown) => void;
}
export function useEditorController(props: EditorSurfaceProps) {
  const { runtime, workspaceId, target, onNavigate } = props;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const mentions = useMemo(
    () =>
      props.mentions ??
      createMentionService(runtime, workspaceId, (id) => navigateRef.current({ id })),
    [props.mentions, runtime, workspaceId],
  );
  const appSliceStore = useMemo(() => {
    void runtime;
    return memoryPermissions();
  }, [runtime]);
  const appSlice = {
    ...props.appSlice,
    permissionStore: props.appSlice?.permissionStore ?? appSliceStore,
  };
  const t = useT();
  const notify = useNotify();
  const { i18n } = useTranslation();
  const state = useStore(runtime.state);
  useEffect(() => {
    const release = runtime.retain([target.id]);
    void runtime.loadTarget(target.id).catch(() => {});
    return release;
  }, [runtime, target.id]);
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
  const [error, setError] = useState('');
  const resolver = useMemo(() => new AssetResolver(runtime), [runtime]);
  const resolveAsset = useCallback((url: string) => resolver.resolve(url), [resolver]);
  useEffect(() => () => resolver.dispose(), [resolver]);
  useEffect(() => {
    setRecordId(null);
    setReadOnly(false);
    setFieldDb(null);
    setEmbedPicker(false);
  }, [target.id]);
  const isVisible = visibility(objects);
  const current =
    state.loads[target.id] === 'ready'
      ? objects.find((o) => o.id === target.id && isVisible(o))
      : undefined;
  const nav = objects.filter((o) => ['page', 'database'].includes(o.type) && isVisible(o));
  const record = objects.find(
    (o) => o.id === (recordId ?? (current?.type === 'record' ? current.id : null)) && !o.deleted,
  );
  useEffect(() => {
    if (!recordId) return;
    const release = runtime.retain([recordId]);
    void runtime.loadTarget(recordId).catch(() => {});
    return release;
  }, [runtime, recordId]);
  const activeDb = objects.find((o) => o.id === record?.databaseId);
  const fieldTarget = objects.find((o) => o.id === fieldDb);
  function report(error: unknown) {
    // Persistence failures are exposed through the runtime to the host.
    if (runtime.state.getState().error !== error)
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
  function patch(o: TioObject, changes: Partial<TioObject>, remember = true) {
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
  async function deleteRecords(records: TioObject[]) {
    try {
      const expected = records.map((record) => {
        const current = runtime.snapshot().find((o) => o.id === record.id);
        if (!current || current.deleted || current.type !== 'record')
          throw new HostError('conflict');
        return current;
      });
      const guard = () => {
        if (
          readOnly ||
          expected.some((record) => !editable(record) || !runtime.can(record, 'delete'))
        )
          throw new HostError('permission');
      };
      await runtime.checked(
        expected,
        expected.map((record) => ({ ...record, deleted: true })),
        guard,
      );
      if (expected.some((record) => record.id === recordId)) setRecordId(null);
    } catch (error) {
      report(error);
      throw error;
    }
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
  const history: EditHistory = {
    canUndo: !readOnly && state.writable && state.canUndo,
    canRedo: !readOnly && state.writable && state.canRedo,
    undo: () => command(() => runtime.undo()),
    redo: () => command(() => runtime.redo()),
    breakGroup: () => runtime.breakHistoryGroup(),
    recordDraft: (owner, before, after, apply) => {
      if (!readOnly) runtime.recordDraft(owner, before, after, apply);
    },
    discardDraft: (owner) => runtime.discardDraft(owner),
  };
  const upload = async (file: File) => {
    if (readOnly) throw new Error('Read only');
    const ref = runtime.upload(workspaceId, await fileData(file));
    await runtime.flush();
    return ref;
  };
  return {
    mentions,
    appSlice,
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
    error,
    setError,
    navigate,
    patch,
    addPage,
    addDatabase,
    addRecord,
    deleteRecords,
    canDeleteRecord: (record: TioObject) =>
      !readOnly && editable(record) && runtime.can(record, 'delete'),
    embed,
    upload,
    resolve: resolveAsset,
    cell: (record: TioObject, field: Field, value: unknown) =>
      command(() => runtime.cell(record.id, field.id, value)),
    changeFields: (db: TioObject, fields: Field[]) => {
      const changed = fields.find((field) =>
        db.fields?.some(
          (old) =>
            old.id === field.id &&
            (old.type !== field.type ||
              (['mention', 'relation'].includes(field.type) &&
                (old.multiple !== false) !== (field.multiple !== false))),
        ),
      );
      if (changed) {
        if (readOnly) return Promise.reject(new HostError('permission'));
        return runtime.convertField(db.id, changed).then((cleared) => {
          notify(t('transfer.converted', { count: cleared }));
        });
      }
      command(() => runtime.fields(db.id, fields, db.fields ?? []));
    },
    changeBlocks: (page: TioObject, blocks: Block[], previous: Block[], group?: string | null) =>
      command(() => {
        if (editable(page)) runtime.blocks(page.id, blocks, previous, group);
      }),
    history,
    undoOperation: history.undo,
  };
}
export type EditorController = ReturnType<typeof useEditorController>;
