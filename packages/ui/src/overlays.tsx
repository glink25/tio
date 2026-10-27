import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Command as CommandPrimitive } from 'cmdk';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Toaster, toast as sonnerToast, type ExternalToast } from 'sonner';

import { PortalContext, Modal, cn } from './index';
import { ThemeContext } from './theme';

export const NotificationContext = createContext('host');
export const toast = Object.assign(
  (message: ReactNode, options?: ExternalToast) =>
    sonnerToast(message, { ...options, toasterId: 'host' }),
  {
    error: (message: ReactNode, options?: ExternalToast) =>
      sonnerToast.error(message, { ...options, toasterId: 'host' }),
  },
);
export function useNotify() {
  const toasterId = useContext(NotificationContext);
  return (message: ReactNode, options?: ExternalToast) =>
    sonnerToast(message, { ...options, toasterId });
}
export function Notifications() {
  const id = useContext(NotificationContext);
  const theme = useContext(ThemeContext) ?? undefined;
  return (
    <Toaster
      id={id}
      theme={theme}
      className="tio-notifications"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ className: 'font-sans' }}
    />
  );
}
export function useMobile() {
  const [mobile, setMobile] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}
export function Menu({
  trigger,
  children,
  label,
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  const container = useContext(PortalContext);
  return (
    <MenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal container={container}>
        <MenuPrimitive.Content
          aria-label={label}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="tio-menu z-[80] max-w-[calc(100vw-24px)] min-w-52 rounded-lg border border-line bg-panel p-1.5 text-sm text-ink shadow-xl"
        >
          {children}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
export function MenuItem({
  children,
  onSelect,
  disabled,
  danger,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-default items-center gap-2 rounded px-2.5 py-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-hover',
        danger && 'text-red-600 dark:text-red-400',
      )}
    >
      {children}
    </MenuPrimitive.Item>
  );
}
export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-line" />;
}
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  className,
  label,
  modal = false,
  restoreFocus,
  mobilePlacement,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  label?: string;
  modal?: boolean;
  restoreFocus?: () => void;
  mobilePlacement?: 'sheet' | 'center';
}) {
  const container = useContext(PortalContext);
  const mobile = useMobile();
  const [localOpen, setLocalOpen] = useState(false);
  const active = open ?? localOpen;
  const change = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  if (mobile)
    return (
      <>
        {cloneElement(trigger as ReactElement<{ onClick: () => void }>, {
          onClick: () => change(!active),
        })}
        {active && (
          <Modal mobilePlacement={mobilePlacement} title={label ?? ''} close={() => change(false)}>
            {children}
          </Modal>
        )}
      </>
    );
  return (
    <PopoverPrimitive.Root modal={modal} open={active} onOpenChange={change}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          onCloseAutoFocus={
            restoreFocus
              ? (event) => {
                  event.preventDefault();
                  restoreFocus();
                }
              : undefined
          }
          aria-label={label}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'tio-popover z-[80] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-line bg-panel p-3 text-sm text-ink shadow-xl outline-none',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
export function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  const container = useContext(PortalContext);
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container}>
          <TooltipPrimitive.Content
            sideOffset={5}
            className="z-[100] rounded bg-ink px-2 py-1 text-xs text-panel"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
export const Command = CommandPrimitive;
export const CommandInput = CommandPrimitive.Input;
export const CommandList = CommandPrimitive.List;
export const CommandItem = CommandPrimitive.Item;
export const CommandEmpty = CommandPrimitive.Empty;
export const CommandGroup = CommandPrimitive.Group;
