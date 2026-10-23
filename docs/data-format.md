# Data contract v1

Canonical files are UTF-8 JSON with recursively sorted keys, two-space indentation and a final newline. Array order is meaningful. IDs must match `[A-Za-z0-9_-]+` and do not depend on display names.

```text
workspaces/<workspaceId>/
  workspace.json
  pages/<pageId>.json
  dataworkspaces/<databaseId>/
    schema.json
    views/<viewId>.json
    records/<recordId>.json
  assets/<assetId>.json
  assets/<assetId>.<extension>
  objects/<unknownObjectId>.json
```

Every business object has `id`, `workspaceId`, `type`, `schemaVersion`, and optional `deleted: true`. A workspace object's `id` equals its `workspaceId`. Unknown top-level fields are preserved. The file path must agree with the object's identity, Workspace and database membership.

| Object    | Fields                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| workspace | `name`                                                                                         |
| Page      | `title`, `parentId`, `order`, `blocks`, optional `icon`                                        |
| Database  | `name`, `parentId`, `order`, `fields`, optional `icon`                                         |
| Record    | `databaseId`, `properties` keyed by Field ID, `blocks`                                         |
| View      | `type: databaseView`, `databaseId`, `layout`, `visibleFieldIds`, `filters`, `sorts`, `groupBy` |
| Asset     | `filename`, `mime`, `byteSize`, `assetPath`                                                    |

The navigation tree is derived from Page/Database `parentId` and `order`; there is no second authoritative child list. A deleted parent hides its navigation subtree. Database embeds reference `databaseId` and `viewId`; removing an embed does not delete the target. Page references use `type: pageReference` and `props: { pageId }`. Subpages have one authoritative parent; references can point to that page from any number of documents. Titles and Workspace names are mutable labels, never identifiers.

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

## Evolution

`ObjectRegistry` migrations advance exactly one version at a time and must preserve identity. Migration runs on a cloned object; repeated decoding is idempotent. Current types are v1, so no historical migration is fabricated. Unknown/newer versions retain raw fields and remain read-only when unsupported. Tombstones are not automatically removed.

### Compatibility rules

- Prefer additive optional properties, new registered types and new field/block definitions over changing the meaning of existing fields. A new optional capability does not require rewriting every object or increasing the version of unrelated types.
- Missing optional properties get runtime defaults. Unknown properties, block payloads, field definitions and values survive roundtrips. Unsupported content is read-only, not converted to a lossy approximation.
- A semantic breaking change needs an explicit per-type version and a tested sequential migration. Older clients must preserve newer objects without writing them. A schema version is not the application release version.
- Stable IDs, per-object files and provider-independent payloads remain invariant. New database views share existing records; adding a field does not rewrite old records.
- Keep regression fixtures and roundtrip tests for every historical format once one exists. These rules reduce migrations; they cannot make arbitrary future breaking changes migration-free.

## Reading export

The separate Markdown ZIP contains `documents/<id>.md` with relative document links and an `assets/` directory. It is a lossy reading projection: rich styles, unknown block payloads, live queries and formulas are not a restorable representation. Use the canonical JSON ZIP for backup/import. The exporter never changes source objects.
