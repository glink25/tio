import { invoke } from '@tauri-apps/api/core';
import { i18n } from '@tio/i18n';

type Pack = { revision: number; translations: Record<string, Record<string, string>> };
export async function startResourceUpdate() {
  const { channel } = await invoke<{ channel: string }>('update_status');
  const request = <T>(action: string, fields: Record<string, unknown> = {}) =>
    invoke<T>('resource_update', { action, channel, ...fields });
  const pack = await request<Pack | null>('begin');
  if (!pack) return;
  for (const [lang, entries] of Object.entries(pack.translations)) {
    const bundled = i18n.getResourceBundle(lang, 'translation');
    if (!bundled || Object.keys(entries).some((k) => !Object.hasOwn(bundled, k)))
      throw new Error('Unknown translation key');
  }
  for (const [lang, entries] of Object.entries(pack.translations))
    i18n.addResourceBundle(lang, 'translation', entries, true, true);
  return async () => {
    await request('confirm', { revision: pack.revision });
    await invoke('download_resources', { channel });
  };
}
