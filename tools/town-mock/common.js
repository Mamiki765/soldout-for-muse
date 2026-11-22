// SOLD OUT ミューズ街 P0 見本 — 3案で共通の部品 (上から見た地図の描画・店の札・Muse に渡る JSON)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';
  const T = root.TownGen;

  // ---- 街の取得 (URL の ?shops=200&avenue=2&alley=1&cols=8 で切り替え) ----
  function params() {
    const q = new URLSearchParams(location.search);
    return {
      shops: q.get('shops') === '200' ? 200 : 121,
      avenue: q.get('avenue') === '2' ? 2 : 3, // 大通り 3チップ (96px) が既定
      alley: q.get('alley') === '1' ? 1 : 2, // 路地 2チップ (64px) が既定
      cols: q.get('cols') === '8' ? 8 : 6, // 1列の区画 6 (地区 = 24区画) が既定
      center: q.get('center') === 'admin' ? 'admin' : 'public', // 中央: 公共施設だけ / 管理人の店を入れる
      names: q.get('names') === 'b' ? 'b' : 'a', // 地区名の候補 A / B
      ui: q.get('ui') || '',
    };
  }
  function getTown(p) {
    return T.demoTown({ avenue: p.avenue, alley: p.alley, cols: p.cols, center: p.center, names: p.names, grow: p.shops === 200 ? 79 : 0, fixture: true });
  }
  function setParam(k, v) {
    const q = new URLSearchParams(location.search);
    q.set(k, v);
    location.search = q.toString();
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---- 区画の中身の説明 ----
  function lotInfo(town, lot) {
    if (lot.kind === 'public') return { type: 'public', title: lot.publicName, sub: lot.publicKind === 'plot' ? '将来の公共施設の予定地（今は花壇・遊歩道・石畳・緑地）' : town.districts.find((d) => d.id === lot.district)?.center ? '中央の公共施設（店は入らない）' : '地区の目印' };
    if (lot.state === 'vacant') return { type: 'npc', title: 'NPCの家', sub: '空き区画（新しい店が入れる）' };
    const s = town.shops.get(lot.holder);
    if (lot.state === 'held') return { type: 'held', title: '空き家', sub: '閉店した店の区画（猶予中。期限が過ぎたらNPCの家に戻る）', shop: s };
    return { type: s.resting ? 'resting' : 'open', title: s.shop, sub: s.owner, shop: s };
  }
  const SIZE_NAME = { S: 'S（小さな店）', M: 'M（中くらいの店）', L: 'L（大きな店）' };
  const SIZE_SHELVES = { S: '1〜4棚', M: '5〜7棚', L: '8棚' };
  const yen = (n) => (n >= 10000 ? n / 10000 + '万円' : n.toLocaleString() + '円');
  /** 棚の維持費 (今のまま)。家のための追加の維持費は無い */
  const upkeep = (shelves) => yen(T.SHELF_COST[Math.max(0, Math.min(8, shelves) - 1)]);

  /**
   * 店の札 (3案共通の中身)。左右・向かいは常には出さない (opt.neighbors で出す)。
   * 「まわりを見る」は data-around の button。押したら aroundPanel() を出す。
   */
  function shopCard(town, lot, opt) {
    const o = { compact: false, neighbors: false, ...opt };
    const info = lotInfo(town, lot);
    const addr = T.addressText(town, lot);
    const badge = { resting: '<span class="badge rest">改装中（休業）</span>', held: '<span class="badge held">空き家</span>', npc: '<span class="badge npc">NPCの家</span>', public: '<span class="badge pub">目印</span>' }[info.type] || '';
    const isNew = info.shop?.isNew ? '<span class="badge new">新しく入った店</span>' : '';
    const you = (town.fixture && info.shop?.som === town.fixture.you ? '<span class="badge you">あなたの店</span>' : '') + (info.shop?.admin ? '<span class="badge pub">管理人</span>' : '');
    const portrait = info.type === 'open' || info.type === 'resting'
      ? `<div class="portrait" style="--h:${info.shop.hue}"><span>立ち絵の領域<br><small>3:4</small></span></div>`
      : '';
    const live = info.type === 'open' || info.type === 'resting';
    const look = live ? T.lookOf(info.shop) : null;
    const nb = o.neighbors && lot.links ? T.neighborsJson(town, lot.id) : null;
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
        ${live ? `<div class="sz"><span class="lb">店構え</span> ${SIZE_NAME[lot.size]} <span class="dim">棚${info.shop.shelves}・維持費 ${upkeep(info.shop.shelves)}／決算</span></div>
        <div class="sz"><span class="lb">外観</span> <i class="sw" style="background:${look.roof}"></i>${esc(look.name)} <span class="dim">屋根 <i class="sw" style="background:${look.roof}"></i> ドア <i class="sw" style="background:${look.door}"></i></span></div>` : ''}
        ${nb ? `<ul class="nb">${nbRow('left', '左隣')}${nbRow('right', '右隣')}${nbRow('front', '向かい')}</ul>` : ''}
        ${lot.kind === 'shop' ? `<div class="acts"><button class="go" data-around="street">まわりを見る（この通り）</button> <button class="go" data-around="district">地区ぜんぶ</button></div>` : ''}
      </div>
    </div>`;
  }

  /** 「まわりを見る」: 同じ通りの両側か地区ぜんぶを、番地の順に。押すとその店へ */
  function aroundPanel(town, lot, scope) {
    const j = T.aroundJson(town, lot.id, scope);
    const REL = { self: 'ここ', left: '左隣', right: '右隣', front: '向かい' };
    const ST = { npc_house: 'NPCの家', empty_house: '空き家', resting: '休業', landmark: '目印' };
    const byStreet = new Map();
    for (const n of j.lots) byStreet.set(n.street, (byStreet.get(n.street) || []).concat(n));
    const d = town.districts.find((x) => x.id === j.district);
    let h = '';
    for (const [st, ls] of byStreet) {
      const name = d.alleys.find((a) => a.id === st)?.name ?? st;
      h += `<div class="ar-st">${esc(name)}</div>`;
      for (const side of ['north', 'south']) {
        const row = ls.filter((n) => n.side === side && n.state !== 'landmark');
        if (!row.length) continue;
        h += `<div class="ar-row"><span class="dim">${side === 'north' ? '北側' : '南側'}</span>` + row.map((n) =>
          `<button class="ar ${n.rel ? 'rel-' + n.rel : ''} st-${n.state}" data-lot="${n.lot_id}" title="${n.number}番">${n.rel ? `<b>${REL[n.rel]}</b>` : ''}${n.number}<span>${esc(n.state === 'open' ? n.shop : ST[n.state] + (n.shop && n.state === 'resting' ? '・' + n.shop : ''))}</span></button>`).join('') + '</div>';
      }
    }
    return `<div class="around"><div class="ar-h">まわり（${scope === 'district' ? esc(d.name) + 'ぜんぶ' : 'この通りの両側'}）<span class="dim"> 必要なときだけ取る</span></div>${h}
      <details class="json"><summary>Muse に渡る JSON（API案 GET /town/lots/${lot.id}/around?scope=${j.scope}）</summary><pre>${esc(JSON.stringify(j, null, 1))}</pre></details></div>`;
  }

  /** 見出しの切り替え (店数・大通り・路地・地区の幅) と街暦を、#ctl に入れる */
  function controls(p) {
    const host = document.getElementById('ctl');
    if (!host) return;
    const seg = (k, label, opts) => `<span class="lbl">${label}</span><span class="seg" data-k="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(p[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
    host.outerHTML = calendarBadge() + `<button class="btn ctl-tg" type="button">切り替え</button><span class="ctlbox">` + seg('shops', '店数', [[121, '121'], [200, '200']]) + seg('avenue', '大通り', [[3, '96px'], [2, '64px']]) +
      seg('alley', '路地', [[2, '64px'], [1, '32px']]) + seg('cols', '地区', [[6, '6×4区画'], [8, '8×4区画']]) +
      seg('center', '中央', [['public', '公共だけ'], ['admin', '＋管理人の店']]) + seg('names', '地名', [['a', '案A'], ['b', '案B']]) + '</span>';
    document.querySelector('header.bar .ctl-tg').onclick = () => { document.querySelector('header.bar').classList.toggle('ctl-open'); hdr(); };
    document.querySelectorAll('header.bar .seg[data-k]').forEach((el) => (el.onclick = (e) => e.target.dataset.v && setParam(el.dataset.k, e.target.dataset.v)));
    hdr();
  }

  /** 札のボタンをつなぐ: 店へ移る (data-lot) と「まわりを見る」(data-around)。onGo(lotId) */
  function wireCard(el, town, lot, onGo) {
    const bind = () => el.querySelectorAll('button[data-lot]').forEach((b) => (b.onclick = () => onGo(Number(b.dataset.lot))));
    el.querySelectorAll('button[data-around]').forEach((b) => (b.onclick = () => {
      el.querySelector('.around')?.remove();
      const was = b.classList.contains('on');
      el.querySelectorAll('button[data-around]').forEach((x) => x.classList.remove('on'));
      if (!was) { b.classList.add('on'); el.insertAdjacentHTML('beforeend', aroundPanel(town, lot, b.dataset.around)); }
      bind();
      el.dispatchEvent(new CustomEvent('cardresize', { bubbles: true }));
    }));
    bind();
  }

  /** 街暦の置き場 (基準日時と数え方は Codex 側で決める。今は仮の表示) */
  function calendarBadge() {
    return `<span class="cal" title="1期 = 27時間（決算の周期）。基準日時と数え方はまだ決めていない">ミューズ街 第<b>○</b>期</span>`;
  }

  // ---- 上から見た地図 ----
  /**
   * 地区 (または街全体) を描く。地面・建物・小物は canvas (Muse に渡すチャンクと同じマス目から)、
   * 押せる区画と看板は上に重ねた div。単位はチップ、scale は 1チップの px。
   * @returns {HTMLElement}
   */
  function renderTop(town, opt) {
    const o = { districts: town.districts, scale: 16, labels: true, highlight: null, sizeOverride: null, res: 1, signs: true, ...opt };
    const bb = T.bounds(town, o.districts);
    const x1 = bb.x, y1 = bb.y, x2 = bb.x + bb.w, y2 = bb.y + bb.h;
    const s = o.scale, W = x2 - x1, H = y2 - y1;
    const el = document.createElement('div');
    el.className = 'top-map';
    el.style.width = W * s + 'px';
    el.style.height = H * s + 'px';
    el.style.setProperty('--chip', s + 'px');
    // canvas は大きすぎないように (一辺 8192px まで)
    const res = Math.max(0.25, Math.min(o.res, 8192 / (W * s), 8192 / (H * s)));
    const cv = document.createElement('canvas');
    cv.className = 'tiles';
    cv.width = Math.round(W * s * res); cv.height = Math.round(H * s * res);
    cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
    const chunks = T.chunksFor(town, o.districts, { sizeOverride: o.sizeOverride });
    root.Tiles.paint(cv.getContext('2d'), chunks, s * res, x1, y1, W, H);
    el.appendChild(cv);
    const px = (v, base) => (v - base) * s + 'px';
    const bld = new Map();
    for (const ch of chunks) for (const b of ch.buildings) if (b.kind !== 'npc') bld.set(b.lot, b);
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
        if (o.signs && (info.type === 'open' || info.type === 'resting' || info.type === 'held')) {
          const b = bld.get(l.id), up = l.front === 'down';
          const txt = info.type === 'held' ? '空き家' : info.type === 'resting' ? '休業' : s >= 10 ? esc(info.shop.shop) : '';
          div.innerHTML = `<div class="sign ${up ? 'down' : 'up'}">${txt}</div>`;
        } else if (o.signs && l.kind === 'public' && !['fountain', 'park', 'garden', 'market', 'plot', 'bigpark'].includes(l.publicKind) && s >= 10 && !(d.center && l.col % 2 === 1 && ['hall', 'guild', 'tree'].includes(l.publicKind))) {
          div.innerHTML = `<div class="sign pub up">${esc(l.publicName)}</div>`;
        } else if (o.signs && l.publicKind === 'market' && l.row === 2 && (l.col === 1 || l.col === d.cols - 2) && s >= 10) {
          div.innerHTML = `<div class="sign pub up">${esc(l.publicName)}</div>`;
        }
        el.appendChild(div);
      }
      if (o.labels) {
        const lab = document.createElement('div');
        lab.className = 'dlabel';
        lab.className = 'dlabel' + (d.center ? ' center' : '');
        lab.style.left = px(d.x0 + d.w / 2, x1);
        lab.style.top = px(d.y0 + d.h / 2, y1);
        lab.innerHTML = `<b>${esc(d.name)}</b><span>${esc(d.landmark.name)}</span>`;
        // 寄ったときも見える地名の札 (北の大通りの上)
        const plate = document.createElement('div');
        plate.className = 'dplate' + (d.center ? ' center' : '');
        plate.style.left = px(d.x0 + d.w / 2, x1);
        plate.style.top = px(d.y0 - town.opts.avenue / 2, y1);
        plate.textContent = d.name;
        el.appendChild(plate);
        el.appendChild(lab);
      }
    }
    return el;
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

  root.Mock = { T, params, getTown, setParam, esc, lotInfo, shopCard, aroundPanel, wireCard, controls, calendarBadge, renderTop, SIZE_NAME, SIZE_SHELVES, upkeep };
})(globalThis);
