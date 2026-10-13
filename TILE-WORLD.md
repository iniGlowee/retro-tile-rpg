# Tile world + click-to-move — an engine-agnostic spec

The world-and-movement half of the classic tile-RPG recipe: a **tile-region** data model
with directional collision, and **point-and-click movement** (click a tile → route →
smooth walk). This is portable technique — algorithms, data shapes, coordinate math. No
game data is embedded.

> A ready, verified three.js implementation of everything here is the companion repo
> [**three-pointclick**](https://github.com/iniGlowee/three-pointclick) (BFS mover,
> interaction menu, click marker, cursor). This document is the *why* behind it, for
> porting to another engine or rolling your own.

## 1. The tile-region data model

A **region** is a grid of tiles, optionally stacked in a few planes (floors). Pick a world
scale — one tile = one world unit is simplest. Per tile (per plane), store:

| field | type | meaning |
|---|---|---|
| `height` | number | corner height — build the ground mesh from the four corners of each tile |
| `colour` | RGB / id | ground colour (an underlay, optionally an overlay drawn on top) |
| `clip` | bitmask | collision: blocked + directional walls (below) |

**Clip bitmask** — one integer per tile. `BLOCKED` = the whole tile is unwalkable; the
wall bits mean "there is a wall on this edge of this tile." The exact bit *values* are
arbitrary — pick any layout; what matters is the set:

```
BLOCKED
WALL_N  WALL_S  WALL_E  WALL_W            // straight walls, one per edge
WALL_NE WALL_NW WALL_SE WALL_SW           // (optional) diagonal/corner walls
```

### Populating `clip` from object placements

When you place an object on the grid (id, tile, type, orientation, footprint
`width × length`), stamp clip flags:

- **Walls** stamp a directional wall on **both** the object's tile and the neighbour it
  faces — a wall is symmetric. A west-facing wall on tile *T*: `T |= WALL_W` and
  `T.west |= WALL_E`. Corner/L walls stamp two edges.
- **Scenery / props** stamp `BLOCKED` across the whole `width × length` footprint (swap
  width/length when the orientation is rotated an odd number of quarter-turns).
- Only **solid, non-walkable** objects block — skip decorative / walk-under ones.

A region's clip grid is a plain typed array per plane: cheap to build at load, cheap to
query.

## 2. Traversability test

Moving between adjacent tiles checks flags on **both** endpoints (a wall blocks
symmetrically). For a size-1 entity:

```
canStep(from, dir):
  to = from + delta(dir)
  if to out of bounds: return false
  N: return !(clip[to] & (BLOCKED | WALL_S))    // entering to's south edge
  S: return !(clip[to] & (BLOCKED | WALL_N))
  E: return !(clip[to] & (BLOCKED | WALL_W))
  W: return !(clip[to] & (BLOCKED | WALL_E))
  // diagonals: BOTH orthogonal steps clear AND the corner tile's two facing edges
  //            (this is the no-corner-cutting rule)
  NE: return canStep(from,N) && canStep(from,E) && !(clip[to] & (BLOCKED|WALL_S|WALL_W))
  NW: return canStep(from,N) && canStep(from,W) && !(clip[to] & (BLOCKED|WALL_S|WALL_E))
  SE: return canStep(from,S) && canStep(from,E) && !(clip[to] & (BLOCKED|WALL_N|WALL_W))
  SW: return canStep(from,S) && canStep(from,W) && !(clip[to] & (BLOCKED|WALL_N|WALL_E))
```

For a size-N entity, require the test to hold across the whole N-wide leading edge.

## 3. Click-to-move

Keep the **three-role split**, even in a single-player build — it's what makes the motion
feel deliberate rather than slidey:

- **Intent (input):** a click yields a destination tile. Clamp the distance and drop it if
  nothing nearby is reachable.
- **Simulation (authoritative):** compute a route and hold a **step queue**; advance it on
  a fixed tick (1 tile/tick walking, 2 running). The tick rate is yours — the algorithm is
  tick-rate-agnostic.
- **View (render):** interpolate the avatar smoothly between the last and next tile each
  frame; play walk/run/turn animations. Never move the avatar straight from a click —
  always through the queue.

### Route-finder (breadth-first flood fill)

```
route(start, dest):
  if chebyshev(start, dest) > REGION_SIZE: return []          // sanity cap
  via  = grid, the direction each tile was reached from
  seen = {start};  queue = [start];  via[start] = SENTINEL
  while queue not empty:
    cur = queue.popFront()
    if cur == dest: found = true; break
    for dir in [N,S,E,W, NE,NW,SE,SW]:         // orthogonals FIRST, then diagonals
      nxt = cur + delta(dir)
      if nxt in seen or not canStep(cur, dir): continue
      via[nxt] = dir; seen.add(nxt); queue.pushBack(nxt)

  if not found:                                // nearest-reachable fallback
    pick the reached tile nearest dest (min squared distance) in a small box
    if none: return []                         // truly unreachable

  backtrace via[] from the end to start, emitting the tiles
  return the path
```

Signature behaviours to preserve: **no corner-cutting**, **nearest-reachable fallback**
("walk as close as possible"), and exploring orthogonals before diagonals (BFS on an
8-connected grid gives shortest tile paths this way). You can compress straight runs on the
backtrace into turn-points to keep the queue small.

### Step queue + interpolation

```
tick():                         // fixed timestep
  if queue.empty: return
  steps = running ? 2 : 1
  repeat steps: prevTile = tile; tile = queue.popFront(); facing = dir(prevTile -> tile)
  animTimer = 0

frame(dt):                      // every render frame
  animTimer += dt / tickDuration
  pos = lerp(prevTile.center, tile.center, clamp(animTimer, 0, 1))
  avatar.setPosition(pos, groundHeightAt(pos))     // bilinear sample of tile-corner heights
  avatar.setYaw(facing); avatar.play(running ? runClip : walkClip)
```

Ground height under the avatar is a **bilinear sample of the four tile-corner heights** —
the same heights that built the ground mesh — so the avatar hugs slopes.

## 4. Rendering notes

If you're coming from a software/painter's renderer, a modern GPU engine does the hard
parts for free: **drop** the painter's tile walk, depth/priority face sorting, and scanline
rasterizer — the z-buffer and frustum culling handle all of it. **Keep** three things that
are gameplay/aesthetic, not rasterization:

1. **The look** — HSL-Gouraud flat shading (see the [README](README.md) + `retro-flat-material.js`).
2. **Roof removal** — hide upper-plane geometry above the avatar when indoors.
3. **Wall face-culling by orientation** — matches the oriented wall data from §1.

## Deferred / optional

Projectile line-of-sight (reuse the flags with an "impenetrable" variant), multi-plane
transitions (bridges/stairs — a plane-change flag), overlay tile *shapes* (diagonal
water/path edges), and walk-to-interact pathing (the same route-finder with a target
footprint).

---

*Portable technique only — no game maps, data, or cache bytes. The exact collision/movement
behaviour of the classic clients is documented by the community (OpenRS2, RuneLite); this is
the engine-agnostic reduction. MIT.*
