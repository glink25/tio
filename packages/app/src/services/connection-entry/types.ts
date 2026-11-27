import type { TranslationKey } from '@tio/i18n';
import type { ComponentType } from 'react';

export interface ConnectionEntry {
  id: string;
  label: TranslationKey;
  icon: ComponentType;
  emphasis: 'primary' | 'secondary';
  available: boolean;
  iconOnly?: boolean;
  run: () => void | Promise<void>;
}
import type { GitProvider } from '@tio/provider-github/credentials';

export interface ConnectionEntryActions {
  git: (provider: GitProvider) => Promise<void>;
  token: (provider: GitProvider) => void;
  device: () => Promise<void>;
  folder: () => Promise<void>;
}
