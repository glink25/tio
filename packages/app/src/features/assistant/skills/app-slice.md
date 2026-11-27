Use an App Slice for a focused interface over Tio pages or databases. Start with the smallest useful interaction. Use native HTML controls, responsive CSS, readable status, and touch support. Tio loads window.tio before the script. Keep the HTML self-contained; local rendering needs no external resource grant.

Identify the page and the visible data: create or reuse a database, define typed fields, and insert a direct database mention or databaseView block on the page. ID relationships, not parent nesting, grant scope. Read the rich block schema through tio_operations first. To add an App Slice use blocks.insert with an appSlice block, stable ID, props {title, html, runtimeVersion:1, height, autoHeight}, empty content and children. For an existing App Slice use blocks.update on the same block ID with changes.props.html. Keep other props and the existing data references. Use pages.update appMode only when requested or appropriate for a page dedicated to the app; the first App Slice fills that page.

App Slice SDK v1: await tio.context.get() for theme and permissions; await tio.databases.list() for accessible database IDs; tio.databases.get(id) returns a handle. Use await table.records.query({limit,cursor,sorts}) and follow nextCursor. Read and write properties by field ID. Use the page's existing direct reference or add one in the same blocks.insert operation. Use await table.records.create(properties,{requestId}), update(id,properties,version,{requestId}), or delete(id,version,{requestId}). Changes are locally committed through the runtime. Reuse the same requestId and payload on TIMEOUT; read the latest version to resolve CONFLICT. Use tio.subscribe(listener) to refresh on external changes and avoid writes in the listener. The default grant is read-only. Only request a readWrite grant when app interactions need it, via tio_app_permission and user confirmation.

When an App Slice fails, call tio_app_permission with only id and blockId. Read diagnostic.error.reason if status is observed. A not_observed result means the current live code has no captured SDK failure. Use the actual error the user sees if provided.

- slice_read_only or host_permission: check the instance grant, SDK context and workspace access before requesting a grant change.
- database_out_of_scope: inspect the page's direct database mentions and embedded views. Reuse the needed reference and preserve the block ID.
- field_unavailable: compare the actual payload keys built by the save function against the readable field IDs. Correct missing mappings such as an undefined key. Avoid silently dropping fields or trying alternate SDK signatures.
- version_mismatch: re-read and reconcile before retrying. The query and get versions are both valid for an unchanged record in the same App Slice session. If a controlled test shows query's version consistently fails while get's version works on the same unchanged record, report an SDK defect; on an affected build, read with get immediately before that update or delete. Do not infer stale grants from a version conflict.

Trace the failing UI action to its actual save function. A direct SDK call with a hand-built payload checks the SDK only. A successful blocks.insert/update means the code was published. Report which of publication, the actual save function, and real user interaction were verified. Real interaction requires running the published UI and observing its effects in the intended table after reload. If unavailable, state the missing check without claiming success. Use isolated data for probes rather than writing diagnostic records into a user's application tables.

For substantial code, use the Playground and its conversation-local async fs when available. If typeof fs is undefined, use the same Tio operations with inline HTML. Keep snippets in files such as slice.html and use fs.replace(path, oldText, newText) for exact, unique edits. When reading an existing Slice, run tools.tio_read({operation:'objects.get', input:{id:pageId}}) inside the Playground, find the target block recursively in result.value.object.blocks, and write only its HTML to a file with fs.write. Return IDs and a short status to the model. For publishing, get the current version and check the live HTML against a saved baseline before updating. If someone edited it since import, reconcile first. For new apps, join any HTML, CSS and script fragments into one inline document inside the Playground. Pass the resulting string directly into a tool call. For example, inside an async default export:

```js
const response = await tools.tio_write({
  operation: 'blocks.update',
  requestId,
  input: {
    id: pageId,
    blockId,
    version,
    changes: { props: { html: await fs.read('slice.html') } },
  },
});
return { status: response.status, error: response.error };
```

Use the same approach with blocks.insert for a new block. Keep full HTML out of the return value. Keep the original requestId if the write outcome is uncertain. App Slice code runs in its own iframe; its external resource permission stays independent of the assistant's nativeFetch tool.
