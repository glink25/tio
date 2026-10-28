import type { AutomationRule } from '@tio/core';
import { useState } from 'react';

import { blankFlow, editFlow, type FlowDraft } from './model';
/** Incomplete drafts are UI state only; nothing is written until explicit save. */
export function useFlowDraft() {
  const [draft, setDraft] = useState<FlowDraft>();
  const [baseline, setBaseline] = useState('');
  const begin = (rule?: AutomationRule) => {
    const next = rule ? editFlow(rule) : blankFlow();
    setDraft(next);
    setBaseline(JSON.stringify(next));
  };
  const clear = () => {
    setDraft(undefined);
    setBaseline('');
  };
  return { draft, setDraft, begin, clear, dirty: !!draft && JSON.stringify(draft) !== baseline };
}
