import type { Field, TioObject } from '@tio/core';
import { createEvaluator, displayValue as format } from '@tio/database';
import { i18n, useTranslation } from '@tio/i18n';
import { useEffect, useMemo, useState } from 'react';

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

export function useFieldEvaluator(objects: TioObject[]) {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setTick(Math.floor(Date.now() / 60000));
    };
    const timer = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return useMemo(() => createEvaluator(objects, new Date(tick * 60000)), [objects, tick]);
}
