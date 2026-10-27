# Tio

**A quiet place for documents, databases, and ideas — local first.**

[简体中文](README.zh-CN.md) · [Architecture](architecture.md) · [Data format](data-format.md) · [Contributing](CONTRIBUTING.md) · [Verification](verification.md)

Project vision and guiding principles: [tio 之禅](zen.md) (Chinese).

Tio is a browser-based document and database workspace. Write locally, organize records in tables and boards, and optionally synchronize portable JSON files and attachments into a folder you control. No application server or cloud account is required.

## Quick start

Requirements: Node.js 24 LTS and Corepack. The repository pins pnpm in `packageManager`.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:6789`. If your global `pnpm` is older, use `corepack pnpm` as shown; no global package-manager replacement is required.

For the production PWA:

```sh
corepack pnpm build
corepack pnpm preview --port 4175
```

Open `http://localhost:4175` once while online, wait for the application to finish loading, then reopen offline. Production deployments need HTTPS. Folder access depends on browser support.

## Storage modes

| Mode         | Entry                                                    | Persistence                                                                            |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Offline      | Create or reopen a workspace                             | IndexedDB in this browser                                                              |
| Local Folder | Connect a root folder, then create or select a workspace | Direct files in `workspaces/<workspaceId>/`, with an unfinished-write recovery journal |

Local Folder supports reopening existing workspaces, multiple independent workspaces in one connection, external JSON edits, explicit missing-file restoration, and permission recovery. The application manages its recognized business files only. Revoking access blocks folder writes; unfinished commits remain recoverable.

GitHub adds one repository per workspace, complete local text replicas, on-demand attachments, PAT access and optional GitHub App sign-in. See [GitHub storage and setup](github-storage.md).

## Features

- Nested document/database navigation, drag-and-drop placement, search, favorites.
- BlockNote rich text, slash menus, lists, tables, images, undo, and database embeds.
- Editable records, properties, related records, table and board views, filters and sorting.
- Shared record detail/body across every view of the database.
- ZIP backups containing canonical JSON and binary assets; isolated imports.
- Chinese and English UI, persisted language selection, localized editor menus and sample data.
- Responsive desktop/mobile layouts; PWA app-shell caching.
- Schema-aware three-way merges, revision-checked commits, retry scheduling and per-file issues.
- Unknown and newer content remains preserved or read-only instead of being silently dropped.

## Engineering

| Area                   | Implementation                                                          |
| ---------------------- | ----------------------------------------------------------------------- |
| Monorepo               | pnpm workspaces; explicit `workspace:*` dependencies                    |
| Build                  | Vite 8 / Rolldown, React plugin 6 with Oxc transforms                   |
| Lint / formatting      | Oxlint with type-aware tsgolint; Oxfmt with import and Tailwind sorting |
| Types                  | TypeScript 6, strict checking                                           |
| UI                     | React 18, Tailwind CSS 4, Lucide SVG icons, Radix Dialog primitives     |
| Internationalization   | i18next 26 + react-i18next 17; typed semantic translation keys          |
| Editor / grid          | BlockNote 0.56, Glide Data Grid 6; lazy-loaded workspace and grid       |
| Persistence / archives | idb 8, fflate                                                           |
| Testing                | Vitest 5, fake-indexeddb, Playwright; GitHub Actions CI                 |

React remains on 18.3.1 because Glide's latest stable peer dependency range does not include React 19. TypeScript 6 remains within the internationalization packages' supported range. Dependencies are locked; upgrades must pass compatibility tests rather than bypass peer checks. No BlockNote XL extension is used.

## Commands

```sh
corepack pnpm check             # format, typed lint, boundaries, types, unit tests, build
corepack pnpm lint:fix          # Oxlint fixes
corepack pnpm format            # Oxfmt + Tailwind class/import sorting
corepack pnpm test:e2e          # development and production browser tests
corepack pnpm test:coverage
corepack pnpm test:perf         # synthetic 1k/10k record checks
```

On Linux/CI install the test browser first: `corepack pnpm exec playwright install --with-deps chromium`. On macOS the test config can use an installed Google Chrome. All automated tests use isolated browser contexts.

## Repository map

```text
apps/web/src/
  app/             Application composition, dialogs, error boundary
  pages/           Welcome and workspace pages
  features/        Workspace controller, navigation, database interaction
  components/      Small application-specific components
  styles/          Tailwind theme/base + editor DOM integration only
packages/
  core/ serialization/ database/ merge/       Pure business logic
  local-store/ assets/ workspace/             Local application services
  storage/ sync/ provider-*/ adapter-*/       Replaceable synchronization
  editor-blocknote/ views/ ui/ i18n/          Presentation and localization
scripts/           Architecture checks
tests/             Unit, integration, performance, and browser tests
docs/              Architecture, contracts, validation, and roadmap
```

## Current boundaries

This is an early usable demo, not a real-time collaboration system. Sync uses best-effort snapshots with deterministic conflict resolution; plain file writes cannot guarantee zero loss under arbitrary external concurrent writers. Sync runs while the application is open. Deletion is persisted as a marker; there is no trash/history UI or automatic tombstone cleanup.

GitHub, formula/rollup evaluation, calendar views, and cross-workspace relations are not implemented. The UI currently exposes one default view per database and simple filtering/sorting. Mobile hardware behavior and the native OS folder picker require manual validation; OPFS integration tests do not claim to verify native permissions. See the verification record for precise coverage.

## License

MIT for this project's code. Third-party packages retain their respective licenses; see [third-party notes](dependencies.md).

See [provider-owned asynchronous access](async-provider-access.md) for storage guarantees and loading behavior.
