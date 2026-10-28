export interface OptionsPage<T> {
  items: T[];
  next?: string;
  sourceErrors?: string[];
}
export interface OptionsState<T> {
  items: T[];
  next?: string;
  loading: boolean;
  failed: boolean;
}
/** One query generation; a failed cursor is never retried until reset. */
export class PagedOptions<T> {
  private generation = 0;
  private state: OptionsState<T> = { items: [], loading: false, failed: false };
  constructor(
    private key: (item: T) => string,
    private publish: (state: OptionsState<T>) => void,
    private error: () => void,
  ) {}
  reset() {
    this.generation++;
    this.state = { items: [], loading: false, failed: false };
    this.publish(this.state);
  }
  dispose() {
    this.generation++;
  }
  async load(query: (after?: string) => Promise<OptionsPage<T>>, append = false) {
    if (this.state.loading || this.state.failed || (append && !this.state.next)) return;
    const generation = this.generation;
    const after = append ? this.state.next : undefined;
    this.state = { ...this.state, loading: true };
    this.publish(this.state);
    try {
      const page = await query(after);
      if (generation !== this.generation) return;
      const items = new Map((append ? this.state.items : []).map((item) => [this.key(item), item]));
      for (const item of page.items) items.set(this.key(item), item);
      const failed = !!page.sourceErrors?.length || (!!after && page.next === after);
      this.state = {
        items: [...items.values()],
        loading: false,
        failed,
        next: failed ? undefined : page.next,
      };
      this.publish(this.state);
      if (failed) this.error();
    } catch {
      if (generation !== this.generation) return;
      this.state = { ...this.state, loading: false, failed: true, next: undefined };
      this.publish(this.state);
      this.error();
    }
  }
}
