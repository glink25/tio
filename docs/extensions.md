# Instance-scoped extensions

The pure domain and presentation extensions are separate. Neither the domain nor synchronization imports React or BlockNote.

```ts
const domain = createDomain();
domain.objects.register({ type: 'counter', currentVersion: 1, validate, merge });
domain.fields.register({ type: 'rating', validate: isRating });
const repository = new MemoryRepository(access, domain);
const runtime = await WorkspaceRuntime.open(repository, access, domain);
const content = new FileWorkspaceContent(files, workspaceId, { types: domain.objects });
const sync = new HostSyncRunner(repositoryWithSyncState, content, endpoint, workspaceId, {
  types: domain.objects,
});
```

Configure definitions before opening a session. Pass the same domain to the host and editing runtime; pass its object registry to the file codec and synchronizer. Across a native bridge, each process independently registers the same semantic definitions. Functions are never serialized over the bridge.

A registered object validator runs during command execution, direct host commits, file encoding and decoding. A custom object merge receives the base and two branches, returns a complete logical object plus warnings/recovered values, and must preserve identity and validate against its definition. Merge functions must be deterministic and symmetric in the two branches. Unregistered types retain their JSON payload and remain uneditable. Registered types accept exactly their declared schema version. There are no migration callbacks or historical readers.

Field definitions validate values at the host boundary, including callers that bypass the editor. UI validators are not the authority. Unknown fields retain their payload; adding a presentation renderer alone does not establish a custom value contract. Schema and records may arrive separately through file synchronization; absent schema is not fabricated. A database-backed server may enforce stronger relational transaction constraints.

`mountEditor` accepts `domain`, `extensions` and `views`:

- `extensions.schema`: the instance's BlockNote schema. Extend `defaultEditorSchema` so built-in embedded references and the opaque `unsupported` block remain available.
- `extensions.codecs`: block-type mappings with `accepts`, `toEditor`, `fromEditor`. A codec explicitly owns custom inline/style content within its block. Unknown nested content without a codec remains an opaque block and roundtrips exactly.
- `extensions.slashItems(editor)`: additional slash commands for the configured schema.
- `views.fields[type]`: label, field input component and localized display function. The field type appears in the property editor.
- `views.layouts[name]`: label and a component receiving the common filtered/sorted rows and edit handlers. The layout appears in view settings. Missing layouts render as unsupported instead of silently becoming tables.

The current AST uses BlockNote-compatible tables. This is an explicit format boundary, not a claim that every future BlockNote schema will deserialize identically. `tests/editor-codec.test.ts` and the browser table test guard unknown nested inline/style preservation and table edits. `tests/extensions.test.ts` guards independent domains and validators through commands, commits and files.

Workspace packages currently export TypeScript source for monorepo consumers. The standalone editor production bundle is a browser embedding artifact, not a published npm SDK with declarations and semver guarantees. Public SDK packaging and third-party plugin distribution are separate release work.

The built-in `webSlice` block provides page-scoped HTML applications with host-owned permissions. Custom editor schemas should extend `defaultEditorSchema` to retain it. See [Web Slice SDK and embedding](web-slice.md).

The default `codeBlock` spec includes common-language highlighting and Mermaid Code/Preview/Split modes. Extend the default schema to retain these controls. `displayMode` is a normal persisted block prop; read-only view changes stay local. See [code blocks and Mermaid](code-blocks.md) for lazy-loading and export behavior.
