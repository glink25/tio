import { useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Modal, PortalContext } from './index';
import { useModalHost } from './modal-provider';
import { OverlayPresence } from './motion';
import { inSwipeEdge, isTopPanel, usePanelSwipe } from './panel-swipe';

export function SidebarDrawer({
  title,
  open,
  enabled,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  enabled: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const host = useModalHost();
  const native = host === 'ios' || host === 'android';
  const portal = useContext(PortalContext);
  const [layer, attach] = useState<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState(false);
  const [openedByGesture, setOpenedByGesture] = useState(false);
  useLayoutEffect(() => {
    if (!open) {
      setOpenedByGesture(false);
      if (layer?.dataset.swipe === 'finished') {
        layer.removeAttribute('data-swipe');
        layer.style.removeProperty('--tio-swipe-offset');
        layer.style.removeProperty('--tio-swipe-opacity');
        setPreview(false);
      }
    }
  }, [layer, open]);
  usePanelSwipe(layer, {
    enabled: native && enabled && !open,
    opening: true,
    direction: 1,
    canStart: (x) => native && inSwipeEdge(host, x),
    isActive: () => enabled && !open && isTopPanel(),
    onPreview: setPreview,
    commit: () => {
      setOpenedByGesture(true);
      onOpenChange(true);
    },
  });
  return (
    <>
      {native &&
        createPortal(
          <div
            ref={attach}
            className="tio-modal-layer tio-sidebar-preview"
            aria-hidden="true"
            inert
          >
            <div className="tio-overlay absolute inset-0 bg-black/40 backdrop-blur-xs" />
            <div
              data-tio-swipe-panel=""
              data-placement="sidebar"
              data-headerless=""
              className="tio-dialog absolute z-50 flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel text-ink shadow-xl"
            >
              {preview && (
                <div className="tio-dialog-body min-h-0 flex-1 overflow-hidden">{children}</div>
              )}
            </div>
          </div>,
          portal ?? document.body,
        )}
      <OverlayPresence>
        {open && (
          <Modal
            sheet
            hideHeader
            title={title}
            close={() => onOpenChange(false)}
            skipEnter={openedByGesture}
            onPanelReady={() => {
              if (layer?.dataset.swipe !== 'finished') return;
              layer.removeAttribute('data-swipe');
              layer.style.removeProperty('--tio-swipe-offset');
              layer.style.removeProperty('--tio-swipe-opacity');
              setPreview(false);
            }}
          >
            {children}
          </Modal>
        )}
      </OverlayPresence>
    </>
  );
}
