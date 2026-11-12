# Track network model: current state and a simpler node–edge alternative

Status: implemented. The runtime model is a node–edge graph (`RailNetwork`)
with derived switches, one-way save migration, and `CONFIG.VERSION` 0.7.

**Recommendation: adopt the node–edge model.** It removes one of the three
topology representations entirely, turns the switch into derived data, and
gives trains and signal search a single traversal function. Measured on the
two bundled prebuilds, the converted JSON is roughly 40 % smaller. The main
risk is not the model but the advanced renderer's reliance on stable
`Switch` object identity, addressed in [Risks](#risks).

## 1. How tracks, switches and signals work today

### 1.1 Entities and saved JSON

A real fragment from `app/prebuilds.xml` (layout `1gleisig`, one turnout):

```json
{ "_class": "Track", "id": 4, "start": {"x": 100, "y": 500}, "end": {"x": 300, "y": 500},
  "signals": [], "switches": [null, {"type": "Switch", "id": 0}], "hasBumper": true }
{ "_class": "Track", "id": 3, "start": {"x": 300, "y": 500}, "end": {"x": 450, "y": 350},
  "signals": [], "switches": [{"type": "Switch", "id": 0}, {"type": "Track", "id": 6}], "hasBumper": true }
{ "_class": "Switch", "id": 0, "location": {"x": 300, "y": 500},
  "tracks": [4, 9, 3, null], "branch": 9, "from": 4 }
```

- `Track.allTracks` (`app/code/track.ts`): a straight segment `start`→`end`,
  a nested `signals` array, `hasBumper`, and `switches[2]` — the predecessor
  (`switches[0]`, exposed as `switchAtTheStart`) and successor (`switches[1]`)
  — each `null`, a `Track`, or a `Switch`.
- `Switch.allSwitches` (`app/code/switch.ts`): `location`, `tracks[4]`
  (`track1`/`track2` = the straight pair, `track3` = diverging, `track4` =
  second diverging side of a DKW), plus the mutable route `from`/`branch`.
- `Signal` (`app/code/signal.ts`): saved nested inside its track; the parent
  track is implied. `_positioning` is `{track, km, above, flipped}`, but only
  `km/above/flipped` are written out.
- `Train` (`app/code/train.ts`): saved by raw `coordinates`; on load,
  `Train.restore()` finds its track again via `Track.findTrackByPoint`.
- `RailwayCrossing` (`app/code/railway_crossing.ts`): already references
  tracks as `{trackId, km}` pairs — the only entity that does this.

### 1.2 Topology is stored three times

The same connection is represented by (a) two tracks sharing an endpoint
`Point`, (b) each track's `switches[2]`, and (c) the switch's `tracks[4]`.
Every mutation must patch all three, which is where most of the complexity
lives:

- `Track.createRailNetwork()` runs the repair pipeline
  `pruneStaleConnections → splitTracksAtIntersections → cleanUpTracks →
  createSwitches` after every draw, endpoint drag, and deletion.
- `splitTracksAtIntersections` is two near-identical ~75-line blocks (one
  per track of the pair) that re-point `switchAtTheStart/End`, call
  `Switch.replaceTrackReference`, and re-home signals by `km`.
- `joinTrack`, `splitTrackAtPoint`, `#splitTrackIntoSegments`,
  `#rebuildColinearTracks` and `#pruneStaleConnections` each re-implement
  parts of the same bookkeeping; `STORAGE.linkObjects`
  (`app/code/storage.ts`) re-links everything a second time after loading,
  via temporary `switches_data` / `tracks_id` / `branch_id` fields.
- A switch is almost fully *derived* from geometry (location, incident
  tracks, `type`, `angle`, `track_directions` are all computed in
  `Switch.createSwitch`/`calculateParameters`) yet is persisted as an
  independent object. Its only real state is `from`/`branch`.

Symptoms of the redundancy:

- `AdvancedTrackRendering` tests `track == (track.switchAtTheEnd as any)?.t1`
  — `Switch` has no `t1` property, so that branch can never fire.
- `Signal.search4Signal` contains `index = Math.min(0, index)` when stepping
  onto the next track, which only works incidentally for `length - 1 ≥ 0`.
- After drawing, `TrackBuildInteraction` calls `t.restore()` on *every*
  train, because any track may have been split out from under it.

### 1.3 There is no traversal primitive

"Which track comes next at this end?" is re-implemented per consumer:

- `Signal.search4Signal`: walks `track.signals`, then
  `track.switches[dir == 1 ? 1 : 0]`, resolving a switch via a local
  `getTrackAtBranch` (`from ↔ branch`, otherwise `null` — approaching a
  turnout from the diverging side against the set route finds nothing).
- `Train.moveTrain` / `Train.movementPossible`: the same logic again, with
  `instanceof Track` / `from` / `branch` checks, duplicated for the
  possible-check and the actual move.
- `AdvancedTrackCalculations.getTrackEndOffset`: branches on
  `conn instanceof Switch` vs `Track` vs `null` to size joint curves.

### 1.4 Who reads and writes topology (inventory)

Writers (must keep all representations in sync):

- `Track.checkNodesAndCreateTracks` (drawing, incl. collinear overlap
  repair), `Track.splitTracksAtIntersections`, `Track.cleanUpTracks` /
  `joinTrack`, `Track.removeTrack`, `Track.refreshConnections`,
  `Track.setNewStart/setNewEnd`, `Switch.updateSwitchAtPoint`,
  `Switch.createSwitch`, `Switch.removeSwitch`,
  `Switch.replaceTrackReference`, `STORAGE.linkObjects`.

Readers:

- Traversal: `Signal.search4Signal`, `Train.moveTrain`,
  `Train.movementPossible`, `AdvancedTrackCalculations`
  (`switchAtTheStart/End`, `instanceof Switch/Track`).
- Rendering: `Switch.allSwitches` iteration and `renderedSwitches` identity
  sets in `BasicRendering` and `AdvancedRendererCore`;
  `BasicRendering.renderSwitchUI` (`sw.tracks`, `from`/`branch`,
  `track_directions`); `AdvancedSwitchCalculations` (`track1..4`, `type`,
  `angle`, `slope`); `AdvancedSwitchRendering` (`from`/`branch` arrows);
  `AdvancedTrackRendering` (`switchAtTheStart/End` + the dead `.t1` check);
  `AdvancedSleeperRendering.drawBumper` (`switchAtTheStart/End == null`);
  `RailwayCrossing.kmRangeOnTrack` (same null-checks for margins).
- Hit testing / editing: `EventManager.getHitInfoForSignalPositioning`
  (linear scan of `allTracks`), `Track.findTrackByPoint`,
  `RailwayCrossing.findNearestTrack` / `findAffectedEntries` (linear scans).

File sizes today: `track.ts` 860 lines, `switch.ts` 357, `signal.ts` 292,
`train.ts` 797, `storage.ts` 466 — topology bookkeeping is roughly a third
of `track.ts` and nearly all of `switch.ts`.

## 2. Proposed model: nodes and straight edges

One stored representation: an edge connects two nodes. Everything else —
adjacency, switches, routes — is derived from that plus one small piece of
per-node state.

### 2.1 Saved JSON

The turnout from §1.1 in the new format (grid coordinates unchanged;
`CONFIG.GRID_SIZE` is 50):

```json
{
  "nodes": [
    {"id": 0, "x": 100, "y": 500},
    {"id": 1, "x": 300, "y": 500, "selected": {"4": 9}},
    {"id": 2, "x": 450, "y": 350},
    {"id": 3, "x": 500, "y": 500}
  ],
  "edges": [
    {"id": 4, "a": 0, "b": 1, "bumperA": true, "bumperB": true},
    {"id": 9, "a": 1, "b": 3, "bumperA": true, "bumperB": true},
    {"id": 3, "a": 1, "b": 2, "bumperA": true, "bumperB": true}
  ],
  "signals": [
    {"edge": 4, "km": 80, "above": true, "flipped": false,
     "template": "hv_hp", "stellung": {"hp": 0, "verw": "asig"}, "renderOrder": 0}
  ],
  "trains": [
    {"id": 0, "edge": 4, "km": 120, "color": "#c00", "number": "", "type": "locomotive",
     "coupledBack": 1, "coupledFront": null}
  ],
  "crossings": [
    {"id": 0, "center": {"x": 200, "y": 500}, "entries": [{"edge": 4, "km": 100}]}
  ],
  "objects": [],
  "settings": {"zoom": 1, "scrollX": 0, "scrollY": 0, "renderer": "advanced"}
}
```

- `Node`: `{id, x, y, selected?}`. `selected` maps an entry edge ID to the
  exit edge ID chosen at a junction (§2.3). It is the *only* switch state
  that exists, replacing `Switch.from`/`branch`. (JSON object keys are
  strings; the runtime uses the same record shape, as the code already does
  for `_signalStellung`.)
- `Edge`: `{id, a, b, bumperA, bumperB}` — today's `Track` geometry,
  unchanged: straight, `km` measured from `a`, with the same cached
  `unit/rad/slope/length` getters. Invariant kept from today: `a` precedes
  `b` lexicographically (`x`, then `y`), which renderers implicitly assume.
  `hasBumper` splits per end; bumpers only render at degree-1 ends, exactly
  where `switchAtTheStart/End == null` today.
- `Signal`: top-level, owning edge explicit. No new ID — nothing references
  a signal, so object identity at runtime is enough, as today. `above`/
  `flipped` and the direction derivation in `search4Signal` are unchanged.
- `Train`: `{edge, km}` instead of coordinates — no `findTrackByPoint`
  guessing on load (which today silently picks the first of several
  overlapping collinear tracks).
- Node classification is *derived*: degree 1 = line end, 2 = joint,
  3 = turnout, 4 = DKW/diamond. Nothing about it is stored.

Deleting a whole entity type also deletes its loading pass: no `_class`
reviver linking for topology, no `switches_data`/`tracks_id` temporaries,
no `Switch.counter`.

### 2.2 Runtime structure

A single `RailNetwork` owns the graph and is the only place topology
changes:

- `nodes: Map<number, Node>`, `edges: Map<number, Edge>`,
  `byPoint: Map<string, number>` (`"x,y" → nodeId`) so drawing and hit
  tests reuse nodes instead of scanning all tracks.
- Adjacency (`nodeId → edgeIds`) is a derived cache updated by the only two
  mutators, `addEdge` / `removeEdge`.
- Mutations needed by the whole app: `getOrCreateNode(point)`,
  `addEdge(a, b)`, `removeEdge(edge)`, `splitEdge(edge, point)`,
  `moveNode(node, point)`, `detachEdgeEnd(edge, end, point)`.
  `splitEdge` re-homes signals, trains and crossing entries by `km` — it is
  the single replacement for `splitTrackAtPoint`, both halves of
  `splitTracksAtIntersections`, `#splitTrackIntoSegments` and
  `#rebuildColinearTracks`.
- Signals are grouped per edge in a sorted runtime index (maintained by
  `AddSignal`-equivalent), preserving today's per-track sorted order that
  `search4Signal` steps through.

### 2.3 Derived switches and the one traversal function

`classify(node)` computes, from the incident edges sorted by outgoing
direction:

- the straight-through pair(s): the two edges closest to opposite
  (180° apart);
- for degree 3: `spine` (straight edge on the normalised "left"),
  `straight`, `diverging` — mapped onto the `track1..track4`, `type`,
  `angle`, `slope`, `track_directions` fields renderers already consume,
  so `AdvancedSwitchCalculations` keeps working against a view object;
- for degree 4: both straight pairs are routes; the two "spine-side"
  entries each get a `selected` choice, which reproduces today's DKW
  behaviour where `switch_A_Switch` swaps the left and right sides
  independently (currently via a mouse-X heuristic).

`nextEdge(inEdge, node)` is then total and tiny:

- degree ≤ 1: `null` (line end);
- degree 2: the other edge (straight or 45° kink — same rule);
- junction: `node.selected[inEdge]` if present, else the straight-through
  partner; entering from a non-spine edge always exits via its route
  partner (for a turnout, the spine). Unlike today's `getTrackAtBranch`,
  approaching from the diverging side works regardless of the set route —
  a deliberate small behaviour fix to flag in implementation, since
  `search4Signal` currently cannot cross a turnout that way.

Because routes are pairings of edge IDs, toggling a switch is
`selected[entry] = otherExit` — the `SwitchInteraction` click handler
keeps its shape and loses the `instanceof` cascade.

**Identity caveat:** renderers keep `renderedSwitches` sets and look up
display objects by `Switch` identity (`getGameObjFromDisplayObj(c) === sw`).
A freshly computed view object per call would break incremental rendering
and viewport culling. The network therefore caches one switch-view per
junction node, invalidated when an incident edge changes; the view's
identity is stable while the node exists. This keeps
`AdvancedRendererCore`/`BasicRendering` iteration almost unchanged:
`network.switchViews()` instead of `Switch.allSwitches`.

### 2.4 Which renderer code this touches

- `AdvancedTrackCalculations.getTrackEndOffset`: `conn instanceof Switch /
  Track / null` becomes `connectionKind(edge, end): "none" | "joint" |
  "switch"` from the node's degree — the joint-curve maths is untouched.
- `RailwayCrossing.kmRangeOnTrack` and the two `drawBumper` implementations:
  `switchAtTheStart ? margin : 0` becomes `degree(node) > 1 ? margin : 0`.
- `BasicRendering.renderSwitchUI` / `AdvancedSwitchRendering.renderSwitchUI`:
  read the cached switch-view (`tracks`, `directions`, selected pairs)
  instead of `Switch` fields; unchanged drawing code.
- `AdvancedTrackRendering`: the dead `.t1` branch disappears with the
  switch-view lookup.

## 3. Editing operations, before and after

- **Draw** (`TrackBuildInteraction` → `checkNodesAndCreateTracks` +
  `createRailNetwork` + restore-all-trains): snapped points →
  `getOrCreateNode` per point → one `addEdge` per pair. Interior crossings
  and collinear overlaps are handled by `splitEdge` on both the new and the
  existing edge; drawing exactly over an existing edge is detected as
  "edge already exists between these nodes" and is a no-op. No global
  repair pipeline, no train restore pass — `splitEdge` re-homes the trains
  that were actually on the split edge.
- **Endpoint drag** (`TrackEndpointInteraction`): confirmed semantics —
  normal drag on a shared node *detaches* the dragged edge end onto a new
  node (today's effective behaviour), Shift-drag *moves the node* with all
  incident edges following. On each affected edge, signals/crossings keep
  their distance to the unchanged end, mirroring
  `setNewStart`/`setNewEnd`. If a move would break the `a`-before-`b`
  invariant, swap `a`/`b` and remap `km → length − km` on that edge's
  signals, trains and crossing entries (route state is keyed by edge ID
  and is unaffected).
- **Delete** (`Application.deleteSelectedObject` → `Track.removeTrack` +
  crossing cleanup + `createRailNetwork`): `removeEdge` deletes the edge's
  signals, drops orphaned nodes, and neighbours reclassify automatically.
  Trains on the edge are deleted as today; crossing entries referencing
  the edge are dropped by the same `km`-bearing-reference sweep that
  `splitEdge` uses, replacing `RailwayCrossing.removeTrackReference`.
- **Join/cleanup**: gone as a correctness requirement. Degree-2 nodes are
  harmless — traversal and rendering walk edge by edge — so
  `cleanUpTracks`/`joinTrack` (and their signal-shifting) are deleted.
  Merging collinear edges remains possible as a cosmetic operation later;
  nothing depends on it.
- **Signals**: placement hit-testing (`getHitInfoForSignalPositioning`)
  still scans edges, but returns `{edge, km}` directly; drag-and-drop
  (`signalDrag.ts`) is unchanged apart from the field name. Dependency
  propagation uses `nextEdge` (§2.3).
- **Trains**: `moveTrain`/`movementPossible` collapse into one walk:
  advance `km`, on overflow continue with
  `nextEdge(edge, node)` and carry the remainder (negative at the `a`
  end). One implementation serves both the check and the move; the
  current duplication and its `instanceof` route test disappear.
- **Load/save/undo**: undo already snapshots the JSON string
  (`EditorCommitter` → `STORAGE.getJSONString`), so it follows the new
  format for free.

## 4. Worked examples

Coordinates on the 50-unit grid. Only topology fields shown.

### 4.1 A line drawn in two strokes

Draw `(0,0)→(100,0)`, later `(100,0)→(200,0)`:

```json
"nodes": [{"id":0,"x":0,"y":0}, {"id":1,"x":100,"y":0}, {"id":2,"x":200,"y":0}],
"edges": [{"id":0,"a":0,"b":1}, {"id":1,"a":1,"b":2}]
```

Node 1 has degree 2; `nextEdge` passes through. Today this needs
`cleanUpTracks` to join the tracks (or a persisted track-to-track entry in
`switches[2]`); here nothing happens at all.

### 4.2 Turnout

Edges 4 (west), 9 (east), 3 (north-east) at node 1, as in §2.1.
`classify` finds the straight pair (4, 9); spine = 4.
`selected: {"4": 9}` = straight route (also the default when `selected` is
absent); clicking the switch sets `selected: {"4": 3}`.
Traversal: `nextEdge(4, n1) = 9|3`, `nextEdge(9, n1) = 4`,
`nextEdge(3, n1) = 4`. Old format additionally stored a full `Switch`
object and three `switches` references for the same fact.

### 4.3 DKW (degree 4)

Incident edges W, E (straight pair) and SW, NE (second pair).
`selected: {"W": "E", "SW": "NE"}` is one route set;
`{"W": "NE", "SW": "E"}` the crossed set — toggled per side, matching
today's two independent `from`/`branch` swaps. A plain diamond crossing
has identical geometry; see §6 for why nothing changes here.

### 4.4 Drawing across an existing edge (diamond/crossing point)

Existing edge `(0,0)→(100,100)`; new stroke `(0,100)→(100,0)` crosses it
at `(50,50)`: `splitEdge` on both edges creates node `(50,50)` and four
short edges. Today this is the O(n²) `splitTracksAtIntersections` pass
over all track pairs after every stroke.

### 4.5 Deleting the middle edge of a line

Edges `A—n1—B—n2—C`; delete `B`: its signals are removed, `n1`/`n2` drop
to degree 1 (line ends, bumpers render if `bumperA/B` set). No switch
repair, no re-linking; `A` and `C` are untouched. Today this also runs
`createRailNetwork` over the whole layout.

### 4.6 Junction drag

Node at `(300,500)` with edges west/east/north-east. Normal drag of the
east edge's end to `(350,450)`: the east edge detaches onto a new node;
junction keeps west/north-east (degree 2). Shift-drag: the node itself
moves to `(350,450)` and all three edges stretch; signals on them keep
their distance to their far ends.

### 4.7 Signal search and train crossing a turnout

Signal on edge 4 at `km 80`, next main signal on edge 3. Search steps the
sorted signals of edge 4, then `nextEdge(4, n1)`: with route set to the
branch it continues onto edge 3 and finds the signal — and with route set
straight it correctly continues onto edge 9 instead. A train at edge 4,
`km = length − 5`, moving +20: overflow 15 → `nextEdge` → continues at
`km 15` on the selected edge. Both use the function from §2.3; today each
has its own copy of the route logic, and signal search cannot enter from
edge 3 at all.

## 5. Measured effect on saved JSON

Simulating the conversion of §7 on both bundled prebuilds (same signal and
train payloads, field names as in §2.1):

- `1gleisig`: 42 tracks, 36 distinct endpoints (6× degree 1, 13× degree 2,
  16× degree 3, 1× degree 4), 17 saved switches, 23 signals.
  13,068 bytes → ≈ 7,519 bytes (× 0.58).
- `2gleisig`: 63 tracks, 52 nodes, 32 saved switches, 62 signals.
  26,308 bytes → ≈ 15,961 bytes (× 0.61).

The saving comes from deleting the per-track `switches` arrays and the
whole `switches` list (whose `location` duplicates a track endpoint), not
from shorter geometry. It also stays under the 512 KB upload limit for
proportionally larger layouts.

## 6. Resolved questions

- **Diamond vs. DKW**: indistinguishable from geometry alone (both are
  degree 4 with two straight pairs), and today's code treats every valid
  4-track node as a switchable DKW (`type = DKW` whenever `track4`
  exists). Preserved as-is; making diamonds non-switchable would be a
  separate behaviour change, not part of this simplification.
- **Signal direction**: `above`/`flipped` and the existing derivation in
  `search4Signal` stay; no explicit `dir` field in v1.
- **Bumpers**: old `hasBumper` migrates to `bumperA = bumperB = hasBumper`.
- **Route-state survival**: node objects persist across degree changes
  (2 ↔ 3 ↔ 4), so `selected` survives edits at the same location; a fully
  deleted and redrawn junction resets to straight — matching today's
  recreated `Switch`.
- **Approaching a turnout from the diverging side**: `nextEdge` resolves
  it (route partner = spine) where today `getTrackAtBranch` returns
  `null`. Behaviour improvement, to be called out in release notes of the
  implementation, not silent.

## 7. Migration design (implementation phase)

One-way upgrade, confirmed: old saves load and convert; saving always
writes the new format.

- **Detection**: a parsed save without a `nodes` array is old format. This
  single check in `STORAGE.loadFromJson` covers all three entry points —
  the `VERSION;JSON` localStorage string, downloaded XML files, and
  `prebuilds.xml`. Bump `CONFIG.VERSION` (`"0.6"`) when new saves ship.
- **Conversion** (in memory, before any linking):
  1. Point-key map over every old track `start`/`end` → nodes, coordinates
     preserved exactly. One edge per old track, `a = start`, `b = end`
     (old tracks already satisfy the ordering invariant), so every `km`
     in the file stays valid unchanged. `bumperA = bumperB = hasBumper`.
  2. Route state: for each old `Switch`, find its node by `location` and
     set `selected[from] = branch`, mapping old track IDs through the
     old-ID → edge-ID table; for a DKW, the second entry pairs the
     remaining two edges, as implied by today's `from`/`branch` swap
     logic in `switch_A_Switch`.
  3. Signals nested in old tracks become top-level `{edge, km, above,
     flipped, template, stellung, renderOrder}` (`migrateRenderOrder`
     semantics preserved).
  4. Trains: only coordinates exist, so resolve each car exactly as
     `Train.restore()` does today (containing edge, `km` from point),
     then store `{edge, km}`; coupling IDs carry over.
  5. Crossings keep `{km}` with `trackId` renamed to the mapped edge ID;
     generic objects and settings pass through.
  6. Fresh sequential node/edge IDs — all references are internal to the
     file, so no ID-preservation pass is needed.
- **Failure behaviour**: convert into a detached structure first; only
  swap it in on success, leaving the current layout and showing the
  existing error toast otherwise (today a half-linked load can proceed
  with warnings).
- After conversion the model is indistinguishable from a native layout;
  undo snapshots only new format from the first post-migration commit.

## 8. Risks

- **Switch-view identity** (§2.3): the one place the new model must
  deliberately keep an object cache; getting invalidation wrong shows up
  as stale switch rendering, not data loss. Mitigation: invalidate on any
  incident-edge mutation, which is centralised in `RailNetwork`.
- **Advanced joint curves**: `AdvancedTrackCalculations` sizes curves at
  track-to-track joints; degree-2 kink nodes must keep producing "joint"
  connections (they do — `connectionKind` by degree), but this renderer
  path deserves the closest review since it reads `switches[]` most
  indirectly.
- **Collinear drawing edge cases**: `checkNodesAndCreateTracks` has grown
  cases (extend, fill gap, rebuild overlapping). `splitEdge` plus
  edge-exists detection must cover them; the two prebuilds and a layout
  redrawn over itself are the natural regression fixtures (build/lint
  verification only — the repo has no test suite; `npm test` is a stub).
- **`a`/`b` reordering on endpoint drag** remaps `km` on one edge only;
  centralised in the network mutator so signals, trains and crossings
  cannot drift apart (today they can: `setNewStart` shifts signals but
  `RailwayCrossing.refreshAfterTrackGeometryChange` is a separate call
  the interaction must remember to make).

## 9. Estimated code effect (implementation phase)

Rough, based on current file sizes; treat as ±30 %:

- `track.ts` (860) + `switch.ts` (357): replaced by an edge type with the
  existing geometry getters (~200 lines, mostly moved) and `railNetwork.ts`
  (~250: maps, mutators, `splitEdge`, `classify`, `nextEdge`). The split /
  join / cleanup / prune / switch-repair block (~450 lines across both
  files) is deleted, not rewritten.
- `storage.ts` (466): `linkObjects` and reviver linking (~60) deleted;
  migration converter (~140) added; net ≈ +60 in the migration release,
  removable once old-format support is dropped.
- `signal.ts`: `search4Signal` traversal ~45 → ~25 lines.
- `train.ts`: move/possible/restore traversal ~80 → ~45 lines.
- Renderers: field access renames plus `connectionKind`; `BasicRendering`
  switch drawing is data-identical via the view. Net ≈ neutral, minus the
  dead `.t1` branch.
- Interactions: `TrackBuildInteraction` loses the repair + restore-all
  calls (~−20); `TrackEndpointInteraction` gains the detach/move-node
  distinction (~+20); `SwitchInteraction` unchanged in shape.

Net: roughly 400–700 fewer lines overall, with the remaining topology
logic concentrated in one file instead of spread over five.

## 10. Suggested implementation phases (separate plan)

1. `Node`/`Edge`/`RailNetwork` + JSON save/load + old-format migration;
   renderers fed through the cached switch-view so this lands behind one
   internal interface.
2. Editing interactions onto network mutators (draw, endpoint drag with
   detach/Shift-move, delete); remove `createRailNetwork` call sites.
3. Traversal consumers (`search4Signal`, train movement, crossing
   margins, hit testing) onto `nextEdge`/`connectionKind`.
4. Delete `Switch`, `Track.switches[]`, `linkObjects` remnants and the
   repair pipeline; bump `CONFIG.VERSION`.
5. Verification per phase: `npm run build` and `npm run type-check`
   (the repo has no automated tests), plus loading both prebuilds and a
   pre-migration localStorage save as fixtures.
