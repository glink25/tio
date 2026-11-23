/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Atomic variable chips require an editable text container. */
import { useT } from '@tio/i18n';
import { useLayoutEffect, useRef } from 'react';

import { VariablePicker, inputClass } from './controls';
import type { Variable } from './model';
function serialize(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.variable) return `{{${node.dataset.variable}}}`;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return '\n';
  return [...node.childNodes]
    .map(
      (child, index) =>
        `${index && ['DIV', 'P'].includes(child.nodeName) ? '\n' : ''}${serialize(child)}`,
    )
    .join('');
}
export function TemplateEditor({
  value,
  onChange,
  variables,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: Variable[];
}) {
  const t = useT();
  const element = useRef<HTMLDivElement>(null);
  const last = useRef<string | undefined>(undefined);
  const selection = useRef<Range | undefined>(undefined);
  const emit = () => {
    if (element.current) {
      const value = serialize(element.current);
      last.current = value;
      onChange(value);
    }
  };
  const token = (path: string) => {
    const variable = variables.find((v) => v.path === path);
    const span = document.createElement('span');
    span.dataset.variable = path;
    span.contentEditable = 'false';
    span.className = `mx-0.5 inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 align-baseline text-xs ${variable ? '' : 'text-red-600'}`;
    span.append(
      document.createTextNode(
        variable ? `${variable.group} · ${variable.label}` : t('automation.invalidReference'),
      ),
    );
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t('automation.removeVariable'));
    remove.onmousedown = (event) => event.preventDefault();
    remove.onclick = () => {
      span.remove();
      emit();
    };
    span.append(remove);
    return span;
  };
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    // Rebuild only for external changes; keep the caret stable while typing.
    if (value === last.current && root.childNodes.length) {
      for (const span of root.querySelectorAll<HTMLElement>('[data-variable]')) {
        const replacement = token(span.dataset.variable!);
        span.replaceWith(replacement);
      }
      return;
    }
    root.replaceChildren();
    let offset = 0;
    for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      root.append(
        document.createTextNode(value.slice(offset, match.index)),
        token(match[1].trim()),
      );
      offset = match.index! + match[0].length;
    }
    root.append(document.createTextNode(value.slice(offset)));
    last.current = value;
  });
  const remember = () => {
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : undefined;
    if (range && element.current?.contains(range.commonAncestorContainer))
      selection.current = range.cloneRange();
  };
  const insert = (node: Node) => {
    const root = element.current;
    if (!root) return;
    const range =
      selection.current && root.contains(selection.current.commonAncestorContainer)
        ? selection.current
        : document.createRange();
    if (!selection.current || !root.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.current = range.cloneRange();
    root.focus();
    const selected = window.getSelection();
    selected?.removeAllRanges();
    selected?.addRange(range);
    emit();
  };
  return (
    <div className="space-y-2">
      <div
        ref={element}
        role="textbox"
        tabIndex={0}
        aria-label={t('automation.bodyTemplate')}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        data-history="native"
        className={`${inputClass} min-h-28 break-words whitespace-pre-wrap`}
        onInput={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onPaste={(event) => {
          event.preventDefault();
          remember();
          insert(document.createTextNode(event.clipboardData.getData('text/plain')));
        }}
      />
      <div className="flex items-center gap-1 text-xs text-muted">
        <VariablePicker
          variables={variables}
          onSelect={(variable) => insert(token(variable.path))}
        />
        <span>{t('automation.insertVariable')}</span>
      </div>
    </div>
  );
}
