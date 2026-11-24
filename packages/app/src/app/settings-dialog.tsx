import { t } from '@tio/i18n';
import {
  Button,
  Modal,
  cn,
  ChoiceSelect,
  LanguageSwitcher,
  OverlayPresence,
  IconButton,
  SettingsGroup,
  SettingsRow,
  SettingsAction,
  SettingsLink,
  useMobile,
  useOverlayBack,
} from '@tio/ui';
import {
  ArrowRightLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Palette,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { HostUpdateSettings } from '../components/host-update-settings';
import { ConnectionInfo } from '../components/identity';
import {
  AssistantConfigForm,
  AssistantConfigList,
  AssistantPromptForm,
  type AssistantSettingsPage,
  type SettingsExitGuard,
} from '../features/assistant/settings';
import { AgentPermissionSettings } from '../features/site-tools/permission-ui';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { platform } from '../platform';
import { usePresentation, setPresentation } from '../services/browser-presentation';

const categories = [
  { kind: 'general', label: 'ui.general', icon: Palette },
  { kind: 'ai', label: 'agent.aiSettings', icon: Sparkles },
  { kind: 'storage', label: 'ui.storage', icon: HardDrive },
  { kind: 'transfer', label: 'ui.transfer', icon: ArrowRightLeft },
] as const;

type Category = (typeof categories)[number]['kind'];
type SettingsPage = { kind: Category | 'root' | 'update' | 'permissions' } | AssistantSettingsPage;

function SettingsNavigationRow({
  label,
  icon: Icon,
  current,
  chevron = true,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  current?: boolean;
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={cn(
        'w-full min-w-0 justify-start gap-3 rounded-none px-1 py-3 text-left font-medium text-ink hover:bg-transparent hover:underline focus-visible:-outline-offset-2',
        current && 'font-semibold',
      )}
      onClick={onClick}
    >
      <Icon aria-hidden size={18} className="shrink-0 text-secondary" />
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {chevron && <ChevronRight aria-hidden size={16} className="shrink-0 text-muted" />}
      {current && <Check aria-hidden size={16} className="shrink-0" />}
    </Button>
  );
}

export function SettingsDialog({
  model,
  close,
}: {
  model?: WorkspaceController;
  close: () => void;
}) {
  const [pages, setPages] = useState<SettingsPage[]>([{ kind: 'root' }]);
  const [discard, setDiscard] = useState<(() => void) | undefined>();
  const [advancedTarget, setAdvancedTarget] = useState<HTMLDivElement | null>(null);
  const [guards] = useState(() => new Map<number, NonNullable<SettingsExitGuard>>());
  const [registerGuards] = useState(() => new Map<number, (guard: SettingsExitGuard) => void>());
  function registerFor(index: number) {
    let register = registerGuards.get(index);
    if (!register) {
      register = (guard) => {
        if (guard) guards.set(index, guard);
        else guards.delete(index);
      };
      registerGuards.set(index, register);
    }
    return register;
  }
  const mobile = useMobile();
  const top = pages.length - 1;
  const active = !mobile && pages[top].kind === 'assistant-advanced' ? top - 1 : top;
  const visibleCategories = model?.session ? categories : categories.slice(0, 1);
  const activeCategory =
    visibleCategories.find(({ kind }) => kind === pages[1]?.kind)?.kind ?? 'general';
  const push = (page: SettingsPage) => setPages((pages) => [...pages, page]);
  const back = () => setPages((pages) => (pages.length > 1 ? pages.slice(0, -1) : pages));
  const assistantSaved = () => {
    if (mobile) back();
    else setPages(([root]) => [root, { kind: 'ai' }]);
  };
  const request = (apply: () => void) => {
    const status = guards.get(active)?.();
    if (status === 'dirty') setDiscard(() => apply);
    return !status || status === 'clean';
  };
  const openCategory = (kind: Category) => {
    if (mobile) {
      push({ kind });
      return;
    }
    const page = pages[active];
    if (page.kind === kind || (page.kind === 'root' && kind === 'general')) return;
    const apply = () => setPages(([root]) => (kind === 'general' ? [root] : [root, { kind }]));
    if (request(apply)) apply();
  };

  const renderPages = (index: number): ReactNode => {
    const page = pages[index];
    const activePage = index === active;
    const root = index === 0;
    const subpage = mobile && !root;
    const leave = subpage ? back : close;
    const canLeave = () => (subpage && page?.kind === 'assistant-advanced') || request(leave);
    return (
      <>
        <OverlayPresence>
          {page && (
            <SettingsSurface
              key={page.kind === 'root' ? 'root' : index}
              title={pageTitle(page)}
              mobile={mobile}
              covered={!activePage}
              close={leave}
              canClose={canLeave}
              subpage={subpage}
              skipEnter={!mobile && !root}
              navigation={
                (!mobile || root) && (
                  <nav
                    aria-label={t('ui.settings')}
                    className="min-w-0 divide-y divide-line md:overflow-y-auto md:border-r md:border-line md:pr-3"
                  >
                    {visibleCategories.map(({ kind, label, icon }) => (
                      <SettingsNavigationRow
                        key={kind}
                        label={t(label)}
                        icon={icon}
                        current={!mobile && activeCategory === kind}
                        chevron={mobile}
                        onClick={() => openCategory(kind)}
                      />
                    ))}
                  </nav>
                )
              }
            >
              {renderContent(page, index)}
            </SettingsSurface>
          )}
        </OverlayPresence>
        {page && renderPages(index + 1)}
      </>
    );
  };
  function renderContent(page: SettingsPage, index: number) {
    let content: ReactNode;
    switch (page.kind) {
      case 'root':
        content = !mobile && (
          <GeneralSettings
            openUpdates={() =>
              setPages(([root]) => [root, { kind: 'general' }, { kind: 'update' }])
            }
          />
        );
        break;
      case 'general':
        content = <GeneralSettings openUpdates={() => push({ kind: 'update' })} />;
        break;
      case 'update':
        content = (
          <HostUpdateSettings
            beforeInstall={async () => {
              await model?.runtime?.flush();
            }}
          />
        );
        break;
      case 'ai':
        content = model && (
          <div className="space-y-5">
            <AssistantConfigList model={model} push={push} />
            {'modelContext' in document && (
              <SettingsLink
                label={t('agent.settings')}
                open={() => push({ kind: 'permissions' })}
              />
            )}
          </div>
        );
        break;
      case 'permissions':
        content = <AgentPermissionSettings />;
        break;
      case 'assistant-advanced':
        content = <div ref={setAdvancedTarget} />;
        break;
      case 'assistant-config':
        content = model && (
          <AssistantConfigForm
            key={page.id ?? 'new'}
            model={model}
            configId={page.id}
            advanced={pages[index + 1]?.kind === 'assistant-advanced'}
            advancedTarget={mobile ? advancedTarget : null}
            openAdvanced={
              mobile ? () => push({ kind: 'assistant-advanced', id: page.id }) : undefined
            }
            registerGuard={registerFor(index)}
            saved={assistantSaved}
          />
        );
        break;
      case 'assistant-prompt':
        content = model && (
          <AssistantPromptForm
            model={model}
            registerGuard={registerFor(index)}
            saved={assistantSaved}
          />
        );
        break;
      case 'storage':
        content = model && <StorageSettings model={model} />;
        break;
      case 'transfer':
        content = model && <TransferSettings model={model} />;
        break;
    }
    return content;
  }

  return (
    <>
      <SettingsHistory back={close} canClose={() => request(close)} />
      {renderPages(0)}
      {mobile &&
        pages
          .slice(1)
          .map((frame, index) => (
            <SettingsHistory
              key={index}
              back={() => setPages((pages) => pages.slice(0, index + 1))}
              canClose={() =>
                frame.kind === 'assistant-advanced' ||
                request(() => setPages((pages) => pages.slice(0, index + 1)))
              }
            />
          ))}
      <OverlayPresence>
        {discard && (
          <Modal
            title={t('settings.unsaved')}
            mobilePlacement="center"
            dismissOnOutside={false}
            close={() => setDiscard(undefined)}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setDiscard(undefined)}>{t('settings.keepEditing')}</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDiscard(undefined);
                  discard();
                }}
              >
                {t('settings.discard')}
              </Button>
            </div>
          </Modal>
        )}
      </OverlayPresence>
    </>
  );
}

function SettingsSurface({
  title,
  mobile,
  covered,
  close,
  canClose,
  subpage,
  skipEnter,
  navigation,
  children,
}: {
  title: string;
  mobile: boolean;
  covered: boolean;
  close: () => void;
  canClose: () => boolean;
  subpage: boolean;
  skipEnter: boolean;
  navigation: ReactNode;
  children: ReactNode;
}) {
  const heading = useCallback(
    (element: HTMLHeadingElement | null) => {
      if (!covered) element?.focus({ preventScroll: true });
    },
    [covered],
  );
  return (
    <Modal
      layout="page"
      className="max-md:border-0"
      covered={covered}
      hidden={covered && !mobile}
      skipEnter={skipEnter}
      trackHistory={false}
      title={title}
      titleRef={heading}
      dismissOnOutside={false}
      hideClose={subpage}
      close={close}
      canClose={canClose}
      leading={
        subpage && (
          <IconButton
            label={t('ui.back')}
            onClick={() => {
              if (canClose()) close();
            }}
          >
            <ChevronLeft size={20} />
          </IconButton>
        )
      }
    >
      <div
        className={cn(
          'pt-4',
          !mobile && 'grid h-full min-h-0 grid-cols-[190px_minmax(0,1fr)] gap-5 pt-5',
        )}
      >
        {navigation}
        {(!mobile || subpage) && (
          <section className={cn('min-w-0 px-1 pb-1', !mobile && 'min-h-0 overflow-y-auto')}>
            {children}
          </section>
        )}
      </div>
    </Modal>
  );
}

function SettingsHistory({ back, canClose }: { back: () => void; canClose: () => boolean }) {
  useOverlayBack(back, true, canClose);
  return null;
}

function pageTitle(page: SettingsPage) {
  switch (page.kind) {
    case 'root':
      return t('ui.settings');
    case 'general':
      return t('ui.general');
    case 'update':
      return t('settings.update');
    case 'ai':
      return t('agent.aiSettings');
    case 'permissions':
      return t('agent.settings');
    case 'storage':
      return t('ui.storage');
    case 'transfer':
      return t('ui.transfer');
    case 'assistant-config':
      return t(page.id ? 'assistant.editConfig' : 'assistant.add');
    case 'assistant-advanced':
      return t('assistant.advanced');
    case 'assistant-prompt':
      return t('assistant.extraPrompt');
  }
}

function GeneralSettings({ openUpdates }: { openUpdates: () => void }) {
  const presentation = usePresentation();
  return (
    <div className="space-y-5">
      <SettingsGroup title={t('settings.preferences')}>
        <SettingsRow title={t('ui.appearance')} description={t('settings.appearanceDescription')}>
          <ChoiceSelect
            label={t('ui.appearance')}
            value={presentation.themePreference}
            className="w-36"
            search={false}
            options={(['light', 'dark', 'system'] as const).map((id) => ({
              id,
              text: t(`theme.${id}`),
              label: t(`theme.${id}`),
            }))}
            onValueChange={(value) =>
              setPresentation({ themePreference: value as 'light' | 'dark' | 'system' })
            }
          />
        </SettingsRow>
        <SettingsRow title={t('common.language')} description={t('settings.languageDescription')}>
          <LanguageSwitcher
            value={presentation.locale}
            onChange={(locale) => setPresentation({ locale })}
          />
        </SettingsRow>
      </SettingsGroup>
      {platform().update && (
        <SettingsNavigationRow
          label={t('settings.update')}
          icon={RefreshCw}
          onClick={openUpdates}
        />
      )}
    </div>
  );
}

function StorageSettings({ model: m }: { model: WorkspaceController }) {
  const actions = m.session ? m.workspaceActions(m.session) : {};
  return (
    <div className="space-y-5">
      <SettingsGroup title={t('settings.connection')}>
        <div className="py-4">
          <ConnectionInfo identity={m.identity} />
        </div>
      </SettingsGroup>
      {m.hasReplicaSync && m.workspace && (
        <SettingsGroup title={t('settings.synchronization')}>
          <SettingsRow
            title={t('settings.manualSync')}
            description={t('settings.manualSyncDescription')}
          >
            <input
              type="checkbox"
              role="switch"
              aria-checked={m.manualSync}
              aria-label={t('settings.manualSync')}
              className="h-4 w-4 accent-ink"
              checked={m.manualSync}
              disabled={!m.canSetManualSync}
              onChange={(event) => m.patch(m.workspace!, { manualSync: event.target.checked })}
            />
          </SettingsRow>
        </SettingsGroup>
      )}
      <SettingsGroup title={t('workspace.manage')}>
        {actions.share && (
          <SettingsRow title={t('workspace.share')}>
            <SettingsAction onClick={() => m.requestWorkspaceAction(m.session!, 'share')}>
              {t('workspace.share')}
            </SettingsAction>
          </SettingsRow>
        )}
        <SettingsRow title={t('workspace.disconnect')}>
          <SettingsAction onClick={() => m.setLogoutOpen(true)}>
            {t('workspace.disconnect')}
          </SettingsAction>
        </SettingsRow>
        {actions.delete && (
          <SettingsRow title={t('workspace.delete')}>
            <SettingsAction danger onClick={() => m.requestWorkspaceAction(m.session!, 'delete')}>
              {t('workspace.delete')}
            </SettingsAction>
          </SettingsRow>
        )}
      </SettingsGroup>
    </div>
  );
}

function TransferSettings({ model: m }: { model: WorkspaceController }) {
  return (
    <SettingsGroup title={t('settings.data')}>
      <SettingsRow title={t('workspace.import')} description={t('settings.importDescription')}>
        <SettingsAction onClick={() => m.importRef.current?.click()}>
          {t('workspace.import')}
        </SettingsAction>
      </SettingsRow>
      <SettingsRow title={t('workspace.exportFull')} description={t('settings.exportDescription')}>
        <SettingsAction onClick={() => void m.download()}>
          {t('workspace.exportFull')}
        </SettingsAction>
      </SettingsRow>
      <SettingsRow
        title={t('workspace.exportMarkdown')}
        description={t('settings.markdownDescription')}
      >
        <SettingsAction onClick={() => void m.download(true)}>
          {t('workspace.exportMarkdown')}
        </SettingsAction>
      </SettingsRow>
    </SettingsGroup>
  );
}
