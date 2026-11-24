export { FilePicker, AssetPolicyContext, useAssetPolicy } from './file-picker';
import type { DocumentIcon } from '@tio/core';

import { BuiltinIcon, useMediaUrl, type MediaResolver } from './media';
export { BuiltinIcon, coverPresets, useMediaUrl, type MediaResolver } from './media';
export { EditHistoryContext, useDraftHistory, type EditHistory } from './edit-history';
import * as Dialog from '@radix-ui/react-dialog';
import { isLanguage, languageLabel, languages, type Language, useT } from '@tio/i18n';
import { clsx, type ClassValue } from 'clsx';
import { X, FileText, Database } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
export { MentionContext, MentionLabel, MentionPicker } from './mentions';
export const PortalContext = createContext<HTMLElement | undefined>(undefined);
import { twMerge } from 'tailwind-merge';

import { useOverlayOpen } from './motion';
export { OverlayPresence, useOverlayOpen, useReducedMotion, motion } from './motion';

import { useMobileDialogPosition } from './mobile-dialog';
import { useModalHost, useOverlayBack } from './modal-provider';
export { ModalProvider, navigateFromOverlay, useOverlayBack } from './modal-provider';
export { isOverlayHistoryTraversal } from './overlay-history';
import { useOverlayInteraction } from './overlay-interaction';
import { useMobile } from './overlays';
import { inSwipeEdge, isTopPanel, useNativePanelMotion, usePanelSwipe } from './panel-swipe';
export { SidebarDrawer } from './sidebar-drawer';
import { ChoiceSelect } from './select';
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'ghost' | 'primary' | 'outline' }
>(function Button({ className, variant = 'ghost', ...props }, ref) {
  return (
    <button
      ref={ref}
      data-variant={variant}
      className={cn(
        'tio-button inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary'
          ? 'bg-accent text-on-accent hover:bg-accent-strong'
          : variant === 'outline'
            ? 'border border-line bg-panel hover:bg-surface'
            : 'text-secondary hover:bg-surface-hover',
        className,
      )}
      {...props}
    />
  );
});
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }
>(function IconButton({ label, children, ...props }, ref) {
  return (
    <Button ref={ref} aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
});
export function Modal({
  title,
  description,
  close,
  children,
  wide = false,
  sheet = false,
  mobilePlacement = 'sheet',
  layout = 'default',
  trackHistory = true,
  header,
  footer,
  hideHeader = false,
  restoreFocus,
  canClose,
  dismissOnOutside = true,
  hideClose = false,
  leading,
  titleRef,
  skipEnter = false,
  onPanelReady,
  covered = false,
  hidden = false,
  className,
}: {
  leading?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  canClose?: () => boolean;
  dismissOnOutside?: boolean;
  hideClose?: boolean;
  restoreFocus?: () => void;
  layout?: 'default' | 'page' | 'workspace';
  hideHeader?: boolean;
  trackHistory?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  sheet?: boolean;
  mobilePlacement?: 'sheet' | 'center';
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
  skipEnter?: boolean;
  onPanelReady?: () => void;
  covered?: boolean;
  hidden?: boolean;
  className?: string;
}) {
  const t = useT();
  const open = useOverlayOpen();
  const requestClose = () => {
    if (canClose && !canClose()) return false;
    close();
    return true;
  };
  useOverlayBack(close, trackHistory && open, canClose);
  const panelMotion = useModalSwipe({
    open,
    close,
    canClose,
    covered,
    skipEnter,
    onPanelReady,
    sidebar: sheet,
    page: mobilePlacement !== 'center' && (wide || layout !== 'default'),
  });
  useMobileDialogPosition(panelMotion.element, open && !covered);
  const interaction = useOverlayInteraction(
    open && !covered,
    () => dismissOnOutside && requestClose(),
    restoreFocus,
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <Dialog.Portal forceMount container={useContext(PortalContext)}>
        <div
          ref={panelMotion.layer}
          className="tio-modal-layer"
          data-state={open ? 'open' : 'closed'}
          data-managed-motion={panelMotion.managed ? '' : undefined}
          data-covered={covered ? '' : undefined}
          hidden={hidden}
          data-skip-enter={skipEnter && open ? '' : undefined}
        >
          <Dialog.Overlay className="tio-overlay fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
          <Dialog.Content
            {...interaction}
            onPointerDownOutside={dismissOnOutside ? undefined : (event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              // Floating controls are portalled; their Escape must not dismiss the containing dialog.
              const floating = [
                ...document.querySelectorAll(
                  '.tio-popover[data-state="open"], .tio-select[data-state="open"], .tio-menu[data-state="open"]',
                ),
              ];
              if (floating.some((element) => !element.closest('[aria-hidden="true"]')))
                event.preventDefault();
            }}
            inert={!open || covered || undefined}
            data-tio-swipe-panel=""
            data-motion={
              panelMotion.motion ??
              (panelMotion.nativeNarrow && mobilePlacement === 'center' ? 'center' : 'vertical')
            }
            data-placement={sheet ? 'sidebar' : layout === 'default' ? mobilePlacement : 'full'}
            data-wide={wide || undefined}
            data-layout={layout}
            data-headerless={hideHeader || undefined}
            aria-describedby={undefined}
            className={cn(
              'tio-dialog fixed z-50 flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel text-ink shadow-xl outline-none',
              className,
            )}
          >
            {hideHeader ? (
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
            ) : (
              <div
                className={cn(
                  'tio-dialog-header flex shrink-0 items-center justify-between gap-4',
                  layout === 'workspace'
                    ? 'shrink-0 items-start border-b border-line px-4 py-3 md:items-center md:px-6'
                    : 'px-4 py-3 md:px-5 md:py-4',
                  layout === 'page' && 'border-b border-line',
                )}
              >
                {header ? (
                  <>
                    <Dialog.Title className="sr-only">{title}</Dialog.Title>
                    {header}
                  </>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    {leading}
                    <Dialog.Title
                      ref={titleRef}
                      tabIndex={titleRef ? -1 : undefined}
                      className="text-lg font-semibold outline-none"
                    >
                      {title}
                    </Dialog.Title>
                  </div>
                )}
                {!hideClose && (
                  <Dialog.Close asChild>
                    <IconButton label={t('common.close')} className="p-1">
                      <X size={20} />
                    </IconButton>
                  </Dialog.Close>
                )}
              </div>
            )}
            {description && (
              <Dialog.Description className="shrink-0 px-4 pb-3 text-sm text-muted md:px-5">
                {description}
              </Dialog.Description>
            )}
            <div
              className={cn(
                'tio-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain',
                layout !== 'workspace' && !hideHeader && 'px-4 pb-4 md:px-5 md:pb-5',
              )}
            >
              {children}
            </div>
            {footer && (
              <div className="tio-dialog-footer shrink-0 border-t border-line bg-panel px-4 py-3 md:px-6">
                {footer}
              </div>
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Drawer({
  title,
  close,
  children,
  actions,
  closeLabel,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
}) {
  const t = useT();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const open = useOverlayOpen();
  const panelMotion = useModalSwipe({ open, close, page: true });
  useMobileDialogPosition(panelMotion.element, open);
  useOverlayBack(close, open);
  const { ref: attachInteraction, ...interaction } = useOverlayInteraction(open, close);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      setPortalContainer(node);
      attachInteraction(node);
    },
    [attachInteraction],
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal forceMount container={useContext(PortalContext)}>
        <div
          ref={panelMotion.layer}
          className="tio-modal-layer"
          data-drawer=""
          data-managed-motion={panelMotion.managed ? '' : undefined}
          data-state={open ? 'open' : 'closed'}
        >
          <Dialog.Overlay className="tio-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" />
          <Dialog.Content
            inert={!open || undefined}
            {...interaction}
            ref={attach}
            data-tio-swipe-panel=""
            data-motion={panelMotion.motion ?? 'vertical'}
            aria-describedby={undefined}
            className="tio-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-hidden bg-panel shadow-xl"
          >
            <header className="tio-drawer-header z-10 flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3 md:px-6">
              <Dialog.Title className="text-sm text-secondary">{title}</Dialog.Title>
              <div className="flex items-center gap-2">
                {actions}
                <Dialog.Close asChild>
                  <IconButton label={closeLabel ?? t('database.closeRecord')} className="p-1">
                    <X size={20} />
                  </IconButton>
                </Dialog.Close>
              </div>
            </header>
            <PortalContext.Provider value={portalContainer ?? undefined}>
              <div className="tio-drawer-body min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                {children}
              </div>
            </PortalContext.Provider>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function useModalSwipe({
  open,
  close,
  canClose,
  covered,
  skipEnter = false,
  onPanelReady,
  page,
  sidebar,
}: {
  open: boolean;
  close: () => void;
  canClose?: () => boolean;
  covered?: boolean;
  skipEnter?: boolean;
  onPanelReady?: () => void;
  page: boolean;
  sidebar?: boolean;
}) {
  const narrow = useMobile();
  const host = useModalHost();
  const native = host === 'ios' || host === 'android';
  const swipe = native && narrow && (page || !!sidebar);
  const side = sidebar ? 'left' : 'right';
  const [layer, attach] = useState<HTMLDivElement | null>(null);
  useNativePanelMotion(layer, swipe ? side : undefined, open, skipEnter, onPanelReady);
  usePanelSwipe(layer, {
    enabled: swipe && open && !covered,
    direction: sidebar ? -1 : 1,
    canStart: (x, target, panel) =>
      panel.contains(target) &&
      (sidebar || (native && inSwipeEdge(host, x))) &&
      !panel.getAnimations().some((animation) => animation.playState === 'running'),
    isActive: (panel) => open && !covered && isTopPanel(panel),
    canCommit: canClose,
    commit: close,
  });
  return {
    layer: attach,
    element: layer,
    managed: swipe,
    motion: sidebar || swipe ? side : undefined,
    nativeNarrow: native && narrow,
  };
}
export function LanguageSwitcher({
  value,
  onChange,
}: {
  value: Language;
  onChange: (value: Language) => void;
}) {
  const t = useT();

  return (
    <ChoiceSelect
      label={t('common.language')}
      value={value}
      className="w-36"
      search={false}
      options={languages.map((id) => ({ id, text: languageLabel(id), label: languageLabel(id) }))}
      onValueChange={(language) => {
        if (isLanguage(language)) onChange(language);
      }}
    />
  );
}
export function ObjectIcon({
  type,
  icon,
  size = 18,
  resolve,
}: {
  type: string;
  icon?: DocumentIcon;
  resolve?: MediaResolver;
  size?: number;
}) {
  const url = useMediaUrl(
    typeof icon === 'object' && icon.type === 'image' ? icon.url : undefined,
    resolve,
  );
  const [failed, setFailed] = useState('');
  const style = { width: size, height: size, flexShrink: 0 };
  if (typeof icon === 'object') {
    if (icon.type === 'builtin') {
      return (
        <BuiltinIcon name={icon.name} color={icon.color} size={size} style={style} aria-hidden />
      );
    }
    if (url && failed !== url)
      return (
        <img
          src={url}
          alt=""
          style={style}
          className="rounded-sm object-cover"
          onError={() => setFailed(url)}
        />
      );
  }
  if (typeof icon === 'string' && icon)
    return (
      <span
        className="inline-flex items-center justify-center leading-none"
        style={{ ...style, fontSize: size }}
        aria-hidden
      >
        {icon}
      </span>
    );
  const Component = type === 'database' ? Database : FileText;
  return <Component size={size} style={style} strokeWidth={1.7} aria-hidden />;
}
export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface p-4 text-sm text-muted">
      {children}
    </div>
  );
}

export { useTheme, ThemeSwitcher, ThemeContext } from './theme';
export { LoadingSkeleton, LoadingIndicator, SidebarSkeleton, readingLayout } from './skeleton';
export { EmptyStateIllustration } from './empty-state-illustration';

export {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Popover,
  Tooltip,
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  Notifications,
  NotificationContext,
  useNotify,
  toast,
  useMobile,
} from './overlays';
export { ReferencePicker, ReferenceIcon, type ReferenceOption } from './reference-picker';

export {
  OptionsPanel,
  type OptionsPanelProps,
  type ChoiceOption,
  type ChoiceTab,
} from './options-panel';
export { ChoiceSelect, SelectInput } from './select';

export { usePagedOptions } from './use-paged-options';

export { SettingsGroup, SettingsRow, SettingsAction, SettingsLink } from './settings';

export {
  InteractionBoundary,
  useInteractionExit,
  useInteractionOwner,
  interactionHasKind,
  registerInteraction,
  interactionScopeAt,
  interactionOwner,
  claimInteraction,
  withinInteraction,
} from './interaction';
