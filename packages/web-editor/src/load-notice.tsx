import { useT } from '@tio/i18n';
import { Button } from '@tio/ui';
import type { EditorSession } from '@tio/workspace';
import { useStore } from 'zustand';
export function LoadNotice({
  runtime,
  id,
  loading = false,
}: {
  runtime: EditorSession;
  id: string;
  loading?: boolean;
}) {
  const state = useStore(runtime.state);
  const t = useT();
  const status = state.loads[id];
  if (loading || !status || status === 'loading')
    return (
      <output
        aria-label={t('common.loading')}
        className="animate-pulse space-y-4 p-8 motion-reduce:animate-none"
      >
        <div className="h-8 w-2/3 rounded bg-surface-hover" />
        <div className="h-4 rounded bg-surface-hover" />
        <div className="h-4 w-4/5 rounded bg-surface-hover" />
      </output>
    );
  return (
    <div role="alert" className="p-6">
      <p>
        {state.loadErrors[id] ?? (status === 'denied' ? t('status.permission') : t('page.missing'))}
      </p>
      <Button onClick={() => void runtime.loadTarget(id).catch(() => {})}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
