// SOLD OUT ミューズ街 P0 見本 — 3案で共通の部品 (上から見た地図の描画・店の札・Muse に渡る JSON)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';
  const T = root.TownGen;

  // ---- 街の取得 (URL の ?shops=200&avenue=1 で切り替え) ----
  function params() {
    const q = new URLSearchParams(location.search);
    return {
      shops: q.get('shops') === '200' ? 200 : 121,
      avenue: q.get('avenue') === '1' ? 1 : 2,
      ui: q.get('ui') || '',
    };
  }
  function getTown(p) {
    return T.demoTown({ avenue: p.avenue, grow: p.shops === 200 ? 79 : 0, fixture: true });
  }
  function setParam(k, v) {
    const q = new URLSearchParams(location.search);
    q.set(k, v);
    location.search = q.toString();
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---- 区画の中身の説明 ----
  function lotInfo(town, lot) {
    if (lot.kind === 'public') return { type: 'public', title: lot.publicName, sub: '公共の場所' };
    if (lot.state === 'vacant') return { type: 'npc', title: 'NPCの家', sub: '空き区画（新しい店が入れる）' };
    const s = town.shops.get(lot.holder);
    if (lot.state === 'held') return { type: 'held', title: '空き家', sub: '閉店した店の区画（猶予中。期限が過ぎたらNPCの家に戻る）', shop: s };
    return { type: s.resting ? 'resting' : 'open', title: s.shop, sub: s.owner, shop: s };
  }
  const SIZE_NAME = { S: 'S（小さな家）', M: 'M（中くらいの家）', L: 'L（大きな家）' };

  /** 店の札 (3案共通の中身。並べ方は各案で変える) */
  function shopCard(town, lot, opt) {
    const o = { compact: false, ...opt };
    const info = lotInfo(town, lot);
    const addr = T.addressText(town, lot);
    const badge = { resting: '<span class="badge rest">改装中（休業）</span>', held: '<span class="badge held">空き家</span>', npc: '<span class="badge npc">NPCの家</span>', public: '<span class="badge pub">目印</span>' }[info.type] || '';
    const isNew = info.shop?.isNew ? '<span class="badge new">新しく入った店</span>' : '';
    const you = town.fixture && info.shop?.som === town.fixture.you ? '<span class="badge you">あなたの店</span>' : '';
    const portrait = info.type === 'open' || info.type === 'resting'
      ? `<div class="portrait" style="--h:${info.shop.hue}"><span>立ち絵の領域<br><small>3:4</small></span></div>`
      : '';
    const nb = lot.links ? T.neighborsJson(town, lot.id) : null;
    const nbRow = (k, label) => {
      const n = nb?.neighbors[k];
      if (!n) return `<li><span class="lb">${label}</span> <span class="dim">（なし）</span></li>`;
      const txt = n.state === 'npc_house' ? 'NPCの家' : n.state === 'empty_house' ? '空き家' : esc(n.shop) + (n.state === 'resting' ? '（休業）' : '');
      return `<li><span class="lb">${label}</span> <button class="go" data-lot="${n.lot_id}">${txt}</button> <span class="dim">${n.number}番</span></li>`;
    };
    return `<div class="card ${o.compact ? 'compact' : ''}">
      ${portrait}
      <div class="card-body">
        <div class="badges">${you}${badge}${isNew}</div>
        <h3>${esc(info.title)}</h3>
        <div class="sub">${esc(info.sub)}${info.shop?.job && info.type !== 'held' ? ' ・ ' + esc(info.shop.job) : ''}</div>
        <div class="addr"><span class="lb">住所</span> ${esc(addr)}</div>
        ${lot.kind === 'shop' && info.type !== 'npc' ? `<div class="sz"><span class="lb">家</span> ${SIZE_NAME[lot.size]}</div>` : ''}
        ${nb ? `<ul class="nb">${nbRow('left', '左隣')}${nbRow('right', '右隣')}${nbRow('front', '向かい')}
          <li><span class="lb">目印</span> ${esc(nb.landmark?.name ?? '')}${nb.landmark ? `<span class="dim">（${nb.landmark.same_street ? '同じ通り、' + nb.landmark.lots_away + '軒先' : '一本となりの通り'}）</span>` : ''}</li></ul>` : ''}
        ${nb && !o.compact ? `<details class="json"><summary>Muse に渡る JSON（API案）</summary><pre>${esc(JSON.stringify(nb, null, 1))}</pre></details>` : ''}
      </div>
    </div>`;
  }

  // ---- 上から見た地図 ----
  const ROOF = ['#b5523b', '#3f6fa0', '#5b8c3e', '#8b5a9e', '#b88a2a', '#606a78'];
  const WALL = ['#f1e6d0', '#e9dcc8', '#f4efe6', '#e2d6c4'];

  /**
   * 地区 (または街全体) を絶対配置の div で描く。単位はチップ、scale は 1チップの px。
   * @returns {HTMLElement}
   */
  function renderTop(town, opt) {
    const o = { districts: town.districts, scale: 16, labels: true, highlight: null, sizeOverride: null, ...opt };
    const A = town.opts.avenue;
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (const d of o.districts) {
      x1 = Math.min(x1, d.x0 - A); y1 = Math.min(y1, d.y0 - A);
      x2 = Math.max(x2, d.x0 + d.w + A); y2 = Math.max(y2, d.y0 + d.h + A);
    }
    const s = o.scale;
    const el = document.createElement('div');
    el.className = 'top-map';
    el.style.width = (x2 - x1) * s + 'px';
    el.style.height = (y2 - y1) * s + 'px';
    el.style.setProperty('--chip', s + 'px');
    const px = (v, base) => (v - base) * s + 'px';
    const box = (cls, x, y, w, h, extra) =>
      `<div class="${cls}" style="left:${px(x, x1)};top:${px(y, y1)};width:${w * s}px;height:${h * s}px;${extra || ''}"></div>`;
    let html = '';
    // 大通り (地区のまわりの帯)
    for (const d of o.districts) html += box('avenue', d.x0 - A, d.y0 - A, d.w + 2 * A, d.h + 2 * A);
    for (const d of o.districts) {
      html += box('ground', d.x0, d.y0, d.w, d.h);
      for (const a of d.alleys) html += box('alley', a.x, a.y, a.w, a.h);
      html += box('strip ' + d.strip.kind, d.strip.x, d.strip.y, d.strip.w, d.strip.h);
    }
    el.innerHTML = html;
    // 区画
    for (const d of o.districts) {
      for (const l of d.lots) {
        const div = document.createElement('div');
        const info = lotInfo(town, l);
        div.className = 'lot t-' + info.type + (o.highlight === l.id ? ' hl' : '') + (info.shop?.isNew ? ' is-new' : '');
        div.dataset.lot = l.id;
        div.style.left = px(l.x, x1);
        div.style.top = px(l.y, y1);
        div.style.width = l.w * s + 'px';
        div.style.height = l.h * s + 'px';
        div.innerHTML = lotInner(town, l, info, s, o);
        el.appendChild(div);
      }
      if (o.labels) {
        const lab = document.createElement('div');
        lab.className = 'dlabel';
        lab.style.left = px(d.x0 + d.w / 2, x1);
        lab.style.top = px(d.y0 + d.h / 2, y1);
        lab.innerHTML = `<b>${esc(d.name)}</b><span>${esc(d.landmark.name)}</span>`;
        el.appendChild(lab);
      }
    }
    return el;
  }

  function lotInner(town, l, info, s, o) {
    if (l.kind === 'public') {
      if (l.publicKind === 'fountain') return `<div class="pub-fountain"></div>`;
      if (l.publicKind === 'park') return `<div class="pub-park"></div>`;
      return `<div class="pub-mark"><i>${esc(l.publicName.slice(0, 1))}</i>${s >= 10 ? `<span>${esc(l.publicName)}</span>` : ''}</div>`;
    }
    const size = (o.sizeOverride && o.sizeOverride.lot === l.id ? o.sizeOverride.size : l.size) || 'S';
    const hs = info.type === 'npc' ? 2 + (T.npcLook(town, l.id).shape === 2 ? 1 : 0) : T.HOME[size];
    const upper = l.front === 'down';
    // 店先 (路地側) の真ん中に建てる
    const left = ((l.w - hs) / 2) * s, top = (upper ? l.h - hs : 0) * s;
    let style = `left:${left}px;top:${top}px;width:${hs * s}px;height:${hs * s}px;`;
    let cls = 'bld';
    if (info.type === 'npc') {
      const k = T.npcLook(town, l.id);
      style += `--roof:${ROOF[k.roof]};--wall:${WALL[k.wall]};`;
      cls += ' npc';
    } else {
      style += `--roof:hsl(${info.shop.hue} 45% 42%);--wall:hsl(${info.shop.hue} 40% 90%);`;
    }
    const garden = info.type === 'npc' ? '' : `<div class="garden ${size}"></div>`;
    const sign = info.type === 'open' || info.type === 'resting' || info.type === 'held'
      ? `<div class="sign ${upper ? 'down' : 'up'}">${info.type === 'held' ? '空き家' : info.type === 'resting' ? '休業' : s >= 10 ? esc(info.shop.shop) : ''}</div>`
      : '';
    const trees = info.type === 'npc' ? `<div class="npc-yard t${T.npcLook(town, l.id).tree}"></div>` : '';
    return `${garden}${trees}<div class="${cls}" style="${style}"><div class="roof"></div></div>${sign}`;
  }

  // 見出しの高さ (スマホで折り返す) を CSS の --hdr に
  function hdr() {
    const h = document.querySelector('header.bar');
    if (h) document.documentElement.style.setProperty('--hdr', h.offsetHeight + 'px');
  }
  if (typeof document !== 'undefined') {
    addEventListener('DOMContentLoaded', hdr);
    addEventListener('resize', hdr);
    setTimeout(hdr, 0);
  }

  root.Mock = { T, params, getTown, setParam, esc, lotInfo, shopCard, renderTop, SIZE_NAME, ROOF, WALL };
})(globalThis);
