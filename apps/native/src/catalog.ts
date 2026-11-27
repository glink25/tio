import { HostError, type WorkspaceSession } from '@tio/core';
import { giteeEndpointsKey } from '@tio/provider-gitee';
import { githubEndpointsKey, type GitHubEndpoint } from '@tio/provider-github';
import { gitConnection } from '@tio/provider-github/credentials';

async function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>('catalog', { request: { action, ...args } });
  } catch (error) {
    if (error === 'invalid' || error === 'closed' || error === 'unavailable')
      throw new HostError(error);
    throw error;
  }
}

class NativeCatalog {
  sessions() {
    return request<WorkspaceSession[]>('sessions');
  }
  saveSession(session: WorkspaceSession) {
    return request<void>('saveSession', { id: session.id, session });
  }
  removeSession(id: string) {
    return request<void>('removeSession', { id });
  }
  read<T = unknown>(key: string): Promise<T> {
    return request('read', { key });
  }
  write(key: string, value: unknown) {
    return request<void>('write', { key, value: value ?? null });
  }
  setting(key: string, ...values: [unknown?]) {
    return values.length ? this.write(key, values[0]) : this.read(key);
  }
  async close() {
    // The application owns the SQLite connection across workspace sessions.
  }
}

export const createHostCatalog = () => new NativeCatalog();

export async function restoreNativeBindings() {
  const catalog = new NativeCatalog();
  const connections = new Set((await catalog.sessions()).map((session) => session.connectionId));
  for (const connection of connections) {
    const account = gitConnection(connection);
    if (!account) continue;
    const key = (account.provider === 'gitee' ? giteeEndpointsKey : githubEndpointsKey)(connection);
    const endpoints = await catalog.read<[string, GitHubEndpoint][]>(key);
    if (endpoints) localStorage.setItem(key, JSON.stringify(endpoints));
    else localStorage.removeItem(key);
  }
}
