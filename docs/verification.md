# Verification record

Date: 2026-10-23. Environment: macOS, Node.js 24.22.1, pnpm 12.14.0, isolated installed Google Chrome contexts.

Final run: `pnpm check` passed (54 unit/contract tests, type checks, formatting, lint, dependency boundaries, both production builds and compiled CSS isolation). `pnpm test:e2e` passed all 17 tests. Backup import also passed three consecutive isolated runs after deterministic initial-page selection and flushing before export were added.

## Automated checks

- Strict TypeScript checking across all workspace packages.
- Oxlint, including type-aware tsgolint checks and zero-warning enforcement.
- Oxfmt formatting, import ordering and Tailwind class ordering.
- Dependency boundary checks for pure business packages and `workspace:*` links.
- Production Vite 8 build and generated PWA service worker.
- Vitest (85 tests, architecture repair run): trailing debounce across foreground polls, retained requests during in-flight work, canonical/unknown data preservation, unsupported-version rejection, merge determinism, text/grapheme Diff3, delete conflicts, revision CAS, two-store synchronization, upload-time edits, failed writes, invalid/missing files, attachments-first ordering, unknown-type preservation, ZIP roundtrip, Markdown reading-export links and assets, i18n parity/pluralization, synthetic 1k/10k record queries plus 100-page persistence, synchronous keystroke projection, persistence failure/retry, external-field preservation, cyclic-move rejection, command-level future-format preservation, and bounded receipts for repeated host/sync writes.

## Browser scenarios

21 browser tests (including the new table roundtrip case) cover the following flows, including independent embedding:

1. Offline document editing (including Chinese text), reload recovery, table/board navigation, record editing and JSON/Markdown ZIP downloads.
2. A 390×844 viewport: mobile list, full-screen record detail, edit persistence and no document overflow.
3. Actual `FileSystemDirectoryHandle` list/read/write/delete on an isolated OPFS directory; unrelated file remains untouched.
4. Folder entry with a controlled picker returning an actual OPFS directory handle; automatic write, external file update, pull, clearing business IndexedDB stores, and reconstruction from the directory.
5. Production PWA: first installation, network disabled, reload, close tab, reopen offline, saved title retained.
6. Chinese/English switching, persisted language, unchanged user content, accessible dialog dismissal.
7. Three-level pages, ancestor breadcrumbs, references/backlinks, workspace rename, rapid keystroke persistence, dark/light switching and reload persistence.
8. Slash menu creates a subpage under the current page.
9. JSON ZIP export/import into a new workspace identity retaining internal object IDs, isolated editor draft state, subsequent editing/reload and persisted light-theme preference.

10. One folder connection with A/B spaces, switching, independent persistence and a headless write to A while B is active; host background synchronization publishes it.
11. Host sidebar/body/header and editor computed CSS colors follow explicit presentation and remain correct after reload.
12. Standalone production editor with IndexedDB disabled: two themes/locales, host-native writes, scoped portals, focused input updates, failed persistence retry and numeric field updates.

Additional repository contracts cover field-level permissions, hidden-field preservation, deleted-object undo, concurrent schema edits, compacted receipts, close failure/retry, registered-type validation and cross-workspace bridge rejection. Sync contracts cover binary-only repair after staging cleanup and remote permission denial preserving local drafts.

The directory tests exercise real browser file APIs and actual writes in browser-owned storage. **They do not test the native OS picker, user-visible directory authorization, or ordinary disk-folder permission persistence.** The picker substitution is confined to the test context and does not ship in the app.

## Visual checks

Desktop dark-grid, board and document screenshots and 390-pixel entry/document screenshots were inspected. The responsive layout has no horizontal document overflow; mobile records open in a full-screen drawer. The entry screen selects one connection, then lists its workspaces. Light and dark monochrome layouts are checked, including a three-level document tree. Database block selection outlines are supplied by BlockNote and remain visible while that block is selected.

Screenshots and traces are written to ignored `test-results/`; the headless capture script also records a manifest under ignored `.tmp/visual-qa/`.

## Manual release checklist — not yet verified

- [ ] Desktop Chrome native picker: choose a temporary empty disk folder, grant read/write, confirm JSON/assets appear on disk.
- [ ] Close/reopen browser; test granted, prompt, denied and revoked directory permissions.
- [ ] Select an existing folder with multiple workspaces; open each without modifying unrelated files.
- [ ] Remove a known JSON externally; see an issue, then explicitly restore it.
- [ ] Native disk I/O errors and read-only/removable volumes.
- [ ] iOS Safari and Android Chrome hardware: IME composition, soft keyboard, selection, touch drag alternatives, installed PWA restart.
- [ ] Firefox/WebKit offline-mode smoke checks; native directory support is capability-gated.
- [ ] Real-device scrolling/memory measurements at 1k/10k records. Synthetic query thresholds are not hardware benchmarks.

## Known limits

- Concurrent external file writers can still race after the pre-write read. There is no cross-file transaction or zero-loss guarantee.
- Recovery copies are locally bounded to 100 entries and have no UI; deletion markers persist indefinitely.
- Current UI exposes a default view, a single contains filter and a single sort, while the model supports arrays of filters/sorts.
- Search scans local objects. It is suitable for demo datasets, not a full-text indexing service.
- Standard date editing is date-only. Unsupported time-aware values must remain read-only/preserved rather than being coerced into a date.
- The rich-editor dependency remains a large lazy-loaded chunk. The app shell precaches it for offline use; first download still includes that cost.
- No GitHub adapter, formula/rollup evaluator, calendar, trash/history interface or background execution after closing the application.

## Cross-platform editor refactor

The Web host now consumes the independent `web-editor` package. Both application and standalone editor builds are checked. Storage contract tests run against IndexedDB and memory hosts, covering the new initial format, CAS conflicts, atomic failure, duplicate commit receipts, ambiguous timeout recovery, binary transfers and missed notifications. The production standalone bundle is mounted twice over asynchronous simulated host channels with IndexedDB access disabled; external basic writes, title persistence, locale/theme isolation and dialog containment are verified. No native platform or system integration is shipped.

Native integration instructions: [native-host-integration.md](native-host-integration.md). Acknowledged editor, host-helper and sync receipts are compacted into client watermarks; unacknowledged receipts remain available for recovery. Binary transport references use consumption acknowledgements and leases. A native transport must implement the same lifecycle. The rich editor build retains the existing large-chunk warning.

## State-flow follow-up — 2026-10-23

Removed component-local persistence drafts from title, record-field and query inputs. Browser coverage includes focused title updates from the host, rapid typing, failed commits followed by continued editing and retry, numeric conversion, negative decimals, external numeric updates and explicit clearing. A Runtime regression verifies that invalid field commands do not change the projection or pending queue. These tests use isolated browser instances and a controlled host; native IME/hardware verification remains on the manual checklist.

## Offline authorization recovery — 2026-10-23

`pnpm check` and the full 17-test browser suite passed. Added contracts cover a simulated non-folder adapter, no endpoint access during local restoration, A/B draft synchronization after reauthorization, concurrent-click coalescing, late authorization after disconnect, immediate folder permission requests, cancellation, discovery/network failure, local flush failure, and authentication expiry during publication.

Browser regressions override permission results on genuine OPFS handles: both `prompt` and `denied` after reload retain the selected document, allow continued edits and another reload, avoid automatic permission prompts, preserve the editor after denial, and publish drafts after a successful click. A connection with no cached spaces retains its recovery action in the selector. These tests do not substitute for the native OS permission-dialog checklist above.

## Architecture repair evidence

The repair adds shared file chunk/index budgets and failure injection, per-instance domain validation, recursive table opacity, archive preflight, object-isolated sync, incremental host reads, and a 10,000-level navigation projection. See `repair-progress.md`, `file-storage.md` and `extensions.md`. Synthetic operation tests do not establish real-device latency or memory guarantees.

## Code blocks and Mermaid — 2026-10-26

`pnpm check` passed, including 164 unit tests, type checking, formatting, lint, package boundaries, both production builds and compiled CSS scoping. Four new production standalone browser tests passed: dual-theme highlighting/diagrams, persisted modes across instances and remounts, temporary read-only viewing, keyboard editing and real clipboard paste, syntax-error recovery, optional chunk requests and renderer-load failure isolation. The language test loads every offered grammar and verifies dual-theme tokens. A captured two-instance screenshot was inspected for light/dark presentation.

The expanded editor/embedding browser run also exposed two existing fixture/expectation mismatches: `embedding.spec.ts` still selects the removed “Link to page” action and seeds a reserved `mention` with the obsolete `userId` shape. Those tests require updating for the current mention contract. A standalone multi-block selection failure in that expanded run passed when rerun with one worker, in both development and standalone builds.

## GitHub storage integration

GitHub-specific unit coverage lives in `tests/github.test.ts` and `tests/github-auth.test.ts`; the browser fixture is `tests/e2e/github.spec.ts`. These cover the stateless login/install/exchange flow, token rotation, pinned Git snapshots and publication confirmation, offline replicas, and repository discovery. Real GitHub/Cloudflare integration requires deployment credentials; fixture success must not be reported as live authorization verification.
