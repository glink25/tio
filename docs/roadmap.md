# Roadmap

## Demo baseline

Offline and Local Folder modes, local persistence, typed merge/sync, block documents, embedded databases, table/board/detail, basic relations, ZIP backups, bilingual UI, PWA and project tooling.

## Next milestones

1. Complete the native-folder and real-device checklist in `verification.md`.
2. Extend the existing named-view, filter and field-visibility controls with richer queries and date/time editing. The current project has one accepted format and no historical migrations.
3. Add conflict-recovery browsing alongside the existing trash UI; establish tombstone and chunk retention before any remote cleanup.
4. Add GitHub adapter/provider after deciding authentication and repository selection. Keep Git internals out of core.
5. Add deterministic formula and rollup evaluators with dependency/cycle handling.
6. Build on indexed incremental host reads and bounded command history with indexed search, paged record queries and real-device workspace profiling.

Real-time collaboration would be a separate protocol/module; the file snapshot engine does not claim CRDT guarantees.
