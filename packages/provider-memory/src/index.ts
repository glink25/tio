import type { FileStorageProvider } from '@tio/storage';
export class MemoryProvider implements FileStorageProvider {
  readonly attachmentPolicy = { maxFileBytes: 20 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 };
  files = new Map<string, Uint8Array>();
  beforeWrite?: (path: string) => Promise<void>;
  fail = false;
  async list(prefix: string) {
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix))
      .sort()
      .map((path) => ({ path }));
  }
  async read(path: string) {
    if (this.fail) throw new Error('模拟读取失败');
    return this.files.get(path)?.slice() ?? null;
  }
  async write(path: string, data: Uint8Array) {
    await this.beforeWrite?.(path);
    if (this.fail) throw new Error('模拟写入失败');
    this.files.set(path, data.slice());
  }
  async delete(path: string) {
    this.files.delete(path);
  }
}
export { MemoryRepository } from './repository';
