import {
  DomainError,
  HostError,
  ConnectionAccessError,
  type DomainErrorCode,
  type ConnectionAccessCode,
} from '@tio/core';
import { StorageError } from '@tio/storage';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

import { en, zh } from './locales';
export type Language = 'en' | 'zh';
export type TranslationKey = keyof typeof en;
export function createLanguageInstance(language: Language) {
  const instance = i18n.createInstance();
  void instance.init({
    resources: { en: { translation: en }, zh: { translation: zh } },
    lng: language,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh'],
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
    keySeparator: false,
  });
  return instance;
}
export const initialLanguage: Language = 'zh';
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
  keySeparator: false,
});
export function useT() {
  const { t } = useTranslation();
  return (key: TranslationKey, options?: Record<string, unknown>): string =>
    String(t(key, options));
}
export function t(key: TranslationKey, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options));
}
export function setLanguage(language: Language) {
  void i18n.changeLanguage(language);
}
export { i18n };
export { useTranslation, I18nextProvider } from 'react-i18next';
export function errorMessage(error: unknown, translate: typeof t = t): string {
  if (error instanceof DomainError)
    return translate(domainErrorKeys[error.code], {
      maxMB: error.details ? error.details.maxBytes / (1024 * 1024) : undefined,
    });
  if (error instanceof ConnectionAccessError) return translate(accessErrorKeys[error.state.code]);
  if (error instanceof HostError) return translate(hostErrorKeys[error.code]);
  if (error instanceof StorageError) return translate(storageErrorKeys[error.code]);
  const message = error instanceof Error ? error.message : String(error);
  return translate('errors.details', { message });
}
const domainErrorKeys = {
  stale: 'errors.stale',
  'asset-size': 'errors.assetSize',
  'single-workspace': 'errors.singleWorkspace',
  'backup-identity': 'errors.backupIdentity',
  'move-cycle': 'errors.moveCycle',
  identity: 'errors.identity',
  'future-version': 'errors.future',
  'asset-missing': 'errors.assetMissing',
  'asset-pending': 'errors.assetPending',
  missing: 'errors.missing',
  'invalid-number': 'errors.number',
  'close-tabs': 'errors.closeTabs',
} satisfies Record<DomainErrorCode, TranslationKey>;
const accessErrorKeys = {
  available: 'status.ready',
  'reauthorization-required': 'status.reauthorize',
  unreachable: 'status.unreachable',
  unrecoverable: 'status.unrecoverable',
  forbidden: 'status.permission',
} satisfies Record<ConnectionAccessCode, TranslationKey>;
const hostErrorKeys = {
  conflict: 'errors.stale',
  invalid: 'errors.invalid',
  unavailable: 'status.unreachable',
  timeout: 'errors.timeout',
  closed: 'errors.closed',
  unsupported: 'errors.future',
  permission: 'status.permission',
  pending: 'status.pending',
} satisfies Record<HostError['code'], TranslationKey>;
const storageErrorKeys = {
  permission: 'status.permission',
  missing: 'errors.missing',
  invalid: 'errors.invalid',
  io: 'status.failed',
} satisfies Record<StorageError['code'], TranslationKey>;
