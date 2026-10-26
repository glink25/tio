import { isDateValue, validDatePart, validTimeZone } from '@tio/core';
import type { DateValue } from '@tio/core';

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
/** Convert wall time in an IANA zone to an explicit offset. Reject DST gaps. */
export function zonedDateTime(local: string, zone: string) {
  if (!validTimeZone(zone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local))
    throw new Error('Invalid date or time zone');
  const normalized = local.length === 16 ? `${local}:00` : local;
  const wall = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(wall)) throw new Error('Invalid date');
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const delta = wall - Date.parse(`${dateParts(new Date(instant), zone)}Z`);
    if (!delta) break;
    instant += delta;
  }
  if (dateParts(new Date(instant), zone) !== normalized)
    throw new Error('This local time does not exist');
  const minutes = Math.round((wall - instant) / 60000);
  const offset = `${minutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  const result = normalized + offset;
  if (!validDatePart(result)) throw new Error('Invalid date');
  return result;
}
export function dateInput(value: string, zone: string) {
  return value.includes('T') ? dateParts(new Date(value), zone).slice(0, 16) : value;
}
export function asDate(value: unknown): DateValue {
  if (isDateValue(value)) return value;
  if (typeof value === 'string' && validDatePart(value)) return { start: value };
  throw new Error('Expected a date');
}
export const dateUnits = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const;
export function dateAdd(value: unknown, amount: number, unit: string): DateValue {
  const source = asDate(value);
  if (!dateUnits.includes(unit as (typeof dateUnits)[number]) || !Number.isInteger(amount))
    throw new Error('Invalid date unit or amount');
  const add = (part: string) => {
    if (['minutes', 'hours'].includes(unit)) {
      if (!part.includes('T')) throw new Error('Time is required');
      return new Date(
        Date.parse(part) + amount * (unit === 'hours' ? 3600000 : 60000),
      ).toISOString();
    }
    const local = part.includes('T')
      ? dateParts(new Date(part), source.timeZone ?? 'UTC')
      : `${part}T00:00:00`;
    const date = new Date(`${local}Z`);
    if (unit === 'days' || unit === 'weeks')
      date.setUTCDate(date.getUTCDate() + amount * (unit === 'weeks' ? 7 : 1));
    else {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + amount * (unit === 'years' ? 12 : 1));
      const last = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      date.setUTCDate(Math.min(day, last));
    }
    const shifted = date.toISOString().slice(0, 19);
    return part.includes('T')
      ? zonedDateTime(shifted, source.timeZone ?? 'UTC')
      : shifted.slice(0, 10);
  };
  return { ...source, start: add(source.start), ...(source.end ? { end: add(source.end) } : {}) };
}
export function dateBetween(a: unknown, b: unknown, unit: string) {
  const first = asDate(a),
    second = asDate(b);
  const milliseconds: Record<string, number> = {
    minutes: 60000,
    hours: 3600000,
    days: 86400000,
    weeks: 604800000,
  };
  if (milliseconds[unit]) {
    const zone = first.timeZone ?? second.timeZone ?? 'UTC';
    const comparable = (date: DateValue) =>
      ['days', 'weeks'].includes(unit) && date.start.includes('T')
        ? Date.parse(dateParts(new Date(date.start), zone) + 'Z')
        : Date.parse(date.start);
    return Math.trunc((comparable(first) - comparable(second)) / milliseconds[unit]);
  }
  if (unit !== 'months' && unit !== 'years') throw new Error('Invalid date unit');
  const x = new Date(first.start),
    y = new Date(second.start);
  let months = (x.getUTCFullYear() - y.getUTCFullYear()) * 12 + x.getUTCMonth() - y.getUTCMonth();
  const shifted = Date.parse(dateAdd(second, months, 'months').start);
  if (months > 0 && shifted > x.getTime()) months--;
  if (months < 0 && shifted < x.getTime()) months++;
  return unit === 'years' ? Math.trunc(months / 12) : months;
}
export function formatDate(value: unknown, pattern: string) {
  const date = asDate(value);
  const local = date.start.includes('T')
    ? dateParts(new Date(date.start), date.timeZone ?? 'UTC')
    : `${date.start}T00:00:00`;
  const tokens: Record<string, string> = {
    YYYY: local.slice(0, 4),
    MM: local.slice(5, 7),
    DD: local.slice(8, 10),
    HH: local.slice(11, 13),
    mm: local.slice(14, 16),
    ss: local.slice(17, 19),
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokens[token]);
}
