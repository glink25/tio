import { i18n, t, setLanguage } from '@tio/i18n';
import { expect, it } from 'vitest';

import { en, zh } from '../packages/i18n/src/locales';
it('keeps English and Chinese keys and interpolation placeholders aligned', () => {
  expect(Object.keys(en).sort((a, b) => a.localeCompare(b))).toEqual(
    Object.keys(zh).sort((a, b) => a.localeCompare(b)),
  );
  for (const key of Object.keys(en) as (keyof typeof en)[])
    expect(zh[key].match(/{{.*?}}/g) ?? []).toEqual(en[key].match(/{{.*?}}/g) ?? []);
});
it('supports Chinese and English plurals and safe language fallback', async () => {
  setLanguage('en');
  expect(t('database.count', { count: 1 })).toBe('1 record');
  expect(t('database.count', { count: 2 })).toBe('2 records');
  setLanguage('zh');
  expect(t('database.count', { count: 2 })).toBe('2 条记录');
  await i18n.changeLanguage('fr');
  expect(t('common.close')).toBe('Close');
});
