# Tio

A local-first document and database editor. Use device storage, a local folder, or a GitHub repository. PAT and local modes need no application server; GitHub App sign-in uses an optional authorization Worker.

[简体中文](README.zh-CN.md) · [Project principles](zen.md)

## Start

Use Node.js 24 and the pnpm version pinned in `packageManager`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:6789`. For a production build, run `corepack pnpm build` followed by `corepack pnpm preview --port 4175`. Production hosting requires HTTPS for browser filesystem and offline capabilities.

## Capabilities and limits

Rich text, nested pages, mentions, table/board views, typed fields, formulas, rollups, trash, JSON backups, Markdown exports, code highlighting, Mermaid and App Slice are implemented. The editor can also be embedded independently.

File publication is best effort; it does not guarantee atomic multi-file visibility or zero loss with arbitrary external writers. Synchronization runs while the host is active. Native apps, WebDAV, real-time collaboration and automatic tombstone/chunk cleanup are not implemented. Browser data can be evicted; keep backups. Native folder permissions and real-device IME behavior require manual verification.

## Documentation

The detailed documentation is maintained in Chinese.

- [Product](product/requirements.md) · [Next steps](product/roadmap.md)
- [Architecture](architecture/overview.md) · [Provider reads](architecture/provider-access.md)
- [Data contract](protocols/data-format.md) · [Extensions](protocols/extensions.md)
- [Development](development/contributing.md) · [Testing](development/testing.md)
- [Embedding](../packages/web-editor/docs/integration.md) · [App Slice](../packages/web-editor/docs/app-slice.md)
- [File storage](../packages/file-storage/docs/storage.md) · [GitHub](../packages/provider-github/docs/storage.md)
- [Database fields](../packages/database/docs/fields.md) · [Code blocks](../packages/editor-blocknote/docs/code-blocks.md)
- [Security](governance/SECURITY.md) · [Third-party notices](governance/THIRD_PARTY_NOTICES.md) · [Changelog](governance/CHANGELOG.md)

Original project code is MIT licensed; see [LICENSE](../LICENSE). Dependencies retain their own licenses.
