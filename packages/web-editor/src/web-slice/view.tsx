import { type Block, type TioObject } from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { IconButton } from '@tio/ui';
import { Settings } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import type { EditorController } from '../controller';
import { flatten } from './broker';
import { Frame } from './frame';
import { defaultPermission } from './types';

const SliceSettings = lazy(() => import('./settings'));
export type SliceLog = { message: string; source: 'live' | 'preview' };

export function WebSlice({
  model: m,
  page,
  block,
}: {
  model: EditorController;
  page: TioObject;
  block: Block;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const key = JSON.stringify([
    m.webSlice.namespace ?? 'local',
    page.workspaceId,
    page.id,
    block.id,
  ]);
  const store = m.webSlice.permissionStore!;
  const [permission, setPermission] = useState(() => store.get(key) ?? { ...defaultPermission });
  useEffect(
    () => store.subscribe?.(key, () => setPermission(store.get(key) ?? { ...defaultPermission })),
    [store, key],
  );
  const [running, setRunning] = useState(true);
  const [generation, setGeneration] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<SliceLog[]>([]);
  const [height, setHeight] = useState(Number(block.props.height));
  const log = (message: string, source: SliceLog['source'] = 'live') =>
    setLogs((items) => [...items.slice(-99), { message, source }]);
  if (!flatten(page.blocks ?? []).some((b) => b.id === block.id)) return null;
  return (
    <section
      className="my-4 w-full min-w-0 overflow-hidden rounded-lg border border-line bg-panel"
      contentEditable={false}
      data-web-slice={block.id}
    >
      <div className="flex h-10 items-center justify-between border-b border-line px-3">
        <span className="text-xs font-medium text-secondary">Web Slice</span>
        <IconButton
          ref={trigger}
          label={zh ? 'Web Slice 设置' : 'Web Slice settings'}
          className="p-1.5"
          onClick={() => setOpen(true)}
        >
          <Settings size={16} />
        </IconButton>
      </div>
      {running ? (
        <Frame
          model={m}
          page={page}
          block={block}
          html={String(block.props.html)}
          permission={permission}
          height={block.props.autoHeight ? height : Number(block.props.height)}
          onHeight={setHeight}
          log={log}
          generation={generation}
        />
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-muted">
          {zh ? '已停止' : 'Stopped'}
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <SliceSettings
            model={m}
            page={page}
            block={block}
            permission={permission}
            setPermission={setPermission}
            permissionKey={key}
            running={running}
            setRunning={setRunning}
            restart={() => {
              setRunning(true);
              setGeneration((v) => v + 1);
            }}
            logs={logs}
            log={(message) => log(message, 'preview')}
            clearLogs={() => setLogs([])}
            close={() => {
              setOpen(false);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
