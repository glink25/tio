# Database fields

Database property definitions live in `Field`; record values live in `TioObject.properties`.
The schema is new and intentionally does not accept the former `{ date }` date representation.

- Dates use `{ start, end?, timeZone? }`. Date-only values use `YYYY-MM-DD`; timestamps include an offset. The editor defaults to the browser's IANA time zone, rejects DST gaps and invalid intervals, and stores the zone with timed values. Calendar days/months/years preserve wall time; hours/minutes represent elapsed time.
- Files use an ordered, unique array of `asset:<id>` references. Metadata and bytes use the existing workspace asset pipeline. Each file is limited to 20 MB. Removing a property reference never deletes a shared asset.
- Select/multiselect/status values contain stable option IDs. Options have an optional color; status options also have `todo`, `doing` or `done` groups. Formula references to these properties resolve their labels.
- Relations contain record IDs (an array by default, a scalar when `multiple: false`). They are single-direction, target one database in the same workspace, and ignore missing/deleted records during calculation while preserving missing references for display.
- Formula definitions store a canonical `formula` expression whose `prop(...)` calls refer to stable field IDs. `compileFormula` resolves user-entered names and rejects ambiguous names. `formulaSource` displays current names when editing. Duplicate names can be selected explicitly through the insertion menu.
- Rollups configure `{ relationFieldId, targetFieldId, operation }` in `Field.rollup`. Numeric/date aggregations validate the target field and the actual calculated values. Empty sums/counts return zero; empty averages/extrema return null.
- Created/last-edited time properties read `createdAt`/`updatedAt` metadata. Runtime commands capture one timestamp before queuing; replay never obtains a new time. Property/body edits and undo update the modification time. Recalculation does not write metadata.

`createEvaluator(objects, now)` provides cached, typed `read`, display-oriented `value` and nonpersistent `project` operations for an immutable workspace snapshot. Formula and rollup failures return explicit errors. Cycles and excessive dependency depth are bounded. All views and database queries use the same evaluator. Empty/error results sort last; errors do not satisfy value filters.

Formula syntax supports JSON literals, parentheses, unary `!`/`not`/`+`/`-`, arithmetic, comparisons, `and`/`or`/`&&`/`||`, and these functions:

- `prop`, `if` (lazy branches), `empty`, `format`, `toNumber`
- `abs`, `round`, `floor`, `ceil`, `min`, `max`
- `concat`, `length`, `contains`, `replace`, `lower`, `upper`
- `dateStart`, `dateEnd`, `dateAdd`, `dateBetween`, `formatDate`, `now`, `today`

Date units are `minutes`, `hours`, `days`, `weeks`, `months`, `years`. `formatDate` supports `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`. Time-dependent calculations refresh every minute while the document is visible. This is a restricted interpreter, without JavaScript execution or complete Notion Formula 2.0 compatibility.

Editors stage values locally and commit on Done/Enter; Escape cancels a cell overlay. Field types remain locked after creation. Derived fields reject writes, including null, at the registry/command boundaries. Generic record patches and checked transactions receive the same property and reference validation as direct cell edits.
