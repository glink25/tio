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
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const key = errorKeys[message];
  return key ? t(key) : i18n.language === 'zh' ? message : t('errors.details', { message });
}
const errorKeys: Record<string, TranslationKey> = {
  '内容已在另一个窗口更新，请重试': 'errors.stale',
  '附件不能超过 20 MB': 'errors.assetSize',
  请选择只包含一个工作空间的备份: 'errors.singleWorkspace',
  备份对象重复或跨工作空间: 'errors.backupIdentity',
  不能移动到自身或子页面: 'errors.moveCycle',
  文件路径与对象身份不匹配: 'errors.identity',
  '文件夹 Workspace 身份不匹配': 'errors.identity',
  '对象版本高于当前支持版本，保留只读': 'errors.future',
  对象版本不支持写入: 'errors.future',
  附件二进制缺失: 'errors.assetMissing',
  '附件尚未完成同步，暂缓发布业务对象': 'errors.assetPending',
  '已同步文件被移除；可恢复文件': 'errors.missing',
  请输入有效数字: 'errors.number',
};
export function translateStatus(status: string) {
  if (status.startsWith('syncing:')) return `${t('status.syncing')} ${status.slice(8)}`;
  const keys: Record<string, TranslationKey> = {
    idle: 'status.saved',
    syncing: 'status.syncing',
    synced: 'status.synced',
    pending: 'status.pending',
    permission: 'status.permission',
    'reauthorization-required': 'status.reauthorize',
    unreachable: 'status.unreachable',
    unrecoverable: 'status.unrecoverable',
    forbidden: 'status.permission',
    failed: 'status.failed',
    issues: 'status.issues',
    已保存本地: 'status.saved',
    正在保存本地: 'status.saving',
    本地保存失败: 'status.saveFailed',
    正在同步文件夹: 'status.syncing',
    已同步文件夹: 'status.synced',
    等待同步文件夹: 'status.pending',
    需要授权: 'status.permission',
    同步失败: 'status.failed',
    同步遇到问题: 'status.issues',
  };
  return t(keys[status] ?? 'status.ready');
}
