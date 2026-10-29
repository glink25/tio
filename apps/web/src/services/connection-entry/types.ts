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
export interface ConnectionEntryActions {
  github: () => Promise<void>;
  token: () => void;
  device: () => Promise<void>;
  folder: () => Promise<void>;
}
