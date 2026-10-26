# Data contract v1

Canonical files are UTF-8 JSON with recursively sorted keys, two-space indentation and a final newline. Array order is meaningful. IDs must match `[A-Za-z0-9_-]+` and do not depend on display names.

```text
workspaces/<workspaceId>/
  objects/<objectId>.json
  chunks/<hash-prefix>/<sha256>.json
  assets/<assetId>.<extension>
```

All object types share the same stable identity path. Large objects use the shared [file storage tree](file-storage.md); database-backed object APIs need no file layout. This is a new-project format with no historical reader or migration path.

Every business object has `id`, `workspaceId`, `type`, `schemaVersion`, and optional `deleted: true`. A workspace object's `id` equals its `workspaceId`. Unknown top-level fields are preserved. The file path must agree with the object's identity and workspace. Database membership is immutable but does not participate in the path.

| Object    | Fields                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| workspace | `name`                                                                                         |
| Page      | `title`, `parentId`, `order`, `blocks`, optional `icon`                                        |
| Database  | `name`, `parentId`, `order`, `fields`, optional `icon`                                         |
| Record    | `databaseId`, `properties` keyed by Field ID, `blocks`                                         |
| View      | `type: databaseView`, `databaseId`, `layout`, `visibleFieldIds`, `filters`, `sorts`, `groupBy` |
| Asset     | `filename`, `mime`, `byteSize`, `assetPath`                                                    |

The navigation tree is derived from Page/Database `parentId` and `order`; there is no second authoritative child list. A deleted parent hides its navigation subtree. Database embeds reference `databaseId` and `viewId`; removing an embed does not delete the target. Inline mentions use `type: mention` and a stable `{workspaceId, kind, id}` reference in `props`. Subpages have one authoritative parent; references can point to that page from any number of documents. Titles and Workspace names are mutable labels, never identifiers.

## Blocks

```json
{
  "id": "block_example",
  "type": "paragraph",
  "props": {},
  "content": [{ "type": "text", "text": "Hello", "styles": { "bold": true } }],
  "children": []
}
```

Product blocks are normalized through an editor boundary; persistent values contain no editor instances. Unknown block/inline/style content is represented as an opaque read-only block in the editor and decoded back to its original JSON. Unknown block properties survive edits to known properties. Standard table content uses BlockNote-compatible structured table data in v1.

Image/file URLs use `asset:<assetId>` as the stable reference. The asset resolver supplies ephemeral Blob URLs; these are never serialized. External HTTP(S) resources are not included in a complete local backup unless imported as assets.

## Fields and values

Title/text use strings, numbers use finite JSON numbers, booleans use booleans, select uses Option ID, multi-select uses an Option ID array, and relation uses a Record ID or Record ID array depending on `multiple`. A relation definition has `targetDatabaseId` and is scoped to one Workspace.

Date-only values use `{ "date": "2026-10-22" }`. A future time-aware extension can preserve additional structured fields; the current date input only edits date-only values. Formula and rollup definitions are preserved but not evaluated. Unknown field values remain retained. Removing a field or option never rewrites every Record to discard its values.

Filters are `contains`, `eq`, or `notEmpty` with a Field ID and optional value; the demo UI currently exposes one contains filter. Sorts have a Field ID and `asc`/`desc`; the UI currently exposes one sort. Board grouping supports a select field.

## Local-only data

The host stores business snapshots/revisions, synchronization baselines, committed assets, compact receipts and incremental changes in IndexedDB. Catalog descriptors and personal preferences are separated from business repositories. Connection records own directory handles. Workspace preferences own selection and favorites. None of these appear in business JSON.

Complete ZIP exports contain current-format business files and assets. Import creates a new workspace ID and rewrites every object's workspaceId, preserving object IDs and internal references within the new workspace. Imports do not overwrite another workspace. No historical format compatibility, detection, conversion or warning flow is provided.

## Extension policy

Each host owns a domain registry. Registered types accept exactly their declared version; unsupported versions fail explicitly. Unregistered object types and unknown block/field payloads retain their JSON representation without becoming editable. This opacity supports plugins, not historical formats. No migration API, alternate old layout, or old-data repair is provided.

Prefer additive properties and new registered definitions instead of changing existing field meanings. Object identity and database membership cannot change during an update. New views share existing records; removing a field retains its stored values. Current-format regression fixtures cover these contracts. Tombstones and immutable chunks are not automatically removed.

## Reading export

The separate Markdown ZIP contains `documents/<id>.md` with relative document links and an `assets/` directory. It is a lossy reading projection: rich styles, unknown block payloads, live queries and formulas are not a restorable representation. Use the canonical JSON ZIP for backup/import. The exporter never changes source objects.

## Inline mentions

Rich-text arrays (including table-cell content) support `{ "type": "mention", "props": { "workspaceId": "workspace-id", "kind": "page", "id": "page-id" } }`. `kind` also accepts `database`; record/user targets are not registered. This node is atomic and has no editable title or child content. The same reference object is the value of a `mention` field; `null` clears it. IDs retain their source workspace across copying and JSON export/import. Deleted or unavailable targets do not erase references. Unknown extension content continues to roundtrip opaquely. The former `pageReference` block and page-footer reference summary have been removed without migration.

Markdown export resolves known mention targets to stable relative document links; unavailable references become an explicit unavailable label. JSON remains the lossless export format.
