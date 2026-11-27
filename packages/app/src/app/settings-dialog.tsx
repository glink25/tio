import { t } from '@tio/i18n';
import {
  Button,
  Modal,
  ChoiceSelect,
  LanguageSwitcher,
  OverlayPresence,
  IconButton,
  SettingsGroup,
  SettingsRow,
  SettingsAction,
  SettingsLink,
  useOverlayOpen,
} from '@tio/ui';
import { ArrowRightLeft, ChevronLeft, HardDrive, Palette, RefreshCw, Sparkles } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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

export function SettingsDialog({
  model,
  close,
}: {
  model?: WorkspaceController;
  close: () => void;
}) {
  const [pages, setPages] = useState<{ key: number; page: SettingsPage }[]>([
    { key: 0, page: { kind: 'root' } },
  ]);
  const nextKey = useRef(1);
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
  const visibleCategories = model?.session ? categories : categories.slice(0, 1);
  const push = (page: SettingsPage) => {
    const key = nextKey.current++;
    setPages((pages) => [...pages, { key, page }]);
  };
  const pop = () => setPages((pages) => pages.slice(0, -1));
  const canLeave = (key: number, leave: () => void) => {
    const status = guards.get(key)?.();
    if (status === 'dirty') setDiscard(() => leave);
    return !status || status === 'clean';
  };

  function renderContent(page: SettingsPage, key: number) {
    let content: ReactNode;
    switch (page.kind) {
      case 'root':
        content = (
          <nav aria-label={t('ui.settings')} className="space-y-1">
            {visibleCategories.map(({ kind, label, icon: Icon }) => (
              <SettingsLink
                key={kind}
                label={t(label)}
                icon={<Icon size={18} aria-hidden />}
                open={() => push({ kind })}
              />
            ))}
          </nav>
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
            advancedTarget={advancedTarget}
            openAdvanced={() => push({ kind: 'assistant-advanced', id: page.id })}
            registerGuard={registerFor(key)}
            saved={pop}
          />
        );
        break;
      case 'assistant-prompt':
        content = model && (
          <AssistantPromptForm model={model} registerGuard={registerFor(key)} saved={pop} />
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

  // Each depth retains its closing surface for the exit animation.
  const renderLayer = (depth: number): ReactNode => {
    const frame = pages[depth];
    const leave = depth === 0 ? close : () => setPages((pages) => pages.slice(0, depth));
    return (
      <>
        <OverlayPresence>
          {frame && (
            <SettingsLayer
              key={frame.key}
              title={pageTitle(frame.page)}
              root={depth === 0}
              covered={depth < pages.length - 1}
              close={leave}
              canClose={() => canLeave(frame.key, leave)}
            >
              {renderContent(frame.page, frame.key)}
            </SettingsLayer>
          )}
        </OverlayPresence>
        {frame && renderLayer(depth + 1)}
      </>
    );
  };

  return (
    <>
      {renderLayer(0)}
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

function SettingsLayer({
  title,
  root,
  covered,
  close,
  canClose,
  children,
}: {
  title: string;
  root: boolean;
  covered: boolean;
  close: () => void;
  canClose: () => boolean;
  children: ReactNode;
}) {
  const open = useOverlayOpen();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (open && !covered) heading.current?.focus({ preventScroll: true });
  }, [open, covered]);
  return (
    <Modal
      layout="page"
      className="tio-settings max-md:border-0"
      stack={root ? 'root' : 'child'}
      covered={covered}
      title={title}
      titleRef={heading}
      dismissOnOutside={false}
      hideClose={!root}
      close={close}
      canClose={canClose}
      leading={
        !root && (
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
      <div className="min-w-0 space-y-5 py-4">{children}</div>
    </Modal>
  );
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
        <SettingsLink
          label={t('settings.update')}
          icon={<RefreshCw size={18} aria-hidden />}
          open={openUpdates}
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
