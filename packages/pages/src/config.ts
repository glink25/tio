import type { TioObject } from '@tio/core';

import type { CodeOptions } from './code';
import type { SitePlan } from './page';

export interface TemplateContext {
  workspaceId: string;
  /** Call inside a route renderer to include configured styles, scripts and code enhancement. */
  headHtml: () => string;
}
export interface SiteConfiguration {
  workspaceId: string;
  /** Output file -> source path relative to .tio-page/config.ts. */
  assets?: Record<string, string>;
  stylesheets?: string[];
  scripts?: string[];
  code?: CodeOptions | false;
  template(objects: readonly TioObject[], context: TemplateContext): SitePlan | Promise<SitePlan>;
}
export const defineSite = (config: SiteConfiguration): SiteConfiguration => config;
