import type { TioObject } from '@tio/core';
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
): MergeResult {
  const warnings: string[] = [];
  const recovered: unknown[] = [];
  if (
    local.id !== remote.id ||
    local.workspaceId !== remote.workspaceId ||
    local.type !== remote.type
  )
    throw new Error('对象身份不匹配');
  function visit(b: any, l: any, r: any, path: string): any {
    if (eq(l, r)) return l;
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
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
  let merged: TioObject;
  if (local.deleted || remote.deleted) {
    merged = structuredClone(
      winner(local.deleted ? local : remote, remote.deleted ? remote : local),
    );
    merged.deleted = true;
    if (!eq(local, remote)) {
      warnings.push('delete-edit');
      recovered.push(local.deleted ? remote : local);
    }
  } else merged = visit(base, local, remote, '');
  if (merged.blocks) {
    const seen = new Set<string>();
    const dedupe = (blocks: NonNullable<TioObject['blocks']>): NonNullable<TioObject['blocks']> =>
      blocks
        .filter((b) => {
          if (seen.has(b.id)) {
            warnings.push('duplicate-block:' + b.id);
            recovered.push(b);
            return false;
          }
          seen.add(b.id);
          return true;
        })
        .map((b) => ({ ...b, children: dedupe(b.children) }));
    merged = { ...merged, blocks: dedupe(merged.blocks) };
  }
  return { merged, warnings, recovered };
}
