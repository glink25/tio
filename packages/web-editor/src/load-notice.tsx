import { useT } from '@tio/i18n';
import { Button, LoadingSkeleton } from '@tio/ui';
import type { EditorSession } from '@tio/workspace';
import { useStore } from 'zustand';
export function LoadNotice({
  runtime,
  id,
  loading = false,
  inline = false,
}: {
  runtime: EditorSession;
  id: string;
  loading?: boolean;
  inline?: boolean;
}) {
  const state = useStore(runtime.state);
  const t = useT();
  const status = state.loads[id];
  if (loading || !status || status === 'loading')
    return <LoadingSkeleton layout={inline ? 'inline' : 'document'} />;
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
