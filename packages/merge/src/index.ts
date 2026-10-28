import {
  knownTypes,
  createDefaultRegistry,
  type ObjectRegistry,
  type Block,
  type TioObject,
} from '@tio/core';
import { canonical } from '@tio/serialization';
import { diff3Merge } from 'node-diff3';
export interface MergeResult {
  merged: TioObject;
  warnings: string[];
  recovered: unknown[];
}
const eq = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const rank = (v: unknown) => canonical(v) ?? '';
const winner = (a: any, b: any) => (rank(a) > rank(b) ? a : b);
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (value: string) => Array.from(segmenter.segment(value), (x) => x.segment);
export function merge(
  base: TioObject | undefined,
  local: TioObject,
  remote: TioObject,
  types: ObjectRegistry = createDefaultRegistry(),
): MergeResult {
  const warnings: string[] = [];
  const recovered: unknown[] = [];
  if (
    local.id !== remote.id ||
    local.workspaceId !== remote.workspaceId ||
    local.type !== remote.type
  )
    throw new Error('对象身份不匹配');
  const custom = types.get(local.type)?.merge;
  if (custom) {
    const result = custom(base, local, remote);
    types.decode(result.merged);
    if (
      result.merged.id !== local.id ||
      result.merged.workspaceId !== local.workspaceId ||
      result.merged.type !== local.type
    )
      throw new Error('Merge changed identity');
    return result;
  }
  function visit(b: any, l: any, r: any, path: string): any {
    if (knownTypes.has(local.type) && path === '.createdAt')
      return (
        base?.createdAt ??
        [local.createdAt!, remote.createdAt!].sort((a, b) => Date.parse(a) - Date.parse(b))[0]
      );
    if (knownTypes.has(local.type) && path === '.updatedAt')
      return [base?.updatedAt, local.updatedAt, remote.updatedAt]
        .filter((time): time is string => !!time)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    if (eq(l, r)) return l;
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
    if (path === '.blocks') return mergeBlocks(b ?? [], l, r);
    if (l === undefined || r === undefined) {
      warnings.push(path + ':delete-edit');
      recovered.push(l ?? r);
      return undefined;
    }
    if (
      l &&
      r &&
      typeof l === 'object' &&
      typeof r === 'object' &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      const out: Record<string, unknown> = Object.create(null);
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        const v = visit(b?.[k], l[k], r[k], path + '.' + k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (
      Array.isArray(l) &&
      Array.isArray(r) &&
      [...l, ...r].every((x) => x && typeof x.id === 'string')
    ) {
      const bm = new Map((Array.isArray(b) ? b : []).map((x: any) => [x.id, x]));
      const lm = new Map(l.map((x) => [x.id, x]));
      const rm = new Map(r.map((x) => [x.id, x]));
      const order = winner(
        l.map((x) => x.id),
        r.map((x) => x.id),
      ) as string[];
      const ids = [
        ...order,
        ...[...new Set([...lm.keys(), ...rm.keys()])]
          .filter((x) => !order.includes(x))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ];
      return ids
        .map((id) => visit(bm.get(id), lm.get(id), rm.get(id), path + '.' + id))
        .filter((x) => x !== undefined);
    }
    // Inline text with identical metadata: token merge preserves non-overlapping edits.
    if (
      Array.isArray(l) &&
      Array.isArray(r) &&
      Array.isArray(b) &&
      l.length === 1 &&
      r.length === 1 &&
      b.length === 1 &&
      l[0]?.type === 'text' &&
      r[0]?.type === 'text' &&
      b[0]?.type === 'text'
    ) {
      const strip = (x: any) => ({ ...x, text: '' });
      if (eq(strip(l[0]), strip(r[0])) && eq(strip(l[0]), strip(b[0]))) {
        return [{ ...l[0], text: visit(b[0].text, l[0].text, r[0].text, path + '.text') }];
      }
    }
    if (
      typeof b === 'string' &&
      typeof l === 'string' &&
      typeof r === 'string' &&
      path.endsWith('.text')
    ) {
      const parts = diff3Merge(graphemes(l), graphemes(b), graphemes(r));
      if (parts.every((p) => 'ok' in p))
        return parts.flatMap((p) => ('ok' in p ? p.ok : [])).join('');
    }
    warnings.push(path + ':conflict');
    recovered.push({ path, local: l, remote: r });
    return winner(l, r);
  }
  // Block identity is document-wide: moving a node must not turn its edit into a deletion.
  function mergeBlocks(baseBlocks: Block[], localBlocks: Block[], remoteBlocks: Block[]): Block[] {
    const index = (blocks: Block[]) => {
      const nodes = new Map<string, { payload: Omit<Block, 'children'>; parent: string | null }>();
      const orders = new Map<string | null, string[]>();
      const walk = (siblings: Block[], parent: string | null) => {
        orders.set(
          parent,
          siblings.map((block) => block.id),
        );
        for (const { children, ...payload } of siblings) {
          nodes.set(payload.id, { payload, parent });
          walk(children, payload.id);
        }
      };
      walk(blocks, null);
      return { nodes, orders };
    };
    const b = index(baseBlocks),
      l = index(localBlocks),
      r = index(remoteBlocks);
    const nodes = new Map<string, { payload: Omit<Block, 'children'>; parent: string | null }>();
    for (const id of [...new Set([...l.nodes.keys(), ...r.nodes.keys()])].sort()) {
      const node = visit(b.nodes.get(id), l.nodes.get(id), r.nodes.get(id), '.block.' + id);
      if (node) nodes.set(id, node);
    }
    // Concurrent valid moves can form a cycle. Detach its first ID deterministically.
    for (const [id, node] of nodes) {
      const seen = new Set([id]);
      let parent = node.parent;
      while (parent !== null) {
        if (seen.has(parent) || !nodes.has(parent)) {
          recovered.push({ id, parent: node.parent });
          warnings.push('.block.' + id + ':parent');
          node.parent = null;
          break;
        }
        seen.add(parent);
        parent = nodes.get(parent)!.parent;
      }
    }
    const children = new Map<string | null, string[]>();
    for (const [id, node] of nodes) {
      const siblings = children.get(node.parent) ?? [];
      siblings.push(id);
      children.set(node.parent, siblings);
    }
    const build = (parent: string | null): Block[] => {
      const ids = children.get(parent) ?? [];
      const order: string[] = visit(
        b.orders.get(parent) ?? [],
        l.orders.get(parent) ?? [],
        r.orders.get(parent) ?? [],
        '.order.' + parent,
      );
      const positions = new Map(order.map((id, i) => [id, i]));
      ids.sort(
        (a, b) =>
          (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity) ||
          (a < b ? -1 : a > b ? 1 : 0),
      );
      return ids.map((id) => ({ ...nodes.get(id)!.payload, children: build(id) }) as Block);
    };
    return build(null);
  }
  let merged: TioObject;
  if (eq(local, remote)) merged = local;
  else if (eq(local, base)) merged = remote;
  else if (eq(remote, base)) merged = local;
  else if (local.deleted || remote.deleted) {
    merged = structuredClone(
      winner(local.deleted ? local : remote, remote.deleted ? remote : local),
    );
    merged.deleted = true;
    if (!eq(local, remote)) {
      warnings.push('delete-edit');
      recovered.push(local.deleted ? remote : local);
    }
  } else merged = visit(base, local, remote, '');
  if (knownTypes.has(local.type))
    merged = {
      ...merged,
      createdAt: visit(base?.createdAt, local.createdAt, remote.createdAt, '.createdAt'),
      updatedAt: visit(base?.updatedAt, local.updatedAt, remote.updatedAt, '.updatedAt'),
    };
  return { merged, warnings, recovered };
}
