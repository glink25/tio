import { useT } from '@tio/i18n';
import { ChevronDown } from 'lucide-react';
import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';

import { Button, cn } from './index';
import { OptionsPanel, type ChoiceOption } from './options-panel';
import { Popover } from './overlays';

const ValueContext = createContext<ReactNode>(null);
function collect(children: ReactNode): ChoiceOption[] {
  return Children.toArray(children).flatMap((child): ChoiceOption[] => {
    if (
      !isValidElement<{
        value?: string;
        textValue?: string;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === 'option') {
      const text = child.props.textValue ?? plainText(child.props.children);
      return [
        {
          id: child.props.value ?? text,
          text,
          label: child.props.children,
          disabled: child.props.disabled,
        },
      ];
    }
    return collect(child.props.children);
  });
}
function plainText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? plainText(child.props.children)
          : '',
    )
    .join('');
}
export function ChoiceSelect({
  value,
  onValueChange,
  options,
  label,
  disabled,
  className,
  search = false,
  trigger,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
  label: string;
  disabled?: boolean;
  className?: string;
  search?: boolean;
  trigger?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState<string>();
  return (
    <ValueContext.Provider
      value={
        options.find((o) => o.id === value)?.label ??
        (value ? t('automation.selectionUnavailable') : label)
      }
    >
      <Popover
        label={label}
        open={open}
        onOpenChange={setOpen}
        mobilePlacement="anchor"
        className={search ? 'w-72 p-1' : 'w-max min-w-[var(--radix-popover-trigger-width)] p-1'}
        trigger={cloneElement(
          isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(trigger) ? (
            trigger
          ) : (
            <SelectTrigger aria-label={label} className={className}>
              <SelectValue />
            </SelectTrigger>
          ),
          {
            role: 'combobox',
            'aria-expanded': open,
            'aria-controls': listId,
            'aria-haspopup': 'listbox',
            disabled:
              disabled ||
              (isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(trigger)
                ? trigger.props.disabled
                : false),
          },
        )}
      >
        <OptionsPanel
          onListId={setListId}
          label={label}
          options={options}
          selected={[value]}
          search={search}
          onClose={() => setOpen(false)}
          onSelect={(id) => {
            onValueChange(id);
            setOpen(false);
          }}
        />
      </Popover>
    </ValueContext.Provider>
  );
}
function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span className="min-w-0 truncate">{useContext(ValueContext) ?? placeholder}</span>;
}
const SelectTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SelectTrigger({ children, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className={cn('h-9 w-full justify-between text-sm', className)}
        {...props}
      >
        {children}
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </Button>
    );
  },
);
/** JSX option adapter for fixed option lists. */
export function SelectInput({
  value,
  onValueChange,
  children,
  required,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange'> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
}) {
  const t = useT();
  return (
    <ChoiceSelect
      value={String(value)}
      onValueChange={onValueChange}
      options={collect(children)}
      search={collect(children).length > 8}
      label={props['aria-label'] ?? t('database.chooseReference')}
      trigger={
        <SelectTrigger {...props} aria-required={required}>
          <SelectValue />
        </SelectTrigger>
      }
    />
  );
}
