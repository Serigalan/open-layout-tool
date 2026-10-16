# merge — comparing and merging states of a project

`src/core/utils/merge/` · needs `project`, `track`, `survey`, `geometry`

Three-way merge of two states of a project against the state both came from, the diff behind it, carrying
references across splits and joins of tracks, and drawing a comparison on the map. Pure, without a DOM: the
browser merges when checking in over a stale base or merging variants; the module also loads and runs under
plain Node (a test holds it to that), as everything the project server might share has to.

## Files

| File | What it does |
|---|---|
| `collections.js` | What a record is made of for merging: the collections and their keys, fields, canonical comparison, labels |
| `diff.js` | `diffProject`, `diffEntries`: what changed between two dehydrated states |
| `merge.js` | `mergeProject(base, mine, theirs)` → merged record, conflicts, warnings, what was applied; `resolve` |
| `remap.js` | Carrying a reference across a change of track ids, by geometry |
| `compareLayer.js` | Two states on the map: new green, changed orange, gone grey dashed; a conflict as each side has it |
| `index.js` | The module's public interface |

## The unit of merging

A record is the **dehydrated** project — only primary data; derived geometry neither counts as a change nor
rides into the result. Collections are compared by id:

| Collection | Key | Merged as |
|---|---|---|
| `tracks` | `id` | field by field; `elements` and `heights` are one field each (elements have no ids) |
| `switches` | `switchId` | field by field; `ports` is one field |
| `platforms` | `id` | field by field |
| `kmLines` | `lineNumber` | whole object |
| `endMarks`, `axisSurveys`, `referenceAxes`, `routes` | `id` | whole object |

The project's own fields (title, settings, plan header, image hash …) are merged field by field too.

## The rules

1. Compare collections by id: added, removed, changed.
2. Merge field by field: different fields changed on the two sides → both taken; the same field changed
   differently → conflict; changed alike → no conflict.
3. Deleted against changed is always a conflict.
4. Apply id remaps: splitting and joining give pieces new ids; the working copy logs them as
   `{ from, to: [ids] }`, and the merge carries the other side's references over.
5. Validate the result (`project/validateProject`); an error the merge brings in is a conflict on the object,
   decided by taking the whole object from one side (`object:<collection>:<id>`), after which it is validated
   again. Warnings it brings in (e.g. a track drawn on both sides) are listed.

**Nothing repairs.** Where both sides changed the same thing differently it is a conflict, decided by choosing
a side, never by mixing. The merged record is dehydrated; whoever adopts it hydrates it.

## Remapping by geometry

The id log says which pieces an old track became, not which piece a given point went to — and it does not
have to: the pieces lie exactly where the old track lay. A switch port or end mark on `a.END` goes to the piece
one of whose ends is where `a`'s end was; a platform goes to the piece on which both its stations lie (at the
stations there, with the side swapped if that piece runs the other way); a route's track is replaced by the
pieces in order along it. That holds over any number of splits and joins, which a table of offsets would have
to replay one by one.

## Decisions

- **The track is the unit**, elements and heights one field each.
- **Only dehydrated records are versioned and merged**; the result is validated, a violation is a conflict.
- **Remaps by geometry**, not by stored offsets.
- **The browser merges** (the server only takes revisions on the current head and checks them), so no result
  is stored that no user has seen.

## Tests

`merge.test.js` (incl. the diff, the plain-Node load and the PEK data set) and `remap.test.js`.
