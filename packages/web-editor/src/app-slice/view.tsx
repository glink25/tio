import { type Block, type TioObject } from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { IconButton, cn } from '@tio/ui';
import { Settings } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import type { EditorController } from '../controller';
import { flatten } from './broker';
import { Frame } from './frame';
import { defaultPermission } from './types';

const AppSliceSettings = lazy(() => import('./settings'));
export type AppSliceLog = { message: string; source: 'live' | 'preview' };

export function AppSlice({
  model: m,
  page,
  block,
  fullscreen = false,
}: {
  model: EditorController;
  page: TioObject;
  block: Block;
  fullscreen?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const key = JSON.stringify([
    m.appSlice.namespace ?? 'local',
    page.workspaceId,
    page.id,
    block.id,
  ]);
  const store = m.appSlice.permissionStore!;
  const [permission, setPermission] = useState(() => store.get(key) ?? { ...defaultPermission });
  useEffect(
    () => store.subscribe?.(key, () => setPermission(store.get(key) ?? { ...defaultPermission })),
    [store, key],
  );
  const [running, setRunning] = useState(true);
  const [generation, setGeneration] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AppSliceLog[]>([]);
  const [height, setHeight] = useState(Number(block.props.height));
  const log = (message: string, source: AppSliceLog['source'] = 'live') =>
    setLogs((items) => [...items.slice(-99), { message, source }]);
  if (!flatten(page.blocks ?? []).some((b) => b.id === block.id)) return null;
  return (
    <section
      className={cn(
        'w-full min-w-0 overflow-hidden bg-panel',
        fullscreen ? 'h-full' : 'my-4 rounded-lg border border-line',
      )}
      contentEditable={false}
      data-app-slice={block.id}
    >
      {!fullscreen && (
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-medium text-secondary">App Slice</span>
          <IconButton
            ref={trigger}
            label={zh ? 'App Slice 设置' : 'App Slice settings'}
            className="p-1.5"
            onClick={() => setOpen(true)}
          >
            <Settings size={16} />
          </IconButton>
        </div>
      )}
      {running ? (
        <Frame
          fullscreen={fullscreen}
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
      <OverlayPresence>
        {open && (
          <Suspense fallback={null}>
            <AppSliceSettings
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
      </OverlayPresence>
    </section>
  );
}
