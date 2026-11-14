// DUSTLINE Sector 7 — weapons. Definitions, firing, reload, recoil and spread,
// grenades. All ballistics are pure math on the world's data (ray vs wall AABBs
// and ray vs bot capsules), so the simulation stays independent of rendering.
//
// Spread punishes firing on the move and in the air; stopping to aim pays.
// Headshots pay: every weapon deals its head multiplier on a head hit.
import { rayWallDistance } from './world.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 34, headMult: 3.0,
    mag: 13, reserve: 52, rateMs: 160, reloadMs: 1400,
    spread: 0.011, moveSpread: 0.030, airSpread: 0.05, recoil: 0.011,
    auto: false, pellets: 1, range: 60, zoom: 1,
  },
  mako: {
    id: 'mako', name: 'Mako SMG', price: 1500, damage: 26, headMult: 2.6,
    mag: 30, reserve: 120, rateMs: 78, reloadMs: 1900,
    spread: 0.016, moveSpread: 0.034, airSpread: 0.055, recoil: 0.009,
    auto: true, pellets: 1, range: 55, zoom: 1,
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Rifle', price: 2700, damage: 33, headMult: 3.0,
    mag: 30, reserve: 90, rateMs: 105, reloadMs: 2200,
    spread: 0.008, moveSpread: 0.028, airSpread: 0.05, recoil: 0.013,
    auto: true, pellets: 1, range: 90, zoom: 1,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 4000, damage: 88, headMult: 3.2,
    mag: 10, reserve: 30, rateMs: 900, reloadMs: 2800,
    spread: 0.004, moveSpread: 0.05, airSpread: 0.09, recoil: 0.05,
    auto: false, pellets: 1, range: 120, zoom: 2.2,
  },
  breacher: {
    id: 'breacher', name: 'Breacher 12', price: 1800, damage: 11, headMult: 2.0,
    mag: 6, reserve: 24, rateMs: 850, reloadMs: 2600,
    spread: 0.045, moveSpread: 0.05, airSpread: 0.07, recoil: 0.045,
    auto: false, pellets: 8, range: 30, zoom: 1,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, radius: 7, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 200, radius: 5, duration: 14 },
};

export function createWeaponState(id) {
  const def = WEAPONS[id];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: 0, // ms left, 0 = not reloading
    lastShotAt: -1e9,
    bloom: 0, // recoil bloom, decays over time
  };
}

// Current spread (radians) for a shot: base + movement + air + bloom.
export function currentSpread(state, speed, onGround, crouched) {
  const d = state.def;
  let s = d.spread + state.bloom;
  if (speed > 0.5) s += d.moveSpread * Math.min(1, speed / 5);
  if (!onGround) s += d.airSpread;
  if (crouched) s *= 0.75;
  return s;
}

// Ray vs a bot capsule. Bot: { x, z, hp, crouched }. Head sphere at y 1.52
// (1.05 crouched), r 0.2; body cylinder r 0.42 from y 0.1 to 1.35 (0.95 crouched).
// Returns { t, part: 'head'|'body' } or null.
export function rayHitBot(ox, oy, oz, dx, dy, dz, bot, maxDist) {
  // Head sphere.
  const hy = bot.crouched ? 1.05 : 1.52;
  const hx = bot.x - ox;
  const hz = bot.z - oz;
  const hyy = hy - oy;
  const b = hx * dx + hyy * dy + hz * dz;
  const c = hx * hx + hyy * hyy + hz * hz - 0.2 * 0.2;
  const disc = b * b - c;
  if (disc >= 0 && b > 0) {
    const t = b - Math.sqrt(disc);
    if (t > 0 && t < maxDist) return { t, part: 'head' };
  }
  // Body cylinder: ray vs circle in XZ, then check y at that t.
  const cx = bot.x - ox;
  const cz = bot.z - oz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const bb = cx * dx + cz * dz;
    const cc = cx * cx + cz * cz - 0.42 * 0.42;
    const dd = bb * bb - a * cc;
    if (dd >= 0 && bb > 0) {
      const t = (bb - Math.sqrt(dd)) / a;
      if (t > 0 && t < maxDist) {
        const y = oy + dy * t;
        const top = bot.crouched ? 0.95 : 1.35;
        if (y > 0.05 && y < top) return { t, part: 'body' };
      }
    }
  }
  return null;
}

// Fire one trigger pull. `bots` are the live targets, `onDamage(bot, dmg, part)`
// applies damage. Returns shot events for rendering/HUD.
export function fireWeapon(state, origin, dir, opts, bots, onDamage) {
  const def = state.def;
  const now = opts.now;
  if (now - state.lastShotAt < def.rateMs) return null;
  if (state.reloading > 0) return null;
  if (state.mag <= 0) return { empty: true };
  state.lastShotAt = now;
  state.mag -= 1;
  state.bloom = Math.min(0.05, state.bloom + def.recoil * 0.55);

  const spread = currentSpread(state, opts.speed, opts.onGround, opts.crouched);
  const events = [];
  for (let p = 0; p < def.pellets; p++) {
    // Jitter the direction by a gaussian-ish spread (two uniform draws).
    const a = (Math.random() + Math.random() - 1) * spread;
    const b = (Math.random() + Math.random() - 1) * spread;
    // Build an orthonormal basis around dir.
    let ux = -dir.z;
    let uz = dir.x;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    const vx = dir.y * uz - dir.z * 0;
    const vy = dir.z * ux - dir.x * uz;
    const vz = dir.x * 0 - dir.y * ux;
    let ddx = dir.x + ux * a + vx * b;
    let ddy = dir.y + 0 * a + vy * b;
    let ddz = dir.z + uz * a + vz * b;
    const dl = Math.hypot(ddx, ddy, ddz) || 1;
    ddx /= dl; ddy /= dl; ddz /= dl;

    const wallT = rayWallDistance(origin.x, origin.y, origin.z, ddx, ddy, ddz, def.range);
    let bestBot = null;
    let bestHit = null;
    for (const bot of bots) {
      if (bot.hp <= 0) continue;
      const hit = rayHitBot(origin.x, origin.y, origin.z, ddx, ddy, ddz, bot, Math.min(def.range, wallT));
      if (hit && (!bestHit || hit.t < bestHit.t)) { bestHit = hit; bestBot = bot; }
    }
    const endT = bestHit ? bestHit.t : wallT;
    const end = {
      x: origin.x + ddx * (Number.isFinite(endT) ? endT : def.range),
      y: origin.y + ddy * (Number.isFinite(endT) ? endT : def.range),
      z: origin.z + ddz * (Number.isFinite(endT) ? endT : def.range),
    };
    let hitInfo = null;
    if (bestHit) {
      const dmg = Math.round(def.damage * (bestHit.part === 'head' ? def.headMult : 1));
      onDamage(bestBot, dmg, bestHit.part);
      hitInfo = { bot: bestBot, damage: dmg, headshot: bestHit.part === 'head', killed: bestBot.hp <= 0 };
    }
    events.push({ end, hit: hitInfo, wall: !bestHit && Number.isFinite(wallT) });
  }
  return { events, recoil: def.recoil };
}

export function startReload(state) {
  if (state.reloading > 0 || state.mag >= state.def.mag || state.reserve <= 0) return false;
  state.reloading = state.def.reloadMs;
  return true;
}

// Advance reload timers; returns true when a reload just finished.
export function updateWeapon(state, dtMs) {
  state.bloom = Math.max(0, state.bloom - dtMs * 0.00006);
  if (state.reloading > 0) {
    state.reloading -= dtMs;
    if (state.reloading <= 0) {
      state.reloading = 0;
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      return true;
    }
  }
  return false;
}

// --- Grenades ---
export function throwGrenade(kind, from, dir) {
  return {
    kind,
    x: from.x, y: from.y, z: from.z,
    vx: dir.x * 14 + (Math.random() - 0.5) * 0.4,
    vy: dir.y * 14 + 4.5,
    vz: dir.z * 14 + (Math.random() - 0.5) * 0.4,
    fuse: kind === 'frag' ? 1.6 : 1.1,
    bounced: 0,
  };
}
