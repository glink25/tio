import type { SyncCore } from './core';
import type { ReplicaInitialization } from './index';

/** A single cooperative execution shared by foreground and system task hosts. */
export async function executeSyncBatch(
  core: SyncCore,
  options: {
    initialization?: ReplicaInitialization;
    initializing: boolean;
    automatic: boolean;
    automaticEnabled(): boolean;
    initialized?(): Promise<void>;
    signal?: AbortSignal;
  },
) {
  const stop = () => {
    core.stopped = true;
  };
  if (options.signal?.aborted) stop();
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    if (core.stopped) return;
    if (options.initializing) {
      await core.pull(options.initialization?.targetId?.());
      if (core.stopped || core.issues.length) return;
      await options.initialization!.complete();
      await options.initialized?.();
      if (core.stopped || (options.automatic && !options.automaticEnabled())) return;
    }
    await core.run();
  } finally {
    options.signal?.removeEventListener('abort', stop);
  }
}
