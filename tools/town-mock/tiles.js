// SOLD OUT ミューズ街 P0 見本 — 仮のマップチップ (canvas で描く)。
// 本物の 32px の絵ができたら、tileset 画像 (kit/town/tiles-v1.png) の切り出しに差し替える。
// 人間向けの地図も、Muse に渡すチャンク (TownGen.chunkData) と同じマス目から描く。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';
  const T = root.TownGen;
  const G = T.GROUND, D = T.DECO;
  const hh = (x, y) => T.hash2(x * 92821 + 7, y * 68917 + 3);

  // ---- 地面 (1チップ) ----
  function ground(c, code, x, y, s, gx, gy, nb) {
    nb = nb || (() => code);
    const h = hh(gx, gy);
    const rect = (col, a, b, w, hgt) => { c.fillStyle = col; c.fillRect(x + a * s, y + b * s, w * s, hgt * s); };
    switch (code) {
      case G.grass:
        rect('#8fc06a', 0, 0, 1, 1);
        if (h % 3 === 0) { rect('#7fb35c', ((h >>> 3) % 6) / 8, ((h >>> 6) % 6) / 8, 0.12, 0.12); rect('#7fb35c', ((h >>> 9) % 6) / 8 + 0.1, ((h >>> 12) % 6) / 8, 0.1, 0.1); }
        break;
      case G.lawn:
        rect('#a3cf7c', 0, 0, 1, 1);
        if (h % 4 === 0) rect('#b4da8f', ((h >>> 3) % 6) / 8, ((h >>> 6) % 6) / 8, 0.14, 0.08);
        break;
      case G.avenue: {
        rect('#c9bfa9', 0, 0, 1, 1);
        c.fillStyle = 'rgba(0,0,0,.07)';
        const off = gy % 2 ? 0.5 : 0;
        c.fillRect(x, y + s * 0.5 - 0.5, s, 1);
        c.fillRect(x + s * ((0.25 + off) % 1), y, 1, s * 0.5);
        c.fillRect(x + s * ((0.75 + off) % 1), y + s * 0.5, 1, s * 0.5);
        break;
      }
      case G.curb: // 歩道 (大通りの両端)。車道と色を少しだけ変える
        rect('#d6ccb6', 0, 0, 1, 1);
        c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x + 1, y + 1, s - 2, s - 2);
        break;
      case G.alley:
        rect('#e3d4b2', 0, 0, 1, 1);
        if (h % 5 === 0) rect('#d6c59f', ((h >>> 3) % 5) / 6, ((h >>> 6) % 5) / 6, 0.18, 0.1);
        break;
      case G.canal: {
        // 川: 岸 (陸と接する辺) に石積み。上下の岸は隣のマスを見て決める (チップの「岸・上」「岸・下」)
        const wet = (v) => v === G.canal || v === G.bridge;
        rect('#5fa6d2', 0, 0, 1, 1);
        rect('#86c1e3', ((h >>> 2) % 4) / 5, 0.3, 0.3, 0.06);
        rect('#86c1e3', ((h >>> 5) % 4) / 5 + 0.1, 0.65, 0.25, 0.06);
        if (!wet(nb(0, -1))) { rect('#a39880', 0, 0, 1, 0.2); rect('#8a7f68', 0, 0.2, 1, 0.05); }
        if (!wet(nb(0, 1))) { rect('#8a7f68', 0, 0.75, 1, 0.05); rect('#a39880', 0, 0.8, 1, 0.2); }
        if (!wet(nb(-1, 0))) rect('#a39880', 0, 0, 0.15, 1);
        if (!wet(nb(1, 0))) rect('#a39880', 0.85, 0, 0.15, 1);
        break;
      }
      case G.bridge: {
        // 橋: 川の上は板張り、両端 (陸へ延びた1マス) は石の橋台。左右の端に欄干
        const overWater = nb(0, 0, 'water');
        rect(overWater ? '#b08a58' : '#c4b89c', 0, 0, 1, 1);
        if (overWater) { c.fillStyle = 'rgba(0,0,0,.12)'; for (let k = 1; k < 4; k++) c.fillRect(x, y + (k * s) / 4, s, Math.max(1, s / 24)); }
        else { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(x + s / 2, y, 1, s); }
        const rail = '#6e4e2a';
        if (nb(-1, 0) !== G.bridge) { rect(rail, 0, 0, 0.14, 1); if (!overWater) rect('#8a7f68', 0, 0, 0.14, 1); }
        if (nb(1, 0) !== G.bridge) { rect(rail, 0.86, 0, 0.14, 1); if (!overWater) rect('#8a7f68', 0.86, 0, 0.14, 1); }
        if (nb(0, -1) !== G.bridge) rect('rgba(0,0,0,.15)', 0, 0, 1, 0.06);
        if (nb(0, 1) !== G.bridge) rect('rgba(0,0,0,.15)', 0, 0.94, 1, 0.06);
        break;
      }
      case G.hedge:
        rect('#8fc06a', 0, 0, 1, 1);
        c.fillStyle = '#3f7a30'; c.beginPath(); c.arc(x + s / 2, y + s / 2, s * 0.5, 0, 7); c.fill();
        c.fillStyle = '#56953f'; c.beginPath(); c.arc(x + s * 0.4, y + s * 0.4, s * 0.25, 0, 7); c.fill();
        break;
      case G.plaza:
        rect((gx + gy) % 2 ? '#e7dfcd' : '#ddd3bd', 0, 0, 1, 1);
        break;
      case G.path:
        rect('#a3cf7c', 0, 0, 1, 1);
        rect('#d9ccae', 0.2, 0.08, 0.6, 0.36); rect('#d9ccae', 0.2, 0.56, 0.6, 0.36);
        break;
      case G.flowerbed: {
        rect('#7a5a3c', 0.04, 0.04, 0.92, 0.92);
        const cols = ['#f4d24d', '#e86a7a', '#f2f2f2', '#b07ad6'];
        for (let i = 0; i < 4; i++) {
          c.fillStyle = cols[(h + i) % 4];
          c.beginPath(); c.arc(x + s * (0.28 + (i % 2) * 0.44), y + s * (0.28 + (i >> 1) * 0.44), s * 0.13, 0, 7); c.fill();
        }
        break;
      }
      case G.field:
        rect('#8a6a45', 0, 0, 1, 1);
        rect('#6f9a3e', 0.1, 0.3, 0.8, 0.12); rect('#6f9a3e', 0.1, 0.7, 0.8, 0.12);
        break;
      default:
        rect('#8fc06a', 0, 0, 1, 1);
    }
  }

  // ---- 小物 (1チップ) ----
  function circle(c, col, x, y, r) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
  function deco(c, code, x, y, s) {
    const cx = x + s / 2, cy = y + s / 2;
    switch (code) {
      case D.tree:
      case D.street_tree:
        if (code === D.street_tree) { c.fillStyle = '#8f8572'; c.fillRect(x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6); }
        circle(c, 'rgba(0,0,0,.18)', cx + s * 0.1, cy + s * 0.12, s * 0.46);
        circle(c, '#3b7a2f', cx, cy, s * 0.46);
        circle(c, '#4f9640', cx - s * 0.1, cy - s * 0.1, s * 0.3);
        circle(c, '#6ab152', cx - s * 0.16, cy - s * 0.16, s * 0.12);
        break;
      case D.bush:
        circle(c, 'rgba(0,0,0,.15)', cx + s * 0.06, cy + s * 0.08, s * 0.3);
        circle(c, '#4a8a3a', cx, cy, s * 0.3);
        circle(c, '#e86a7a', cx + s * 0.1, cy - s * 0.08, s * 0.06);
        break;
      case D.lamp:
        circle(c, 'rgba(0,0,0,.2)', cx + 2, cy + 2, s * 0.14);
        circle(c, '#3a3a3a', cx, cy, s * 0.14);
        circle(c, '#ffe27a', cx, cy, s * 0.08);
        break;
      case D.bench:
        c.fillStyle = '#7b5a36'; c.fillRect(x + s * 0.1, y + s * 0.35, s * 0.8, s * 0.3);
        c.fillStyle = '#5c4126'; c.fillRect(x + s * 0.1, y + s * 0.48, s * 0.8, s * 0.04);
        break;
      case D.pot:
        circle(c, '#b8643c', cx, cy, s * 0.26);
        circle(c, '#4f9640', cx, cy, s * 0.17);
        circle(c, '#f4d24d', cx, cy, s * 0.06);
        break;
      case D.mailbox:
        c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + s * 0.36, y + s * 0.34, s * 0.34, s * 0.4);
        c.fillStyle = '#c8402f'; c.fillRect(x + s * 0.32, y + s * 0.3, s * 0.34, s * 0.4);
        c.fillStyle = '#fff'; c.fillRect(x + s * 0.36, y + s * 0.42, s * 0.26, s * 0.04);
        break;
      case D.crate:
        c.fillStyle = '#a77b47'; c.fillRect(x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6);
        c.strokeStyle = '#6e4e2a'; c.lineWidth = Math.max(1, s / 16);
        c.strokeRect(x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6);
        c.beginPath(); c.moveTo(x + s * 0.2, y + s * 0.2); c.lineTo(x + s * 0.8, y + s * 0.8); c.stroke();
        break;
      case D.reed:
        c.strokeStyle = '#5d8a3a'; c.lineWidth = Math.max(1, s / 16);
        for (const f of [0.25, 0.45, 0.65]) { c.beginPath(); c.moveTo(x + s * f, y + s * 0.9); c.lineTo(x + s * (f + 0.08), y + s * 0.2); c.stroke(); }
        circle(c, '#7a5a3c', x + s * 0.53, y + s * 0.22, s * 0.06);
        break;
      case D.flowers: {
        const cols = ['#f4d24d', '#e86a7a', '#ffffff', '#b07ad6'];
        for (let i = 0; i < 5; i++) circle(c, cols[(i + Math.floor(x + y)) % 4], x + s * (0.2 + ((i * 37) % 60) / 100), y + s * (0.2 + ((i * 53) % 60) / 100), s * 0.07);
        break;
      }
      case D.scarecrow:
        c.fillStyle = '#7b5a36'; c.fillRect(cx - s * 0.04, y + s * 0.1, s * 0.08, s * 0.8); c.fillRect(x + s * 0.15, cy - s * 0.04, s * 0.7, s * 0.08);
        circle(c, '#d9b65a', cx, y + s * 0.3, s * 0.16);
        break;
    }
  }

  // ---- 建物 (上から見た屋根。戸口は路地の側) ----
  function building(c, b, s, ox, oy) {
    const x = (b.x - ox) * s, y = (b.y - oy) * s, w = b.w * s, h = b.h * s;
    const p = b.palette;
    const down = b.door === 'down';
    // 影
    c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x + s * 0.18, y + s * 0.18, w, h);
    // 壁の見える帯 (店先の側)
    const band = Math.max(2, s * (b.w >= 4 ? 0.45 : 0.35));
    c.fillStyle = p.wall;
    c.fillRect(x, down ? y + h - band : y, w, band);
    // 屋根 (切妻。棟は店先と平行)
    const ry = down ? y : y + band, rh = h - band;
    c.fillStyle = p.roof; c.fillRect(x, ry, w, rh);
    c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(x, ry, w, rh / 2);
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x, ry + rh / 2 - 0.5, w, Math.max(1, s / 16));
    // 瓦の筋
    c.fillStyle = 'rgba(0,0,0,.08)';
    for (let k = 1; k < b.w * 2; k++) c.fillRect(x + (k * s) / 2, ry, 1, rh);
    // 軒
    c.strokeStyle = p.trim; c.lineWidth = Math.max(1, s / 14); c.strokeRect(x + 0.5, ry + 0.5, w - 1, rh - 1);
    // 煙突
    if (b.w >= 4) { c.fillStyle = '#7a6a5a'; c.fillRect(x + w * 0.72, ry + rh * 0.12, s * 0.4, s * 0.4); }
    // 戸と窓 (壁の帯に)
    const by = down ? y + h - band : y;
    const dw = s * (b.kind === 'shop' || b.kind === 'held' ? 0.7 : 0.5);
    c.fillStyle = p.door; c.fillRect(x + w / 2 - dw / 2, by + band * 0.15, dw, band * 0.85);
    c.fillStyle = '#bfe0f2';
    const wins = b.w >= 4 ? [0.18, 0.82] : [0.2];
    for (const f of wins) c.fillRect(x + w * f - s * 0.18, by + band * 0.25, s * 0.36, band * 0.45);
    // 店の日除け (開いている店だけ)
    if (b.kind === 'shop' && !b.resting) {
      const ay = down ? y + h - band - s * 0.12 : y + band;
      for (let k = 0; k < b.w * 2; k++) { c.fillStyle = k % 2 ? p.trim : p.roof; c.fillRect(x + (k * s) / 2, ay, s / 2, s * 0.12); }
    }
    if (b.kind === 'held') { c.fillStyle = 'rgba(80,80,80,.25)'; c.fillRect(x, y, w, h); }
    if (b.resting) { // 改装中の足場
      c.strokeStyle = '#d29a2a'; c.lineWidth = Math.max(1, s / 12);
      for (let k = 0; k <= b.w; k++) { c.beginPath(); c.moveTo(x + k * s, y); c.lineTo(x + k * s, y + h); c.stroke(); }
    }
  }

  function object(c, o, s, ox, oy) {
    const x = (o.x - ox) * s, y = (o.y - oy) * s, w = o.w * s, h = o.h * s;
    const cx = x + w / 2, cy = y + h / 2;
    if (o.kind === 'fountain') {
      circle(c, 'rgba(0,0,0,.15)', cx + s * 0.15, cy + s * 0.15, w * 0.48);
      circle(c, '#b9ad94', cx, cy, w * 0.48);
      circle(c, '#6fb0d8', cx, cy, w * 0.4);
      circle(c, '#9fd2ee', cx - w * 0.08, cy - w * 0.08, w * 0.16);
      circle(c, '#b9ad94', cx, cy, w * 0.1);
      circle(c, '#e9f6fd', cx, cy, w * 0.05);
      return;
    }
    if (o.kind === 'facility') return facility(c, o, x, y, w, h, s);
    // 目印 (仮の絵)
    const col = { clock: '#8a6a4a', bridge: '#9a8f78', well: '#7d7468', board: '#7b5a36', ginkgo: '#d9b23a', bench: '#7b5a36', lamp: '#3a3a3a', pier: '#7b5a36', mill: '#8a6a4a', bell: '#9a8f78', star: '#4a5a8a', vane: '#7b5a36', anvil: '#555b66', stone: '#7d8a6a', flower: '#e8e1d2' }[o.sub] || '#7b5a36';
    if (o.sub === 'flower') { circle(c, '#4f9640', cx, cy, w * 0.5); for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; circle(c, ['#f4d24d', '#e86a7a', '#fff', '#b07ad6'][i % 4], cx + Math.cos(a) * w * 0.36, cy + Math.sin(a) * w * 0.36, w * 0.08); } c.fillStyle = '#333'; c.fillRect(cx - 1, cy - w * 0.25, 2, w * 0.25); return; }
    if (o.sub === 'stone') { circle(c, 'rgba(0,0,0,.2)', cx + 3, cy + 3, w * 0.42); circle(c, '#8c9384', cx, cy, w * 0.42); circle(c, '#6f9a4a', cx - w * 0.1, cy - w * 0.12, w * 0.2); return; }
    if (o.sub === 'mill') { c.fillStyle = '#8a6a4a'; c.fillRect(x, y, w, h); c.strokeStyle = '#5c4126'; c.lineWidth = Math.max(2, s / 6); for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * w * 0.7, cy + Math.sin(a) * w * 0.7); c.stroke(); } circle(c, '#5c4126', cx, cy, w * 0.12); return; }
    if (o.sub === 'ginkgo') { circle(c, 'rgba(0,0,0,.18)', cx + 4, cy + 4, w * 0.6); circle(c, '#d9b23a', cx, cy, w * 0.6); circle(c, '#f0cf55', cx - w * 0.15, cy - w * 0.15, w * 0.3); return; }
    if (o.sub === 'well') { circle(c, '#7d7468', cx, cy, w * 0.45); circle(c, '#3d5a6b', cx, cy, w * 0.3); return; }
    if (o.sub === 'pier') { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + 3, y + 3, w, h); c.fillStyle = '#b08a58'; c.fillRect(x, y, w, h); c.fillStyle = 'rgba(0,0,0,.15)'; for (let k = 1; k < 4; k++) c.fillRect(x, y + (k * h) / 4, w, 1); circle(c, '#6e4e2a', x + 3, y + 3, s * 0.12); circle(c, '#6e4e2a', x + w - 3, y + 3, s * 0.12); c.strokeStyle = '#d9c9a8'; c.lineWidth = 2; c.beginPath(); c.arc(x + w * 0.7, y + h * 0.7, s * 0.3, 0, 6.3); c.stroke(); return; }
    c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + 4, y + 4, w, h);
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x, y, w, h / 2);
    if (o.sub === 'clock') { circle(c, '#fff8e6', cx, cy, w * 0.3); c.fillStyle = '#333'; c.fillRect(cx - 1, cy - w * 0.22, 2, w * 0.22); c.fillRect(cx, cy - 1, w * 0.16, 2); }
    if (o.sub === 'lamp') circle(c, '#ffe27a', cx, cy, w * 0.22);
    if (o.sub === 'bell') { circle(c, '#d9b23a', cx, cy, w * 0.25); circle(c, '#a5801e', cx, cy, w * 0.1); }
    if (o.sub === 'star') { circle(c, '#c8d4ef', cx, cy, w * 0.34); circle(c, '#4a5a8a', cx + w * 0.08, cy - w * 0.08, w * 0.12); }
    if (o.sub === 'vane') { c.fillStyle = '#d9b23a'; c.fillRect(cx - w * 0.3, cy - 1, w * 0.6, 3); c.fillRect(cx - 1, cy - w * 0.3, 3, w * 0.6); }
    if (o.sub === 'anvil') { c.fillStyle = '#2f343c'; c.fillRect(cx - w * 0.25, cy - w * 0.12, w * 0.5, w * 0.24); circle(c, '#ff8a3d', cx + w * 0.3, cy + w * 0.25, w * 0.08); }
  }

  /** 中央の公共施設 (仮の絵)。屋根の形で見分ける */
  function facility(c, o, x, y, w, h, s) {
    const down = o.door !== 'up';
    const shadow = () => { c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x + s * 0.25, y + s * 0.25, w, h); };
    const roof = (col, ridge) => {
      c.fillStyle = col; c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x, y, w, h / 2);
      c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x, y + h / 2 - 1, w, Math.max(2, s / 12));
      if (ridge) { c.fillStyle = 'rgba(0,0,0,.08)'; for (let k = 1; k < o.w * 2; k++) c.fillRect(x + (k * s) / 2, y, 1, h); }
    };
    const door = (col) => { c.fillStyle = col; c.fillRect(x + w / 2 - s * 0.6, down ? y + h - s * 0.35 : y, s * 1.2, s * 0.35); };
    if (o.sub === 'bigtree') {
      circle(c, 'rgba(0,0,0,.2)', x + w / 2 + s * 0.4, y + h / 2 + s * 0.4, Math.min(w, h) * 0.55);
      circle(c, '#2f6b28', x + w / 2, y + h / 2, Math.min(w, h) * 0.55);
      circle(c, '#3d8a33', x + w * 0.4, y + h * 0.42, Math.min(w, h) * 0.36);
      circle(c, '#5aa647', x + w * 0.36, y + h * 0.36, Math.min(w, h) * 0.16);
      circle(c, '#f4d24d', x + w * 0.62, y + h * 0.6, s * 0.12); circle(c, '#f4d24d', x + w * 0.3, y + h * 0.66, s * 0.1);
      return;
    }
    if (o.sub === 'board') {
      shadow(); c.fillStyle = '#7b5a36'; c.fillRect(x, y + h * 0.25, w, h * 0.5);
      for (let i = 0; i < 5; i++) { c.fillStyle = ['#fff8e6', '#ffe0e6', '#e6f0ff'][i % 3]; c.fillRect(x + s * 0.3 + i * (w - s * 0.6) / 5, y + h * 0.32, (w - s * 0.6) / 6, h * 0.34); }
      return;
    }
    shadow();
    if (o.sub === 'hall') {
      roof('#a3473a', true); door('#5a3a24');
      const tx = x + w / 2 - s, ty = y + h / 2 - s; // 時計塔
      c.fillStyle = '#e9dcc8'; c.fillRect(tx, ty, s * 2, s * 2); c.fillStyle = '#7a3328'; c.fillRect(tx + s * 0.2, ty + s * 0.2, s * 1.6, s * 1.6);
      circle(c, '#fff8e6', tx + s, ty + s, s * 0.6); c.fillStyle = '#333'; c.fillRect(tx + s - 1, ty + s * 0.5, 2, s * 0.5); c.fillRect(tx + s, ty + s - 1, s * 0.35, 2);
      return;
    }
    if (o.sub === 'guild') {
      roof('#3f5f8f', true); door('#2a3350');
      for (const f of [0.18, 0.5, 0.82]) { c.fillStyle = '#c8402f'; c.fillRect(x + w * f - s * 0.25, down ? y + h - s * 1.1 : y + s * 0.2, s * 0.5, s * 0.9); c.fillStyle = '#f4d24d'; c.fillRect(x + w * f - s * 0.1, down ? y + h - s * 0.9 : y + s * 0.4, s * 0.2, s * 0.2); }
      return;
    }
    if (o.sub === 'market') {
      roof('#c08a1e', true); door('#7a4e1c');
      c.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < o.w; k += 2) c.fillRect(x + k * s + s * 0.2, y + s * 0.3, s * 0.6, h - s * 0.6);
      return;
    }
    if (o.sub === 'stalls') {
      const cols = ['#c8402f', '#3f6fa0', '#5b8c3e', '#c08a1e', '#8b5a9e'];
      c.fillStyle = 'rgba(0,0,0,0)';
      let i = 0;
      for (let yy = 0; yy + 2 <= o.h; yy += 2.5) for (let xx = 0; xx + 2 <= o.w; xx += 2.5) {
        const sx = x + xx * s, sy = y + yy * s, col = cols[i++ % cols.length];
        c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(sx + 3, sy + 3, s * 2, s * 2);
        for (let k = 0; k < 4; k++) { c.fillStyle = k % 2 ? '#fff8e6' : col; c.fillRect(sx + (k * s) / 2, sy, s / 2, s * 2); }
      }
      return;
    }
    roof('#7b5a36', true);
  }

  /**
   * チャンクをいくつか、1枚の canvas に描く。チャンクは重ならない (どのマスも持ち主は1つ) ので、そのまま並べて描く。
   * 岸と橋の欄干は隣のマスを見て決める (隣のチャンクのマスも見る)。
   * @param {CanvasRenderingContext2D} c
   * @param {object[]} chunks TownGen.chunkAt / chunksFor の返り値
   * @param {number} s 1チップの px
   * @param {number} ox 描き始めのチップ座標 (左上)
   */
  function paint(c, chunks, s, ox, oy, wChips, hChips) {
    const byPos = new Map(chunks.map((ch) => [ch.origin[0] + ',' + ch.origin[1], ch]));
    const [CW, CH] = chunks[0].size;
    const at = (x, y) => {
      const cx = chunks[0].origin[0] + Math.floor((x - chunks[0].origin[0]) / CW) * CW;
      const cy = chunks[0].origin[1] + Math.floor((y - chunks[0].origin[1]) / CH) * CH;
      const ch = byPos.get(cx + ',' + cy);
      return ch ? ch.ground[(y - cy) * CW + (x - cx)] : G.grass;
    };
    // 橋の下が川か (チャンクの bridges の water の範囲)
    const overWater = new Set();
    for (const ch of chunks) for (const b of ch.bridges || []) for (let y = b.water[0]; y < b.water[1]; y++) for (let x = b.x; x < b.x + b.w; x++) overWater.add(x + ',' + y);
    c.fillStyle = '#8fc06a'; c.fillRect(0, 0, wChips * s, hChips * s);
    for (const ch of chunks) {
      const [X, Y] = ch.origin, [W, H] = ch.size;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const gx = X + i, gy = Y + j;
        const nb = (dx, dy, q) => (q === 'water' ? overWater.has(gx + ',' + gy) : at(gx + dx, gy + dy));
        ground(c, ch.ground[j * W + i], (gx - ox) * s, (gy - oy) * s, s, gx, gy, nb);
      }
    }
    for (const ch of chunks) for (const o of ch.objects) object(c, o, s, ox, oy);
    for (const ch of chunks) for (const b of ch.buildings) building(c, b, s, ox, oy);
    for (const ch of chunks) {
      const [X, Y] = ch.origin, [W, H] = ch.size;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const v = ch.deco[j * W + i];
        if (v) deco(c, v, (X + i - ox) * s, (Y + j - oy) * s, s);
      }
    }
  }

  /** 見本用: 地面と小物の一覧表 (tiles.html) */
  function sheet(c, s) {
    const gs = Object.entries(G), ds = Object.entries(D).filter(([, v]) => v);
    gs.forEach(([, v], i) => ground(c, v, i * (s + 8), 0, s, i, 0));
    ds.forEach(([, v], i) => { ground(c, G.lawn, i * (s + 8), s + 24, s, i, 1); deco(c, v, i * (s + 8), s + 24, s); });
    return { ground: gs.map(([k]) => k), deco: ds.map(([k]) => k) };
  }

  root.Tiles = { ground, deco, building, object, paint, sheet };
})(globalThis);
