# Workspace operations

`@tio/operations` is a platform-independent application service. It uses the host's existing `WorkspaceRuntime`; it never opens storage, owns a second save queue, or executes agent code. The Web host currently exposes it as Site tools. Native hosts can reuse this package with their own authorization and transport adapters.

```ts
const service = new WorkspaceOperations({
  runtime,
  workspaceId,
  validateBlocks: sharedContentValidator,
  describeContent: sharedContentSchema,
});
const definitions = await service.describe();
const result = await service.invoke('objects.get', { id }, undefined, authorizationLease);
// Read returns {object, version}. Updates require this opaque version.
await service.invoke(
  'pages.update',
  {
    id,
    version,
    changes: { title: 'Updated' },
  },
  requestId,
  authorizationLease,
);
service.dispose();
```

`authorizationLease` throws a typed `permission` or `closed` error after revocation/session disposal. The service rechecks it after asynchronous reads and the runtime checks it before persistence. Content validation is injected by the host from the shared editor schema; nonempty body writes are unavailable without it. No content is normalized through Markdown.

Operation definitions contain read/write classification, input/output schema and descriptions. `describe(operation)` provides the full definition; native block metadata is included for body operations. Operation families cover context, object listing/search/read, page/block changes, database/record/field/view changes and automation configuration/history. `mutations` exports pure helpers shared with the App Slice broker; the broker retains its own page-derived scope and protected objects.

Mutations require `requestId`; updates, deletion and restoration require an opaque read version. Record versions also bind their database schema. Unknown object fields and unmodified opaque blocks are retained. Block props merge; explicit content/children changes replace those parts. Field type/cardinality conversion, workspace management, connection management, physical deletion and asset upload are unsupported.

Results are `completed` with `value`, `failed` with a stable error code and diagnostic details, or `pending` with the request ID. Each write is serialised through the service and confirmed through the runtime. It forms one undo item and emits trusted `source: ai` commits. Provider guarantees still apply: file publication is recoverable, not a multi-file transaction. Remote sync and subsequent automation runs have separate outcomes.

A 12-second service wait can return `pending` while the original write continues. Query `result(requestId, lease)` or repeat the identical request with the same ID. Reusing an ID with different arguments fails. The session retains up to 10,000 requests and 10,000 version tokens; a refreshed or replaced host starts a new session. After refresh, inspect persisted content rather than replaying an uncertain create under a new ID.

The host must authorize before calling the service and gate result delivery. Workspace IDs and session IDs are routing/baseline identifiers, not credentials. The service cannot stop an already-started provider write; revocation blocks future work and further result delivery.
