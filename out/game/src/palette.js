// DUSTLINE Sector 7 — palette. One dusk-industrial palette for the whole game:
// cold slate concrete, warm amber hazard accents, teal site markers. Every colour
// in the game comes from here so the scene reads at a glance.
export const PALETTE = {
  sky: 0x27313e,
  fog: 0x2c3644,
  ground: 0x3a3f45,
  groundDark: 0x2e3238,
  wall: 0x565e66,
  wallDark: 0x3c4249,
  wallTop: 0x6b737c,
  crate: 0x8a6b3a,
  crateDark: 0x6e5530,
  containerA: 0x7a4a2e,
  containerB: 0x2e5d6e,
  accent: 0xf0a830,
  accentHot: 0xff5a2a,
  siteA: 0x2fa36b,
  siteB: 0x2f7fb8,
  enemy: 0xe14b3a,
  ally: 0x3aa7e1,
  tracer: 0xffd27a,
  smoke: 0x9aa2ab,
  text: '#e9e6df',
  muted: '#98a0a8',
};

// CSS mirrors of the same palette for the HUD (index.html reads these names).
export const CSS = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  danger: '#ff5a2a',
  good: '#2fa36b',
};
