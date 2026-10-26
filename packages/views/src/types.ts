import type { Field, TioObject } from '@tio/core';
export interface ViewProps {
  readOnly?: boolean;
  upload?: (file: File) => Promise<string>;
  resolve?: (ref: string) => Promise<string>;
  views?: TioObject[];
  onSelectView?: (id: string) => void;
  onCreateView?: () => void;
  onCopyView?: () => void;
  onDeleteView?: () => void;
  onField?: (field?: Field) => void;
  onDeleteField?: (field: Field) => void;
  searchQuery?: string;
  onSearchQuery?: (query: string) => void;
  mobileTable?: boolean;
  onMobileTable?: () => void;
  canEdit?: (record: TioObject, field: Field) => boolean;
  database: TioObject;
  view: TioObject;
  objects: TioObject[];
  onCell: (record: TioObject, field: Field, value: unknown) => void;
  onOpen: (record: TioObject) => void;
  onAdd: () => void;
  onView: (patch: Partial<TioObject>) => void;
  onFields: () => void;
}
export interface RowsProps extends ViewProps {
  rows: TioObject[];
  fields: Field[];
}
