import { Channel, invoke } from '@tauri-apps/api/core';
import type { AssistantFetch, AssistantFetchResult } from '@tio/app/services/assistant-fetch';

export const createAssistantFetch =
  (generation: string): AssistantFetch =>
  async (input, signal) => {
    signal.throwIfAborted();
    const id = crypto.randomUUID();
    const done = new Channel<AssistantFetchResult>();
    const result = new Promise<AssistantFetchResult>((resolve) => {
      done.onmessage = resolve;
    });
    const started = invoke('assistant_fetch', { id, generation, input, done });
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(signal.reason);
        void started
          .then(() => invoke('cancel_assistant_fetch', { id, generation }))
          .catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([started.then(() => result), cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
      done.onmessage = () => {};
    }
  };
