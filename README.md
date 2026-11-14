# DUSTLINE — Sector 7

A round-based tactical FPS in three.js, built for the make.fun `threejs-fps-02`
bounty. Counter-Strike-style, never a copy: an original map, original weapons,
original art and sounds, all made for this entry.

You are the attacker, alone against four Sentinel defenders. Plant the spike at
**A (Foundry)** or **B (Yard)**, or eliminate the whole defending team. Win
rounds to earn money; spend it on better guns and grenades in the buy phase.
First to 5 rounds takes the match.

## Play

Serve `game/` with any static server and open `index.html` in desktop Chrome:

```sh
node serve.mjs   # serves game/ on http://localhost:8080
```

No build step, no network requests: three.js 0.187.0 is vendored under
`game/vendor/three/`, and every sound is synthesised with WebAudio.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (click to lock the pointer) |
| Click | Fire |
| Right-click | Scope (Longbow DMR) |
| R | Reload |
| 1–5 | Switch weapon |
| Ctrl / C | Crouch |
| Shift | Sprint |
| Space | Jump |
| G | Throw frag grenade |
| H | Throw smoke grenade |
| E (hold) | Plant the spike on a site |
| B | Buy menu (buy phase) |

## Systems

- **Gunplay** — raycast hit detection with headshot bonuses, recoil and spread
  that punish firing on the move or in the air, acceleration-based movement,
  crouching, jumping, and AABB map collision.
- **Tactics** — spike plant/defuse objective, per-round economy and a buy menu,
  five weapons and two grenades, defenders that patrol waypoints, hold angles,
  investigate gunfire, rotate to a planted spike and defuse it.
- **Map** — Sector 7: three lanes, a mid block, long sightlines, low crates you
  can shoot over and containers for hard cover, in a dusk-industrial palette.
- **Code** — modular ES modules; a fixed-step (1/60 s) simulation in `src/sim.js`
  kept apart from the three.js rendering in `src/main.js`.

## Entry

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `/output` and writes `dossier.json` with the vendored `makefun-threejs.ts`
library, as the kit requires.

## License

MIT — see `LICENSE`.
