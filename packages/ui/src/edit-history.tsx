import { createContext, useContext, useEffect, useRef } from 'react';

/** Editing history is supplied by the editor's session, including temporary form drafts. */
export interface EditHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  breakGroup: () => void;
  recordDraft: <T>(owner: symbol, before: T, after: T, apply: (value: T) => void) => void;
  discardDraft: (owner: symbol) => void;
}
export const EditHistoryContext = createContext<EditHistory | undefined>(undefined);

export function useDraftHistory<T>(value: T, apply: (value: T) => void, token?: symbol) {
  const history = useContext(EditHistoryContext);
  const owner = useRef(token ?? Symbol('draft'));
  const mounted = useRef(true);
  const latest = useRef({ value, apply, history });
  latest.current = { value, apply, history };
  useEffect(() => {
    const token = owner.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current.history?.discardDraft(token);
    };
  }, []);
  const change = (next: T) => {
    if (!mounted.current) return;
    latest.current.history?.recordDraft(owner.current, latest.current.value, next, (value) => {
      latest.current.value = value;
      latest.current.apply(value);
    });
    latest.current.value = next;
    latest.current.apply(next);
  };
  return {
    owner: owner.current,
    change,
    update(transform: (value: T) => T) {
      change(transform(latest.current.value));
    },
    discard() {
      latest.current.history?.discardDraft(owner.current);
    },
  };
}
