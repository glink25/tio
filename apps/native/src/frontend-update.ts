import { invoke } from '@tauri-apps/api/core';

import { createHostCatalog } from './catalog';

export interface UpdateDiagnostics {
  channel: string;
  track: string;
  contractId: string;
  hostVersion: string;
  hostBuild: string;
  runtime: { productVersion: string; revision: number; runtimeId: string };
  enabled: boolean;
}
export async function confirmFrontendUpdate() {
  const state = await invoke<UpdateDiagnostics>('update_status');
  if (!state.enabled) return;
  const response = await fetch(new URL('native-contract.json', document.baseURI));
  if (!response.ok) throw new Error('Application contract unavailable');
  const contract = (await response.json()) as { contractId: string; runtimeId: string };
  if (contract.contractId !== state.contractId || contract.runtimeId !== state.runtime.runtimeId)
    throw new Error('Application and host contract differ');
  await createHostCatalog().sessions();
  await invoke('frontend_update', { action: 'confirm' });
}
