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

import { locales, type Language, type TranslationKey } from './locales';
export type { Language, TranslationKey };
export const languages = Object.keys(locales).filter(isLanguage);
export const fallbackLanguage: Language = 'en';
export const initialLanguage: Language = 'zh';
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.hasOwn(locales, value);
}
export function resolveLanguage(value: unknown, fallback = fallbackLanguage): Language {
  return isLanguage(value) ? value : fallback;
}
const options = {
  resources: Object.fromEntries(
    languages.map((language) => [language, { translation: locales[language].translation }]),
  ),
  fallbackLng: fallbackLanguage,
  supportedLngs: languages,
  interpolation: { escapeValue: false },
  returnNull: false as const,
  initAsync: false,
  keySeparator: false as const,
};
export function createLanguageInstance(language: Language) {
  const instance = i18n.createInstance();
  void instance.init({
    ...options,
    lng: language,
  });
  return instance;
}
void i18n.use(initReactI18next).init({ ...options, lng: initialLanguage });
export function formatLocale(language: Language) {
  return locales[language].formatLocale;
}
export function languageLabel(language: Language) {
  return locales[language].label;
}
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
