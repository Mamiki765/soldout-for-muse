// SOLD OUT Muse街 P0 — PNG アトラスの描画。配置データは TownGen が作る。
// GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';
  const T = root.TownGen;
  const A = root.TownTileset;
  const G = T.GROUND;
  const D = T.DECO;
  const frames = new Map();
  // 絵の置き場。見本 (tools/town-mock) はリポジトリの kit/town、本番の観戦画面は TOWN_ART_DIR で渡す
  const artDir = new URL(root.TOWN_ART_DIR || '../../kit/town/', document.currentScript.src);
  const ready = Promise.all(Object.values(A.atlases).map((atlas) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(atlas.file));
    for (const [name, rect] of Object.entries(atlas.frames)) frames.set(name, { image, rect });
    image.src = new URL(atlas.file, artDir).href;
  })));

  function withAssets(start) {
    ready.then(start).catch((error) => {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = '地図を表示できませんでした。';
      document.body.appendChild(message);
      console.error(error);
    });
  }

  // Round shared edges, rather than independently rounding each width.
  function raster(c, s, ox, oy) {
    c.imageSmoothingEnabled = false;
    return (image, source, x, y, w, h) => {
      const l = Math.round((x - ox) * s), t = Math.round((y - oy) * s);
      const r = Math.round((x + w - ox) * s), b = Math.round((y + h - oy) * s);
      if (r > l && b > t) c.drawImage(image, ...source, l, t, r - l, b - t);
    };
  }

  function draw(r, name, x, y, w, h) {
    const { image, rect } = frames.get(name);
    r(image, rect, x, y, w, h);
  }

  function bytes(hex) {
    const literal = hex.length === 4 ? '#' + [...hex.slice(1)].map((n) => n + n).join('') : hex;
    const value = Number.parseInt(literal.slice(1), 16);
    return [value >>> 16, (value >> 8) & 255, value & 255];
  }

  function shades(group, base) {
    const exact = (group === 'roof' || group === 'door') && A.colors[group].find(
      (item) => item.tones[group === 'roof' ? 2 : 1] === base.toLowerCase()
    );
    if (exact) return exact.tones;
    const ratios = {
      roof: [0.69, 0.82, 1, 1.16, 1.32],
      door: [0.71, 1, 1.23, 1.44],
      wall: [0.82, 1, 1.06],
      trim: [0.88, 1],
    }[group];
    const rgb = bytes(base);
    return ratios.map((ratio) => 'rgb(' + rgb.map((v) => Math.min(255, Math.round(v * ratio))).join(',') + ')');
  }

  const colored = new Map();
  const scratch = document.createElement('canvas');
  function shopImage(key, palette) {
    const cacheKey = [key, palette.roof, palette.door, palette.wall, palette.trim].join('/');
    if (colored.has(cacheKey)) {
      const cached = colored.get(cacheKey);
      colored.delete(cacheKey);
      colored.set(cacheKey, cached);
      return cached;
    }
    const entry = A.shops[key];
    const { image, rect } = frames.get(entry.base), [, , size] = rect;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const c = sprite.getContext('2d');
    c.drawImage(image, ...rect, 0, 0, size, size);
    if (scratch.width !== size) scratch.width = scratch.height = size;
    const m = scratch.getContext('2d');
    // Use alpha composition, so this also works on file:// without pixel readback.
    for (const [group, names] of Object.entries(entry.groups)) {
      const colors = shades(group, palette[group]);
      for (const [index, name] of names.entries()) {
        const mask = frames.get(name);
        m.globalCompositeOperation = 'copy';
        m.fillStyle = colors[index];
        m.fillRect(0, 0, size, size);
        m.globalCompositeOperation = 'destination-in';
        m.drawImage(mask.image, ...mask.rect, 0, 0, size, size);
        c.drawImage(scratch, 0, 0);
      }
    }
    colored.set(cacheKey, sprite);
    if (colored.size > 128) colored.delete(colored.keys().next().value);
    return sprite;
  }

  const sizeKey = (b) => b.size ?? (b.w === 2 ? 'S' : b.w === 4 ? 'M' : 'L');
  const shopKey = (b) => sizeKey(b) + (b.door === 'up' ? '-north' : '-south');
  function drawBuilding(r, b) {
    const image = shopImage(shopKey(b), b.palette);
    r(image, [0, 0, image.width, image.height], b.x, b.y, b.w, b.h);
    if (b.resting) draw(r, 'scaffold-' + sizeKey(b), b.x, b.y, b.w, b.h);
  }

  function drawThreshold(r, b, lot) {
    const entry = A.shops[shopKey(b)];
    const north = b.door === 'up', px = 1 / A.chip;
    const middle = b.x + b.w / 2;
    const edge = north ? lot.y : lot.y + lot.h;
    const other = b.y + entry.front * px;
    const start = Math.min(edge, other), end = Math.max(edge, other);
    // Start at the ground-side anchor of the window or door sprite.
    for (let y = start; y < end; y += 1) {
      const h = Math.min(1, end - y);
      draw(r, 'threshold', middle - 10 * px, y, 20 * px, h);
    }
  }

  function lookup(chunks) {
    const [w, h] = chunks[0].size;
    const [ox, oy] = chunks[0].origin;
    const grid = new Map(chunks.map((ch) => [ch.origin.join(','), ch]));
    return (x, y) => {
      const cx = ox + Math.floor((x - ox) / w) * w;
      const cy = oy + Math.floor((y - oy) / h) * h;
      const ch = grid.get(cx + ',' + cy);
      return ch?.ground[(y - cy) * w + x - cx];
    };
  }

  function drawGround(r, code, x, y, at) {
    const variant = T.hash2(x * 92821 + 7, y * 68917 + 3) % 4;
    if (code === G.canal) {
      const dry = (v) => v !== undefined && v !== G.canal && v !== G.bridge;
      const mask = (dry(at(x, y - 1)) ? 1 : 0) | (dry(at(x, y + 1)) ? 2 : 0) |
        (dry(at(x - 1, y)) ? 4 : 0) | (dry(at(x + 1, y)) ? 8 : 0);
      draw(r, A.water[mask][variant], x, y, 1, 1);
      return;
    }
    if (code === G.path) {
      const path = (v) => v === G.path;
      const mask = (path(at(x, y - 1)) ? 1 : 0) | (path(at(x, y + 1)) ? 2 : 0) |
        (path(at(x - 1, y)) ? 4 : 0) | (path(at(x + 1, y)) ? 8 : 0);
      draw(r, A.paths[mask], x, y, 1, 1);
      return;
    }
    draw(r, A.ground[code === G.bridge ? G.avenue : code][variant], x, y, 1, 1);
  }

  const pickDeco = (code, x, y) => {
    const options = A.deco[code];
    return options[T.hash2(x, y) % options.length];
  };

  function drawObject(r, o, at) {
    if (o.kind === 'fountain') {
      draw(r, 'fountain-paving', o.x - 1.5, o.y - 1, 7, 6);
      draw(r, 'fountain', o.x, o.y, o.w, o.h);
      return;
    }
    if (o.sub === 'pier' && o.w === 4) {
      const southBank = at(o.x, o.y - 1) === G.canal;
      draw(r, southBank ? 'pier' : 'pier-north', o.x, o.y - (southBank ? 1 : 0), 4, 4);
      return;
    }
    if (o.sub === 'stalls') {
      let i = 0;
      for (let y = 0; y + 2 <= o.h; y += 2) {
        for (let x = 0; x + 2 <= o.w; x += 2.5) {
          draw(r, 'stall-' + i++ % 4, o.x + x, o.y + y, 2, 2);
        }
      }
      return;
    }
    if (o.kind === 'facility') {
      const frame = o.sub === 'market' && o.w > 10 ? 'market-wide' : o.sub;
      draw(r, frame, o.x, o.y, o.w, o.h);
      return;
    }
    if (A.marks[o.sub]) draw(r, A.marks[o.sub], o.x, o.y, o.w, o.h);
  }

  function paint(c, chunks, s, ox, oy, w, h, options = {}) {
    const at = lookup(options.neighbors ?? chunks);
    const r = raster(c, s, ox, oy);
    if (!options.partial) {
      c.fillStyle = '#9bae80';
      c.fillRect(0, 0, Math.round(w * s), Math.round(h * s));
    }
    for (const ch of chunks) {
      const [x, y] = ch.origin, [cw, chh] = ch.size;
      const occupied = new Set();
      const objects = ch.objects;
      const lotById = new Map(ch.lots.map((lot) => [lot.id, lot]));
      const activeLots = new Set(ch.buildings.filter((b) => b.kind !== 'npc').map((b) => b.lot));
      const fixedPaths = new Set();
      for (const b of ch.buildings) {
        for (let j = b.y; j < b.y + b.h; j++) {
          for (let i = b.x; i < b.x + b.w; i++) occupied.add((j - y) * cw + i - x);
        }
      }
      let corner;
      for (const lot of ch.lots) {
        if (lot.public === 'lamp' && at(lot.x - 1, lot.y - 1) === G.bridge) corner = lot;
        if (!activeLots.has(lot.id)) continue;
        for (let j = lot.y; j < lot.y + lot.h; j++) {
          for (let i = lot.x; i < lot.x + lot.w; i++) {
            const idx = (j - y) * cw + i - x;
            if (ch.ground[idx] === G.path) fixedPaths.add(idx);
          }
        }
      }
      for (let j = 0; j < chh; j++) {
        for (let i = 0; i < cw; i++) {
          const idx = j * cw + i, gx = x + i, gy = y + j;
          let code = fixedPaths.has(idx) ? G.lawn : ch.ground[idx];
          if (corner && gx === corner.x - 1 && gy >= corner.y && gy < corner.y + corner.h && code === G.curb) {
            code = G.plaza;
          }
          drawGround(r, code, gx, gy, at);
        }
      }
      for (const b of ch.bridges) draw(r, A.bridges[b.w], b.x, b.y, b.w, b.h);
      if (ch.part === 'east') {
        // The 6×3 pool is encoded as canal cells inside the park, separate from the river.
        for (let j = 0; j < chh; j++) {
          for (let i = 0; i < cw; i++) {
            const gx = x + i, gy = y + j;
            if (ch.ground[j * cw + i] === G.canal && at(gx - 1, gy) === G.lawn &&
                at(gx, gy - 1) === G.lawn && at(gx, gy + 2) === G.canal) {
              draw(r, 'park-pond', gx, gy, 6, 3);
            }
          }
        }
      }
      if (corner) draw(r, 'public-corner', corner.x, corner.y, corner.w, corner.h);
      for (const o of objects) {
        if (!(corner && o.sub === 'lamp')) drawObject(r, o, at);
      }
      for (const b of ch.buildings) {
        if (b.kind !== 'npc') drawThreshold(r, b, lotById.get(b.lot));
      }
      for (let j = 0; j < chh; j++) {
        for (let i = 0; i < cw; i++) {
          const idx = j * cw + i, code = ch.deco[idx], gx = x + i, gy = y + j;
          if (!code || occupied.has(idx)) continue;
          if (corner && gx >= corner.x && gx < corner.x + corner.w && gy >= corner.y && gy < corner.y + corner.h) continue;
          draw(r, pickDeco(code, gx, gy), gx, gy, 1, 1);
        }
      }
      for (const b of ch.buildings) drawBuilding(r, b);
    }
  }

  function sheet(c, s) {
    const ground = Object.keys(G), deco = Object.keys(D).filter((name) => D[name] !== D.none);
    const r = raster(c, s, 0, 0), step = (s + 8) / s, row = (s + 24) / s;
    ground.forEach((name, i) => {
      if (name === 'bridge') draw(r, 'bridge-3', i * step, 0, 1, 1);
      else drawGround(r, G[name], i * step, 0, () => G[name]);
    });
    deco.forEach((name, i) => {
      draw(r, A.ground[G.lawn][0], i * step, row, 1, 1);
      draw(r, A.deco[D[name]][0], i * step, row, 1, 1);
    });
    return { ground, deco };
  }
  const building = (c, b, s, ox, oy) => drawBuilding(raster(c, s, ox, oy), b);
  root.Tiles = { ready, withAssets, paint, sheet, building };
})(globalThis);
