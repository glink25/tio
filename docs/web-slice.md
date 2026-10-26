# Web Slice

Web Slice embeds a complete HTML document in a sandboxed iframe. Insert **Web Slice / 自定义网页** from the slash menu, open the gear button to use the shared right-side drawer, edit HTML in **Code**, preview, then **Apply changes**. Permissions, display and runtime controls are in **Settings**; runtime messages are in **Logs**. The [ledger example](examples/web-slice-ledger.html) is archived as standalone HTML: copy it into the editor to try it. Draft previews are always read-only. Source uses CodeMirror HTML/CSS/JavaScript highlighting. The minimal header and settings drawer remain outside the iframe. The code editor loads only when opened.

## Permissions and scope

Each instance has two host-owned settings: `data: 'read' | 'readWrite'` and `allowExternalResources: boolean`. Defaults are read-only and no external resources. Editing source preserves grants. Browser grants belong to the local browser profile, workspace, containing page and block ID. Copies/pastes receive new block IDs through BlockNote; user imports re-key Slice IDs. Grants are not exported or synchronized.

The SDK sees the containing page or record body, plus databases directly referenced by its nested database-view blocks. All readable records, fields and views of those databases are available, independently of the displayed view. Direct inline mentions and the containing record’s readable single-select mention fields also grant their page/database targets. Child pages, database record bodies, relation targets, mentions in embedded database records and mentions inside target pages are not followed. Cross-workspace references never grant access. A record body does not automatically grant its parent database. Removing the final reference revokes subsequent access, but cannot retract values already delivered to code.

Read-write grants allow ordinary block edits, record CRUD, field/view management, and creating a database with an atomic reference insertion. They do not allow deleting the containing page/database, moving resources, rewriting Slice code, changing grants or inserting a reference to an inaccessible existing database. Existing user/field permissions remain authoritative. Host `presentation.readOnly` prohibits writes; the editor's local reading mode does not disable a granted application.

Tio implements formula/rollup evaluation for editor views and queries. The Slice SDK exposes their definitions but still omits derived record values, including cached values, and prohibits writing them.

## SDK v1

`window.tio` exists before user scripts execute. Calls return promises. `tio.databases.get(id)` returns a local API handle; its `.get()` asynchronously returns database metadata.

```js
const context = await tio.context.get();
const page = await tio.page.get(); // id, title, type, version
const { blocks, version } = await tio.page.getBlocks();
const databases = await tio.databases.list(); // id, name, fields, version
const table = tio.databases.get(databases[0].id);
const { records, nextCursor } = await table.records.query({ limit: 100 });
const record = await table.records.create({ amount: 38 }, { requestId: crypto.randomUUID() });
await table.records.update(record.id, { amount: 40 }, record.version);
const unsubscribe = tio.subscribe((event) => {
  // { type: 'changed', origin: sliceBlockId | null }
  // Debounce refreshes and avoid unconditional writes in this callback.
});
```

- `context.get()`: API version, containing page/instance IDs, theme, locale, timezone and effective instance permissions.
- `pages.get(id)` returns a handle for a directly mentioned page, exposing `.get()`, `.getBlocks()`, `.update(changes, version)`, `.insertBlocks(blocks, version)`, `.updateBlock(id, changes, version)` and `.removeBlock(id, version)`. Target writes follow the instance read/write grant and host/resource permissions. Deleting or moving target pages and modifying Slice blocks/code are prohibited.
- `page.get()` / `page.getBlocks()`: page metadata or `{blocks, version}`. Links remain references.
- `page.update({title}, version)`: update the title.
- `page.insertBlocks(blocks, version)`: append valid Tio blocks with distinct IDs.
- `page.updateBlock(id, changes, version)`: patch `type`, `props`, `content`, or `children` of an ordinary block.
- `page.removeBlock(id, version)`: remove an ordinary block. An ancestor containing a Slice is protected too.
- `databases.list()` / `databases.get(id).get()`: database metadata. `databases.find(name)` returns a handle only if exactly one database matches.
- `databases.create({name, fields}, {requestId}?)`: create the database, default view and page reference in one provider commit; file providers offer recoverable best-effort publication; return metadata. Field definitions have stable `id`, `name`, and `type`.
- `table.records.query({limit?, cursor?, viewId?, filters?, sorts?})`: default 100, maximum 1000; returns `{records, nextCursor}`. Without `viewId`, all records are considered. Filters use `{fieldId, op: 'eq'|'contains'|'notEmpty', value?}`; sorts use `{fieldId, direction: 'asc'|'desc'}`. Pages are live, not a frozen multi-page snapshot.
- `table.records.get(id)`: `{id, databaseId, properties, version}`; never the record body.
- `table.records.create(properties, {requestId}?)`, `.update(id, properties, version, {requestId}?)`, `.delete(id, version, {requestId}?)`.
- `table.fields.list()`: `{fields, version}`. `.find(name)` fails if absent or ambiguous. `.create(field, databaseVersion)`, `.update(id, changes, databaseVersion)`, `.delete(id, databaseVersion)` return updated database metadata. Removed fields preserve underlying values, as in the normal editor.
- `table.views.list()`, `.create(changes)`, `.update(id, changes, viewVersion)`, `.delete(id, viewVersion)`. Changes support name, layout, filters, sorts and display configuration.
- `ui.resize(height)`: request 160–1200px; a host manual height overrides automatic resize.
- `request(method, payload, {requestId}?)`: low-level access to the same method allowlist, including retrying requests after timeout. This never exposes repository operations.

Record properties use field IDs. Date values are `{start: 'YYYY-MM-DD', end?: string, timeZone?: string}`; timed values include an ISO offset. Formula, rollup and system-time properties are read-only. Updates/deletes require the version returned by a read. A stale version returns `CONFLICT`; re-read before retrying. Writes are acknowledged after the selected provider acknowledges its commit (direct file publication for folders). Each write forms one undo entry. The existing host retry mechanism recovers ambiguous persistence failures without issuing a second mutation.

Requests time out after 15 seconds. Timeout is not cancellation: the error includes `requestId`, and retrying the **same payload with the same ID within the same running session** returns the original outcome. Do not submit a new ID to retry an uncertain record creation. Reloading starts a new session, so inspect persisted records before repeating an uncertain action. A session admits 10,000 distinct requests; restart after reaching that limit. Calls and logs are rate/size bounded; use pagination.

Errors include `PERMISSION_DENIED`, `RESOURCE_REMOVED`, `CONFLICT`, `INVALID_INPUT`, `RATE_LIMITED`, `CLOSED` and `TIMEOUT`. Request methods cannot change permissions. Subscription delivery is scoped to visible data; remote changes have `origin: null`.

## Embedding

Both `EditorSurface` and `mountEditor` / `mountBridgedEditor` accept:

```ts
webSlice: {
  namespace: 'host-user-id',
  permissionStore: {
    get(key) { return grants.get(key); },
    set(key, grant) { grants.set(key, grant); }
  }
}
```

The store is synchronous and host-owned. An optional `subscribe(key, listener)` hook propagates permission changes across simultaneously mounted instances; the browser implementation also observes cross-tab storage changes. Without one, grants last for the editing session. Store failures do not enable permissions. Never persist grants inside document data.

The default runner uses `srcdoc` and an opaque origin, so no separate deployment is required. An optional trusted `runtimeUrl` receives `?external=0|1#token=...`. Its host must serve `createWebSliceRuntimeDocument('', external)` with the matching policy (read `external` on the server); the bootstrap reads its handshake token from the fragment. Exported by the editor package and standalone `TioEditor` global. This endpoint must not serve user content, use credentials, or omit the generated CSP. The same `sandbox="allow-scripts"` applies.

## Security and execution limits

A dedicated MessagePort is created after a window-identity and one-use-token handshake. Every API operation rechecks page scope and authority. Mutations compare their expected objects at commit and recheck grants before dispatch to storage. Already submitted commits can finish after revocation; queued unsent commands are rejected. Navigation, restart, removal and editor teardown invalidate the old channel.

The host installs CSP before user HTML and strips user meta policies/base elements during inert parsing. The sandbox excludes same-origin access, native form submission, popups and top-level navigation. For app forms, use a `type="button"` click handler, `reportValidity()` and the SDK rather than native submit. External access enables HTTPS scripts/resources and HTTPS/WSS connections, subject to CORS; there is no privileged network proxy. Nested frames, objects, workers and forms stay prohibited.

**This is browser resource restriction, not a complete no-exfiltration boundary.** In particular, iframe self-navigation is not a reliable network firewall. An iframe also does not provide a guaranteed CPU/memory quota or termination of an infinite loop. Source editors and anyone changing already-granted code are trusted application maintainers.

Scripts run after SDK initialization; normal DOM operations, inline scripts and sequential external scripts are supported. The runner dispatches DOMContentLoaded/load after its initial script installation. No npm transpilation or bundling is performed. Use full HTTPS asset URLs when external access is enabled.

## Verification

- `pnpm exec vitest run tests/web-slice.test.ts`
- `pnpm exec playwright test --config playwright.web-slice.config.ts` (Chromium, Firefox, WebKit)
- `pnpm check`

The ledger example uses inline SVG, requires no network, initializes its own table, and keeps business data in ordinary database records.

## Mention authority

Mentioned databases use the existing `databases` API with readable records, fields and views, independently of the loaded editor cache. Mentioned pages use `pages.get(id)`; `page` still refers to the containing page/record. A removed final direct reference or deleted target revokes subsequent access. Scope and host permissions are rechecked after asynchronous reads and before queued commits; already delivered content cannot be recalled.

Slice writes cannot introduce an out-of-scope mention in nested blocks, table cells or record properties. Existing unavailable references can be preserved or removed. Field schema changes cannot activate dormant values to expand the containing record's authority. Target references never grant recursive access.
