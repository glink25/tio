import type { Field, TioObject } from '@tio/core';
import { createEvaluator, displayValue as format, type ValuePresentation } from '@tio/database';
import { formatLocale, i18n, resolveLanguage, t, useT, useTranslation } from '@tio/i18n';
import { useEffect, useMemo, useState } from 'react';

import { useViewExtensions } from './extensions';
function presentation(language: string | undefined, translate: typeof t): ValuePresentation {
  return {
    locale: formatLocale(resolveLanguage(language)),
    text: {
      unavailableReference: translate('database.value.unavailableReference'),
      missingReference: translate('database.value.missingReference'),
      untitledRecord: translate('database.value.untitledRecord'),
      missingAttachment: translate('database.value.missingAttachment'),
      yes: translate('database.value.yes'),
      no: translate('database.value.no'),
      unknownOption: (id) => translate('database.value.unknownOption', { id }),
    },
  };
}
export function displayValue(value: unknown, field: Field, objects: TioObject[] = []) {
  return format(value, field, objects, presentation(i18n.resolvedLanguage, t));
}

export function useDisplayValue() {
  const { i18n } = useTranslation();
  const { fields } = useViewExtensions();
  const translate = useT();
  const formatting = presentation(i18n.resolvedLanguage, translate);
  return (value: unknown, field: Field, objects: TioObject[] = []) =>
    fields?.[field.type]?.display(value, field, objects, i18n.language) ??
    format(value, field, objects, formatting);
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
