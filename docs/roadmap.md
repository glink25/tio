# Roadmap

## Demo baseline

Offline and Local Folder modes, local persistence, typed merge/sync, block documents, embedded databases, table/board/detail, basic relations, ZIP backups, bilingual UI, PWA and project tooling.

## Next milestones

1. Complete the native-folder and real-device checklist in `verification.md`.
2. Add saved view management, richer filter controls, field visibility controls and date/time editing using additive v1 extensions where possible; reserve explicit migrations for breaking semantic changes.
3. Add recovery browsing and optional trash UI; establish tombstone retention before any remote cleanup.
4. Add GitHub adapter/provider after deciding authentication and repository selection. Keep Git internals out of core.
5. Add deterministic formula and rollup evaluators with dependency/cycle handling.
6. Add indexed search, incremental store subscriptions and larger workspace profiling.

Real-time collaboration would be a separate protocol/module; the file snapshot engine does not claim CRDT guarantees.
