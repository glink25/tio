import { HostError, type WorkspaceSession } from '@tio/core';

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
  read(key: string): Promise<any> {
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
    if (!connection.startsWith('github-')) continue;
    const key = 'tio.github.endpoints.' + connection;
    const endpoints = await catalog.read(key);
    if (endpoints) localStorage.setItem(key, JSON.stringify(endpoints));
    else localStorage.removeItem(key);
  }
}
