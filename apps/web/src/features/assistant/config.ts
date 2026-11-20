import type { Provider } from '@glink25/chaty';
import { createAIProvider } from '@glink25/chaty/providers';
import type { AssistantApiConfig } from '@tio/core';
import { t } from '@tio/i18n';
export function encodeKey(value: string) {
  return btoa(
    Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''),
  );
}
export function decodeKey(value: string) {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
  );
}
export function assistantProvider(getConfig: (id?: string) => AssistantApiConfig): Provider {
  const provider = createAIProvider(
    (id) => {
      const config = getConfig(id);
      return { ...config, apiKey: decodeKey(config.apiKey) };
    },
    {
      formatUserAssets: (files, start) =>
        `User attachments: ${files.map((f, i) => `${start + i}: ${f.name}`).join(', ')}. Use fileIndex with assets.upload or content.import; Code Mode getFile(index) reads the original uploaded file.`,
    },
  );
  const safeError = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError')
      return new DOMException('Aborted', 'AbortError');
    const status =
      error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    return Object.assign(
      new Error(t('assistant.failed')),
      typeof status === 'number' ? { status } : {},
    );
  };
  return {
    getContextPolicy: provider.getContextPolicy,
    request: (params) => {
      const pending = provider.request(params);
      const result = pending
        .then((stream) =>
          (async function* () {
            try {
              yield* stream;
            } catch (error) {
              throw safeError(error);
            }
          })(),
        )
        .catch((error) => {
          throw safeError(error);
        });
      return Object.assign(result, { abort: () => pending.abort() });
    },
  };
}
