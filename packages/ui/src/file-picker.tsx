import type { AssetPolicy } from '@tio/core';
import { useT } from '@tio/i18n';
import { FileUp, LoaderCircle } from 'lucide-react';
import { createContext, useContext, useId, useRef, type ReactNode } from 'react';

export const AssetPolicyContext = createContext<AssetPolicy | null>(null);
export function useAssetPolicy() {
  const policy = useContext(AssetPolicyContext);
  if (!policy) throw new Error('The host must provide an attachment policy');
  return policy;
}
export function FilePicker({
  accept,
  multiple,
  icon,
  label,
  hint,
  busy,
  error,
  disabled,
  onSelect,
}: {
  accept?: string;
  multiple?: boolean;
  icon?: ReactNode;
  label: string;
  hint: string;
  busy?: boolean;
  error?: string;
  disabled?: boolean;
  onSelect: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const t = useT();
  return (
    <div className="w-full min-w-0 space-y-2" data-history="native">
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy}
        aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
        className="flex w-full min-w-0 flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-panel px-4 py-6 text-center text-secondary transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
        onClick={() => input.current?.click()}
      >
        <span aria-hidden="true">
          {busy ? (
            <LoaderCircle size={24} className="animate-spin motion-reduce:animate-none" />
          ) : (
            (icon ?? <FileUp size={24} />)
          )}
        </span>
        <span className="text-sm font-medium">{busy ? t('upload.processing') : label}</span>
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        className="hidden"
        tabIndex={-1}
        accept={accept}
        multiple={multiple}
        disabled={disabled || busy}
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) onSelect(files);
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-secondary">
          {error}
        </p>
      )}
    </div>
  );
}
