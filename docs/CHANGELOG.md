# Changelog

## 0.1.0 — 2026-10-22

- Offline and Local Folder workspaces with canonical file synchronization.
- Block editor, database embeds, table/board views, records and basic relations.
- Revision-safe local persistence, deterministic merge, attachment synchronization and ZIP backups.
- Responsive interface, PWA caching, Chinese/English localization.
- pnpm workspace boundaries, Vite 8, Tailwind CSS 4, Lucide and Radix UI.
- Oxlint type-aware checks, Oxfmt, TypeScript, Vitest, Playwright and CI configuration.

- Minimal monochrome editor shell with light/dark themes, nested pages, breadcrumbs, references/backlinks and slash actions.
- Editable workspace and page names, synchronous input drafts with asynchronous persistence.
- Trailing-only sync debounce; background polls respect active edits.
- Markdown reading export with linked documents and attachments.
- Project docs consolidated under `docs/`; original source documents excluded under `docs/.local/`.

## State-flow completion — 2026-10-23

- Removed `DraftInput`; ordinary controlled inputs now consume the shared Runtime directly.
- Kept native numeric parsing separate from persistence, preserving negative decimals and explicit clearing.
- Added focused host-update, save-failure/retry and rejected-command regressions.
