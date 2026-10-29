import type { Block, ContentAnchor, TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { useNotify } from '@tio/ui';
import { useEffect, useId, useState } from 'react';

export function ContentLocation({
  object,
  anchor,
  requestId,
  root,
}: {
  object?: TioObject;
  anchor?: ContentAnchor;
  requestId?: number;
  root: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const notify = useNotify();
  const scope = useId();
  const [highlight, setHighlight] = useState('');
  useEffect(() => {
    const container = root.current;
    setHighlight('');
    if (!object || !anchor || !container) return;
    const contains = (blocks: Block[]): boolean =>
      blocks.some(
        (b) => (anchor.type === 'block' && b.id === anchor.blockId) || contains(b.children),
      );
    if (anchor.type === 'block' && !contains(object.blocks ?? [])) {
      notify(t('links.positionMissing'));
      return;
    }
    container.dataset.contentLocation = scope;
    const selector =
      anchor.type === 'block'
        ? `.bn-block-outer[data-id="${CSS.escape(anchor.blockId)}"]`
        : `[data-field-id="${CSS.escape(anchor.fieldId)}"]`;
    let highlighted: HTMLElement | undefined;
    let finish: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const locate = () => {
      const element = container.querySelector<HTMLElement>(selector);
      if (!element || highlighted === element) return;
      highlighted = element;
      setHighlight(`[data-content-location="${CSS.escape(scope)}"] ${selector}`);
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (!finish)
        finish = setTimeout(() => {
          observer.disconnect();
          setHighlight('');
        }, 1800);
    };
    // Never mutate ProseMirror-owned DOM: a temporary external stylesheet also survives
    // BlockNote replacing the initial block node during mount.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(locate);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-id', 'data-field-id'],
    });
    frame = requestAnimationFrame(locate);
    const deadline = setTimeout(() => {
      if (!highlighted) {
        observer.disconnect();
        notify(t('links.positionMissing'));
      }
    }, 5000);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      clearTimeout(finish);
      delete container.dataset.contentLocation;
    };
    // Consume once per navigation; changes to the edited body must not move the viewport.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [object?.id, !!object, anchor, requestId]);
  return highlight ? (
    <style
      data-location-highlight
    >{`${highlight} { outline: 2px solid currentColor; outline-offset: 4px; border-radius: 4px; }`}</style>
  ) : null;
}
