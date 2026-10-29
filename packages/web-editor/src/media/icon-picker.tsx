import {
  builtinIconColors,
  type BuiltinIconColor,
  type BuiltinIconName,
  type DocumentIcon,
} from '@tio/core';
import { useT, useTranslation } from '@tio/i18n';
import { BuiltinIcon, Popover } from '@tio/ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { iconCategories } from './icon-catalog';
import { readRecentIcons, rememberIcon } from './recent-icons';

type Category = (typeof iconCategories)[number]['id'] | 'recent';

export default function IconPicker({
  value,
  onSelect,
}: {
  value?: DocumentIcon;
  onSelect: (icon: DocumentIcon) => void;
}) {
  const t = useT();
  const { i18n } = useTranslation();
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const [recent] = useState(readRecentIcons);
  const categories: { id: Category; icons: readonly BuiltinIconName[] }[] = recent.length
    ? [{ id: 'recent', icons: recent }, ...iconCategories]
    : [...iconCategories];
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<BuiltinIconColor>(
    typeof value === 'object' && value.type === 'builtin' ? (value.color ?? 'default') : 'default',
  );
  const [colorsOpen, setColorsOpen] = useState(false);
  const [active, setActive] = useState<Category>(categories[0].id);
  const scroll = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<Category, HTMLElement>());
  const tabs = useRef(new Map<Category, HTMLButtonElement>());
  const colorTrigger = useRef<HTMLButtonElement>(null);
  const term = query.trim().toLocaleLowerCase();
  const groups = categories
    .filter((category) => !term || category.id !== 'recent')
    .map((category) => ({
      ...category,
      icons: category.icons.filter((name) =>
        [name, ...['en', 'zh'].map((language) => i18n.getFixedT(language)(`media.icon.${name}`))]
          .join(' ')
          .toLocaleLowerCase()
          .includes(term),
      ),
    }))
    .filter((category) => category.icons.length > 0);
  const goTo = (category: Category) => {
    setQuery('');
    setActive(category);
    requestAnimationFrame(() => {
      const container = scroll.current;
      const section = sections.current.get(category);
      if (container && section) {
        container.scrollTop +=
          section.getBoundingClientRect().top - container.getBoundingClientRect().top;
      }
    });
  };
  return (
    <div className="flex h-[min(460px,65dvh)] flex-col" data-history="native">
      <div
        role="tablist"
        aria-label={t('media.iconCategories')}
        className="flex shrink-0 border-b border-line px-2"
      >
        {categories.map((category, index) => (
          <button
            key={category.id}
            ref={(element) => {
              if (element) tabs.current.set(category.id, element);
              else tabs.current.delete(category.id);
            }}
            type="button"
            role="tab"
            id={`${id}-${category.id}`}
            aria-controls={`${id}-icons`}
            aria-selected={!term && active === category.id}
            aria-label={t(`media.iconCategory.${category.id}`)}
            title={t(`media.iconCategory.${category.id}`)}
            tabIndex={active === category.id ? 0 : -1}
            className={`flex h-11 min-w-0 flex-1 items-center justify-center border-b-2 text-muted hover:bg-surface-hover focus-visible:outline-2 ${!term && active === category.id ? 'border-ink text-ink' : 'border-transparent'}`}
            onClick={() => goTo(category.id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? categories.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) %
                      categories.length;
              const category = categories[next].id;
              goTo(category);
              tabs.current.get(category)?.focus();
            }}
          >
            <BuiltinIcon
              name={category.id === 'recent' ? 'clock' : category.icons[0]}
              size={20}
              aria-hidden
            />
          </button>
        ))}
      </div>
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
            />
            <input
              ref={search}
              type="search"
              aria-label={t('media.searchIcons')}
              placeholder={t('media.searchIcons')}
              value={query}
              className="h-9 w-full rounded-md border border-line bg-surface pr-2 pl-8 text-sm text-ink outline-none focus-visible:ring-1 focus-visible:ring-ink"
              onChange={(event) => {
                setQuery(event.target.value);
                if (scroll.current) scroll.current.scrollTop = 0;
              }}
            />
          </div>
          <Popover
            label={t('media.iconColor')}
            open={colorsOpen}
            onOpenChange={setColorsOpen}
            mobilePlacement="anchor"
            align="end"
            className="w-auto p-2"
            trigger={
              <button
                ref={colorTrigger}
                type="button"
                aria-label={`${t('media.iconColor')}: ${t(`media.iconColor.${color}`)}`}
                title={t('media.iconColor')}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-surface-hover focus-visible:outline-2"
              >
                <BuiltinIcon name="circle" color={color} size={22} aria-hidden />
              </button>
            }
          >
            <fieldset aria-label={t('media.iconColor')} className="grid grid-cols-5 gap-1">
              {builtinIconColors.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={t(`media.iconColor.${value}`)}
                  title={t(`media.iconColor.${value}`)}
                  aria-pressed={color === value}
                  className={`flex size-8 items-center justify-center rounded text-secondary hover:bg-surface-hover focus-visible:outline-2 ${color === value ? 'ring-1 ring-ink' : ''}`}
                  onClick={() => {
                    setColor(value);
                    setColorsOpen(false);
                    colorTrigger.current?.focus();
                  }}
                >
                  <BuiltinIcon name="circle" color={value} size={18} aria-hidden />
                </button>
              ))}
            </fieldset>
          </Popover>
        </div>
      </div>
      <div
        ref={scroll}
        id={`${id}-icons`}
        role="tabpanel"
        aria-labelledby={`${id}-${active}`}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onScroll={() => {
          const container = scroll.current;
          if (!container || term) return;
          const top = container.getBoundingClientRect().top;
          let current = categories[0].id;
          for (const category of categories) {
            if (
              (sections.current.get(category.id)?.getBoundingClientRect().top ?? Infinity) <=
              top + 12
            )
              current = category.id;
          }
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1)
            current = categories.at(-1)!.id;
          setActive(current);
        }}
      >
        {groups.length === 0 && (
          <output className="block py-8 text-center text-sm text-muted">
            {t('media.noIcons')}
          </output>
        )}
        {groups.map((category) => (
          <section
            key={category.id}
            ref={(element) => {
              if (element) sections.current.set(category.id, element);
              else sections.current.delete(category.id);
            }}
            aria-label={t(`media.iconCategory.${category.id}`)}
            className="mb-3 last:mb-0"
          >
            <h3 className="mb-1 text-xs font-medium text-muted">
              {t(`media.iconCategory.${category.id}`)}
            </h3>
            <div className="grid grid-cols-9 gap-1">
              {category.icons.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-label={t(`media.icon.${name}`)}
                  title={t(`media.icon.${name}`)}
                  className="flex h-9 min-w-0 items-center justify-center rounded-md text-secondary hover:bg-surface-hover focus-visible:outline-2"
                  onClick={() => {
                    rememberIcon(name);
                    onSelect({ type: 'builtin', name, ...(color === 'default' ? {} : { color }) });
                  }}
                >
                  <BuiltinIcon name={name} color={color} size={24} aria-hidden />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
