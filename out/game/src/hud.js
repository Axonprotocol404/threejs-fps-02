// DUSTLINE Sector 7 — HUD. Plain DOM over the canvas: health, ammo, money,
// round timer, score, kill feed, crosshair, hitmarker, plant progress, damage
// vignette, buy menu and a 2D minimap. The HUD reads sim.hudState() each frame
// and never owns game state.
import { WEAPONS, GRENADES } from './weapons.js';
import { SITES, ARENA } from './world.js';

export class HUD {
  constructor(sim, onBuyWeapon, onBuyGrenade, onResume) {
    this.sim = sim;
    this.onBuyWeapon = onBuyWeapon;
    this.onBuyGrenade = onBuyGrenade;
    this.onResume = onResume;
    this.buyOpen = false;
    this.bannerUntil = 0;
    this.bannerText = '';
    this.bannerKind = '';
    this.hitUntil = 0;
    this.hitKill = false;
    this.hurtUntil = 0;
    this.lastHp = 100;
    this._build();
  }

  _el(id) { return document.getElementById(id); }

  _build() {
    this.el = {
      hp: this._el('hp-value'),
      hpBar: this._el('hp-bar'),
      ammoMag: this._el('ammo-mag'),
      ammoReserve: this._el('ammo-reserve'),
      ammo: this._el('ammo'),
      money: this._el('money-value'),
      timer: this._el('timer-value'),
      timerLabel: this._el('timer-label'),
      score: this._el('score-value'),
      round: this._el('round-value'),
      bots: this._el('bots-value'),
      killfeed: this._el('killfeed'),
      crosshair: this._el('crosshair'),
      hitmarker: this._el('hitmarker'),
      banner: this._el('banner'),
      bannerText: this._el('banner-text'),
      bannerSub: this._el('banner-sub'),
      plant: this._el('plant'),
      plantFill: this._el('plant-fill'),
      plantLabel: this._el('plant-label'),
      hurt: this._el('hurt'),
      buy: this._el('buy'),
      buyGrid: this._el('buy-grid'),
      buyMoney: this._el('buy-money'),
      overlay: this._el('overlay'),
      overlayTitle: this._el('overlay-title'),
      overlayCopy: this._el('overlay-copy'),
      play: this._el('play'),
      minimap: this._el('minimap'),
      weaponName: this._el('weapon-name'),
      spike: this._el('spike'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this._buildBuyMenu();
    this.el.play.addEventListener('click', () => this.onResume());
  }

  _buildBuyMenu() {
    const grid = this.el.buyGrid;
    grid.innerHTML = '';
    const mk = (title, desc, price, key, cb, owned) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy-item' + (owned ? ' owned' : '');
      b.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${title}</span>` +
        `<span class="buy-desc">${desc}</span><span class="buy-price">$${price}</span>`;
      b.addEventListener('click', cb);
      grid.appendChild(b);
    };
    for (const [id, w] of Object.entries(WEAPONS)) {
      if (id === 'p9') continue;
      mk(w.name, `${w.damage} dmg · ${w.mag} mag`, w.price, id === 'mako' ? '2' : id === 'ar77' ? '3' : id === 'longbow' ? '4' : '5',
        () => this.onBuyWeapon(id), false);
    }
    mk(GRENADES.frag.name, 'Hold G to throw · 110 dmg', GRENADES.frag.price, 'G', () => this.onBuyGrenade('frag'), false);
    mk(GRENADES.smoke.name, 'Hold H to throw · blocks sight', GRENADES.smoke.price, 'H', () => this.onBuyGrenade('smoke'), false);
  }

  showBanner(text, sub, kind, seconds = 3) {
    this.bannerText = text;
    this.bannerKind = kind;
    this.bannerUntil = performance.now() / 1000 + seconds;
    this.el.bannerText.textContent = text;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.className = 'show ' + kind;
  }

  showHitmarker(killed) {
    this.hitKill = killed;
    this.hitUntil = performance.now() / 1000 + 0.18;
  }

  showHurt() {
    this.hurtUntil = performance.now() / 1000 + 0.35;
  }

  setOverlay(title, copy, button) {
    this.el.overlayTitle.textContent = title;
    this.el.overlayCopy.textContent = copy;
    this.el.play.textContent = button;
    this.el.overlay.hidden = false;
  }

  hideOverlay() { this.el.overlay.hidden = true; }

  setBuyOpen(open) {
    this.buyOpen = open;
    this.el.buy.hidden = !open;
    if (open) this.refreshBuy();
  }

  refreshBuy() {
    const s = this.sim.hudState();
    this.el.buyMoney.textContent = '$' + s.money;
    const items = this.el.buyGrid.children;
    const ids = ['mako', 'ar77', 'longbow', 'breacher', 'frag', 'smoke'];
    ids.forEach((id, i) => {
      const owned = id === 'frag' || id === 'smoke'
        ? s.grenades[id] > 0
        : s.weaponsOwned.includes(id);
      const price = id === 'frag' ? GRENADES.frag.price : id === 'smoke' ? GRENADES.smoke.price : WEAPONS[id].price;
      items[i].classList.toggle('owned', owned);
      items[i].classList.toggle('poor', !owned && s.money < price);
    });
  }

  // Called every rendered frame with the sim state.
  update(state) {
    const now = performance.now() / 1000;
    this.el.hp.textContent = state.hp;
    this.el.hpBar.style.width = state.hp + '%';
    this.el.hpBar.className = 'hp-fill' + (state.hp <= 30 ? ' low' : '');
    this.el.ammoMag.textContent = state.mag;
    this.el.ammoReserve.textContent = '/ ' + state.reserve;
    this.el.ammo.classList.toggle('empty', state.mag === 0);
    this.el.ammo.classList.toggle('reloading', state.reloading);
    this.el.money.textContent = '$' + state.money;
    this.el.weaponName.textContent = state.weapon + (state.reloading ? ' — reloading' : '');
    const t = Math.ceil(state.phaseT);
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.timerLabel.textContent = state.phase === 'buy' ? 'BUY' : state.planted ? 'SPIKE' : 'ROUND';
    this.el.timer.classList.toggle('urgent', state.phase === 'live' && state.phaseT < 15);
    this.el.score.textContent = `${state.scoreAtk} : ${state.scoreDef}`;
    this.el.round.textContent = 'ROUND ' + Math.max(1, state.round) + ' / 9';
    this.el.bots.textContent = 'Sentinels left: ' + state.botsAlive;
    this.el.spike.textContent = state.planted
      ? `SPIKE ${state.planted.site} — ${Math.ceil(state.planted.timer)}s`
      : state.hasSpike
        ? (state.plantSite ? `Hold E — plant at ${state.plantSite}` : `Spike: plant at ${state.nearestSite}`)
        : 'Spike planted';

    // Kill feed.
    const kf = state.killfeed.map((k) => `<div>${k.text}</div>`).join('');
    if (kf !== this._lastKf) { this.el.killfeed.innerHTML = kf; this._lastKf = kf; }

    // Crosshair gap grows with spread; hidden while scoped.
    const gap = 4 + state.spread * 900;
    this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this.el.crosshair.classList.toggle('hidden', state.zoomed > 1);

    // Hitmarker.
    const hitOn = now < this.hitUntil;
    this.el.hitmarker.classList.toggle('on', hitOn);
    this.el.hitmarker.classList.toggle('kill', this.hitKill && hitOn);

    // Banner expiry.
    if (now > this.bannerUntil) this.el.banner.className = '';
    if (now > this.hurtUntil) this.el.hurt.classList.remove('on');

    // Plant progress.
    if (state.plantProgress > 0 && !state.planted) {
      this.el.plant.hidden = false;
      this.el.plantFill.style.width = (state.plantProgress / 3 * 100) + '%';
      this.el.plantLabel.textContent = 'PLANTING SPIKE…';
    } else if (state.planted) {
      this.el.plant.hidden = false;
      this.el.plantFill.style.width = (state.planted.timer / 35 * 100) + '%';
      this.el.plantLabel.textContent = 'SPIKE LIVE — ' + state.planted.site;
    } else {
      this.el.plant.hidden = true;
    }

    if (state.hp < this.lastHp) this.showHurt();
    this.lastHp = state.hp;
    if (this.buyOpen) this.refreshBuy();
    this._drawMinimap(state);
  }

  _drawMinimap(state) {
    const c = this.mm;
    const W = 168;
    const H = 116;
    const sx = (x) => ((x - ARENA.minX) / (ARENA.maxX - ARENA.minX)) * W;
    const sy = (z) => ((z - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,22,26,0.85)';
    c.fillRect(0, 0, W, H);
    // Sites.
    for (const [key, s] of Object.entries(SITES)) {
      c.fillStyle = key === 'A' ? 'rgba(47,163,107,0.5)' : 'rgba(47,127,184,0.5)';
      c.beginPath();
      c.arc(sx(s.x), sy(s.z), 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#e9e6df';
      c.font = 'bold 10px sans-serif';
      c.textAlign = 'center';
      c.fillText(key, sx(s.x), sy(s.z) + 3);
    }
    // Planted spike.
    if (state.planted) {
      c.fillStyle = '#ff5a2a';
      c.beginPath();
      c.arc(sx(state.planted.x), sy(state.planted.z), 4, 0, Math.PI * 2);
      c.fill();
    }
    // Player arrow.
    const p = this.sim.player;
    c.save();
    c.translate(sx(p.x), sy(p.z));
    // Canvas angle of the forward vector (-sin yaw, -cos yaw), arrow drawn pointing up.
    c.rotate(Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)) + Math.PI / 2);
    c.fillStyle = '#3aa7e1';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath();
    c.fill();
    c.restore();
    // Bots as red dots (only the ones the player could reasonably know: show
    // all — the minimap is a learning aid, not a wallhack in a 1v4).
    c.fillStyle = '#e14b3a';
    for (const b of this.sim.bots) {
      if (b.hp <= 0) continue;
      c.beginPath();
      c.arc(sx(b.x), sy(b.z), 3, 0, Math.PI * 2);
      c.fill();
    }
  }
}
