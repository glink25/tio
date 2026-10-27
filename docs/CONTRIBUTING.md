# Contributing

## Development workflow

1. Use Node 24 LTS and `corepack pnpm install --frozen-lockfile`.
2. Start `corepack pnpm dev`.
3. Keep business changes in the appropriate package and UI changes in a feature/page component.
4. Run `corepack pnpm format`, then `corepack pnpm check`.
5. Run relevant browser tests; use `corepack pnpm test:e2e` for persistence or UI changes.
6. Describe behavior and validation in the pull request template.

The official Oxc VS Code extension is recommended in `.vscode/extensions.json`. Oxfmt owns formatting, imports, and Tailwind ordering. Oxlint owns correctness and React checks, including type-aware checks using tsgolint. TypeScript remains a separate strict type check. ESLint and Prettier are not parallel project tools.

Two React compiler-only diagnostics (`react/refs`, `react/set-state-in-effect`) are disabled because the application is not using React Compiler and explicitly synchronizes external IndexedDB/session state through refs and effects. Hooks ordering/dependencies, unused code, promise handling, and other enabled correctness rules remain enforced.

## Boundaries

- `core`, `database`, `serialization`, `merge`, `sync`, and `storage` must not depend on UI or concrete endpoints. `scripts/check-boundaries.mjs` enforces this.
- No direct IndexedDB writes from a view or editor component. Use commands/services.
- No directory handles, credentials, Blob URLs, React objects, or Git metadata in business JSON.
- Preserve unknown JSON fields. Never rename a field/option by replacing its stable ID.
- New formats need explicit version migrations and roundtrip fixtures.
- Add both `en` and `zh` keys for UI strings. `TranslationKey` and tests check key and interpolation parity. User-authored content is never translated on language changes.
- Use Lucide named imports and accessible labels for icon buttons. Use shared Radix dialogs for focus trapping and dismissal.
- Use Tailwind utilities in components. Add editor-boundary CSS only when the third-party DOM cannot be styled through props.

## State and error semantics

- Business decisions consume typed state and stable error codes, never display text, translated strings, or `Error.message`. Localization is the final presentation step.
- Keep status, progress and connection access separate. Do not encode fields in strings such as `syncing:3/10`. Use finite unions and exhaustive presentation mappings; loading and unknown failures must never appear as saved or successful.
- Preserve structured errors through services and issue dialogs. Diagnostic messages and causes may be displayed, but must not determine retry, authorization or recovery behavior.
- Normalize external failures at provider/adapter boundaries. Standard browser exception names and HTTP status codes belong there; resource permission denial is distinct from connection authorization expiry.
- Review these rules in code review and verify behavior with type checks and tests, including changed diagnostic wording and language switches. No custom AST enforcement is required.

## Testing

Vitest covers merge laws, transactional revisions, failure recovery, attachments and archives. Playwright uses isolated browser contexts for persistence, responsive views, localization, OPFS provider integration and production PWA behavior. Never point automated destructive tests at a user's folder.

Native folder-picker tests and phone checks are recorded separately in `docs/verification.md`; do not mark them passed based on mocked APIs or desktop device emulation.

## Dependency changes

Use latest compatible stable versions, keep related packages (BlockNote, Oxc) aligned, and commit the lockfile. Respect pnpm's release-age policy. Do not override peer constraints merely to silence an install warning. Run the complete check and browser suites after build/editor upgrades.
