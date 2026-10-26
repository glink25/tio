import {
  fullAccess,
  createDefaultRegistry,
  type ObjectRegistry,
  type AccessPolicy,
  type Json,
  type TioObject,
  type WorkspaceContentPort,
} from '@tio/core';
import { canonical, encode, managedPath, pathFor } from '@tio/serialization';
import { StorageError, type FileStorageProvider } from '@tio/storage';

import { ChunkTree } from './chunks';
export { ChunkTree } from './chunks';

/** One shared layout for all file backends. No business merge or transport-specific behavior. */
export class FileWorkspaceContent implements WorkspaceContentPort {
  private filesPresent = new Set<string>();
  private fingerprints = new Map<string, string>();
  private cache = new Map<string, { fingerprint: string; object: TioObject }>();
  private types: ObjectRegistry;
  private tree: ChunkTree;
  readonly maxFileBytes: number;
  constructor(
    private files: FileStorageProvider,
    private workspaceId: string,
    options: { maxFileBytes?: number; types?: ObjectRegistry } = {},
  ) {
    this.types = options.types ?? createDefaultRegistry();
    this.maxFileBytes = options.maxFileBytes ?? 512 * 1024;
    this.tree = new ChunkTree(files, `workspaces/${workspaceId}/chunks`, this.maxFileBytes);
  }
  async authorize(): Promise<AccessPolicy> {
    const allowed = this.files.canWrite ? await this.files.canWrite() : true;
    return { ...fullAccess, allows: (_resource, operation) => operation === 'read' || allowed };
  }
  async list() {
    const ids: string[] = [];
    this.filesPresent.clear();
    this.fingerprints.clear();
    const listings = await Promise.all([
      this.files.list(`workspaces/${this.workspaceId}/objects/`),
      this.files.list(`workspaces/${this.workspaceId}/assets/`),
    ]);
    for (const file of listings.flat()) {
      this.filesPresent.add(file.path);
      if (!managedPath(file.path, this.workspaceId)) continue;
      const id = file.path.slice(file.path.lastIndexOf('/') + 1, -5);
      ids.push(id);
      if (file.fingerprint) this.fingerprints.set(id, file.fingerprint);
    }
    for (const id of this.cache.keys()) if (!this.fingerprints.has(id)) this.cache.delete(id);
    return ids;
  }
  async read(id: string, options: { fresh?: boolean } = {}) {
    const fingerprint = this.fingerprints.get(id);
    const cached = this.cache.get(id);
    if (!options.fresh && fingerprint && cached?.fingerprint === fingerprint)
      return structuredClone(cached.object);
    const path = pathFor({ id, workspaceId: this.workspaceId } as TioObject);
    const bytes = await this.files.read(path);
    if (!bytes) return undefined;
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    let object: TioObject;
    if (json.$storage) {
      if (json.$storage.version !== 1 || json.id !== id || json.workspaceId !== this.workspaceId)
        throw new StorageError('invalid', 'Invalid object manifest');
      object = this.types.decode(await this.tree.read(json.$storage.root));
    } else object = this.types.decode(json);
    if (object.workspaceId !== this.workspaceId || object.id !== id)
      throw new StorageError('invalid', 'Object identity mismatch');
    if (!options.fresh && fingerprint) {
      this.cache.delete(id);
      this.cache.set(id, { fingerprint, object: structuredClone(object) });
      // Bounded acceleration only; the backend remains the source of truth.
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    }
    return object;
  }
  async write(object: TioObject) {
    if (object.workspaceId !== this.workspaceId)
      throw new StorageError('invalid', 'Workspace mismatch');
    const data = encode(object, this.types);
    const path = pathFor(object);
    const bytes =
      data.length <= this.maxFileBytes
        ? data
        : new TextEncoder().encode(
            canonical({
              id: object.id,
              workspaceId: object.workspaceId,
              $storage: {
                version: 1,
                root: await this.tree.write(JSON.parse(canonical(object)) as Json),
              },
            }),
          );
    // All immutable chunks are durable before the single mutable publication point.
    await this.files.write(path, bytes);
    this.cache.delete(object.id);
    this.filesPresent.add(path);
  }
  readAsset(object: TioObject) {
    return this.files.read(`workspaces/${this.workspaceId}/${object.assetPath}`);
  }
  async writeAsset(object: TioObject, bytes: Uint8Array) {
    const path = `workspaces/${this.workspaceId}/${object.assetPath}`;
    if (this.filesPresent.has(path)) return;
    await this.files.write(path, bytes);
    this.filesPresent.add(path);
  }
}
