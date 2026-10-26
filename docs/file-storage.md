# Shared file storage contract

`@tio/file-storage` implements `WorkspaceContentPort` over the four-operation `FileStorageProvider`. Folder, GitHub, WebDAV and other file providers share this implementation. A database-backed service implements `WorkspaceContentPort` directly and has no dependency on chunk files.

## Current layout

```
workspaces/<workspaceId>/objects/<objectId>.json
workspaces/<workspaceId>/chunks/<hash-prefix>/<sha256>.json
workspaces/<workspaceId>/assets/<assetId>.<extension>
```

Every type, including workspace metadata, uses the same identity-based object path. Changing labels never moves files. Object type, workspace, schema version and database membership are immutable. This project accepts only the current format; there is no old-layout discovery, migration or dual write.

Objects below the configured UTF-8 byte budget remain canonical JSON. Larger objects use an identity-bearing head with `$storage: { version: 1, root }`. `$storage` is reserved and cannot occur in a business object envelope. The root references immutable content-addressed JSON nodes. The tree recursively splits arrays, objects and strings, including oversized unknown payloads. Index nodes are also split, so the index itself cannot grow beyond the file budget. Strings split at Unicode scalar boundaries; decoding reconstructs their exact value. The default budget is 512 KiB, configurable per file endpoint, with a minimum of 1 KiB.

## Publication and failures

Chunks are written before the object head. Unchanged chunks are reused by hash. Reads validate each chunk's hash and budget; missing or corrupt chunks are errors, never a deletion or empty document. Retrying a failed publication reuses completed chunks. The tree reader limits reconstruction to 100,000 nodes, 200 MiB and 128 levels.

The minimum provider must make a completed write readable and return null only for a missing path. Permission and transport failures must throw. The four-operation interface does not promise conditional writes or atomic multi-file commits. Head replacement and simultaneous writers therefore retain best-effort semantics; the synchronizer rereads before publication to narrow the race, but this is not CAS. The folder provider uses `createWritable()` followed by `close()`.

No automatic chunk deletion occurs. A failed upload may leave unused chunks; previous generations remain available by content address. Garbage collection requires a separately designed retention and concurrent-reader protocol. Do not delete unreferenced chunks during a normal sync pass.

## Synchronization cost

Each valid object is read once in a no-change pass; changed objects are reread immediately before publication. An optional strong fingerprint from `list` allows a bounded object cache to avoid unchanged reads. Providers must not label modification time alone as a strong content fingerprint. Folder providers without that capability continue to read object heads. Existing immutable asset paths avoid repeated binary uploads; local committed assets avoid repeated downloads.

A bad object is diagnosed independently. Unrelated valid objects continue synchronizing. Object schemas and three-way merges remain outside the file codec. Record count increases the number of identity-addressed files, not the size of one database file. Initial enumeration and whole-object reconstruction remain linear in workspace/object size; file splitting alone does not make arbitrarily large workspaces cheap to open.

## Executable evidence

`tests/file-storage.test.ts` covers Unicode/large payloads, bounded data and index files, interrupted chunk/head publication, retry, corruption and chunk reuse. `tests/architecture-review.test.ts` covers independent invalid-object handling and read counts. Browser tests exercise the same layout through genuine OPFS directory handles. GitHub/WebDAV production integrations and native disk permissions require their own endpoint tests; they are not implied by the in-memory and OPFS results.

## Direct folder repository

The Web folder connection uses `FileRepository` over this codec instead of synchronizing an IndexedDB replica. It scans existing object files for navigation; no navigation index or new object layout is introduced. Hash/revision bookkeeping and unfinished writes live in a minimal browser recovery journal. See [provider-owned data access](async-provider-access.md) for recovery and best-effort commit guarantees. `SyncCore` remains an optional replica-provider component.
