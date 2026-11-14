// DUSTLINE Sector 7 — defender bots. Four bots with a small state machine:
// HOLD at an anchor, PATROL between waypoints, ENGAGE when they see the player,
// INVESTIGATE the last gunshot they heard, ROTATE to a planted spike, DEFUSE it.
// They walk the waypoint graph, hold angles, and fire in bursts with an aim
// error that shrinks the longer they hold you in sight — so peeking is punished
// less than standing in the open.
import { WAYPOINTS, nearestWaypoint, findPath, hasLineOfSight, collideCircle } from './world.js';

export const BOT_NAMES = ['Vex', 'Mara', 'Kilo', 'Rook'];

const BOT_SPEED = 3.4; // m/s walking
const BOT_RUN_SPEED = 4.6; // m/s when rotating to a plant
const EYE_Y = 1.5;
const SEE_RANGE = 42;
const SEE_FOV = 1.9; // radians of half-angle the bot can notice you in
const BURST_MIN = 3;
const BURST_MAX = 6;

export function createBot(i, spawn) {
  return {
    id: i,
    name: BOT_NAMES[i % BOT_NAMES.length],
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.yaw,
    hp: 100,
    state: 'hold',
    anchorWp: nearestWaypoint(spawn.x, spawn.z),
    path: [],
    pathI: 0,
    holdUntil: 4 + Math.random() * 4,
    targetSeen: 0, // seconds the player has been continuously visible
    burstLeft: 0,
    burstPause: 0,
    shotCooldown: 0,
    investigate: null, // { x, z } last heard noise
    defuseProgress: 0,
    damageDealt: 0,
    kills: 0,
    crouched: false,
    moving: false,
  };
}

function angleTo(bot, x, z) {
  return Math.atan2(-(x - bot.x), -(z - bot.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(bot, targetYaw, dt, rate = 5) {
  const d = angleDiff(targetYaw, bot.yaw);
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  bot.yaw += step;
  return Math.abs(d) < 0.05;
}

// Walk toward a point, sliding along walls. Returns true when arrived.
function walkToward(bot, tx, tz, dt, speed) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) return true;
  const step = Math.min(dist, speed * dt);
  bot.x += (dx / dist) * step;
  bot.z += (dz / dist) * step;
  collideCircle(bot, 0.45);
  bot.yaw = angleTo(bot, tx, tz);
  bot.moving = true;
  return false;
}

function followPath(bot, dt, speed) {
  if (bot.pathI >= bot.path.length) return true;
  const wp = WAYPOINTS[bot.path[bot.pathI]];
  if (walkToward(bot, wp.x, wp.z, dt, speed)) {
    bot.pathI += 1;
    bot.pathWait = 0;
  } else {
    // Safety: a waypoint that cannot be reached (a map edit broke the graph,
    // or a crate blocks the last step) is skipped after 4 s instead of
    // stranding the bot against a wall forever.
    bot.pathWait = (bot.pathWait || 0) + dt;
    if (bot.pathWait > 4) {
      bot.pathI += 1;
      bot.pathWait = 0;
    }
  }
  return bot.pathI >= bot.path.length;
}

function setPath(bot, toId) {
  const from = nearestWaypoint(bot.x, bot.z);
  bot.path = findPath(from, toId);
  bot.pathI = 0;
}

// Can this bot see the player right now?
export function botSeesPlayer(bot, player) {
  if (player.hp <= 0) return false;
  const dx = player.x - bot.x;
  const dz = player.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SEE_RANGE) return false;
  if (dist > 6) {
    const yawTo = angleTo(bot, player.x, player.z);
    if (Math.abs(angleDiff(yawTo, bot.yaw)) > SEE_FOV) return false;
  }
  return hasLineOfSight(bot.x, bot.z, player.x, player.z);
}

// One fixed step of bot AI. `ctx` carries the world the bot reacts to:
// player, planted spike, noise events, and a shoot callback.
export function updateBot(bot, dt, ctx) {
  if (bot.hp <= 0) return;
  bot.moving = false;
  const player = ctx.player;
  const sees = botSeesPlayer(bot, player);

  if (sees) bot.targetSeen += dt;
  else bot.targetSeen = Math.max(0, bot.targetSeen - dt * 2);

  // Hearing: a fresh noise event pulls the bot toward it.
  if (ctx.noise && ctx.noise.age < 0.4 && ctx.noise.x !== undefined) {
    const d = Math.hypot(ctx.noise.x - bot.x, ctx.noise.z - bot.z);
    if (d < 30 && bot.state !== 'engage' && bot.state !== 'defuse') {
      bot.investigate = { x: ctx.noise.x, z: ctx.noise.z };
      if (bot.state === 'hold' || bot.state === 'patrol') bot.state = 'investigate';
    }
  }

  // A planted spike overrides everything: rotate to the spike, defuse it.
  // Distances are to the spike itself, not the site centre: a bot that walks
  // the waypoint graph to the site still has to close the last metres.
  if (ctx.planted && bot.state !== 'engage') {
    const dSpike = Math.hypot(ctx.planted.x - bot.x, ctx.planted.z - bot.z);
    if (bot.state !== 'defuse' && bot.state !== 'rotate') {
      bot.state = 'rotate';
      setPath(bot, nearestWaypoint(ctx.planted.x, ctx.planted.z));
    }
    if (bot.state === 'rotate' && dSpike < 2.2) {
      bot.state = 'defuse';
      bot.defuseProgress = 0;
    }
  }

  switch (bot.state) {
    case 'hold': {
      bot.holdUntil -= dt;
      // Slowly scan the lane: sweep the yaw back and forth.
      bot.yaw += Math.sin(ctx.time * 0.5 + bot.id * 2) * 0.15 * dt;
      if (sees) bot.state = 'engage';
      else if (bot.holdUntil <= 0) {
        bot.state = 'patrol';
        const next = WAYPOINTS[bot.anchorWp].edges[
          Math.floor(Math.random() * WAYPOINTS[bot.anchorWp].edges.length)];
        setPath(bot, next);
      }
      break;
    }
    case 'patrol': {
      if (sees) { bot.state = 'engage'; break; }
      if (followPath(bot, dt, BOT_SPEED)) {
        bot.state = 'hold';
        bot.holdUntil = 3 + Math.random() * 5;
        bot.anchorWp = nearestWaypoint(bot.x, bot.z);
      }
      break;
    }
    case 'investigate': {
      if (sees) { bot.state = 'engage'; break; }
      if (!bot.investigate) { bot.state = 'hold'; break; }
      if (!bot.path.length) setPath(bot, nearestWaypoint(bot.investigate.x, bot.investigate.z));
      if (followPath(bot, dt, BOT_SPEED)) {
        bot.state = 'hold';
        bot.holdUntil = 2 + Math.random() * 2;
        bot.investigate = null;
      }
      break;
    }
    case 'rotate': {
      if (sees) { bot.state = 'engage'; break; }
      // Walk the graph to the site, then close the last metres to the spike
      // itself: the site waypoint can sit metres from where it was planted.
      if (followPath(bot, dt, BOT_RUN_SPEED) && ctx.planted) {
        walkToward(bot, ctx.planted.x, ctx.planted.z, dt, BOT_RUN_SPEED);
      }
      break;
    }
    case 'defuse': {
      if (sees) { bot.state = 'engage'; break; }
      const d = Math.hypot(ctx.planted.x - bot.x, ctx.planted.z - bot.z);
      if (d > 2.2) { bot.state = 'rotate'; break; }
      turnToward(bot, angleTo(bot, ctx.planted.x, ctx.planted.z), dt);
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= 5) ctx.onDefused(bot);
      break;
    }
    case 'engage': {
      if (!sees && bot.targetSeen <= 0) {
        // Lost the player: go check where they were last seen.
        bot.investigate = { x: player.x, z: player.z };
        bot.state = 'investigate';
        bot.path = [];
        break;
      }
      const yawTo = angleTo(bot, player.x, player.z);
      turnToward(bot, yawTo, dt, 6);
      const dist = Math.hypot(player.x - bot.x, player.z - bot.z);
      // Hold a fighting distance: step closer if far, back off if point-blank.
      if (dist > 18) walkToward(bot, player.x, player.z, dt, BOT_SPEED);
      else if (dist < 4) {
        // Back off: forward is (-sin yaw, -cos yaw), so step the other way.
        bot.x += Math.sin(bot.yaw) * BOT_SPEED * 0.5 * dt;
        bot.z += Math.cos(bot.yaw) * BOT_SPEED * 0.5 * dt;
        collideCircle(bot, 0.45);
      }
      // Burst fire: aim error shrinks the longer the bot holds you in sight.
      bot.shotCooldown -= dt;
      if (bot.burstLeft <= 0) {
        bot.burstPause -= dt;
        if (bot.burstPause <= 0 && Math.abs(angleDiff(yawTo, bot.yaw)) < 0.12) {
          bot.burstLeft = BURST_MIN + Math.floor(Math.random() * (BURST_MAX - BURST_MIN + 1));
          bot.burstPause = 0.7 + Math.random() * 0.8;
        }
      } else if (bot.shotCooldown <= 0 && Math.abs(angleDiff(yawTo, bot.yaw)) < 0.15) {
        bot.shotCooldown = 0.115;
        bot.burstLeft -= 1;
        const err = Math.max(0.014, 0.06 - bot.targetSeen * 0.01 - (player.crouched ? 0.004 : 0));
        ctx.botShoot(bot, err);
      }
      break;
    }
    default:
      bot.state = 'hold';
  }
}
