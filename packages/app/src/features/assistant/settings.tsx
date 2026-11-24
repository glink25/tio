import {
  id,
  HostError,
  validateAssistant,
  type AssistantSettings,
  type AssistantApiConfig,
  type TioObject,
} from '@tio/core';
import { t } from '@tio/i18n';
import {
  Button,
  LoadingSkeleton,
  Modal,
  OverlayPresence,
  SettingsLink,
  SettingsRow,
} from '@tio/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { WorkspaceController } from '../workspace/use-workspace';
import { assistantProvider, encodeKey, decodeKey } from './config';

export type AssistantSettingsPage =
  | { kind: 'assistant-config' | 'assistant-advanced'; id?: string }
  | { kind: 'assistant-prompt' };

export type SettingsExitGuard = (() => 'clean' | 'dirty' | 'busy') | null;

const emptySettings: AssistantSettings = { configs: [] };

function useSaveAssistant(model: WorkspaceController) {
  const current = useRef(model);
  current.current = model;
  return async (before: TioObject, assistant: AssistantSettings) => {
    const runtime = model.runtime;
    const guard = () => {
      if (!runtime || current.current.runtime !== runtime || current.current.openingWorkspace)
        throw new HostError('closed');
    };
    guard();
    await runtime!.ensure([before.id]);
    guard();
    const latest = runtime!.snapshot().find((object) => object.id === before.id);
    if (JSON.stringify(latest) !== JSON.stringify(before)) throw new HostError('conflict');
    await runtime!.checked([before], [{ ...before, assistant }], guard);
    guard();
  };
}

export function AssistantConfigList({
  model,
  push,
}: {
  model: WorkspaceController;
  push: (page: AssistantSettingsPage) => void;
}) {
  const runtime = model.runtime;
  const workspaceId = model.session?.workspaceId;
  const state = workspaceId ? runtime?.state.getState().loads[workspaceId] : undefined;
  useEffect(() => {
    if (workspaceId) void runtime?.ensure([workspaceId]).catch(() => {});
  }, [runtime, workspaceId]);
  const settings = model.workspace?.assistant ?? emptySettings;
  const [deleting, setDeleting] = useState<AssistantApiConfig>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = useSaveAssistant(model);
  const writable = !!model.workspace && !!model.runtime?.state.getState().writable;
  async function change(operation: (settings: AssistantSettings) => AssistantSettings) {
    if (!model.workspace || !writable || busy) return;
    setBusy(true);
    setError(false);
    try {
      await save(model.workspace, operation(settings));
      setDeleting(undefined);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  if (state !== 'ready')
    return state && state !== 'loading' ? (
      <p role="alert">{t('assistant.failed')}</p>
    ) : (
      <LoadingSkeleton layout="inline" />
    );
  return (
    <>
      <p className="py-2 text-sm text-muted">{t('assistant.sharedConfig')}</p>
      <div className="divide-y divide-line">
        {settings.configs.map((config) => (
          <SettingsRow
            key={config.id}
            title={config.name}
            description={
              settings.defaultConfigId === config.id
                ? `${config.model} · ${t('assistant.defaultConfig')}`
                : config.model
            }
          >
            <Button
              variant="outline"
              onClick={() => push({ kind: 'assistant-config', id: config.id })}
            >
              {t('common.edit')}
            </Button>
            <Button
              disabled={!writable || busy || settings.defaultConfigId === config.id}
              onClick={() =>
                void change((settings) => ({ ...settings, defaultConfigId: config.id }))
              }
            >
              {t('assistant.default')}
            </Button>
            <Button disabled={!writable || busy} onClick={() => setDeleting(config)}>
              {t('ui.delete')}
            </Button>
          </SettingsRow>
        ))}
      </div>
      {!settings.configs.length && (
        <p className="text-sm text-muted">{t('assistant.noConfigurations')}</p>
      )}
      <Button
        variant="outline"
        disabled={!writable || busy}
        onClick={() => push({ kind: 'assistant-config' })}
      >
        {t('assistant.add')}
      </Button>
      <SettingsLink
        label={t('assistant.extraPrompt')}
        open={() => push({ kind: 'assistant-prompt' })}
      />
      {error && !deleting && <p role="alert">{t('assistant.saveFailed')}</p>}
      <OverlayPresence>
        {deleting && (
          <Modal
            title={t('assistant.deleteConfig')}
            mobilePlacement="center"
            close={() => setDeleting(undefined)}
            canClose={() => !busy}
            dismissOnOutside={false}
          >
            <p className="text-sm break-words">{deleting.name}</p>
            {error && (
              <p className="mt-2 text-sm" role="alert">
                {t('assistant.saveFailed')}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  setError(false);
                  setDeleting(undefined);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void change((settings) => {
                    const configs = settings.configs.filter((config) => config.id !== deleting.id);
                    return {
                      ...settings,
                      configs,
                      defaultConfigId:
                        settings.defaultConfigId === deleting.id
                          ? configs[0]?.id
                          : settings.defaultConfigId,
                    };
                  })
                }
              >
                {t('ui.delete')}
              </Button>
            </div>
          </Modal>
        )}
      </OverlayPresence>
    </>
  );
}

type FormProps = {
  model: WorkspaceController;
  registerGuard: (guard: SettingsExitGuard) => void;
  saved: () => void;
};

function useExitGuard(registerGuard: FormProps['registerGuard'], dirty: boolean, saving: boolean) {
  useLayoutEffect(() => {
    registerGuard(() => (saving ? 'busy' : dirty ? 'dirty' : 'clean'));
    return () => {
      registerGuard(null);
    };
  }, [dirty, registerGuard, saving]);
}

export function AssistantConfigForm({
  model,
  configId,
  advanced,
  advancedTarget,
  openAdvanced,
  registerGuard,
  saved,
}: FormProps & {
  configId?: string;
  advanced: boolean;
  advancedTarget: HTMLElement | null;
  openAdvanced?: () => void;
}) {
  const [baseline] = useState(model.workspace);
  const settings = baseline?.assistant ?? emptySettings;
  const original = settings.configs.find((config) => config.id === configId);
  const [config, setConfig] = useState<AssistantApiConfig>(
    () =>
      original ?? {
        id: id('ai'),
        name: '',
        apiType: 'open-ai-compatible',
        apiUrl: 'https://api.openai.com/v1',
        model: '',
        apiKey: '',
      },
  );
  const [parameters, setParameters] = useState(() =>
    JSON.stringify(config.customParams ?? {}, null, 2),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<{ abort(): void } | undefined>(undefined);
  const save = useSaveAssistant(model);
  const unavailable = !baseline || (!!configId && !original);
  const readonly = unavailable || !model.runtime?.state.getState().writable;
  useExitGuard(registerGuard, dirty, saving);
  useEffect(() => () => request.current?.abort(), []);

  function patch(values: Partial<AssistantApiConfig>) {
    setConfig((config) => ({ ...config, ...values }));
    setDirty(true);
    setMessage('');
  }

  function parsed() {
    const candidate = { ...config, customParams: JSON.parse(parameters || '{}') };
    validateAssistant({ configs: [candidate] });
    return candidate;
  }

  async function testConnection() {
    if (testing || saving || unavailable) return;
    let candidate: AssistantApiConfig;
    try {
      candidate = parsed();
    } catch {
      setMessage(t('assistant.invalidConfig'));
      return;
    }
    setTesting(true);
    setMessage('');
    try {
      const pending = assistantProvider(() => candidate).request({
        history: [{ role: 'user', raw: 'Reply OK.' }],
        tools: [],
        maxTokens: 16,
      });
      request.current = pending;
      for await (const _chunk of await pending) {
        // Verify the streaming protocol through completion.
      }
      setMessage(t('assistant.connected'));
    } catch {
      setMessage(t('assistant.failed'));
    } finally {
      request.current = undefined;
      setTesting(false);
    }
  }

  async function persist() {
    if (!baseline || readonly || saving || testing) return;
    let candidate: AssistantApiConfig;
    try {
      candidate = parsed();
    } catch {
      setMessage(t('assistant.invalidConfig'));
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await save(baseline, {
        ...settings,
        configs: original
          ? settings.configs.map((item) => (item.id === candidate.id ? candidate : item))
          : [...settings.configs, candidate],
        defaultConfigId: settings.defaultConfigId ?? (original ? undefined : candidate.id),
      });
      saved();
    } catch {
      setMessage(t('assistant.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (unavailable) return <p role="alert">{t('assistant.saveFailed')}</p>;
  const advancedFields = (
    <>
      {(['contextWindow', 'maxTokens'] as const).map((key) => (
        <label key={key} className="block text-sm">
          {t(`assistant.${key}`)}
          <input
            type="number"
            min="1"
            step="1"
            className="mt-1 w-full"
            value={config[key] ?? ''}
            onChange={(event) =>
              patch({ [key]: event.target.value ? Number(event.target.value) : undefined })
            }
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!config.imageInput}
          onChange={(event) => patch({ imageInput: event.target.checked })}
        />
        {t('assistant.imageInput')}
      </label>
      <label className="block text-sm">
        {t('assistant.customParams')}
        <textarea
          className="mt-1 min-h-32 w-full rounded border border-line bg-panel p-2 font-mono"
          value={parameters}
          onChange={(event) => {
            setParameters(event.target.value);
            setDirty(true);
            setMessage('');
          }}
        />
      </label>
    </>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void persist();
      }}
    >
      <fieldset disabled={readonly || saving || testing} className="min-w-0 space-y-3">
        <>
          <label className="block text-sm">
            {t('assistant.protocol')}
            <select
              className="mt-1 w-full"
              value={config.apiType}
              onChange={(event) =>
                patch({ apiType: event.target.value as AssistantApiConfig['apiType'] })
              }
            >
              <option value="open-ai-compatible">OpenAI compatible</option>
              <option value="google-ai-studio">Google AI Studio</option>
            </select>
          </label>
          {(['name', 'apiUrl', 'model'] as const).map((key) => (
            <label key={key} className="block text-sm">
              {t(`assistant.${key}`)}
              <input
                required
                className="mt-1 w-full"
                value={config[key]}
                onChange={(event) => patch({ [key]: event.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            {t('assistant.apiKey')}
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full"
              value={decodeKey(config.apiKey)}
              onChange={(event) => patch({ apiKey: encodeKey(event.target.value) })}
            />
          </label>
        </>
        {!openAdvanced && (
          <details open={advanced || undefined}>
            <summary className="cursor-pointer py-2 text-sm">{t('assistant.advanced')}</summary>
            <div className="space-y-3">{advancedFields}</div>
          </details>
        )}
      </fieldset>
      {advancedTarget &&
        createPortal(
          <fieldset disabled={readonly || saving || testing} className="min-w-0 space-y-3">
            {advancedFields}
          </fieldset>,
          advancedTarget,
        )}
      <>
        {openAdvanced && <SettingsLink label={t('assistant.advanced')} open={openAdvanced} />}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={readonly || saving || testing}
            onClick={() => void testConnection()}
          >
            {t('assistant.verify')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={readonly || saving || testing || !dirty}
          >
            {t('assistant.save')}
          </Button>
        </div>
        {message && <output className="mt-2 block text-sm">{message}</output>}
      </>
    </form>
  );
}
export function AssistantPromptForm({ model, registerGuard, saved }: FormProps) {
  const [baseline] = useState(model.workspace);
  const settings = baseline?.assistant ?? emptySettings;
  const [prompt, setPrompt] = useState(settings.extraPrompt ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = useSaveAssistant(model);
  const dirty = prompt !== (settings.extraPrompt ?? '');
  const writable = !!baseline && !!model.runtime?.state.getState().writable;
  useExitGuard(registerGuard, dirty, saving);

  async function persist() {
    if (!baseline || !writable || saving || !dirty) return;
    setSaving(true);
    setError(false);
    try {
      await save(baseline, { ...settings, extraPrompt: prompt });
      saved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void persist();
      }}
    >
      <textarea
        aria-label={t('assistant.extraPrompt')}
        disabled={!writable || saving}
        className="min-h-40 w-full rounded border border-line bg-panel p-2"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      {error && <p role="alert">{t('assistant.saveFailed')}</p>}
      <Button variant="primary" type="submit" disabled={!writable || saving || !dirty}>
        {t('assistant.save')}
      </Button>
    </form>
  );
}
