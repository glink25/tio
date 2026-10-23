import { fullAccess, type AccessPolicy, type TioObject } from '@tio/core';
import { decode, encode, managedPath, pathFor } from '@tio/serialization';
import type { FileStorageProvider } from '@tio/storage';
/** A backend may implement this with records/API requests; directory scanning is adapter-only. */
export interface WorkspaceContentPort {
  authorize(): Promise<AccessPolicy>;
  list(): Promise<string[]>;
  read(id: string): Promise<TioObject | undefined>;
  write(object: TioObject): Promise<void>;
  readAsset(object: TioObject): Promise<Uint8Array | null>;
  writeAsset(object: TioObject, bytes: Uint8Array): Promise<void>;
}
export class FileWorkspaceContent implements WorkspaceContentPort {
  private paths = new Map<string, string>();
  constructor(
    private files: FileStorageProvider,
    private workspaceId: string,
  ) {}
  async authorize(): Promise<AccessPolicy> {
    const allowed = this.files.canWrite ? await this.files.canWrite() : true;
    return { ...fullAccess, allows: (_resource, operation) => operation === 'read' || allowed };
  }
  async list() {
    this.paths.clear();
    for (const file of await this.files.list(`workspaces/${this.workspaceId}/`)) {
      if (!managedPath(file.path, this.workspaceId)) continue;
      const bytes = await this.files.read(file.path);
      if (!bytes) continue;
      const object = decode(bytes);
      if (object.workspaceId !== this.workspaceId || pathFor(object) !== file.path)
        throw new Error('Object identity mismatch');
      this.paths.set(object.id, file.path);
    }
    return [...this.paths.keys()];
  }
  async read(id: string) {
    const path = this.paths.get(id);
    if (!path) return undefined;
    const bytes = await this.files.read(path);
    return bytes ? decode(bytes) : undefined;
  }
  async write(object: TioObject) {
    const path = pathFor(object);
    await this.files.write(path, encode(object));
    this.paths.set(object.id, path);
  }
  readAsset(object: TioObject) {
    return this.files.read(`workspaces/${this.workspaceId}/${object.assetPath}`);
  }
  writeAsset(object: TioObject, bytes: Uint8Array) {
    return this.files.write(`workspaces/${this.workspaceId}/${object.assetPath}`, bytes);
  }
}
