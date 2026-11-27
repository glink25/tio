import {
  assistantFetchLimit,
  assistantResponseHeaders,
  type AssistantFetch,
} from '@tio/app/services/assistant-fetch';

export const assistantFetch: AssistantFetch = async (input, signal) => {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal,
    credentials: 'omit',
    mode: 'cors',
    redirect: 'manual',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (response.type === 'opaqueredirect') return { status: 'failed', error: { code: 'redirect' } };

  const headers: Record<string, string> = {};
  for (const name of assistantResponseHeaders) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const reader = response.body?.getReader();
  const buffer = new Uint8Array(assistantFetchLimit);
  let length = 0;
  let truncated = false;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const available = buffer.length - length;
        buffer.set(value.subarray(0, available), length);
        length += Math.min(value.length, available);
        if (value.length > available) {
          truncated = true;
          void reader.cancel().catch(() => {});
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  return {
    status: 'completed',
    httpStatus: response.status,
    headers,
    text: new TextDecoder().decode(buffer.subarray(0, length)),
    truncated,
  };
};
