# Native host integration contract

This is an executable Web architecture reference, not a native application implementation. Reuse the complete rich-text/database editor; the host supplies navigation, persistence, access policy, preferences and background synchronization.

## Mount and lifecycle

```ts
const editor = await mountBridgedEditor(
  container,
  transport,
  { sessionId, workspaceId },
  {
    workspaceId,
    target: { id: pageId },
    presentation: { theme: 'dark', locale: 'zh', readOnly: false },
    onNavigate: (target) => hostNavigate(target),
    onSaveState: (state) => showSaveState(state.status),
    onError: (error) => report(error),
  },
);
await editor.open({ id: anotherPageId });
editor.setPresentation({ theme: 'light' });
await editor.dispose();
```

The host owns resolved presentation state. Editors never write host preferences. `open` flushes and rechecks close state. `dispose` is asynchronous, coalesces concurrent calls and retains the session when flush fails. `onReady` runs after mounting rather than directly after calling React render. The Web shell receives the same `EditorSession` interface backed by WorkspaceRuntime.

One connection exposes multiple spaces. Each space has one endpoint. Switching spaces closes the editing projection after local flush; it does not stop host synchronization. Do not share repository state across unrelated workspace IDs. System features such as calendar reminders or widgets must be host adapters and must not execute during command replay.

## Repository

Implement `WorkspaceRepository` and the shared contract tests:

- `readSnapshot`: coherent workspace version and object revisions.
- `readChanges`: latest changed objects after a version cursor; a full snapshot is a valid fallback.
- `commit`: identity/schema/access validation, provider-declared atomic CAS or recoverable publication, and compact receipt.
- `getCommitResult`: recover an ambiguous timeout using the original commit ID.
- `acknowledgeCommits`: compact acknowledged client sequences and retain a replay-prevention watermark.
- `subscribeChanges`: version, commitId, origin and changedIds.
- `stageAsset/readAsset/releaseAsset`: staged data must not appear through committed reads.

A committed result contains changed entries, not the whole workspace. Receipts for acknowledged sequences may be compacted; retries return `compacted`, never re-execute. Keep unacknowledged receipts until the owning client can resolve uncertainty. Fields not readable to an editor must be preserved by the host while it applies authorized changes.

## JSON bridge and binary leases

Messages carry protocol, sessionId, workspaceId, id, kind, method and payload. Requests and responses are validated at runtime. Bind the trusted channel to the repository and principal; session/workspace checks are routing guards, not a substitute for authentication.

Handshake negotiates extension capabilities. Repository methods include snapshot/delta reads, commit/receipt/ack, asset methods and extension calls. Change notifications are versioned. Tests exercise real JSON encoding rather than structured clone. Duplicate/delayed responses cannot complete another request. Reopening a channel uses a new bridge and fresh navigation and selected-object reads; unresolved commits keep their original identity during retry.

Binary payloads use opaque upload/download/release references, not filesystem paths. The host releases an upload reference after consuming it. An expired request does not revoke an in-use transfer. Implement leases, idempotent release and expiration cleanup; the reference loopback expires transfers after 60 seconds. Native channels may renew leases for larger transfers. A failed asset stage must be retried before its business commit can succeed.

## Headless writes, permissions and synchronization

`executeBasic` supports createPage, rename, appendText, createRecord and setField without React or a WebView. Use stable object/block IDs. The same command rules are revalidated against current state. Fine-grained rich text remains in the Web editor.

`AccessPolicy` supports resource/field-level decisions, allowing a future repository adapter to expose coarse workspace rights or finer backend rights. Host checks are authoritative. For offline-capable providers, local drafts follow the last usable policy; `WorkspaceContentPort.authorize` refreshes publication rights. Denied publication preserves drafts and exposes retry/export/discard behavior.

For providers maintaining a replica, run `SyncCore` through `HostSyncRunner` or a native scheduler. `WorkspaceContentPort` is object-oriented; only `FileWorkspaceContent` assumes canonical files. OS background execution guarantees belong to the native host. Repository events, not editor callbacks, trigger synchronization.

Optional system extensions are declared by name/version at handshake. Calendar, widgets and shortcuts are not implemented in this change. Trigger system effects only after confirmed local commits and make them independently idempotent.

## Verification

`tests/host.test.ts` exercises memory and IndexedDB repositories, compacted receipts, concurrent fields, undo, permissions, registered-type validation and unsupported-version rejection and JSON bridge recovery. `tests/sync-host.test.ts` covers binary-only repair and denied publication. Browser architecture tests verify multiple spaces and headless synchronization; embedding tests disable IndexedDB in the editor and exercise two independent presentations, external updates and failures.

## Restoring expired connections

Restore the local catalog first. Restore content before authorization only for providers declaring offline support; folder content requires access to its endpoint. Implement the host-only `ConnectionAdapter` contract separately from the editor repository and resource `AccessPolicy`. Silent checks must not open dialogs; only an explicit user action may invoke `reauthorize`. Report credential expiry using `ConnectionAccessError` with connection/workspace scope, and report a resource permission denial separately. Offline-capable providers preserve drafts and suspend publication while credentials are unavailable. Direct folder providers block new writes and retain unfinished journal entries.

A successful reauthorization means the original identity and endpoint were restored. If the login flow selects another account/repository, fail recovery without rebinding or publishing cached content. Cancellation leaves the catalog and any already-loaded read-only view available. Invalidate outstanding authorization results when disconnecting. Web folder permission prompts require the request to be invoked directly during the click event, before any asynchronous save or discovery operation.

## Paged reads

Hosts may expose `queryObjects({ scope: { type } | { databaseId }, after?, limit })`. It returns `{ version, entries, next? }` in stable object-ID order, with 1–1000 entries requested per page. The bridge reports `unsupported` if the host lacks this operation. Atomic providers return transactionally consistent pages; file providers retain best-effort scan semantics; multiple pages are not a frozen snapshot. Restart a scan when a consistent export is required and versions differ. Tombstones remain in the result so consumers can maintain a projection. IndexedDB uses the type/database indexes; the memory host is the reference implementation.

## Provider-owned asynchronous reads

Implement `queryNavigation`, `readObjects`, `queryRecords`, `scan` and optional `search` across the bridge. Declare `storageCapabilities`; do not assume a local replica or atomic persistence for every provider. Navigation summaries cannot be used as command baselines. See [asynchronous provider access](async-provider-access.md) for loading states, cursors, query completeness, export and file recovery semantics.

Mention support requires provider `readMetadata(ids)` and the optional `text`/`mentionsOnly` filters on `queryNavigation`. Metadata responses carry `version`, revisioned `entries`, `missing` and `denied`, omit bodies/properties, and apply host access filtering. The JSON bridge transports these operations. Hosts may inject a `MentionService` through editor options for candidate queries, metadata resolution, subscriptions and navigation; no mutable global resolver is used.
