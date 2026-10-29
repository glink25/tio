import { t } from '@tio/i18n';
import {
  Button,
  Modal,
  SettingsGroup,
  SettingsRow,
  SettingsAction,
  ChoiceSelect,
  toast,
} from '@tio/ui';
import { useState, useSyncExternalStore } from 'react';

import {
  answerPrompt,
  currentPrompt,
  subscribePrompt,
  readGrants,
  setGrant,
  clearGrants,
  subscribeGrants,
  grantRevision,
  type Grant,
} from './permissions';
export function AgentPermissionDialog() {
  const prompt = useSyncExternalStore(subscribePrompt, currentPrompt);
  return prompt ? <PermissionForm key={prompt.id} prompt={prompt} /> : null;
}
function PermissionForm({ prompt }: { prompt: NonNullable<ReturnType<typeof currentPrompt>> }) {
  const [edit, setEdit] = useState(prompt.level === 'edit');
  const [remember, setRemember] = useState(false);
  return (
    <Modal title={t('agent.permissionTitle')} close={() => answerPrompt(false, false, false)}>
      <p className="text-sm">
        {t(prompt.level === 'edit' ? 'agent.requestEdit' : 'agent.requestRead', {
          workspace: prompt.scope.workspace,
        })}
      </p>
      <p className="mt-2 text-sm text-muted">{prompt.scope.connection}</p>
      <div className="my-5 space-y-3 text-sm">
        {prompt.level === 'read' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} />
            {t('agent.alsoEdit')}
          </label>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('agent.remember')}
        </label>
        {edit && <p className="text-muted">{t('agent.editDescription')}</p>}
        <p className="text-muted">{t('agent.localDescription')}</p>
        {prompt.error && <p role="alert">{t('agent.storageError')}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => answerPrompt(false, false, false)}>{t('agent.deny')}</Button>
        <Button variant="primary" onClick={() => answerPrompt(true, edit, remember)}>
          {t('agent.allow')}
        </Button>
      </div>
    </Modal>
  );
}
function AgentConnectionSettings() {
  const [copying, setCopying] = useState(false);
  async function copyPrompt() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(
        t('agent.connectionPrompt', { url: window.location.href }),
      );
      toast(t('agent.promptCopied'));
    } catch {
      toast.error(t('agent.promptCopyFailed'));
    } finally {
      setCopying(false);
    }
  }
  return (
    <SettingsGroup title={t('agent.connection')}>
      <SettingsRow title={t('agent.connectTitle')} description={t('agent.connectDescription')}>
        <SettingsAction disabled={copying} onClick={() => void copyPrompt()}>
          {t('agent.connectButton')}
        </SettingsAction>
      </SettingsRow>
    </SettingsGroup>
  );
}
export function AgentPermissionSettings() {
  useSyncExternalStore(subscribeGrants, grantRevision);
  const [error, setError] = useState(false);
  const grants = readGrants();
  const act = (action: () => void) => {
    try {
      action();
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <>
      <AgentConnectionSettings />
      <SettingsGroup title={t('agent.settings')}>
        <p className="py-3 text-sm text-muted">{t('agent.localDescription')}</p>
        {!grants.length && <p className="pb-3 text-sm text-muted">{t('agent.noGrants')}</p>}
        {grants.map((grant) => (
          <SettingsRow key={grant.key} title={grant.workspace} description={grant.connection}>
            <ChoiceSelect
              label={t('agent.settings')}
              value={grant.grant}
              search={false}
              options={['read', 'edit', 'revoke'].map((id) => ({
                id,
                text: t(`agent.${id}` as 'agent.read'),
                label: t(`agent.${id}` as 'agent.read'),
              }))}
              onValueChange={(value) =>
                act(() => setGrant(grant, value === 'revoke' ? undefined : (value as Grant)))
              }
            />
          </SettingsRow>
        ))}
        {!!grants.length && (
          <SettingsAction danger onClick={() => act(clearGrants)}>
            {t('agent.clearAll')}
          </SettingsAction>
        )}
        {error && (
          <p role="alert" className="py-2 text-sm">
            {t('agent.storageError')}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}
