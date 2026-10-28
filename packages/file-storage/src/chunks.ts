import type { Json } from '@tio/core';
import { canonical } from '@tio/serialization';
import { StorageError, type FileStorageProvider } from '@tio/storage';

import { decodeStored, parseStored } from './decode';

type Node =
  | { kind: 'value'; value: Json }
  | { kind: 'string' | 'array' | 'object'; root: string }
  | { kind: 'refs' | 'branches'; refs: string[] };
const bytes = (value: unknown) => new TextEncoder().encode(canonical(value));
export async function hash(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Immutable JSON Merkle tree. Every node, including index nodes, obeys the byte limit. */
export class ChunkTree {
  constructor(
    private files: FileStorageProvider,
    private root: string,
    readonly limit: number,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1024)
      throw new Error('Chunk limit must be at least 1024 bytes');
  }
  private path(id: string) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new StorageError('invalid', 'Invalid chunk hash');
    return `${this.root}/${id.slice(0, 2)}/${id}.json`;
  }
  private async put(node: Node) {
    const data = bytes(node);
    if (data.length > this.limit) throw new Error('Chunk exceeds configured byte limit');
    const id = await hash(data);
    const path = this.path(id);
    const existing = await this.files.read(path);
    if (!existing) await this.files.write(path, data);
    else if ((await hash(existing)) !== id)
      throw new StorageError('invalid', 'Corrupt immutable chunk');
    return id;
  }
  private async refs(refs: string[]): Promise<string> {
    if (bytes({ kind: 'refs', refs }).length <= this.limit) return this.put({ kind: 'refs', refs });
    const width = Math.floor((this.limit - 64) / 72);
    let level = refs;
    let kind: 'refs' | 'branches' = 'refs';
    while (level.length > width) {
      const parents: string[] = [];
      for (let i = 0; i < level.length; i += width)
        parents.push(await this.put({ kind, refs: level.slice(i, i + width) }));
      level = parents;
      kind = 'branches';
    }
    return this.put({ kind, refs: level });
  }
  async write(value: Json): Promise<string> {
    if (bytes({ kind: 'value', value }).length <= this.limit)
      return this.put({ kind: 'value', value });
    if (typeof value === 'string') {
      // Split only at Unicode scalar boundaries, and account for JSON escape expansion.
      const parts: string[] = [];
      let part = '',
        size = 0;
      for (const char of value) {
        const added = bytes(char).length;
        if (size + added > this.limit - 64 && part) {
          parts.push(await this.write(part));
          part = '';
          size = 0;
        }
        part += char;
        size += added;
      }
      if (part) parts.push(await this.write(part));
      return this.put({ kind: 'string', root: await this.refs(parts) });
    }
    if (Array.isArray(value)) {
      const refs: string[] = [];
      for (const item of value) refs.push(await this.write(item));
      return this.put({ kind: 'array', root: await this.refs(refs) });
    }
    const entries: string[] = [];
    for (const key of Object.keys(value!).sort())
      entries.push(await this.write([key, (value as Record<string, Json>)[key]]));
    return this.put({ kind: 'object', root: await this.refs(entries) });
  }
  async read(id: string): Promise<Json> {
    let remaining = 100_000,
      total = 0;
    const load = async (id: string, depth: number): Promise<Node> => {
      if (--remaining < 0 || depth > 128)
        throw new StorageError('invalid', 'Chunk tree exceeds object limits');
      const data = await this.files.read(this.path(id));
      if (!data) throw new StorageError('missing', `Missing chunk: ${id}`);
      total += data.length;
      if (data.length > this.limit || total > 200 * 1024 * 1024 || (await hash(data)) !== id)
        throw new StorageError('invalid', 'Invalid chunk data');
      const node = parseStored(data);
      if (!node || typeof node !== 'object' || !('kind' in node))
        throw new StorageError('invalid', 'Invalid chunk node');
      switch (node.kind) {
        case 'value':
          if ('value' in node) return node as Node;
          break;
        case 'refs':
        case 'branches':
          if (
            'refs' in node &&
            Array.isArray(node.refs) &&
            node.refs.every((ref) => typeof ref === 'string')
          )
            return node as Node;
          break;
        case 'string':
        case 'array':
        case 'object':
          if ('root' in node && typeof node.root === 'string') return node as Node;
          break;
      }
      throw new StorageError('invalid', 'Invalid chunk node');
    };
    const references = async (id: string, depth: number): Promise<string[]> => {
      const node = await load(id, depth);
      if (node.kind === 'refs') return node.refs;
      if (node.kind !== 'branches') throw new StorageError('invalid', 'Expected chunk index');
      const refs: string[] = [];
      for (const child of node.refs) refs.push(...(await references(child, depth + 1)));
      return refs;
    };
    const value = async (id: string, depth: number): Promise<Json> => {
      const node = await load(id, depth);
      if (node.kind === 'value') return node.value;
      if (!('root' in node)) throw new StorageError('invalid', 'Expected JSON chunk');
      const values: Json[] = [];
      for (const ref of await references(node.root, depth + 1))
        values.push(await value(ref, depth + 1));
      switch (node.kind) {
        case 'array':
          return values;
        case 'string': {
          if (!values.every((part) => typeof part === 'string'))
            throw new StorageError('invalid', 'Expected string parts');
          return values.join('');
        }
        case 'object':
          return decodeStored(() => Object.fromEntries(values as [string, Json][]));
        default:
          throw new StorageError('invalid', 'Unknown chunk node');
      }
    };
    return value(id, 0);
  }
}
