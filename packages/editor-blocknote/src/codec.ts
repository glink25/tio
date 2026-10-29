import { id, isMentionReference } from '@tio/core';
import type { Block } from '@tio/core';
export interface ContentSchema {
  blockSchema: Record<
    string,
    {
      content: string;
      propSchema: Record<
        string,
        { default: unknown; type?: 'string' | 'number' | 'boolean'; values?: readonly unknown[] }
      >;
    }
  >;
  styleSchema: Record<string, { propSchema: string }>;
  inlineContentSchema: Record<string, unknown>;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
export function safeContent(content: unknown, schema: ContentSchema): boolean {
  if (typeof content === 'string') return true;
  if (Array.isArray(content))
    return content.every((item) => {
      if (typeof item === 'string') return true;
      if (!record(item)) return false;
      if (item.type === 'text')
        return (
          typeof item.text === 'string' &&
          keys(item, ['type', 'text', 'styles']) &&
          record(item.styles ?? {}) &&
          Object.entries(item.styles ?? {}).every(
            ([key, value]) => schema.styleSchema[key]?.propSchema === typeof value,
          )
        );
      if (item.type === 'link')
        return (
          keys(item, ['type', 'href', 'content']) &&
          typeof item.href === 'string' &&
          /^(https?:|mailto:|#)/.test(item.href) &&
          safeContent(item.content, schema)
        );
      if (item.type === 'mention')
        return (
          !!schema.inlineContentSchema.mention &&
          keys(item, ['type', 'props']) &&
          isMentionReference(item.props)
        );
      // Custom inline payloads require a schema codec supplied by their extension.
      return false;
    });
  if (
    !record(content) ||
    content.type !== 'tableContent' ||
    !keys(content, ['type', 'rows', 'columnWidths', 'headerRows', 'headerCols'])
  )
    return false;
  if (
    content.columnWidths !== undefined &&
    (!Array.isArray(content.columnWidths) ||
      !content.columnWidths.every((width: unknown) => width == null || typeof width === 'number'))
  )
    return false;
  return (
    Array.isArray(content.rows) &&
    content.rows.every(
      (row: unknown) =>
        record(row) &&
        keys(row, ['cells']) &&
        Array.isArray(row.cells) &&
        row.cells.every((cell: unknown) => {
          if (Array.isArray(cell) || typeof cell === 'string') return safeContent(cell, schema);
          return (
            record(cell) &&
            cell.type === 'tableCell' &&
            keys(cell, ['type', 'props', 'content']) &&
            record(cell.props) &&
            keys(cell.props, [
              'backgroundColor',
              'textColor',
              'textAlignment',
              'colspan',
              'rowspan',
            ]) &&
            safeContent(cell.content, schema)
          );
        }),
    )
  );
}
export interface BlockContentCodec {
  accepts(block: Block): boolean;
  toEditor(block: Block): unknown;
  fromEditor(content: unknown): unknown;
}
export function toEditor(
  blocks: Block[],
  schema: ContentSchema,
  codecs: Record<string, BlockContentCodec> = {},
): any[] {
  return blocks.map((block) => {
    const spec = schema.blockSchema[block.type];
    const codec = codecs[block.type];
    const propsSupported =
      spec &&
      Object.entries(block.props).every(([key, value]) => {
        const prop = spec.propSchema[key];
        // Unknown properties are retained by fromEditor; known invalid values must not be coerced.
        return (
          !prop ||
          (value === undefined && prop.default === undefined) ||
          (typeof value === (prop.type ?? typeof prop.default) &&
            (!prop.values || prop.values.includes(value)))
        );
      });
    if (
      !spec ||
      block.type === 'unsupported' ||
      !propsSupported ||
      !(codec
        ? codec.accepts(block)
        : spec.content === 'none'
          ? Array.isArray(block.content) && block.content.length === 0
          : safeContent(block.content, schema))
    )
      return {
        id: block.id,
        type: 'unsupported',
        props: { raw: JSON.stringify(block), label: block.type },
      };
    let content = codec ? codec.toEditor(block) : encodeMentionAnchors(block.content);
    if (
      !codec &&
      record(content) &&
      content.type === 'tableContent' &&
      Array.isArray(content.columnWidths)
    )
      content = {
        ...content,
        columnWidths: content.columnWidths.map((width: unknown) =>
          width === null ? undefined : width,
        ),
      };
    return {
      id: block.id,
      type: block.type,
      props: block.props,
      ...(spec.content === 'none' ? {} : { content }),
      children: toEditor(block.children, schema, codecs),
    };
  });
}
export function fromEditor(
  blocks: any[],
  previous: Block[],
  codecs: Record<string, BlockContentCodec> = {},
): Block[] {
  const originals = new Map<string, Block>();
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      originals.set(block.id, block);
      walk(block.children);
    }
  };
  walk(previous);
  const convert = (block: any): Block => {
    if (block.type === 'unsupported') {
      const raw = JSON.parse(block.props.raw) as Block;
      // The outer opaque node receives a fresh paste ID; its hidden descendants must too.
      const copy = (value: Block): Block => ({
        ...value,
        id: id('block'),
        children: value.children.map(copy),
      });
      return {
        ...raw,
        id: block.id,
        children:
          raw.id === block.id
            ? raw.children
            : (originals.get(block.id)?.children ?? raw.children.map(copy)),
      };
    }
    const old = originals.get(block.id);
    const codec = codecs[block.type];
    let content = codec ? codec.fromEditor(block.content) : (block.content ?? []);
    if (
      !codec &&
      record(content) &&
      content.type === 'tableContent' &&
      Array.isArray(content.columnWidths)
    )
      content = {
        ...content,
        columnWidths: content.columnWidths.map((width: unknown) =>
          width === undefined ? null : width,
        ),
      };
    return {
      ...old,
      id: block.id,
      type: block.type,
      props: { ...(old && old.type === block.type ? old.props : {}), ...block.props },
      content: codec ? content : normalizeInlineContent(content),
      children: (block.children ?? []).map(convert),
    };
  };
  return blocks.map(convert);
}

/** BlockNote adds an undefined content field to atomic inline nodes. Do not persist it. */
function normalizeInlineContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeInlineContent);
  if (!record(value)) return value;
  let node = value;
  if (node.type === 'mention' && record(node.props) && typeof node.props.anchor === 'string') {
    const { anchor, ...props } = node.props;
    node = { ...node, props: { ...props, ...(anchor ? { anchor: JSON.parse(anchor) } : {}) } };
  }
  if (
    node.type === 'mention' &&
    record(node.props) &&
    node.props.kind !== 'github-user' &&
    node.props.login === ''
  ) {
    const { login: _login, ...props } = node.props;
    node = { ...node, props };
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(
        ([key, item]) => !(node.type === 'mention' && key === 'content' && item === undefined),
      )
      .map(([key, item]) => [
        key,
        ['content', 'rows', 'cells'].includes(key) ? normalizeInlineContent(item) : item,
      ]),
  );
}

/** Validate changed known blocks without normalizing or rewriting opaque content. */
export function validateOperationBlocks(
  before: Block[],
  after: Block[],
  schema: ContentSchema,
  codecs: Record<string, BlockContentCodec> = {},
) {
  const originals = new Map<string, Block>();
  const visit = (items: Block[]) => {
    for (const b of items) {
      originals.set(b.id, b);
      visit(b.children);
    }
  };
  visit(before);
  const check = (items: Block[]) => {
    for (const block of items) {
      const old = originals.get(block.id);
      const own = (b: Block) => {
        const { children: _children, ...value } = b;
        return JSON.stringify(value);
      };
      if (!old || own(block) !== own(old)) {
        const converted = toEditor([{ ...block, children: [] }], schema, codecs)[0];
        if (converted.type === 'unsupported')
          throw new Error('Unsupported or invalid block content: ' + block.id);
      }
      check(block.children);
    }
  };
  check(after);
}

export function encodeMentionAnchors(value: unknown): any {
  if (Array.isArray(value)) return value.map(encodeMentionAnchors);
  if (!record(value)) return value;
  if (value.type === 'mention' && record(value.props))
    return {
      ...value,
      props: {
        ...value.props,
        anchor: value.props.anchor ? JSON.stringify(value.props.anchor) : '',
      },
    };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['content', 'rows', 'cells'].includes(key) ? encodeMentionAnchors(item) : item,
    ]),
  );
}
