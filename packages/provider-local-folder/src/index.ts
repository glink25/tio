import { StorageError, segments, type FileStorageProvider } from '@tio/storage';
export class LocalFolderProvider implements FileStorageProvider {
  constructor(readonly handle: FileSystemDirectoryHandle) {}
  async canWrite() {
    try {
      return (await this.handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch (error) {
      throw storageError(error);
    }
  }
  private async parent(path: string, create = false) {
    const parts = segments(path);
    const filename = parts.pop()!;
    let dir = this.handle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, filename };
  }
  async read(path: string) {
    try {
      const { dir, filename } = await this.parent(path);
      return new Uint8Array(
        await (await (await dir.getFileHandle(filename)).getFile()).arrayBuffer(),
      );
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return null;
      throw storageError(e);
    }
  }
  async write(path: string, data: Uint8Array) {
    try {
      await this.writeFile(path, data);
    } catch (error) {
      throw storageError(error);
    }
  }
  private async writeFile(path: string, data: Uint8Array) {
    const { dir, filename } = await this.parent(path, true);
    const file = await dir.getFileHandle(filename, { create: true });
    const stream = await file.createWritable();
    try {
      await stream.write(data as unknown as BufferSource);
      await stream.close();
    } catch (e) {
      await stream.abort().catch(() => {});
      throw storageError(e);
    }
  }
  async delete(path: string) {
    try {
      const { dir, filename } = await this.parent(path);
      await dir.removeEntry(filename);
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') throw storageError(e);
    }
  }
  async list(prefix: string) {
    const result: { path: string }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
      for await (const [name, entry] of dir.entries()) {
        const p = path + name;
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, p + '/');
        else result.push({ path: p });
      }
    };
    const parts = prefix.replace(/\/$/, '');
    try {
      let dir = this.handle;
      if (parts) for (const p of segments(parts)) dir = await dir.getDirectoryHandle(p);
      await walk(dir, parts ? parts + '/' : '');
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') throw storageError(e);
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
}

function storageError(error: unknown): unknown {
  if (
    (error as DOMException)?.name === 'NotAllowedError' ||
    (error as DOMException)?.name === 'SecurityError'
  )
    return new StorageError('permission', error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  return error;
}
