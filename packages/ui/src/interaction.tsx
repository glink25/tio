import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from 'react';

export type InteractionKind = 'document' | 'widget' | 'editor-ui' | 'overlay';
export interface InteractionScope {
  element: HTMLElement;
  kind: InteractionKind;
  parent: () => InteractionScope | null;
  lastIntent: number;
  deactivate?: (next: InteractionScope | null) => void;
}
interface InteractionState {
  owner: InteractionScope | null;
  intent: number;
  listeners: Set<() => void>;
  count: number;
  focus: (event: FocusEvent) => void;
}
const scopes = new WeakMap<HTMLElement, InteractionScope>();
const documents = new WeakMap<Document, InteractionState>();
function state(document: Document): InteractionState {
  let current = documents.get(document);
  if (!current) {
    current = {
      owner: null,
      intent: 0,
      listeners: new Set(),
      count: 0,
      focus: (event) => {
        if (event.target instanceof HTMLElement && event.target !== document.body)
          claimInteraction(document, interactionScopeAt(event.target));
      },
    };
    documents.set(document, current);
  }
  return current;
}
export function interactionScopeAt(node: Node | null): InteractionScope | null {
  for (
    let element = node instanceof HTMLElement ? node : node?.parentElement;
    element;
    element = element.parentElement
  ) {
    const scope = scopes.get(element);
    if (scope) return scope;
  }
  return null;
}
export function withinInteraction(
  owner: InteractionScope | null,
  scope: InteractionScope,
): boolean {
  for (let current = owner; current; current = current.parent()) if (current === scope) return true;
  return false;
}
export function interactionOwner(document: Document) {
  return state(document).owner;
}
export function claimInteraction(document: Document, next: InteractionScope | null) {
  const current = state(document);
  if (current.owner === next) return;
  const previous = current.owner;
  current.owner = next;
  current.intent++;
  for (let scope = next; scope; scope = scope.parent()) scope.lastIntent = current.intent;
  for (let scope = previous; scope; scope = scope.parent())
    if (!withinInteraction(next, scope)) scope.deactivate?.(next);
  for (const listener of current.listeners) listener();
}
export function registerInteraction(
  element: HTMLElement,
  kind: InteractionKind,
  options: { parent?: InteractionScope | null; deactivate?: InteractionScope['deactivate'] } = {},
) {
  const document = element.ownerDocument;
  const current = state(document);
  const scope: InteractionScope = {
    element,
    kind,
    lastIntent: -1,
    parent: () =>
      'parent' in options ? (options.parent ?? null) : interactionScopeAt(element.parentElement),
    deactivate: options.deactivate,
  };
  scopes.set(element, scope);
  if (current.count++ === 0) document.addEventListener('focusin', current.focus, true);
  let disposed = false;
  return {
    scope,
    canRestore: () => scope.lastIntent === current.intent,
    dispose() {
      if (disposed) return;
      disposed = true;
      scopes.delete(element);
      if (withinInteraction(current.owner, scope)) {
        let parent = scope.parent();
        while (parent && scopes.get(parent.element) !== parent) parent = parent.parent();
        current.owner = parent;
        for (const listener of current.listeners) listener();
      }
      if (--current.count === 0) {
        document.removeEventListener('focusin', current.focus, true);
      }
    },
  };
}
export function useInteractionOwner(document: Document | undefined) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!document) return () => {};
      const listeners = state(document).listeners;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [document],
  );
  const snapshot = useCallback(() => (document ? interactionOwner(document) : null), [document]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function interactionHasKind(scope: InteractionScope | null, kind: InteractionKind) {
  for (let current = scope; current; current = current.parent())
    if (current.kind === kind) return true;
  return false;
}
const ExitContext = createContext<Set<() => void> | null>(null);
/** A non-editable application inside a document, with its own focus/selection. */
export function InteractionBoundary({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [exits] = useState(() => new Set<() => void>());
  const registration = useRef<ReturnType<typeof registerInteraction> | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      registration.current?.dispose();
      registration.current = element
        ? registerInteraction(element, 'widget', {
            deactivate: () => {
              for (const exit of exits) exit();
            },
          })
        : null;
    },
    [exits],
  );
  return (
    <ExitContext.Provider value={exits}>
      <div
        {...props}
        ref={attach}
        data-tio-interaction="widget"
        contentEditable={false}
        tabIndex={-1}
        onPointerDownCapture={(event) => {
          props.onPointerDownCapture?.(event);
          if (event.defaultPrevented) return;
          const scope = registration.current?.scope;
          if (scope) claimInteraction(event.currentTarget.ownerDocument, scope);
          if (
            event.target instanceof Element &&
            !event.target.closest('input, textarea, select, [contenteditable="true"]')
          )
            event.currentTarget.focus({ preventScroll: true });
        }}
      >
        {children}
      </div>
    </ExitContext.Provider>
  );
}
export function useInteractionExit(exit: () => void) {
  const exits = useContext(ExitContext);
  const callback = useRef(exit);
  callback.current = exit;
  useEffect(() => {
    if (!exits) return;
    const run = () => callback.current();
    exits.add(run);
    return () => {
      exits.delete(run);
    };
  }, [exits]);
}
