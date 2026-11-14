// DUSTLINE Sector 7 — the simulation. Fixed-step (1/60 s), separate from
// rendering: this module owns the whole game state (player, bots, weapons,
// grenades, spike, rounds, money) and knows nothing about three.js or the DOM.
// main.js steps it and renders the state; hud.js reads the state.
//
// Match: first to 5 round wins, at most 9 rounds. You are the attacker, alone
// against four Sentinel defenders. Win a round by eliminating the defenders,
// or by planting the spike and letting it detonate. Lose it if you die, if the
// round timer runs out before a plant, or if a defender defuses the spike.
import { WEAPONS, GRENADES, createWeaponState, fireWeapon, startReload, updateWeapon, throwGrenade, rayHitBot } from './weapons.js';
import { createBot, updateBot, botSeesPlayer } from './bots.js';
import { SPAWNS, SITES, insideSite, nearestSite, collideCircle, rayWallDistance } from './world.js';

export const STEP = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const PLANT_TIME = 3;
export const DETONATE_TIME = 35;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;

export class Sim {
  constructor() {
    this.time = 0; // seconds since match start
    this.timeMs = 0;
    this.events = [];
    this.noise = null;
    this.smoke = []; // { x, y, z, r, until }
    this.grenades = [];
    this.tracers = [];
    this.resetMatch();
  }

  resetMatch() {
    this.round = 0;
    this.scoreAtk = 0;
    this.scoreDef = 0;
    this.money = 800;
    this.lossStreak = 0;
    this.kills = 0;
    this.deaths = 0;
    this.phase = 'lobby'; // lobby | buy | live | roundEnd | matchEnd
    this.phaseT = 0;
    this.roundWinner = null;
    this.matchWinner = null;
    this.planted = null;
    this.plantProgress = 0;
    this.killfeed = [];
    this.resetRoundState();
  }

  resetRoundState() {
    const s = SPAWNS.attacker;
    this.player = {
      x: s.x, z: s.z, y: 0, vy: 0, yaw: s.yaw, pitch: 0,
      vx: 0, vz: 0, hp: 100, crouched: false, onGround: true,
      eyeH: EYE_STAND, speed: 0, hasSpike: true, alive: true,
      weapons: { p9: createWeaponState('p9') },
      current: 'p9',
      grenades: { frag: 0, smoke: 0 },
      recoilPitch: 0,
    };
    this.bots = SPAWNS.defenders.map((sp, i) => createBot(i, sp));
    this.grenades = [];
    this.smoke = [];
    this.planted = null;
    this.plantProgress = 0;
    this.noise = null;
  }

  startMatch() {
    this.resetMatch();
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.resetRoundState();
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.roundWinner = null;
    this.events.push({ type: 'roundStart', round: this.round });
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.phase = 'roundEnd';
    this.phaseT = 4.5;
    this.roundWinner = winner;
    if (winner === 'atk') {
      this.scoreAtk += 1;
      this.money += 325;
      this.lossStreak = 0;
    } else {
      this.scoreDef += 1;
      this.money += 150 + Math.min(150, this.lossStreak * 50);
      this.lossStreak += 1;
    }
    this.events.push({ type: 'roundEnd', winner, reason, scoreAtk: this.scoreAtk, scoreDef: this.scoreDef });
  }

  endMatch() {
    this.phase = 'matchEnd';
    this.phaseT = 0;
    this.matchWinner = this.scoreAtk > this.scoreDef ? 'atk' : this.scoreDef > this.scoreAtk ? 'def' : 'draw';
    this.events.push({ type: 'matchEnd', winner: this.matchWinner });
  }

  // --- Economy ---
  buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (this.phase !== 'buy') return false;
    if (this.player.weapons[id]) return false;
    if (this.money < def.price) return false;
    this.money -= def.price;
    this.player.weapons[id] = createWeaponState(id);
    this.player.current = id;
    this.events.push({ type: 'buy', what: def.name });
    return true;
  }

  buyGrenade(kind) {
    const def = GRENADES[kind];
    if (!def || this.phase !== 'buy') return false;
    if (this.player.grenades[kind] >= 2) return false;
    if (this.money < def.price) return false;
    this.money -= def.price;
    this.player.grenades[kind] += 1;
    this.events.push({ type: 'buy', what: def.name });
    return true;
  }

  // --- One fixed step ---
  step(dt, input) {
    this.time += dt;
    this.timeMs += dt * 1000;
    if (this.noise) this.noise.age += dt;
    this.phaseT -= dt;

    if (this.phase === 'buy' && this.phaseT <= 0) {
      this.phase = 'live';
      this.phaseT = ROUND_TIME;
      this.events.push({ type: 'live' });
    } else if (this.phase === 'live') {
      if (this.phaseT <= 0 && !this.planted) this.endRound('def', 'time');
    } else if (this.phase === 'roundEnd' && this.phaseT <= 0) {
      if (this.scoreAtk >= WIN_ROUNDS || this.scoreDef >= WIN_ROUNDS || this.round >= MAX_ROUNDS) this.endMatch();
      else this.startRound();
    }

    if (this.phase === 'live' || this.phase === 'buy') {
      this.updatePlayer(dt, input);
      this.updateBots(dt);
      this.updateGrenades(dt);
      this.updateBomb(dt, input);
    }
    // Smoke expires.
    this.smoke = this.smoke.filter((c) => c.until > this.time);
  }

  updatePlayer(dt, input) {
    const p = this.player;
    if (!p.alive) return;

    // Look. Recoil pitch decays back toward the player's aim.
    p.yaw -= input.look.dx * 0.0022;
    p.pitch -= input.look.dy * 0.0022;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
    p.recoilPitch = Math.max(0, p.recoilPitch - dt * 0.25);

    const crouchKey = input.keys.has('ControlLeft') || input.keys.has('KeyC');
    p.crouched = crouchKey;
    const targetEye = crouchKey ? EYE_CROUCH : EYE_STAND;
    p.eyeH += (targetEye - p.eyeH) * Math.min(1, dt * 12);

    // Movement: acceleration-based, with a sprint and a crouch speed.
    const sprint = input.keys.has('ShiftLeft') && input.axes.f > 0 && !p.crouched;
    const maxSpeed = p.crouched ? 2.6 : sprint ? 6.9 : 5.2;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    let wx = fx * input.axes.f + rx * input.axes.s;
    let wz = fz * input.axes.f + rz * input.axes.s;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const accel = p.onGround ? 42 : 10;
    p.vx += wx * accel * dt;
    p.vz += wz * accel * dt;
    // Friction when no input, and a hard cap on speed.
    const sp = Math.hypot(p.vx, p.vz);
    if (wl < 0.05 && p.onGround) {
      const dec = Math.max(0, sp - 34 * dt);
      if (sp > 0) { p.vx *= dec / sp; p.vz *= dec / sp; }
    }
    if (sp > maxSpeed) { p.vx *= maxSpeed / sp; p.vz *= maxSpeed / sp; }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    collideCircle(p, 0.42);
    p.speed = Math.hypot(p.vx, p.vz);

    // Jump + gravity.
    if (input.pressed.has('Space') && p.onGround) {
      p.vy = 6.8;
      p.onGround = false;
    }
    p.vy -= 20 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

    // Weapon switching.
    const order = ['p9', 'mako', 'ar77', 'longbow', 'breacher'];
    for (let i = 0; i < order.length; i++) {
      if (input.pressed.has('Digit' + (i + 1)) && p.weapons[order[i]]) {
        p.current = order[i];
        this.events.push({ type: 'switch', weapon: order[i] });
      }
    }

    const w = p.weapons[p.current];
    if (updateWeapon(w, dt * 1000)) this.events.push({ type: 'reloaded', weapon: p.current });

    if (input.pressed.has('KeyR')) {
      if (startReload(w)) this.events.push({ type: 'reload', weapon: p.current });
    }

    // Firing (allowed in the buy phase too: you can warm up while you shop).
    const wantFire = w.def.auto ? input.fire : input.fireEdge;
    if (wantFire) {
      const eye = this.eyePos();
      const dir = this.aimDir();
      const result = fireWeapon(w, eye, dir, {
        now: this.timeMs,
        speed: p.speed,
        onGround: p.onGround,
        crouched: p.crouched,
      }, this.bots, (bot, dmg, part) => this.damageBot(bot, dmg, part));
      if (result && result.empty) {
        this.events.push({ type: 'dryFire' });
        if (startReload(w)) this.events.push({ type: 'reload', weapon: p.current });
      } else if (result) {
        p.recoilPitch += result.recoil;
        p.pitch += result.recoil * 0.55;
        this.noise = { x: p.x, z: p.z, age: 0 };
        for (const ev of result.events) {
          this.events.push({ type: 'tracer', from: eye, to: ev.end, by: 'player' });
          if (ev.hit) {
            this.events.push({ type: 'hitmarker', headshot: ev.hit.headshot, killed: ev.hit.killed });
          }
        }
        this.events.push({ type: 'shot', weapon: p.current, by: 'player', dist: 0 });
      }
    }

    // Grenades.
    if (input.pressed.has('KeyG') && p.grenades.frag > 0 && this.phase === 'live') {
      p.grenades.frag -= 1;
      this.grenades.push(throwGrenade('frag', this.eyePos(), this.aimDir()));
      this.events.push({ type: 'grenadePin' });
    }
    if (input.pressed.has('KeyH') && p.grenades.smoke > 0 && this.phase === 'live') {
      p.grenades.smoke -= 1;
      this.grenades.push(throwGrenade('smoke', this.eyePos(), this.aimDir()));
      this.events.push({ type: 'grenadePin' });
    }

    // Zoom (DMR right-click).
    this.zoomed = input.altFire && w.def.zoom > 1 ? w.def.zoom : 1;
  }

  eyePos() {
    const p = this.player;
    return { x: p.x, y: p.y + p.eyeH, z: p.z };
  }

  aimDir() {
    const p = this.player;
    const cp = Math.cos(p.pitch + p.recoilPitch);
    return {
      x: -Math.sin(p.yaw) * cp,
      y: Math.sin(p.pitch + p.recoilPitch),
      z: -Math.cos(p.yaw) * cp,
    };
  }

  damageBot(bot, dmg, part) {
    if (bot.hp <= 0) return;
    bot.hp -= dmg;
    bot.targetSeen = Math.max(bot.targetSeen, 0.5);
    // Being shot interrupts a defuse.
    if (bot.state === 'defuse') {
      bot.state = 'rotate';
      bot.defuseProgress = 0;
    }
    if (bot.hp <= 0) {
      bot.hp = 0;
      this.kills += 1;
      if (this.phase === 'live') this.money += 300;
      this.killfeed.unshift({ text: `You ▸ ${bot.name} ${part === 'head' ? '(headshot)' : ''}`, t: this.time });
      this.killfeed = this.killfeed.slice(0, 5);
      this.events.push({ type: 'kill', bot: bot.name, headshot: part === 'head' });
      if (this.bots.every((b) => b.hp <= 0)) this.endRound('atk', 'elimination');
    }
  }

  damagePlayer(dmg, fromBot) {
    const p = this.player;
    if (!p.alive) return;
    // Scripted screenshot scene only: the play shot holds the trigger while
    // a Sentinel returns fire, and the capture must land with the player
    // alive. Normal play never sets this flag.
    if (this.shotInvulnerable) return;
    p.hp -= dmg;
    this.events.push({ type: 'hurt', from: fromBot ? { x: fromBot.x, z: fromBot.z } : null });
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.deaths += 1;
      this.killfeed.unshift({ text: `${fromBot ? fromBot.name : 'Sentinel'} ▸ You`, t: this.time });
      this.killfeed = this.killfeed.slice(0, 5);
      this.events.push({ type: 'died', by: fromBot ? fromBot.name : null });
      if (this.planted) {
        // The spike is still ticking: the round is decided by the bomb now.
        // Give the defenders the win only if nobody can stop it — the bomb
        // decides: keep the round live until it detonates or is defused.
        this.phase = 'live';
        this.phaseT = Math.max(this.phaseT, 0.01);
      } else {
        this.endRound('def', 'eliminated');
      }
    }
  }

  // A bot fires one shot at the player with angular error `err` (radians).
  botShoot(bot, err) {
    const p = this.player;
    if (!p.alive || this.phase !== 'live') return;
    const ox = bot.x;
    const oy = 1.5;
    const oz = bot.z;
    const tx = p.x - ox;
    const ty = (p.y + 1.2) - oy;
    const tz = p.z - oz;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > 60) return;
    let dx = tx / dist;
    let dy = ty / dist;
    let dz = tz / dist;
    // Jitter the aim.
    const a = (Math.random() + Math.random() - 1) * err;
    const b = (Math.random() + Math.random() - 1) * err;
    let ux = -dz;
    let uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    dx += ux * a;
    dy += b;
    dz += uz * a;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const wallT = rayWallDistance(ox, oy, oz, dx, dy, dz, dist + 2);
    const from = { x: ox, y: oy, z: oz };
    if (wallT < dist) {
      const end = { x: ox + dx * wallT, y: oy + dy * wallT, z: oz + dz * wallT };
      this.events.push({ type: 'tracer', from, to: end, by: 'bot' });
      this.events.push({ type: 'shot', weapon: 'ar77', by: 'bot', dist });
      return;
    }
    // Did the ray pass through the player's capsule?
    const hit = rayHitBot(ox, oy, oz, dx, dy, dz, { x: p.x, z: p.z, crouched: p.crouched }, dist + 1);
    const end = hit
      ? { x: ox + dx * hit.t, y: oy + dy * hit.t, z: oz + dz * hit.t }
      : { x: p.x + dx * 2, y: p.y + 1.2, z: p.z + dz * 2 };
    this.events.push({ type: 'tracer', from, to: end, by: 'bot' });
    this.events.push({ type: 'shot', weapon: 'ar77', by: 'bot', dist });
    if (hit) {
      const dmg = hit.part === 'head' ? 55 : 22;
      this.damagePlayer(dmg, bot);
    }
  }

  updateBots(dt) {
    const ctx = {
      time: this.time,
      player: this.player,
      planted: this.planted,
      noise: this.noise,
      smoke: this.smoke,
      botShoot: (bot, err) => this.botShoot(bot, err),
      onDefused: () => this.endRound('def', 'defused'),
    };
    for (const bot of this.bots) updateBot(bot, dt, ctx);
  }

  updateGrenades(dt) {
    for (const g of this.grenades) {
      g.fuse -= dt;
      g.vy -= 18 * dt;
      const nx = g.x + g.vx * dt;
      const nz = g.z + g.vz * dt;
      const before = { x: g.x, z: g.z };
      g.x = nx;
      g.z = nz;
      collideCircle(g, 0.15);
      if (g.x !== nx || g.z !== nz) {
        // Bounced off a wall: kill the horizontal velocity, keep rolling.
        if (Math.abs(g.x - before.x) < Math.abs(nx - before.x)) g.vx *= -0.35;
        if (Math.abs(g.z - before.z) < Math.abs(nz - before.z)) g.vz *= -0.35;
        g.vx *= 0.6;
        g.vz *= 0.6;
        this.events.push({ type: 'bounce' });
      }
      g.y += g.vy * dt;
      if (g.y < 0.08) {
        g.y = 0.08;
        g.vy = Math.abs(g.vy) > 1.5 ? -g.vy * 0.35 : 0;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      if (g.fuse <= 0) {
        g.done = true;
        if (g.kind === 'frag') this.explodeFrag(g);
        else {
          this.smoke.push({ x: g.x, y: 1.2, z: g.z, r: 4.5, until: this.time + GRENADES.smoke.duration });
          this.events.push({ type: 'smoke', x: g.x, y: g.y, z: g.z });
        }
      }
    }
    this.grenades = this.grenades.filter((g) => !g.done);
  }

  explodeFrag(g) {
    const def = GRENADES.frag;
    this.events.push({ type: 'explosion', x: g.x, y: Math.max(0.3, g.y), z: g.z });
    const hurt = (tx, tz, ty, apply) => {
      const d = Math.hypot(tx - g.x, tz - g.z);
      if (d > def.radius) return;
      let dmg = Math.round(def.damage * (1 - (d / def.radius) * 0.8));
      // A wall between the blast and the target halves the damage.
      const wallT = rayWallDistance(g.x, 1.0, g.z, (tx - g.x) / (d || 1), 0, (tz - g.z) / (d || 1), d);
      if (wallT < d) dmg = Math.round(dmg * 0.4);
      apply(dmg);
    };
    for (const bot of this.bots) {
      if (bot.hp > 0) hurt(bot.x, bot.z, 1.2, (dmg) => this.damageBot(bot, dmg, 'body'));
    }
    const p = this.player;
    if (p.alive) hurt(p.x, p.z, p.y + 1.2, (dmg) => this.damagePlayer(dmg, null));
  }

  updateBomb(dt, input) {
    const p = this.player;
    if (!this.planted && p.alive && p.hasSpike && this.phase === 'live') {
      const siteKey = insideSite(p.x, p.z, SITES.A) ? 'A' : insideSite(p.x, p.z, SITES.B) ? 'B' : null;
      if (siteKey && input.keys.has('KeyE')) {
        if (this.plantProgress === 0) this.events.push({ type: 'plantStart', site: siteKey });
        this.plantProgress += dt;
        if (Math.floor(this.plantProgress * 4) !== Math.floor((this.plantProgress - dt) * 4)) {
          this.events.push({ type: 'plantBeep' });
        }
        if (this.plantProgress >= PLANT_TIME) {
          this.planted = { site: siteKey, x: p.x, z: p.z, timer: DETONATE_TIME };
          p.hasSpike = false;
          this.money += 300;
          this.events.push({ type: 'planted', site: siteKey });
        }
      } else {
        this.plantProgress = 0;
      }
    }
    if (this.planted) {
      this.planted.timer -= dt;
      if (this.planted.timer <= 0) {
        this.events.push({ type: 'explosion', x: this.planted.x, y: 0.5, z: this.planted.z });
        this.endRound('atk', 'detonation');
      }
    }
  }

  // --- State for the HUD ---
  hudState() {
    const p = this.player;
    const w = p.weapons[p.current];
    return {
      phase: this.phase,
      phaseT: Math.max(0, this.phaseT),
      round: this.round,
      scoreAtk: this.scoreAtk,
      scoreDef: this.scoreDef,
      money: this.money,
      hp: Math.max(0, Math.ceil(p.hp)),
      alive: p.alive,
      weapon: w.def.name,
      mag: w.mag,
      reserve: w.reserve,
      reloading: w.reloading > 0,
      weaponsOwned: Object.keys(p.weapons),
      current: p.current,
      grenades: { ...p.grenades },
      hasSpike: p.hasSpike,
      planted: this.planted ? { ...this.planted } : null,
      plantProgress: this.plantProgress,
      plantSite: p.alive && !this.planted
        ? (insideSite(p.x, p.z, SITES.A) ? 'A' : insideSite(p.x, p.z, SITES.B) ? 'B' : null)
        : null,
      nearestSite: nearestSite(p.x, p.z),
      botsAlive: this.bots.filter((b) => b.hp > 0).length,
      killfeed: this.killfeed.filter((k) => this.time - k.t < 6),
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      spread: w ? w.def.spread : 0,
      zoomed: this.zoomed || 1,
    };
  }
}
