// DUSTLINE Sector 7 — the map. An original layout: attacker spawn in the south,
// two bombsites in the north (A Foundry west, B Yard east), a mid block that splits
// the map into three lanes, and crates/containers for cover and corners.
// All geometry is data here; main.js turns it into three.js meshes. Collision,
// line of sight and bullet blocking are pure 2D math on the same data, so the
// simulation never depends on the renderer.
//
// Coordinates: x east, z south, metres. The arena is x in [-32, 32], z in [-22, 22].
// A wall is { x, z, w, d, h, kind } centred at (x, z), w along x, d along z.

export const ARENA = { minX: -32, maxX: 32, minZ: -22, maxZ: 22 };

// Walls high enough (>= 1.5) to block sight and bullets; low crates block movement
// only, so you can shoot over them from standing height.
export const WALLS = [
  // Perimeter (h 4.5)
  { x: 0, z: -22.5, w: 66, d: 1, h: 4.5, kind: 'wall' },
  { x: 0, z: 22.5, w: 66, d: 1, h: 4.5, kind: 'wall' },
  { x: -32.5, z: 0, w: 1, d: 46, h: 4.5, kind: 'wall' },
  { x: 32.5, z: 0, w: 1, d: 46, h: 4.5, kind: 'wall' },
  // Mid block: the big foundry hall that splits mid into left/right lanes.
  { x: 0, z: -4, w: 12, d: 8, h: 4.5, kind: 'wallDark' },
  // Mid pillars (corners to play around).
  { x: -8, z: 4, w: 2, d: 2, h: 4.5, kind: 'wall' },
  { x: 8, z: 4, w: 2, d: 2, h: 4.5, kind: 'wall' },
  // A-long wall: forces the west lane into a chokepoint before site A.
  { x: -18, z: -10, w: 2, d: 10, h: 4.5, kind: 'wall' },
  { x: -24, z: -6, w: 8, d: 2, h: 4.5, kind: 'wallDark' },
  // B-long wall: the east lane's corner.
  { x: 18, z: -8, w: 2, d: 12, h: 4.5, kind: 'wall' },
  { x: 24, z: -2, w: 8, d: 2, h: 4.5, kind: 'wallDark' },
  // Connector wall between the lanes, north of mid.
  { x: 0, z: -14, w: 10, d: 2, h: 4.5, kind: 'wall' },
  // South cover near attacker spawn.
  { x: -12, z: 14, w: 6, d: 2, h: 4.5, kind: 'wallDark' },
  { x: 12, z: 14, w: 6, d: 2, h: 4.5, kind: 'wallDark' },
  // Site A crates (low: shoot over, hide behind while crouched).
  { x: -24, z: -16, w: 3, d: 3, h: 1.2, kind: 'crate' },
  { x: -19, z: -18, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: -27, z: -12, w: 2, d: 2, h: 2.4, kind: 'containerA' },
  // Site B containers.
  { x: 24, z: -16, w: 4, d: 2, h: 2.6, kind: 'containerB' },
  { x: 19, z: -18, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 28, z: -12, w: 2, d: 2, h: 2.4, kind: 'containerA' },
  // Mid crates.
  { x: -4, z: 8, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 4, z: 8, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 0, z: 16, w: 3, d: 2, h: 1.2, kind: 'crate' },
  // A-site back wall nook.
  { x: -28, z: -19, w: 2, d: 2, h: 2.4, kind: 'containerB' },
];

export const SITES = {
  A: { x: -23, z: -16, r: 6.5, label: 'A — FOUNDRY' },
  B: { x: 23, z: -15, r: 6.5, label: 'B — YARD' },
};

export const SPAWNS = {
  attacker: { x: -26, z: 17, yaw: -1.0 }, // faces north-east, into the map
  defenders: [
    { x: -22, z: -14, yaw: Math.PI * 1.05 }, // A anchor
    { x: -14, z: -18, yaw: Math.PI * 1.3 },  // A long
    { x: 22, z: -13, yaw: Math.PI * 0.7 },   // B anchor
    { x: 6, z: -2, yaw: Math.PI * 0.5 },     // mid roamer
  ],
};

// Waypoint graph bots walk on: id -> { x, z, edges[] }. Bots pathfind with BFS.
// Every edge is a clear straight walk: no wall AABB (expanded by the bot's
// radius) crosses the segment. Verified with work/check-edges.mjs — keep it
// that way when the map changes: a blocked edge strands a bot against a wall.
export const WAYPOINTS = [
  { id: 0, x: -26, z: 17, edges: [1] },         // attacker spawn
  { id: 1, x: -26, z: 10, edges: [0, 2, 5] },   // south-west corner
  { id: 2, x: -16, z: 10, edges: [1, 3, 5] },   // west lane south
  { id: 3, x: -14, z: 2, edges: [2, 4, 7] },    // west lane
  { id: 4, x: -14, z: -12, edges: [3, 8, 17] }, // A approach (west of the A wall)
  { id: 5, x: 0, z: 12, edges: [1, 2, 6, 11] }, // mid south
  { id: 6, x: 16, z: 10, edges: [5, 9, 10] },   // east lane south
  { id: 7, x: -10, z: 0, edges: [3, 8, 11] },   // mid west (around the block)
  { id: 8, x: -8, z: -10, edges: [4, 7, 13] },  // connector west
  { id: 9, x: 14, z: 2, edges: [6, 10, 19] },   // east lane
  { id: 10, x: 14, z: -12, edges: [6, 9, 18] }, // B approach (west of the B wall)
  { id: 11, x: 0, z: 4, edges: [5, 7, 19] },    // mid (south of the block)
  { id: 12, x: 0, z: -18, edges: [13, 14, 17, 18] }, // north connector
  { id: 13, x: -8, z: -18, edges: [8, 12, 17] },     // north-west
  { id: 14, x: 8, z: -18, edges: [12, 18, 10] },     // north-east
  { id: 15, x: -20, z: -16, edges: [20] },      // site A (east of the A crates)
  { id: 16, x: 20, z: -13, edges: [21] },       // site B (west of the B container)
  { id: 17, x: -12, z: -18, edges: [4, 12, 13, 20] }, // A north approach
  { id: 18, x: 12, z: -18, edges: [10, 12, 14, 21] }, // B north approach
  { id: 19, x: 10, z: 0, edges: [9, 10, 11] },  // mid east (around the block)
  { id: 20, x: -18, z: -16, edges: [15, 17] },  // A gap: between the A crate and the A wall
  { id: 21, x: 20, z: -15, edges: [16, 18] },   // B gap: north of the B wall, east of the B crate
];

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const dx = w.x - x;
    const dz = w.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// BFS path on the waypoint graph; returns an array of waypoint ids.
export function findPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of WAYPOINTS[cur].edges) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        if (n === toId) {
          const path = [n];
          let p = cur;
          while (p !== -1) { path.unshift(p); p = prev.get(p); }
          return path;
        }
        queue.push(n);
      }
    }
  }
  return [toId];
}

// --- Collision: circle (x, z, radius) vs wall AABBs + arena bounds. Mutates pos.
export function collideCircle(pos, radius) {
  const a = ARENA;
  if (pos.x < a.minX + radius) pos.x = a.minX + radius;
  if (pos.x > a.maxX - radius) pos.x = a.maxX - radius;
  if (pos.z < a.minZ + radius) pos.z = a.minZ + radius;
  if (pos.z > a.maxZ - radius) pos.z = a.maxZ - radius;
  for (const w of WALLS) {
    const hx = w.w / 2;
    const hz = w.d / 2;
    const cx = Math.max(w.x - hx, Math.min(pos.x, w.x + hx));
    const cz = Math.max(w.z - hz, Math.min(pos.z, w.z + hz));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const px = hx + radius - Math.abs(pos.x - w.x);
        const pz = hz + radius - Math.abs(pos.z - w.z);
        if (px < pz) pos.x = w.x + (pos.x >= w.x ? hx + radius : -hx - radius);
        else pos.z = w.z + (pos.z >= w.z ? hz + radius : -hz - radius);
      }
    }
  }
  return pos;
}

// Ray vs a single wall AABB in 2D (slab method). Returns distance t or Infinity.
// The ray starts at (ox, oy, oz) with direction (dx, dy, dz); a wall blocks only
// if the ray is below the wall's top when it reaches it.
export function rayWallDistance(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const w of WALLS) {
    const hx = w.w / 2;
    const hz = w.d / 2;
    const minX = w.x - hx;
    const maxX = w.x + hx;
    const minZ = w.z - hz;
    const maxZ = w.z + hz;
    let tmin = 0;
    let tmax = maxDist;
    if (Math.abs(dx) < 1e-9) {
      if (ox < minX || ox > maxX) continue;
    } else {
      let t1 = (minX - ox) / dx;
      let t2 = (maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < minZ || oz > maxZ) continue;
    } else {
      let t1 = (minZ - oz) / dz;
      let t2 = (maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < 0 || tmin > maxDist) continue;
    const yAt = oy + dy * tmin;
    if (yAt > w.h) continue; // ray passes over a low crate
    if (tmin < best) best = tmin;
  }
  return best;
}

// 2D line of sight between two eye positions (y ~1.5). Low crates don't block.
export function hasLineOfSight(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const t = rayWallDistance(ax, 1.5, az, dx / dist, 0, dz / dist, dist);
  return t === Infinity;
}

export function insideSite(x, z, site) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz < site.r * site.r;
}

export function nearestSite(x, z) {
  const da = Math.hypot(x - SITES.A.x, z - SITES.A.z);
  const db = Math.hypot(x - SITES.B.x, z - SITES.B.z);
  return da < db ? 'A' : 'B';
}
