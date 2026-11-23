import {
  id,
  HostError,
  type AssistantSettings,
  type AssistantApiConfig,
  type TioObject,
} from '@tio/core';
import { t } from '@tio/i18n';
import { Button, SettingsGroup, SettingsRow } from '@tio/ui';
import { useEffect, useRef, useState } from 'react';

import type { WorkspaceController } from '../workspace/use-workspace';
import { assistantProvider, encodeKey, decodeKey } from './config';

export function AssistantSettingsPanel({ model: m }: { model: WorkspaceController }) {
  const [draft, setDraft] = useState<AssistantSettings>({ configs: [] });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const baseline = useRef<TioObject | undefined>(undefined);
  const request = useRef<{ abort(): void } | undefined>(undefined);
  const current = useRef(m);
  current.current = m;
  useEffect(() => {
    let active = true;
    void m.runtime
      ?.ensure([m.session!.workspaceId])
      .then(() => {
        if (!active || dirty) return;
        const workspace = m.runtime!.snapshot().find((o) => o.id === m.session!.workspaceId);
        if (!workspace) return;
        baseline.current = workspace;
        const settings = workspace.assistant ?? { configs: [] };
        setDraft(structuredClone(settings));
        setParameters(
          Object.fromEntries(
            settings.configs.map((c) => [c.id, JSON.stringify(c.customParams ?? {}, null, 2)]),
          ),
        );
      })
      .catch(() => {
        if (active) setMessage(t('assistant.failed'));
      });
    return () => {
      active = false;
    };
  }, [m.runtime, m.session?.workspaceId, m.workspace?.assistant, dirty]);
  useEffect(() => () => request.current?.abort(), []);
  const change = (next: AssistantSettings) => {
    setDraft(next);
    setDirty(true);
    setMessage('');
    request.current?.abort();
  };
  const patch = (config: AssistantApiConfig, values: Partial<AssistantApiConfig>) =>
    change({
      ...draft,
      configs: draft.configs.map((c) => (c.id === config.id ? { ...c, ...values } : c)),
    });
  const parseConfigs = () =>
    draft.configs.map((c) => ({
      ...c,
      customParams: JSON.parse(parameters[c.id] || '{}') as Record<string, unknown>,
    }));
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const runtime = m.runtime!;
      const configs = parseConfigs();
      const assistant = { ...draft, configs };
      const before = baseline.current!;
      const guard = () => {
        if (current.current.runtime !== runtime || current.current.openingWorkspace)
          throw new HostError('closed');
      };
      await runtime.checked([before], [{ ...before, assistant }], guard);
      guard();
      setDirty(false);
      setMessage(t('assistant.saved'));
    } catch {
      setMessage(t('assistant.saveFailed'));
    } finally {
      setBusy(false);
    }
  }
  async function verify(config: AssistantApiConfig) {
    setBusy(true);
    setMessage('');
    try {
      const parsed = parseConfigs().find((c) => c.id === config.id)!;
      const pending = assistantProvider(() => parsed).request({
        history: [{ role: 'user', raw: 'Reply OK.' }],
        tools: [],
        maxTokens: 16,
      });
      request.current = pending;
      const chunks = await pending;
      for await (const _chunk of chunks) {
        /* Consume through completion to verify streaming protocol. */
      }
      setMessage(t('assistant.connected'));
    } catch {
      setMessage(t('assistant.failed'));
    } finally {
      request.current = undefined;
      setBusy(false);
    }
  }
  const disabled = busy || !m.runtime?.state.getState().writable || !baseline.current;
  return (
    <SettingsGroup title={t('assistant.configuration')}>
      <p className="py-2 text-sm text-muted">{t('assistant.sharedConfig')}</p>
      {draft.configs.map((config) => (
        <fieldset
          key={config.id}
          disabled={disabled}
          className="my-3 min-w-0 space-y-3 rounded-md border border-line p-3"
        >
          {(['name', 'apiUrl', 'model'] as const).map((key) => (
            <label key={key} className="block text-sm">
              {t(`assistant.${key}`)}
              <input
                className="mt-1 w-full"
                value={config[key]}
                onChange={(e) => patch(config, { [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            {t('assistant.protocol')}
            <select
              className="mt-1 w-full"
              value={config.apiType}
              onChange={(e) =>
                patch(config, { apiType: e.target.value as AssistantApiConfig['apiType'] })
              }
            >
              <option value="open-ai-compatible">OpenAI compatible</option>
              <option value="google-ai-studio">Google AI Studio</option>
            </select>
          </label>
          <label className="block text-sm">
            API Key
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full"
              value={decodeKey(config.apiKey)}
              onChange={(e) => patch(config, { apiKey: encodeKey(e.target.value) })}
            />
          </label>
          {(['contextWindow', 'maxTokens'] as const).map((key) => (
            <label key={key} className="block text-sm">
              {t(`assistant.${key}`)}
              <input
                type="number"
                min="1"
                step="1"
                className="mt-1 w-full"
                value={config[key] ?? ''}
                onChange={(e) =>
                  patch(config, { [key]: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!config.imageInput}
              onChange={(e) => patch(config, { imageInput: e.target.checked })}
            />
            {t('assistant.imageInput')}
          </label>
          <label className="block text-sm">
            {t('assistant.customParams')}
            <textarea
              className="mt-1 min-h-20 w-full rounded border border-line bg-panel p-2 font-mono"
              value={parameters[config.id] ?? '{}'}
              onChange={(e) => {
                setParameters({ ...parameters, [config.id]: e.target.value });
                setDirty(true);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void verify(config)}>
              {t('assistant.verify')}
            </Button>
            <Button
              variant="outline"
              onClick={() => change({ ...draft, defaultConfigId: config.id })}
              disabled={draft.defaultConfigId === config.id}
            >
              {t('assistant.default')}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                change({
                  ...draft,
                  configs: draft.configs.filter((c) => c.id !== config.id),
                  defaultConfigId:
                    draft.defaultConfigId === config.id
                      ? draft.configs.find((c) => c.id !== config.id)?.id
                      : draft.defaultConfigId,
                })
              }
            >
              {t('ui.delete')}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          const config: AssistantApiConfig = {
            id: id('ai'),
            name: '',
            apiType: 'open-ai-compatible',
            apiUrl: 'https://api.openai.com/v1',
            model: '',
            apiKey: '',
          };
          change({
            ...draft,
            configs: [...draft.configs, config],
            defaultConfigId: draft.defaultConfigId ?? config.id,
          });
        }}
      >
        {t('assistant.add')}
      </Button>
      <SettingsRow title={t('assistant.extraPrompt')}>
        <textarea
          disabled={disabled}
          className="min-h-20 w-full rounded border border-line bg-panel p-2"
          value={draft.extraPrompt ?? ''}
          onChange={(e) => change({ ...draft, extraPrompt: e.target.value })}
        />
      </SettingsRow>
      <div className="flex items-center gap-3 py-2">
        <Button disabled={disabled || !dirty} onClick={() => void save()}>
          {t('assistant.save')}
        </Button>
        <output className="text-sm">{message}</output>
      </div>
    </SettingsGroup>
  );
}
