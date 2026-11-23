export interface HostContract {
  format: number;
  channel: string;
  bridgeApiVersion: number;
  storageEpoch: number;
  reviewEpoch: number;
  capabilities: string[];
  runtimeTarget: string;
  contractId: string;
}
export function contract(channel: string): HostContract;
export function productVersion(): string;
export function runtimeIdentity(
  channel: string,
  kernelSha256: string,
): Promise<{ runtimeId: string; translationKeys: Record<string, string[]> }>;
