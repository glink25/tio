import { HostError } from '@tio/core';

export async function withProcessLock<T>(
  name: string,
  work: () => Promise<T>,
  call: (name: string, token?: string) => Promise<string | null>,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + 30000;
  let token: string | null;
  while (!(token = await call(name))) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new HostError('timeout');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    await call(name, token);
  }
}
