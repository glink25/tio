import { isDateValue, valueText } from '@tio/core';
import type { Field } from '@tio/core';

import { asDate, dateAdd, dateBetween, dateParts, formatDate, localTimeZone } from './dates';

type Node =
  | { kind: 'literal'; value: unknown }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; op: string; value: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node };
interface Token {
  text: string;
  value?: unknown;
  literal?: boolean;
}
const precedence: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '>': 4,
  '<': 4,
  '>=': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};
export const formulaFunctions: Record<string, string> = {
  prop: 'prop("Field")',
  if: 'if(condition, yes, no)',
  empty: 'empty(value)',
  format: 'format(value)',
  toNumber: 'toNumber(value)',
  abs: 'abs(number)',
  round: 'round(number)',
  floor: 'floor(number)',
  ceil: 'ceil(number)',
  min: 'min(a, b)',
  max: 'max(a, b)',
  concat: 'concat(a, b)',
  length: 'length(textOrList)',
  contains: 'contains(textOrList, value)',
  replace: 'replace(text, search, replacement)',
  lower: 'lower(text)',
  upper: 'upper(text)',
  dateStart: 'dateStart(date)',
  dateEnd: 'dateEnd(date)',
  dateAdd: 'dateAdd(date, amount, "days")',
  dateBetween: 'dateBetween(a, b, "days")',
  formatDate: 'formatDate(date, "YYYY-MM-DD")',
  now: 'now()',
  today: 'today()',
};
export function parseFormula(source: string): Node {
  if (source.length > 10000) throw new Error('Formula is too long');
  const tokens: Token[] = [];
  const regex =
    /\s+|"(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|==|!=|>=|<=|&&|\|\||[()+\-*/%,!<>]/gy;
  let offset = 0;
  while (offset < source.length) {
    regex.lastIndex = offset;
    const match = regex.exec(source);
    if (!match) throw new Error(`Unexpected character at ${offset + 1}`);
    const text = match[0];
    offset = regex.lastIndex;
    if (!text.trim()) continue;
    const literal =
      text.startsWith('"') || /^\d/.test(text) || ['true', 'false', 'null'].includes(text);
    tokens.push({ text, literal, ...(literal ? { value: JSON.parse(text) as unknown } : {}) });
  }
  if (!tokens.length) return { kind: 'literal', value: null };
  let position = 0,
    depth = 0;
  const take = () => tokens[position++];
  const expect = (text: string) => {
    if (take()?.text !== text) throw new Error(`Expected ${text}`);
  };
  const expression = (minimum = 0): Node => {
    if (++depth > 100) throw new Error('Formula is too deeply nested');
    const token = take();
    if (!token) throw new Error('Incomplete formula');
    let left: Node;
    if (token.literal) left = { kind: 'literal', value: token.value };
    else if (['!', 'not', '-', '+'].includes(token.text))
      left = { kind: 'unary', op: token.text, value: expression(7) };
    else if (token.text === '(') {
      left = expression();
      expect(')');
    } else {
      if (!Object.hasOwn(formulaFunctions, token.text))
        throw new Error(`Unknown function: ${token.text}`);
      expect('(');
      const args: Node[] = [];
      if (tokens[position]?.text !== ')') {
        do {
          args.push(expression());
          if (tokens[position]?.text !== ',') break;
          take();
        } while (position < tokens.length);
      }
      expect(')');
      left = { kind: 'call', name: token.text, args };
    }
    while (position < tokens.length && (precedence[tokens[position].text] ?? -1) >= minimum) {
      const op = take().text;
      left = { kind: 'binary', op, left, right: expression(precedence[op] + 1) };
    }
    depth--;
    return left;
  };
  const result = expression();
  if (position !== tokens.length) throw new Error('Unexpected token');
  return result;
}
function print(node: Node): string {
  if (node.kind === 'literal') return JSON.stringify(node.value);
  if (node.kind === 'unary') return `(${node.op === 'not' ? '!' : node.op}${print(node.value)})`;
  if (node.kind === 'binary') return `(${print(node.left)} ${node.op} ${print(node.right)})`;
  return `${node.name}(${node.args.map(print).join(', ')})`;
}
/** Persist IDs, never mutable labels. The UI can insert prop("id") for duplicate labels. */
export function compileFormula(source: string, fields: Field[]) {
  const node = parseFormula(source);
  const bind = (item: Node): void => {
    if (item.kind === 'call') {
      if (item.name === 'prop') {
        if (
          item.args.length !== 1 ||
          item.args[0].kind !== 'literal' ||
          typeof item.args[0].value !== 'string'
        )
          throw new Error('prop requires a field name');
        const key = item.args[0].value;
        const matches = fields.some((f) => f.id === key)
          ? fields.filter((f) => f.id === key)
          : fields.filter((f) => f.name === key);
        if (matches.length !== 1)
          throw new Error(matches.length ? `Ambiguous field: ${key}` : `Missing field: ${key}`);
        item.args[0].value = matches[0].id;
      }
      item.args.forEach(bind);
    } else if (item.kind === 'binary') {
      bind(item.left);
      bind(item.right);
    } else if (item.kind === 'unary') bind(item.value);
  };
  bind(node);
  return print(node);
}
/** Show current names in the editor while persisted references continue to use IDs. */
export function formulaSource(source: string, fields: Field[]) {
  const node = parseFormula(source);
  const label = (item: Node): void => {
    if (item.kind === 'call') {
      if (item.name === 'prop' && item.args[0]?.kind === 'literal') {
        const argument = item.args[0];
        const field = fields.find((f) => f.id === argument.value);
        if (
          field &&
          fields.filter((f) => f.name === field.name).length === 1 &&
          !fields.some((f) => f.id === field.name && f.id !== field.id)
        )
          argument.value = field.name;
      }
      item.args.forEach(label);
    } else if (item.kind === 'binary') {
      label(item.left);
      label(item.right);
    } else if (item.kind === 'unary') label(item.value);
  };
  label(node);
  return print(node);
}
const numeric = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a number');
  return value;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected text');
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Expected a checkbox or condition');
  return value;
};
export const isEmpty = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && !value.length);
export function evaluateFormula(node: Node, resolve: (id: string) => unknown, now: Date): unknown {
  let budget = 10000;
  const run = (item: Node): unknown => {
    if (--budget < 0) throw new Error('Formula evaluation limit exceeded');
    if (item.kind === 'literal') return item.value;
    if (item.kind === 'unary') {
      const value = run(item.value);
      return item.op === '!' || item.op === 'not'
        ? !boolean(value)
        : numeric(value) * (item.op === '-' ? -1 : 1);
    }
    if (item.kind === 'binary') {
      const a = run(item.left);
      if (item.op === 'and' || item.op === '&&') return boolean(a) && boolean(run(item.right));
      if (item.op === 'or' || item.op === '||') return boolean(a) || boolean(run(item.right));
      const b = run(item.right);
      if (item.op === '==') return JSON.stringify(a) === JSON.stringify(b);
      if (item.op === '!=') return JSON.stringify(a) !== JSON.stringify(b);
      if (['>', '<', '>=', '<='].includes(item.op)) {
        const x = isDateValue(a) ? Date.parse(a.start) : a,
          y = isDateValue(b) ? Date.parse(b.start) : b;
        if ((typeof x !== 'number' && typeof x !== 'string') || typeof x !== typeof y)
          throw new Error('Cannot compare these values');
        const comparison = typeof x === 'number' ? x - numeric(y) : x.localeCompare(string(y));
        return item.op === '>'
          ? comparison > 0
          : item.op === '<'
            ? comparison < 0
            : item.op === '>='
              ? comparison >= 0
              : comparison <= 0;
      }
      if (item.op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
      const x = numeric(a),
        y = numeric(b);
      if ((item.op === '/' || item.op === '%') && y === 0) throw new Error('Division by zero');
      return item.op === '+'
        ? x + y
        : item.op === '-'
          ? x - y
          : item.op === '*'
            ? x * y
            : item.op === '/'
              ? x / y
              : x % y;
    }
    const { name, args } = item;
    const arity: Record<string, number> = {
      prop: 1,
      if: 3,
      empty: 1,
      format: 1,
      toNumber: 1,
      abs: 1,
      round: 1,
      floor: 1,
      ceil: 1,
      length: 1,
      contains: 2,
      replace: 3,
      lower: 1,
      upper: 1,
      dateStart: 1,
      dateEnd: 1,
      dateAdd: 3,
      dateBetween: 3,
      formatDate: 2,
      now: 0,
      today: 0,
    };
    if (arity[name] !== undefined ? args.length !== arity[name] : args.length < 1)
      throw new Error(`Invalid arguments: ${name}`);
    if (name === 'prop') return resolve(string(run(args[0])));
    if (name === 'if') return run(args[boolean(run(args[0])) ? 1 : 2]);
    const values = args.map(run),
      [a, b, c] = values;
    switch (name) {
      case 'empty':
        return isEmpty(a);
      case 'format':
        return isDateValue(a) ? a.start : valueText(a);
      case 'toNumber': {
        const n = typeof a === 'number' ? a : Number(string(a));
        return numeric(n);
      }
      case 'abs':
        return Math.abs(numeric(a));
      case 'round':
        return Math.round(numeric(a));
      case 'floor':
        return Math.floor(numeric(a));
      case 'ceil':
        return Math.ceil(numeric(a));
      case 'min':
        return Math.min(...values.map(numeric));
      case 'max':
        return Math.max(...values.map(numeric));
      case 'concat':
        return values.map(string).join('');
      case 'length':
        return Array.isArray(a) ? a.length : string(a).length;
      case 'contains':
        return Array.isArray(a) ? a.includes(b) : string(a).includes(string(b));
      case 'replace':
        return string(a).replace(string(b), string(c));
      case 'lower':
        return string(a).toLocaleLowerCase();
      case 'upper':
        return string(a).toLocaleUpperCase();
      case 'dateStart':
        return { start: asDate(a).start, timeZone: asDate(a).timeZone };
      case 'dateEnd':
        return { start: asDate(a).end ?? asDate(a).start, timeZone: asDate(a).timeZone };
      case 'dateAdd':
        return dateAdd(a, numeric(b), string(c));
      case 'dateBetween':
        return dateBetween(a, b, string(c));
      case 'formatDate':
        return formatDate(a, string(b));
      case 'now':
        return { start: now.toISOString(), timeZone: localTimeZone() };
      case 'today':
        return { start: dateParts(now, localTimeZone()).slice(0, 10) };
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  };
  const value = run(node);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite result');
  return value;
}
