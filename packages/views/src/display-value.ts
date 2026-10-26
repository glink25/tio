import type { Field, TioObject } from '@tio/core';
import { displayValue as format } from '@tio/database';
import { i18n, useTranslation } from '@tio/i18n';

import { useViewExtensions } from './extensions';
export function displayValue(value: unknown, field: Field, objects: TioObject[] = []) {
  return format(value, field, objects, i18n.language === 'zh' ? 'zh' : 'en');
}

export function useDisplayValue() {
  const { i18n } = useTranslation();
  const { fields } = useViewExtensions();
  return (value: unknown, field: Field, objects: TioObject[] = []) =>
    fields?.[field.type]?.display(value, field, objects, i18n.language) ??
    format(value, field, objects, i18n.language === 'zh' ? 'zh' : 'en');
}
