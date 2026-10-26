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

## Web Slice

- Added sandboxed HTML application blocks to the shared editor, with syntax-highlighted drafts, read-only preview, host-controlled permissions and runtime logs.
- Added page-scoped database/document APIs, atomic acknowledged writes, scoped subscriptions and an offline ledger example.
- Added Chromium/Firefox/WebKit verification configuration and SDK documentation in `docs/web-slice.md`.

- Web Slice uses a minimal header and the shared right-side settings drawer with Code, Settings and Logs tabs; CodeMirror loads on demand and the ledger example lives in documentation.

## Editor chrome — 2026-10-26

- Completed BlockNote Tailwind scanning, semantic colors and React 18 ref forwarding for editor controls and nested overlays.
- Unified block actions, destructive menus and thin fold chevrons; separated linked-text formatting from the caret link toolbar.
- Replaced automatic child-page listings and backlinks with a distinct footer of explicit outgoing document references.
- Fixed Chinese color submenu widths and slash shortcut badge colors; replaced blue selection/focus chrome with neutral feedback.
