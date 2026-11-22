// SOLD OUT ミューズ街 P0 見本 — 街の生成 (区画・道・配置・ご近所・増えたときの割り当て)。
// 本体 (src/) とは別。ブラウザでは <script> で読み、node では check.mjs が vm で読む。
// 本番の DB には触らない。店はダミー。名前はすべて仮 (名前は Muse が決める)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';

  // ---- 寸法 (32px チップ単位) ----
  const CHIP = 32;
  const MOD = 2; // 敷地マス 1つ = 2×2 チップ = 64px
  const LOT = 3 * MOD; // 区画 = 3×3 敷地マス = 6×6 チップ = 192px (L の家がちょうど入る)
  const COLS = 6; // 1列に並ぶ区画の数
  const ROWS = 4; // 区画の列 (路地 2本 × 両側)
  const ALLEY = 1; // 店先の路地 = 1チップ (32px)
  const STRIP = 1; // 裏どうしの間 (水路か生け垣) = 1チップ
  const INNER_W = COLS * LOT; // 36
  const INNER_H = 2 * (LOT + ALLEY + LOT) + STRIP; // 27
  /** 家の大きさ → 建物の一辺 (チップ) */
  const HOME = { S: 2, M: 4, L: 6 };

  // ---- 乱数 ----
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b) {
    let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  }
  function shuffle(arr, r) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- 地区の並び (中央から渦巻き。新しい地区は必ず前の地区のどれかと辺で接する) ----
  function spiral(n) {
    const out = [[0, 0]];
    let x = 0, y = 0, step = 1;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let d = 0;
    while (out.length < n) {
      for (let k = 0; k < 2 && out.length < n; k++) {
        for (let s = 0; s < step && out.length < n; s++) {
          x += dirs[d][0];
          y += dirs[d][1];
          out.push([x, y]);
        }
        d = (d + 1) % 4;
      }
      step++;
    }
    return out;
  }

  // 仮の名前 (Muse が決める)
  const DISTRICT_NAMES = ['中央', '一番', '二番', '三番', '四番', '五番', '六番', '七番', '八番', '九番', '十番', '十一番', '十二番'];
  const LANDMARKS = [
    { key: 'clock', name: '時計塔' },
    { key: 'bridge', name: '橋のたもと' },
    { key: 'well', name: '古井戸' },
    { key: 'board', name: '掲示板の辻' },
    { key: 'ginkgo', name: '銀杏の木' },
    { key: 'bench', name: 'ベンチの小広場' },
    { key: 'lamp', name: 'ガス灯の角' },
    { key: 'pier', name: '船着き場' },
  ];

  /**
   * 地区を1つ作る。形は (街の種, 地区の番号) だけで決まる。
   * @param {number} index 何番目に開いた地区か
   * @param {number} gx @param {number} gy 地区を並べる位置
   * @param {{seed:number, avenue:number}} opts avenue = 大通りの幅 (チップ)
   */
  function layoutDistrict(index, gx, gy, opts) {
    const r = mulberry32(hash2(opts.seed, index + 1));
    const A = opts.avenue;
    const PX = INNER_W + A, PY = INNER_H + A;
    const x0 = gx * PX, y0 = gy * PY;
    const id = 'd' + String(index + 1).padStart(2, '0');
    const name = (DISTRICT_NAMES[index] ?? index + '番') + '地区';
    // 行の y: 行0 [y0,y0+6) 路地0 y0+6 行1 [y0+7,y0+13) 帯 y0+13 行2 [y0+14,y0+20) 路地1 y0+20 行3 [y0+21,y0+27)
    const rowY = [y0, y0 + LOT + ALLEY, y0 + 2 * LOT + ALLEY + STRIP, y0 + 3 * LOT + 2 * ALLEY + STRIP];
    const alleys = [
      { id: id + '-a', name: index === 0 ? '噴水通り' : '一の路地', y: y0 + LOT, x: x0, w: INNER_W, h: ALLEY },
      { id: id + '-b', name: '二の路地', y: y0 + 3 * LOT + ALLEY + STRIP, x: x0, w: INNER_W, h: ALLEY },
    ];
    const strip = { y: y0 + 2 * LOT + ALLEY, x: x0, w: INNER_W, h: STRIP, kind: index === 0 || r() < 0.45 ? 'canal' : 'hedge' };

    // 公共の区画: 中央は噴水広場 (路地0の真ん中 2×2 区画)、ほかは路地の端の目印1つと公園1つ
    const pub = new Map(); // 'row,col' -> {kind,name}
    let landmark;
    if (index === 0) {
      for (const rr of [0, 1]) for (const cc of [2, 3]) pub.set(rr + ',' + cc, { kind: 'fountain', name: '噴水広場' });
      landmark = { kind: 'fountain', name: '噴水広場' };
    } else {
      const lm = LANDMARKS[(index - 1) % LANDMARKS.length];
      const rr = Math.floor(r() * ROWS);
      const cc = r() < 0.5 ? 0 : COLS - 1;
      pub.set(rr + ',' + cc, { kind: lm.key, name: lm.name });
      landmark = { kind: lm.key, name: lm.name };
      let pr, pc;
      do {
        pr = Math.floor(r() * ROWS);
        pc = 1 + Math.floor(r() * (COLS - 2));
      } while (pub.has(pr + ',' + pc));
      pub.set(pr + ',' + pc, { kind: 'park', name: '小さな公園' });
    }

    const lots = [];
    for (let row = 0; row < ROWS; row++) {
      const alley = row < 2 ? 0 : 1;
      const upper = row % 2 === 0; // 路地の上側 (店先が下向き)
      for (let col = 0; col < COLS; col++) {
        const p = pub.get(row + ',' + col);
        lots.push({
          id: (index + 1) * 100 + row * COLS + col + 1,
          district: id,
          row, col,
          x: x0 + col * LOT,
          y: rowY[row],
          w: LOT, h: LOT,
          kind: p ? 'public' : 'shop',
          publicKind: p?.kind,
          publicName: p?.name,
          street: alleys[alley].id,
          // 番地: 路地の上側が奇数、下側が偶数。向かいは ±1
          number: upper ? 2 * col + 1 : 2 * col + 2,
          front: upper ? 'down' : 'up',
          state: p ? 'public' : 'vacant',
          holder: null,
          size: 'S',
          since: 0,
        });
      }
    }
    return { id, index, name, gx, gy, x0, y0, w: INNER_W, h: INNER_H, alleys, strip, landmark, lots };
  }

  /** 区画の左隣・右隣・向かい・目印。路地に立って店を見たときの左右 */
  function buildLinks(d) {
    const at = (row, col) => (row < 0 || row >= ROWS || col < 0 || col >= COLS ? null : d.lots[row * COLS + col]);
    for (const l of d.lots) {
      if (l.kind !== 'shop') continue;
      const upper = l.row % 2 === 0;
      const west = at(l.row, l.col - 1), east = at(l.row, l.col + 1);
      const left = upper ? west : east; // 上側の店は南から見るので左=西。下側は北から見るので左=東
      const right = upper ? east : west;
      const front = at(upper ? l.row + 1 : l.row - 1, l.col);
      l.links = {
        left: left && left.kind === 'shop' ? left.id : null,
        right: right && right.kind === 'shop' ? right.id : null,
        front: front && front.kind === 'shop' ? front.id : null,
        // 同じ路地の公共の区画のうち一番近いもの。なければ地区の目印
        landmark: nearestLandmark(d, l),
      };
    }
  }
  function nearestLandmark(d, l) {
    const alley = l.row < 2 ? 0 : 1;
    let best = null, bd = 1e9;
    for (const p of d.lots) {
      if (p.kind !== 'public') continue;
      const same = (p.row < 2 ? 0 : 1) === alley;
      const dist = Math.abs(p.col - l.col) + (same ? 0 : 10);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    return best ? { lot: best.id, name: best.publicName, steps: Math.abs(best.col - l.col), sameStreet: (best.row < 2 ? 0 : 1) === alley } : null;
  }

  // ---- 街 ----
  function createTown(opts) {
    const o = { seed: 20261122, avenue: 2, fillCap: 0.8, groupMax: 4, minVacant: 3, ...opts };
    return { opts: o, districts: [], lots: new Map(), shops: new Map(), log: [], rand: mulberry32(hash2(o.seed, 999)) };
  }
  function openDistrict(town) {
    const i = town.districts.length;
    const [gx, gy] = spiral(i + 1)[i];
    const d = layoutDistrict(i, gx, gy, town.opts);
    buildLinks(d);
    town.districts.push(d);
    for (const l of d.lots) town.lots.set(l.id, l);
    town.log.push({ what: 'open', district: d.id });
    return d;
  }
  const shopLots = (town) => [...town.lots.values()].filter((l) => l.kind === 'shop');
  const vacantLots = (town) => shopLots(town).filter((l) => l.state === 'vacant');

  function blockedPair(blocks, a, b) {
    return !!a && !!b && (blocks.has(a + '>' + b) || blocks.has(b + '>' + a));
  }
  /** この区画に som を入れると、左右・向かいにブロックの相手がいるか */
  function conflicts(town, lot, som, blocks) {
    for (const k of ['left', 'right', 'front']) {
      const id = lot.links[k];
      if (!id) continue;
      const h = town.lots.get(id).holder;
      if (h && blockedPair(blocks, som, h)) return true;
    }
    return false;
  }
  function occupy(town, lot, shop, what) {
    lot.state = 'occupied';
    lot.holder = shop.som;
    lot.size = shop.size || 'S';
    shop.lot = lot.id;
    town.log.push({ what, lot: lot.id, som: shop.som });
  }

  /** おたがいの希望をまとめる (union-find)。大きすぎるグループは groupMax ずつに分ける */
  function mutualGroups(shops, groupMax) {
    const bySom = new Map(shops.map((s) => [s.som, s]));
    const parent = new Map(shops.map((s) => [s.som, s.som]));
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    for (const s of shops) for (const t of s.wishes || []) {
      const o = bySom.get(t);
      if (o && (o.wishes || []).includes(s.som)) parent.set(find(s.som), find(t));
    }
    const groups = new Map();
    for (const s of shops) {
      const k = find(s.som);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (let i = 0; i < g.length; i += groupMax) {
        const part = g.slice(i, i + groupMax);
        if (part.length >= 2) out.push(part);
      }
    }
    return out;
  }

  /**
   * 初めの配置 (仮配置 → 確定 の「仮配置」)。同じ種・同じ入力なら同じ結果。
   * 1. ブロックを満たす 2. おたがいの希望を隣に 3. 残りはランダム 4. 各地区は fillCap まで
   */
  function placeInitial(town, shops, blocks) {
    const o = town.opts;
    const r = town.rand;
    for (const s of shops) town.shops.set(s.som, s);
    const quota = (d) => Math.floor(d.lots.filter((l) => l.kind === 'shop').length * o.fillCap);
    while (town.districts.reduce((a, d) => a + quota(d), 0) < shops.length) openDistrict(town);
    const used = new Map(town.districts.map((d) => [d.id, 0]));
    const room = (d) => quota(d) - used.get(d.id);
    const placed = new Set();

    // 2. グループ: 同じ列で続きの区画 → だめなら同じ路地 (向かいを含む)
    const groups = mutualGroups(shops, o.groupMax).sort((a, b) => b.length - a.length);
    for (const g of groups) {
      const ds = shuffle([...town.districts], r);
      let done = false;
      for (const d of ds) {
        if (room(d) < g.length) continue;
        // 同じ列で続き
        const rows = shuffle([0, 1, 2, 3], r);
        for (const row of rows) {
          for (let c = 0; c + g.length <= COLS && !done; c++) {
            const seq = d.lots.slice(row * COLS + c, row * COLS + c + g.length);
            if (seq.some((l) => l.kind !== 'shop' || l.state !== 'vacant')) continue;
            if (seq.some((l, i) => conflicts(town, l, g[i].som, blocks))) continue;
            seq.forEach((l, i) => occupy(town, l, g[i], 'assign-wish'));
            g.forEach((s) => placed.add(s.som));
            used.set(d.id, used.get(d.id) + g.length);
            done = true;
          }
          if (done) break;
        }
        if (done) break;
        // 同じ路地のどこか (2人なら向かいどうしを先に試す)
        for (const alley of shuffle([0, 1], r)) {
          const free = d.lots.filter((l) => l.kind === 'shop' && l.state === 'vacant' && (l.row < 2 ? 0 : 1) === alley);
          if (free.length < g.length) continue;
          free.sort((a, b) => a.col - b.col || a.row - b.row);
          const pick = free.slice(0, g.length);
          if (pick.some((l, i) => conflicts(town, l, g[i].som, blocks))) continue;
          pick.forEach((l, i) => occupy(town, l, g[i], 'assign-wish-street'));
          g.forEach((s) => placed.add(s.som));
          used.set(d.id, used.get(d.id) + g.length);
          done = true;
          break;
        }
        if (done) break;
      }
    }

    // 3. 残り
    const rest = shuffle(shops.filter((s) => !placed.has(s.som)), r);
    for (const s of rest) {
      let cands = vacantLots(town).filter((l) => room(town.districts.find((d) => d.id === l.district)) > 0 && !conflicts(town, l, s.som, blocks));
      if (!cands.length) {
        openDistrict(town);
        used.set(town.districts.at(-1).id, 0);
        cands = vacantLots(town).filter((l) => l.district === town.districts.at(-1).id);
      }
      const l = cands[Math.floor(r() * cands.length)];
      occupy(town, l, s, 'assign');
      used.set(l.district, used.get(l.district) + 1);
    }
    return town;
  }

  /** 確定のあとに来た店。前からいる店は動かさない。空きが少なければ地区を開く */
  function addShop(town, shop, blocks) {
    const r = town.rand;
    town.shops.set(shop.som, shop);
    if (vacantLots(town).length < town.opts.minVacant + 1) openDistrict(town);
    // おたがいに希望している相手がいれば: 隣・向かい → 同じ路地 → 同じ地区 → どこでも
    const free = vacantLots(town).filter((l) => !conflicts(town, l, shop.som, blocks));
    const partners = (shop.wishes || [])
      .map((t) => town.shops.get(t))
      .filter((p) => p && p.lot && (p.wishes || []).includes(shop.som))
      .map((p) => town.lots.get(p.lot));
    const tiers = [
      (l) => partners.some((pl) => ['left', 'right', 'front'].some((k) => pl.links[k] === l.id)),
      (l) => partners.some((pl) => pl.street === l.street),
      (l) => partners.some((pl) => pl.district === l.district),
    ];
    let cands = [], tier = 3;
    if (partners.length) {
      for (let i = 0; i < tiers.length && !cands.length; i++) {
        cands = free.filter(tiers[i]);
        tier = i;
      }
    }
    if (!cands.length) {
      cands = free;
      tier = 3;
    }
    const l = cands[Math.floor(r() * cands.length)];
    occupy(town, l, shop, ['move_in-wish', 'move_in-wish-street', 'move_in-wish-district', 'move_in'][tier]);
    return l;
  }

  /** 閉店: 空き家 (猶予中) に。猶予が切れたら NPC の家 (vacant) に戻す */
  function closeShop(town, som, now, graceDays) {
    const s = town.shops.get(som);
    const l = s && town.lots.get(s.lot);
    if (!l) return;
    l.state = 'held';
    l.holdUntil = now + (graceDays ?? 14) * 86400;
    town.log.push({ what: 'hold', lot: l.id, som });
  }
  function expireHolds(town, now) {
    for (const l of town.lots.values()) {
      if (l.state === 'held' && l.holdUntil <= now) {
        town.log.push({ what: 'release', lot: l.id, som: l.holder });
        const s = town.shops.get(l.holder);
        if (s) s.lot = null;
        l.state = 'vacant';
        l.holder = null;
        l.size = 'S';
      }
    }
  }

  /** NPC の家の見た目。区画ID と街の種だけで決まる */
  function npcLook(town, lotId) {
    const h = hash2(town.opts.seed, lotId);
    return { roof: h % 6, wall: (h >>> 3) % 4, shape: (h >>> 6) % 3, tree: (h >>> 9) % 4 };
  }

  function addressText(town, lot) {
    const d = town.districts.find((x) => x.id === lot.district);
    const a = d.alleys[lot.row < 2 ? 0 : 1];
    return `${d.name} ${a.name} ${lot.number}番`;
  }

  /** Muse に渡す形 (API 案 GET /lots/{id} の neighbors) */
  function neighborsJson(town, lotId) {
    const l = town.lots.get(lotId);
    const who = (id) => {
      if (!id) return null;
      const n = town.lots.get(id);
      const s = n.holder && n.state !== 'vacant' ? town.shops.get(n.holder) : null;
      return {
        lot_id: id,
        number: n.number,
        state: n.state === 'vacant' ? 'npc_house' : n.state === 'held' ? 'empty_house' : s?.resting ? 'resting' : 'open',
        som: s?.som ?? null,
        shop: s?.shop ?? null,
      };
    };
    return {
      lot_id: l.id,
      address: { district: l.district, street: l.street, number: l.number, text: addressText(town, l) },
      home_size: l.size,
      neighbors: { left: who(l.links.left), right: who(l.links.right), front: who(l.links.front) },
      landmark: l.links.landmark && { name: l.links.landmark.name, lots_away: l.links.landmark.steps, same_street: l.links.landmark.sameStreet },
    };
  }

  /** 道 (大通り) のチップを集める: 開いている地区の外周 avenue 幅の帯 */
  function roadCells(town) {
    const A = town.opts.avenue;
    const cells = new Set();
    for (const d of town.districts) {
      for (let x = d.x0 - A; x < d.x0 + d.w + A; x++) for (let y = d.y0 - A; y < d.y0 + d.h + A; y++) {
        const inside = x >= d.x0 && x < d.x0 + d.w && y >= d.y0 && y < d.y0 + d.h;
        if (!inside) cells.add(x + ',' + y);
      }
      for (const a of d.alleys) for (let x = a.x; x < a.x + a.w; x++) cells.add(x + ',' + a.y);
    }
    return cells;
  }
  /** 地区の外枠 (大通り込み) */
  function bounds(town) {
    const A = town.opts.avenue;
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (const d of town.districts) {
      x1 = Math.min(x1, d.x0 - A);
      y1 = Math.min(y1, d.y0 - A);
      x2 = Math.max(x2, d.x0 + d.w + A);
      y2 = Math.max(y2, d.y0 + d.h + A);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // ---- ダミーの店 ----
  const JOBS = ['本屋', '薬屋', '酪農家', '行商人', '山師(探鉱夫)', '山師(木こり)', '道具屋(革細工)', '道具屋(木工)', '道具屋(装飾)', '武器屋(剣)', '武器屋(杖)', '防具屋(盾)', '防具屋(鎧)'];
  const A1 = ['こもれび', 'ほしぞら', 'あかね', 'しずく', 'るり', 'こはく', 'ひいらぎ', 'つきみ', 'すずらん', 'みなも', 'かすみ', 'わたぼうし', 'ひだまり', 'くるみ', 'あおば', 'ゆきうさぎ'];
  const A2 = ['堂', '商店', '工房', '屋', '舎', '亭', '庵', '商会', '雑貨', '本舗'];
  function makeShops(n, seed, start) {
    const r = mulberry32(hash2(seed, 7));
    const out = [];
    for (let i = 0; i < n; i++) {
      const no = (start ?? 1) + i;
      const sz = r();
      out.push({
        som: 'som' + String(no).padStart(4, '0'),
        owner: 'ダミー店主' + no,
        shop: A1[Math.floor(r() * A1.length)] + A2[Math.floor(r() * A2.length)],
        job: JOBS[Math.floor(r() * JOBS.length)],
        resting: r() < 0.04,
        size: sz < 0.7 ? 'S' : sz < 0.92 ? 'M' : 'L',
        hue: Math.floor(r() * 360),
        wishes: [],
        isNew: false,
      });
    }
    return out;
  }
  /** 121店ぶんの希望とブロック (ダミー) */
  function addRelations(shops, seed) {
    const r = mulberry32(hash2(seed, 11));
    const pick = () => shops[Math.floor(r() * shops.length)];
    const blocks = new Set();
    for (let i = 0; i < 12; i++) {
      const a = pick(), b = pick();
      if (a === b) continue;
      a.wishes.push(b.som);
      b.wishes.push(a.som);
    }
    // 3人組
    const [x, y, z] = [pick(), pick(), pick()];
    if (new Set([x, y, z]).size === 3) {
      x.wishes.push(y.som, z.som);
      y.wishes.push(x.som, z.som);
      z.wishes.push(x.som, y.som);
    }
    for (let i = 0; i < 8; i++) pick().wishes.push(pick().som); // 片思い (何も起きない)
    for (let i = 0; i < 10; i++) {
      const a = pick(), b = pick();
      if (a !== b) blocks.add(a.som + '>' + b.som);
    }
    return blocks;
  }

  /** 見本でいつも使う街: 121店を置いて確定、200店まで増やせる */
  function demoTown(opts) {
    const o = { shops: 121, grow: 0, ...opts };
    const town = createTown(o);
    const base = makeShops(121, town.opts.seed, 1);
    const blocks = addRelations(base, town.opts.seed);
    placeInitial(town, base, blocks);
    town.confirmed = new Map(base.map((s) => [s.som, s.lot]));
    town.blocks = blocks;
    if (o.grow > 0) {
      const extra = makeShops(o.grow, town.opts.seed + 1, 122);
      // 新しく来た店のうち5店は、前からいる店とおたがいに希望している
      for (let i = 0; i < Math.min(5, extra.length); i++) {
        const p = base[(i * 17) % base.length];
        extra[i].wishes.push(p.som);
        p.wishes.push(extra[i].som);
      }
      for (const s of extra) {
        s.isNew = true;
        addShop(town, s, blocks);
      }
    }
    if (o.fixture) applyFixture(town);
    // 見本用: 2店を閉店 (空き家の札)
    const closing = base.filter((s) => !s.resting).slice(40, 42);
    for (const s of closing) closeShop(town, s.som, 0, 14);
    return town;
  }

  /**
   * 3案で同じに見せる「架空の街区」(中央地区の噴水通り)。表示用に中央地区の割り当てを書き換える。
   * (検査 check.mjs はこれを使わない。追い出した店は空き区画へ移す)
   */
  const FIXTURE = [
    // [row, col, 店名, 職, 家, 役]
    [0, 0, 'こもれび堂', '本屋', 'S', 'you'],
    [0, 1, 'るり工房', '道具屋(装飾)', 'M', 'wish'],
    [1, 0, 'あかね商店', '薬屋', 'S', 'front'],
    [1, 1, 'しずく庵', '酪農家', 'L', 'front'],
    [0, 4, 'つきみ亭', '行商人', 'M', 'resting'],
    [0, 5, null, null, 'S', 'held'],
    [1, 4, null, null, 'S', 'npc'],
    [1, 5, 'ひだまり雑貨', '防具屋(盾)', 'S', 'new'],
  ];
  function applyFixture(town) {
    const d = town.districts[0];
    const at = (row, col) => d.lots[row * COLS + col];
    const evict = [];
    for (const [row, col] of FIXTURE) {
      const l = at(row, col);
      if (l.holder) evict.push(town.shops.get(l.holder));
      l.state = 'vacant';
      l.holder = null;
    }
    const roles = {};
    FIXTURE.forEach(([row, col, shop, job, size, role], i) => {
      const l = at(row, col);
      if (role === 'npc') return;
      const s = {
        som: 'som9' + String(i + 1).padStart(3, '0'),
        owner: 'ダミー店主' + String.fromCharCode(0x41 + i),
        shop: shop ?? '（閉店した店）',
        job: job ?? '',
        resting: role === 'resting',
        size, hue: [200, 330, 20, 140, 45, 0, 0, 260][i], wishes: [], isNew: role === 'new', role,
      };
      town.shops.set(s.som, s);
      occupy(town, l, s, 'fixture');
      if (role === 'held') {
        l.state = 'held';
        l.holdUntil = 14 * 86400;
      }
      roles[role] = (roles[role] || []).concat(s.som);
    });
    const you = town.shops.get(roles.you[0]), wish = town.shops.get(roles.wish[0]);
    you.wishes.push(wish.som);
    wish.wishes.push(you.som);
    for (const s of evict) {
      const l = vacantLots(town).find((x) => x.district !== d.id);
      if (l) occupy(town, l, s, 'fixture-move');
    }
    town.fixture = { district: d.id, you: you.som };
  }

  root.TownGen = {
    FIXTURE,
    CHIP, MOD, LOT, COLS, ROWS, ALLEY, STRIP, INNER_W, INNER_H, HOME,
    mulberry32, hash2, spiral, layoutDistrict, createTown, openDistrict, placeInitial, addShop, closeShop, expireHolds,
    npcLook, addressText, neighborsJson, roadCells, bounds, makeShops, addRelations, demoTown, conflicts, mutualGroups, shopLots, vacantLots,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
