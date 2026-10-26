import type { Field, TioObject } from '@tio/core';
import { createContext, useContext, type ComponentType } from 'react';

import type { RowsProps } from './types';

export interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  objects: TioObject[];
  record?: TioObject;
  readOnly?: boolean;
  onCancel?: () => void;
  upload?: (file: File) => Promise<string>;
  resolve?: (ref: string) => Promise<string>;
  onOpen?: (record: TioObject) => void;
}
export interface ViewExtensions {
  fields?: Record<
    string,
    {
      label: string;
      Input: ComponentType<FieldInputProps>;
      display: (value: unknown, field: Field, objects: TioObject[], locale: string) => string;
    }
  >;
  layouts?: Record<string, { label: string; Component: ComponentType<RowsProps> }>;
}
export const ViewExtensionsContext = createContext<ViewExtensions>({});
export const useViewExtensions = () => useContext(ViewExtensionsContext);
