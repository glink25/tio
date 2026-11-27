export const assistantFetchLimit = 64 * 1024;
export const assistantFetchTimeout = 15_000;

export type AssistantFetchRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export type AssistantFetchResult =
  | {
      status: 'completed';
      httpStatus: number;
      headers: Record<string, string>;
      text: string;
      truncated: boolean;
    }
  | {
      status: 'failed';
      error: { code: 'invalid' | 'unavailable' | 'closed' | 'timeout' | 'redirect' };
    };

export type AssistantFetch = (
  request: AssistantFetchRequest,
  signal: AbortSignal,
) => Promise<AssistantFetchResult>;

export const assistantResponseHeaders = [
  'cache-control',
  'content-length',
  'content-type',
  'date',
  'etag',
  'last-modified',
  'location',
  'retry-after',
] as const;

const blockedHeaders = new Set([
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'expect',
  'host',
  'origin',
  'referer',
  'set-cookie',
  'set-cookie2',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function assistantFetchRequest(input: AssistantFetchRequest): AssistantFetchRequest {
  const url = new URL(input.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (input.body !== undefined &&
      (['GET', 'HEAD'].includes(input.method) ||
        new TextEncoder().encode(input.body).length > assistantFetchLimit))
  )
    throw new Error('Invalid HTTP request');

  const headers = new Headers();
  const entries = Object.entries(input.headers);
  if (entries.length > 32) throw new Error('Too many request headers');
  for (const [name, value] of entries) {
    const key = name.toLowerCase();
    if (
      blockedHeaders.has(key) ||
      key.startsWith('sec-') ||
      key.startsWith('proxy-') ||
      key.startsWith('access-control-request-') ||
      name.length > 128 ||
      value.length > 4096 ||
      headers.has(key)
    )
      throw new Error('Invalid request header');
    headers.set(key, value);
  }
  url.hash = '';
  return { ...input, url: url.href, headers: Object.fromEntries(headers) };
}
