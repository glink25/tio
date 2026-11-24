import { t } from '@tio/i18n';
import { SettingsGroup, SettingsRow, SettingsAction } from '@tio/ui';
import { useEffect, useState } from 'react';

import { platform, type HostUpdate } from '../platform';

type Update = HostUpdate;
export function HostUpdateSettings({ beforeInstall }: { beforeInstall?: () => Promise<void> }) {
  const [enabled, setEnabled] = useState<boolean>();
  const [update, setUpdate] = useState<Update>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<HostUpdate['diagnostics']>();
  useEffect(() => {
    let active = true;
    void platform()
      .update?.('capabilities')
      .then((value) => {
        if (active) {
          setEnabled(value.status === 'enabled');
          setInfo(value.diagnostics);
          if (value.pendingVersion)
            setUpdate({ status: 'available', version: value.pendingVersion });
        }
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (enabled === undefined) return <output>{t('common.loading')}</output>;
  if (!enabled) return <p className="text-sm text-muted">{t('settings.updateUnavailable')}</p>;
  const run = async () => {
    setBusy(true);
    try {
      if (['available', 'ready', 'install-requested'].includes(update.status))
        await beforeInstall?.();
      const value = await platform().update!(
        update.status === 'permission-required'
          ? 'authorize'
          : ['available', 'ready', 'install-requested'].includes(update.status)
            ? 'install'
            : 'check',
        update.version,
      );
      setUpdate({ ...value, version: value.version ?? update.version });
    } catch {
      setUpdate({ status: 'failed' });
    } finally {
      setBusy(false);
    }
  };
  const message =
    update.status === 'runtime-staged'
      ? t('settings.updateStaged')
      : update.status === 'store'
        ? t('settings.updateStore')
        : update.status === 'install-requested'
          ? t('settings.updateInstallRequested')
          : ['permission-required', 'ready'].includes(update.status)
            ? t('settings.updateInstallPermission')
            : update.status === 'installed'
              ? t('settings.updateInstalled')
              : update.status === 'current'
                ? t('settings.updateCurrent')
                : update.status === 'failed'
                  ? t('settings.updateFailed')
                  : undefined;
  return (
    <SettingsGroup title={t('settings.update')}>
      {info && (
        <div className="text-xs break-all text-muted">
          Tio {info.runtime.productVersion} · {info.channel} · {info.hostVersion} ({info.hostBuild})
          · r{info.runtime.revision}
          <br />
          {info.contractId}
        </div>
      )}
      <SettingsRow title={t('settings.update')} description={message}>
        <SettingsAction disabled={busy || update.status === 'installed'} onClick={() => void run()}>
          {busy
            ? t('settings.updateBusy')
            : update.status === 'permission-required'
              ? t('settings.updateAllowInstall')
              : ['available', 'ready', 'install-requested'].includes(update.status)
                ? t('settings.installUpdate', { version: update.version })
                : t('settings.checkUpdate')}
        </SettingsAction>
      </SettingsRow>
    </SettingsGroup>
  );
}
