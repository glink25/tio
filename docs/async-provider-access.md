# Asynchronous provider-owned data access

The host selects a provider repository. Device workspaces use IndexedDB as their authoritative store; folder workspaces read and write their files directly. The editor never chooses a cache, opens IndexedDB, or assumes that a complete workspace is resident in memory. GitHub uses a complete text replica with on-demand binary caching; WebDAV and server providers are not implemented.

## Read contracts

`WorkspaceRepository` exposes `readObjects`, `queryNavigation`, `queryRecords`, `search` and `scan`. These asynchronous operations are also available through the JSON bridge. Navigation returns metadata, never an editable command baseline. `readObjects` reports missing and denied IDs separately; transport and decoding failures reject. Runtime state distinguishes loading, ready, missing, denied and error, and permits retry.

Navigation and selected content load first. Visible database embeds request their schema, views and record pages independently. Links use navigation metadata without recursively fetching their targets. A current page/record is pinned; clean unpinned bodies are evicted beyond a 256-object working-set target. Pending commands prevent eviction. Binary assets are read on access.

Body reads do not advance the workspace change cursor. Commands load their required objects before replay and preserve the existing optimistic projection, undo history and receipt-based retry. A partial projection is never a backup: `exportObjects()` explicitly traverses all pages and retries up to three times if workspace versions change during traversal.

Record queries apply filtering and sorting before pagination. The table requests 100 rows per page and offers forward/reset controls. Queries are live rather than frozen snapshots; deleting a cursor row can require restarting the query. File and device implementations may scan to evaluate a query. A future server implementation can execute the same query remotely without downloading unrelated content.

The browser provider supplies Worker search. Permission-filtered batches are sent to a module Worker for text matching. Results appear progressively and the dialog keeps its loading indicator until the final batch. Query changes and workspace changes invalidate old responses. Search does not populate the editor body cache. A provider can instead supply remote search. No persistent full-text index is required.

## Provider capabilities

`storageCapabilities` declares `persistence: atomic | recoverable`, `offline`, and `prefetch: none | all`. Capabilities describe guarantees; UI code must not infer guarantees from connection names. Device and folder providers choose no automatic full-body prefetch. The GitHub replica declares full text prefetch and blocks search/export until its initial synchronization is complete. The host keeps authorization, lifecycle, catalog, preferences and background scheduling. Optional synchronization components remain available for future providers that need an offline replica.

The scanning query implementation is reusable. File providers do not require an additional navigation index or a metadata/body split. Folder navigation and query discovery can read every object; this implementation deliberately does not promise workspace-size-independent startup. Chunk storage remains unchanged.

## Folder commits and recovery

`FileRepository` publishes directly through `WorkspaceContentPort`. Web Locks serialize cooperating tabs using the same connection/workspace identity. The browser recovery journal contains object hashes/revisions, version cursors, compact receipt identity/watermarks and an unfinished request with its affected bodies and staged asset bytes. It does not contain a full workspace replica. Successful requests discard the pending payload; acknowledgements compact their receipt metadata.

Validation and authorization precede publication. The journal is persisted before any object writes; attachment bytes precede referencing objects. Each file is rechecked immediately before replacement. Saved means all requested writes and the completion receipt have finished. A lost response is resolved by the original commit ID. A compact receipt returns the current authoritative entries for the affected IDs, without replaying the mutation.

On restart or retry, each affected file must equal its recorded original hash or intended new hash. A different external value blocks recovery with a conflict and leaves the journal intact. Missing known files are diagnosed, not converted into deletions. Tombstones remain explicit deletions. Journal storage failure prevents beginning publication.

This is recoverable best-effort publication, not a multi-file transaction or an external-writer CAS guarantee. External tools may observe an intermediate state, and an external writer can race the final check. There is no new file layout or migration path.

A folder without authorization cannot be reopened from a cached body. The catalog remains visible and exposes explicit reauthorization. An already-open editor becomes read-only when the host detects access loss; unfinished commands remain pending. Background checks never prompt. Reauthorization uses the user's click stack, restores the same endpoint, and retries pending work.

## Verification

`tests/provider-async.test.ts` covers targeted reads, query completeness, cursor isolation, deduplicated loads, queued commands, folder recovery, external conflicts, permissions and bridge operations. Architecture browser tests use OPFS for direct file writes and authorization recovery. Existing runtime, host, sync and Web Slice tests remain regression coverage; optional replica synchronization tests do not describe the folder's current write path.

The integration suite additionally exercises Worker search against unopened bodies and verifies that folder commits leave neither business objects in the IndexedDB object store nor completed body payloads in the recovery journal. Relation selectors query the provider asynchronously, and referenced record/asset metadata is loaded for displayed values without fetching attachment bytes.

## Mention metadata

`queryNavigation` accepts optional `text` and `mentionsOnly` filters, applied before pagination by the provider. `readMetadata(ids)` returns versioned metadata entries plus separate missing/denied IDs, with no body or record properties. Both operations are available over the JSON bridge. `EditorSession.mentionCandidates` and `.mentionMetadata` expose them without advancing the body change cursor or populating the body cache. Current scanning providers may still read files/objects internally; no workspace-size-independent scan guarantee is implied.

The default host mention service batches resolution requests from the same render, coalesces background refresh notifications (1 second debounce, 5 second maximum wait) and scopes navigation to its workspace. Concurrent resolutions share in-flight requests; invalidation during a read schedules a follow-up. Existing labels remain visible during refresh, with an unobtrusive retry indicator on failure. Initial resolution and explicit retries are immediate; known access changes bypass the title debounce. Save completion still triggers refresh so optimistic renames cannot leave persisted titles stale. UI requests discard superseded responses and expose loading/retry states. Tombstones display as deleted, denial hides titles, and missing IDs are not misreported as confirmed deletion.
