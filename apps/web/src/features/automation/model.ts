import { createFlowModel } from '@tio/automation/model';
import { t, type TranslationKey } from '@tio/i18n';
export type { DraftAction, FlowDraft, Variable } from '@tio/automation/model';
const model = createFlowModel((key, values) => t(key as TranslationKey, values));
export const {
  editableFields,
  titleField,
  blankFlow,
  editFlow,
  blankAction,
  variables,
  compatible,
  conditionFields,
  operators,
  comparisonField,
  toRule,
  flowSummary,
} = model;
export const flowIssues = (...args: Parameters<typeof model.flowIssues>) =>
  model.flowIssues(...args) as Record<string, TranslationKey>;
