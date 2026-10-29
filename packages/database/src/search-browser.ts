import {
  HostError,
  type WorkspaceRepository,
  type SearchQuery,
  type SearchPage,
  type SearchHit,
  type TioObject,
} from '@tio/core';
/** Provider I/O is asynchronous; text extraction and matching never run on the UI thread. */
export class WorkerSearch {
  private worker?: Worker;
  private closed = false;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (items: SearchHit[]) => void; reject: (error: Error) => void }
  >();
  constructor(private repository: WorkspaceRepository) {}
  private match(
    objects: TioObject[],
    navigation: TioObject[],
    query: SearchQuery,
  ): Promise<SearchHit[]> {
    if (this.closed) return Promise.reject(new HostError('closed'));
    if (!this.worker) {
      this.worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event) => {
        const request = this.pending.get(event.data.id);
        this.pending.delete(event.data.id);
        request?.resolve(event.data.items);
      };
      this.worker.onerror = () => this.close();
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, objects, navigation, text: query.text, type: query.type });
    });
  }
  async search(query: SearchQuery): Promise<SearchPage> {
    if (!this.repository.scan || !this.repository.queryNavigation)
      throw new HostError('unsupported');
    const page = await this.repository.scan(query);
    const navigation: TioObject[] = [];
    let after: string | undefined;
    do {
      const result = await this.repository.queryNavigation({ after, limit: 1000 });
      navigation.push(...result.items);
      after = result.next;
    } while (after);
    const items = await this.match(
      page.entries.map((e) => e.object),
      navigation,
      query,
    );
    return {
      version: page.version,
      items,
      next: page.next,
      complete: !page.next,
      scanned: page.entries.length,
    };
  }
  close() {
    this.closed = true;
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values())
      request.reject(new HostError('closed', 'Search worker stopped'));
    this.pending.clear();
  }
}
