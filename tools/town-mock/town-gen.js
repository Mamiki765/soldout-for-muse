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
  const COLS = 6; // 1列に並ぶ区画の数 (既定。opts.cols で 8 も試せる)
  const ROWS = 4; // 区画の列 (路地 2本 × 両側)
  const STRIP = 2; // 裏どうしの間 (川か並木) = 2チップ (64px)。地区をまたいでつながる
  /** 家の大きさ → 建物の一辺 (チップ) */
  const HOME = { S: 2, M: 4, L: 6 };
  /** 家の大きさは棚の数で決まる (リカさん 11/22): S 1〜4棚 / M 5〜7棚 / L 8棚。維持費は今の棚の維持費そのまま */
  const SHELF_COST = [0, 2000, 5000, 30000, 100000, 200000, 400000, 1000000];
  const sizeOfShelves = (n) => (n <= 4 ? 'S' : n <= 7 ? 'M' : 'L');

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
  /**
   * 地区を置く順番。中央は横に2マス (0,0)(1,0)。そのまわりを「中央の2マスを囲む輪」で時計回りに広げる。
   * 新しい地区は必ず前に置いた地区のどれかと辺で接する。
   */
  function townCells(n) {
    const out = [[0, 0], [1, 0]];
    for (let k = 1; out.length < n; k++) {
      const x1 = -k, x2 = 1 + k, y1 = -k, y2 = k;
      const ring = [];
      for (let y = 0; y <= y2; y++) ring.push([x2, y]); // 東の辺 (真ん中から下へ)
      for (let x = x2 - 1; x >= x1; x--) ring.push([x, y2]); // 南の辺
      for (let y = y2 - 1; y >= y1; y--) ring.push([x1, y]); // 西の辺
      for (let x = x1 + 1; x <= x2; x++) ring.push([x, y1]); // 北の辺
      for (let y = y1 + 1; y < 0; y++) ring.push([x2, y]); // 東の辺の残り
      for (const c of ring) if (out.length < n) out.push(c);
    }
    return out.slice(0, n);
  }
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

  // ---- 地区名と目印 (仮。名前は Muse が決める) ----
  // 地区名は「開いた順番」ではなく「街の中の位置 (渦巻きの何番目か)」と「その列の地形」で決まる。
  // 地区が増えても、前からある地区の名前・目印・住所は変わらない。
  // 川の列 (gy が偶数) は水辺の目印、並木の列 (gy が奇数) は丘・木の目印から順に使う。
  const CENTER_NAME = { a: '中央広場', b: 'ミューズ中央' };
  const CENTER_EAST_NAME = { a: '中央公園', b: 'セントラルパーク' };
  const WATER_MARKS = [
    { key: 'lamp', name: 'ガス灯の角', a: '灯火横丁', b: 'ランタン小路' },
    { key: 'mill', name: '水車小屋', a: '水車河岸', b: 'ミルサイド' },
    { key: 'pier', name: '船着き場', a: '船着き河岸', b: 'ピア河岸' },
    { key: 'bridge', name: '月見橋のたもと', a: '月見橋', b: 'ムーンブリッジ' },
    { key: 'well', name: '古井戸', a: '古井戸町', b: 'オールドウェル' },
    { key: 'flower', name: '花時計', a: '花籠町', b: 'ブーケ通り' },
    { key: 'willow', name: '柳の土手', a: '柳河岸', b: 'ウィロー河岸' },
    { key: 'lock', name: '水門', a: '水門町', b: 'ロックゲート' },
  ];
  const GROVE_MARKS = [
    { key: 'ginkgo', name: '銀杏の木', a: '銀杏坂', b: 'ギンナン坂' },
    { key: 'bell', name: '鐘楼', a: '鐘の辻', b: 'ベルの辻' },
    { key: 'star', name: '星見台', a: '星見ヶ丘', b: 'スターゲイズ' },
    { key: 'vane', name: '風見鶏', a: '風見坂', b: 'ウェザーコック' },
    { key: 'anvil', name: '鍛冶場', a: '鍛冶屋町', b: 'アンヴィル街' },
    { key: 'stone', name: '苔むした石', a: '苔石町', b: 'モスストーン' },
    { key: 'orchard', name: 'りんごの木', a: '林檎坂', b: 'オーチャード' },
    { key: 'windmill', name: '風車', a: '風車ヶ丘', b: 'ミルヒル' },
  ];
  /** 地区名 (ミュート案 2026-11-22、24区ぶん)。区の番号で決まる。25区から先は名前なし (「第25区」だけ) */
  const MUSE_NAMES = ['灯火横丁', '銀杏坂', '鐘の辻', '星見ヶ丘', '風見坂', '水車河岸', '鍛冶屋町', '苔石町', '林檎坂', '風車ヶ丘',
    '硝子町', '染布坂', '薬師小路', '機織町', '月見台', '藤の辻', '鏡池小路', '猫待坂', '太鼓橋', '香炉坂', '窯場町', '雨読横丁', '翡翠台', '鈴蘭小路'];
  const ord = (n) => ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n - 1] ?? String(n);
  /** 位置 index の地区の名前と目印。同じ地形の列で何番目かで決まる (index だけで決まる) */
  function districtIdentity(index, names) {
    const set = names === 'b' ? 'b' : 'a';
    if (index === 0) return { name: CENTER_NAME[set], landmark: { kind: 'fountain', name: '噴水広場' } };
    if (index === 1) return { name: CENTER_EAST_NAME[set], landmark: { kind: 'bigpark', name: '中央公園' } };
    const pts = townCells(index + 1);
    const water = (g) => ((g % 2) + 2) % 2 === 0;
    const mine = water(pts[index][1]);
    let k = 0;
    for (let i = 2; i < index; i++) if (water(pts[i][1]) === mine) k++;
    const pool = mine ? WATER_MARKS : GROVE_MARKS;
    const lm = pool[k % pool.length];
    const round = Math.floor(k / pool.length);
    if (set === 'a') return { name: MUSE_NAMES[index - 2] ?? '', landmark: { kind: lm.key, name: lm.name } };
    return { name: lm[set] + (round ? ord(round + 1) + '丁目' : ''), landmark: { kind: lm.key, name: lm.name } };
  }

  /** 地区の位置 (gx, gy) から決まる寸法。店の有無に関係なく同じ (街の外の野原も同じ格子) */
  function geom(opts, gx, gy) {
    const A = opts.avenue, ALLEY = opts.alley, COLS = opts.cols;
    const w = COLS * LOT, h = 2 * (LOT + ALLEY + LOT) + STRIP;
    const x0 = gx * (w + A), y0 = gy * (h + A);
    const stripY = y0 + 2 * LOT + ALLEY;
    return {
      gx, gy, x0, y0, w, h, A, ALLEY, COLS,
      rowY: [y0, y0 + LOT + ALLEY, y0 + 2 * LOT + ALLEY + STRIP, y0 + 3 * LOT + 2 * ALLEY + STRIP],
      alleyY: [y0 + LOT, y0 + 3 * LOT + ALLEY + STRIP],
      stripY,
      // 地形は列 (gy) で決まる: 偶数の列は川、奇数の列は並木。地区をまたいでつながる
      stripKind: ((gy % 2) + 2) % 2 === 0 ? 'canal' : 'grove',
      // 中央の南北の通り (中央地区だけ。路地と同じ幅)
      ns: { x: x0 + (Math.floor(COLS / 2)) * LOT - Math.floor(ALLEY / 2), w: ALLEY },
    };
  }

  /** 中央地区の公共施設 (区画の行, 列) → 種類。cols=6 と 8 のどちらでも */
  function centerPlan(COLS, mode) {
    const mid = Math.floor(COLS / 2) - 1;
    const m = new Map();
    const put = (row, col, kind) => m.set(row + ',' + col, kind);
    for (let c = 0; c < COLS; c++) { put(0, c, 'garden'); put(1, c, 'garden'); put(2, c, 'market'); put(3, c, 'market'); }
    put(0, 0, 'hall'); put(0, 1, 'hall');
    put(1, 0, 'tree'); put(1, 1, 'tree');
    for (const r of [0, 1]) for (const c of [mid, mid + 1]) put(r, c, 'fountain');
    put(0, COLS - 2, 'guild'); put(0, COLS - 1, 'guild');
    put(1, COLS - 2, 'board');
    put(1, COLS - 1, mode === 'admin' ? 'admin' : 'board');
    put(2, 0, 'pier'); put(3, 0, 'park');
    put(2, COLS - 1, 'park'); put(3, COLS - 1, 'garden');
    return m;
  }
  /**
   * 中央の東: 大きな公園と、将来の施設の予定地。予定地は空き地にせず、花壇・遊歩道・石畳・緑地として見せる。
   * 予定地はあとで施設 (区画いくつかまとめ) に置き換えられる。
   */
  function centerEastPlan(COLS) {
    const m = new Map();
    const parkW = COLS - 2;
    const pairs = Math.floor(COLS / 2);
    for (let c = 0; c < COLS; c++) {
      for (const r of [0, 1]) m.set(r + ',' + c, c < parkW ? 'bigpark' : 'plot');
      for (const r of [2, 3]) {
        const p = Math.floor(c / 2);
        m.set(r + ',' + c, r === 3 && p === pairs - 1 ? 'park' : 'plot');
      }
    }
    return m;
  }
  const PLOT_LOOKS = ['flower', 'walk', 'stone', 'green'];
  const PLOT_NAMES = { flower: '予定地（花壇）', walk: '予定地（遊歩道）', stone: '予定地（石畳の小広場）', green: '予定地（緑地）' };
  const PUBLIC_NAMES = { bigpark: '中央公園', hall: '街役場', guild: 'ギルド会館', tree: '大きな樹', fountain: '噴水広場', board: '掲示板', market: '中央市場', pier: '船着き場', park: '小さな公園', garden: '花壇の庭' };

  /**
   * 地区を1つ作る。形は (街の種, 地区の位置 index) だけで決まる。
   * index 0 は中央の公共地区 (opts.center = 'public' は店なし、'admin' は管理人の店 1区画だけ)。
   */
  function layoutDistrict(index, gx, gy, opts) {
    const r = mulberry32(hash2(opts.seed, index + 1));
    const g = geom(opts, gx, gy);
    const { x0, y0, w: INNER_W, h: INNER_H, ALLEY, COLS } = g;
    const id = 'd' + String(index + 1).padStart(2, '0');
    const who = districtIdentity(index, opts.names);
    const name = who.name;
    const center = index === 0 ? 'west' : index === 1 ? 'east' : false;
    const alleys = [
      { id: id + '-a', name: center === 'west' ? '噴水通り' : center === 'east' ? '公園通り' : '一の路地', y: g.alleyY[0], x: x0, w: INNER_W, h: ALLEY },
      { id: id + '-b', name: center === 'west' ? '市場通り' : center === 'east' ? '花通り' : '二の路地', y: g.alleyY[1], x: x0, w: INNER_W, h: ALLEY },
    ];
    // 中央は南北にも通りが抜ける (大通り → 噴水 → 橋 → 市場 → 大通り)
    if (center === 'west') alleys.push({ id: id + '-c', name: '中央通り', x: g.ns.x, y: y0, w: g.ns.w, h: INNER_H, ns: true });
    const strip = { y: g.stripY, x: x0, w: INNER_W, h: STRIP, kind: g.stripKind };

    const pub = new Map(); // 'row,col' -> {kind,name}
    let landmark = who.landmark;
    if (center === 'west') {
      for (const [k, kind] of centerPlan(COLS, opts.center)) if (kind !== 'admin') pub.set(k, { kind, name: PUBLIC_NAMES[kind] });
    } else if (center === 'east') {
      for (const [k, kind] of centerEastPlan(COLS)) {
        const [rr, cc] = k.split(',').map(Number);
        const look = PLOT_LOOKS[(rr * 3 + Math.floor(cc / 2)) % PLOT_LOOKS.length];
        pub.set(k, kind === 'plot' ? { kind, look, name: PLOT_NAMES[look] } : { kind, name: PUBLIC_NAMES[kind] });
      }
    } else {
      // 目印は路地の端に1つ、公園を1つ。一番地区 (見本の通り) は二の路地側に寄せる
      const rows = index === 2 ? [2, 3] : [0, 1, 2, 3];
      const rr = rows[Math.floor(r() * rows.length)];
      const cc = r() < 0.5 ? 0 : COLS - 1;
      pub.set(rr + ',' + cc, { kind: landmark.kind, name: landmark.name });
      let pr, pc;
      do {
        pr = rows[Math.floor(r() * rows.length)];
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
          y: g.rowY[row],
          w: LOT, h: LOT,
          kind: p ? 'public' : 'shop',
          publicKind: p?.kind,
          publicName: p?.name,
          look: p?.look,
          street: alleys[alley].id,
          // 番地: 路地の上側が奇数、下側が偶数。向かいは ±1
          number: upper ? 2 * col + 1 : 2 * col + 2,
          front: upper ? 'down' : 'up',
          state: p ? 'public' : 'vacant',
          holder: null,
          size: 'S',
          since: 0,
          // 中央の管理人の区画は、ほかの店の配置に使わない
          reserved: center === 'west' && !p ? 'admin' : null,
        });
      }
    }
    return { id, index, no: center ? 0 : index - 1, name, gx, gy, x0, y0, w: INNER_W, h: INNER_H, cols: COLS, alleys, strip, landmark, lots, center };
  }

  /** 区画の左隣・右隣・向かい・目印。路地に立って店を見たときの左右 */
  function buildLinks(d) {
    const COLS = d.cols;
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
    // center: 'public' (中央は公共施設だけ) / 'admin' (管理人の店を1区画)。names: 'a' / 'b' (地区名の候補)
    // wishPlacement: おたがいの希望を初めの配置で近くに置くか (未決。既定はランダム優先で置かない)
    const o = { seed: 20261122, avenue: 3, alley: 2, cols: 6, fillCap: 0.8, groupMax: 4, minVacant: 3, minVacantRatio: 0.15, center: 'public', names: 'a', wishPlacement: false, ...opts };
    return { opts: o, districts: [], grid: new Map(), lots: new Map(), shops: new Map(), log: [], rand: mulberry32(hash2(o.seed, 999)) };
  }
  function openDistrict(town) {
    const i = town.districts.length;
    const [gx, gy] = townCells(i + 1)[i];
    const d = layoutDistrict(i, gx, gy, town.opts);
    buildLinks(d);
    town.districts.push(d);
    town.grid.set(gx + ',' + gy, d);
    for (const l of d.lots) town.lots.set(l.id, l);
    town.log.push({ what: 'open', district: d.id });
    return d;
  }
  const shopLots = (town) => [...town.lots.values()].filter((l) => l.kind === 'shop');
  const vacantLots = (town) => shopLots(town).filter((l) => l.state === 'vacant' && !l.reserved);

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
    const groups = o.wishPlacement ? mutualGroups(shops, o.groupMax).sort((a, b) => b.length - a.length) : [];
    for (const g of groups) {
      const ds = shuffle([...town.districts], r);
      let done = false;
      for (const d of ds) {
        if (room(d) < g.length) continue;
        // 同じ列で続き
        const rows = shuffle([0, 1, 2, 3], r);
        for (const row of rows) {
          for (let c = 0; c + g.length <= d.cols && !done; c++) {
            const seq = d.lots.slice(row * d.cols + c, row * d.cols + c + g.length);
            if (seq.some((l) => l.kind !== 'shop' || l.state !== 'vacant')) continue;
            if (seq.some((l, i) => conflicts(town, l, g[i].som, blocks))) continue;
            // グループの中どうしのブロックも見る (並べた結果、隣・向かいにならないか)
            if (seq.some((l, i) => i > 0 && blockedPair(blocks, g[i].som, g[i - 1].som))) continue;
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
          if (g.some((x) => g.some((y) => x !== y && blockedPair(blocks, x.som, y.som)))) continue;
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
    // (案) 猶予中の空き家の持ち主が戻ってきたら、元の区画にそのまま戻る
    const mine = [...town.lots.values()].find((l) => l.state === 'held' && l.holder === shop.som);
    if (mine) {
      delete mine.holdUntil;
      occupy(town, mine, shop, 'return');
      return mine;
    }
    // 空きを残す: NPC の家が「店の区画の15%」か3つを切りそうなら、新しい地区を開く (街がぎゅうぎゅうにならない)
    const need = Math.max(town.opts.minVacant, Math.ceil(shopLots(town).length * town.opts.minVacantRatio));
    if (vacantLots(town).length < need + 1) openDistrict(town);
    // おたがいに希望している相手がいれば: 隣・向かい → 同じ路地 → 同じ地区 → どこでも
    let free = vacantLots(town).filter((l) => !conflicts(town, l, shop.som, blocks));
    // 空きはあってもブロックで入れる所が無い: 新しい地区を開く (空の地区ならブロックの相手は隣にいない)
    if (!free.length) {
      openDistrict(town);
      free = vacantLots(town).filter((l) => !conflicts(town, l, shop.som, blocks));
    }
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
    s.closedAt = now;
    town.log.push({ what: 'hold', lot: l.id, som });
  }
  function expireHolds(town, now) {
    for (const l of town.lots.values()) {
      if (l.state === 'held' && l.holdUntil <= now) {
        town.log.push({ what: 'release', lot: l.id, som: l.holder });
        const s = town.shops.get(l.holder);
        // その店が別の区画で開き直していたら、そちらの住所は消さない (この区画だけ空ける)
        if (s && s.lot === l.id) s.lot = null;
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

  /**
   * 住所 (許可証に刻む形)。区の番号・丁目・番地だけで、名前は入れない (名前が変わっても住所は変わらない)。
   * 区 = 住む地区が開いた順の番号 (中央の2チャンクは数えず「中央」)。丁目 = 一の路地が1丁目、二の路地が2丁目。
   */
  function addressText(town, lot) {
    const d = town.districts.find((x) => x.id === lot.district);
    const chome = lot.row < 2 ? 1 : 2;
    return `${d.center ? '中央' : d.no + '区'}${chome}丁目${lot.number}番地`;
  }
  /** 地区の呼び方: 「7区（銀杏坂）」。名前は通称で任意 (変わってもよい) */
  const districtLabel = (d) => (d.center ? d.name : d.name ? `${d.no}区（${d.name}）` : `第${d.no}区`);
  /** 住所の3つの書き方 (2026-11-22 の表記案): 長い = 許可証、短い = 地図・札、見出し = 地区の見出し */
  function addressForms(town, lot) {
    const d = town.districts.find((x) => x.id === lot.district);
    const chome = lot.row < 2 ? 1 : 2;
    const ward = d.center ? '中央' : d.no + '区';
    return {
      long: `${d.center ? '中央' : '第' + d.no + '区'}${chome}丁目${lot.number}番地`,
      short: `${ward}${chome}-${lot.number}`,
      heading: d.center ? d.name : d.name ? `第${d.no}区・${d.name}` : `第${d.no}区`,
      data: { district: d.center ? 0 : d.no, block: chome, lot: lot.number },
    };
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

  /**
   * まわりをまとめて取る (API案 GET /town/lots/{id}/around?scope=street|district)。
   * 札に左右・向かいを常に出す代わりに、必要なときに同じ通り (両側) か地区ぜんぶを返す。
   */
  function aroundJson(town, lotId, scope) {
    const l = town.lots.get(lotId);
    const d = town.districts.find((x) => x.id === l.district);
    const rel = (id) => (id === l.id ? 'self' : id === l.links?.left ? 'left' : id === l.links?.right ? 'right' : id === l.links?.front ? 'front' : null);
    const lots = d.lots
      .filter((n) => n.kind === 'shop' || n.kind === 'public')
      .filter((n) => scope === 'district' || n.street === l.street)
      .map((n) => {
        const s = n.holder && n.state !== 'vacant' ? town.shops.get(n.holder) : null;
        return {
          lot_id: n.id, street: n.street, number: n.kind === 'public' ? null : n.number, side: n.front === 'down' ? 'north' : 'south',
          state: n.kind === 'public' ? 'landmark' : n.state === 'vacant' ? 'npc_house' : n.state === 'held' ? 'empty_house' : s?.resting ? 'resting' : 'open',
          som: s?.som ?? null, shop: n.kind === 'public' ? n.publicName : s?.shop ?? null, home_size: n.kind === 'shop' && n.state !== 'vacant' ? n.size : null,
          rel: rel(n.id),
        };
      });
    return { lot_id: l.id, scope: scope === 'district' ? 'district' : 'street', district: d.id, street: scope === 'district' ? null : l.street, lots };
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
      for (const a of d.alleys) for (let x = a.x; x < a.x + a.w; x++) for (let y = a.y; y < a.y + a.h; y++) cells.add(x + ',' + y);
    }
    return cells;
  }
  /** 地図に描く範囲 (地区とまわり1マスの「街の外」、チップ単位)。districts を渡すとその範囲だけ */
  function bounds(town, districts) {
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (const [gx, gy] of viewCells(town, districts)) {
      const g = geom(town.opts, gx, gy);
      x1 = Math.min(x1, g.x0 - g.A); y1 = Math.min(y1, g.y0 - g.A);
      x2 = Math.max(x2, g.x0 + g.w); y2 = Math.max(y2, g.y0 + g.h);
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
      // 棚の数 (ダミー): 1〜4 が多め、8 は少なめ
      const shelves = sz < 0.6 ? 1 + Math.floor(sz / 0.15) : sz < 0.9 ? 5 + Math.floor((sz - 0.6) / 0.1) : 8;
      out.push({
        som: 'som' + String(no).padStart(4, '0'),
        owner: 'ダミー店主' + no,
        shop: A1[Math.floor(r() * A1.length)] + A2[Math.floor(r() * A2.length)],
        job: JOBS[Math.floor(r() * JOBS.length)],
        resting: r() < 0.04,
        shelves, size: sizeOfShelves(shelves),
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
    // 中央に管理人の店を入れる案: som0002 を中央の区画へ (前の区画は空く)
    if (town.opts.center === 'admin') {
      const lot = [...town.lots.values()].find((l) => l.reserved === 'admin');
      const s = town.shops.get('som0002');
      if (lot && s) {
        const prev = town.lots.get(s.lot);
        if (prev) { prev.state = 'vacant'; prev.holder = null; prev.size = 'S'; }
        s.shop = '管理人の店'; s.owner = '管理人 (som0002)'; s.admin = true; s.resting = false;
        occupy(town, lot, s, 'admin');
      }
    }
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
    // [row, col (負は右から), 店名, 職, 棚の数, 役]
    [0, 0, 'こもれび堂', '本屋', 3, 'you'],
    [0, 1, 'るり工房', '道具屋(装飾)', 6, 'wish'],
    [1, 0, 'あかね商店', '薬屋', 4, 'front'],
    [1, 1, 'しずく庵', '酪農家', 8, 'front'],
    [0, -2, 'つきみ亭', '行商人', 6, 'resting'],
    [0, -1, null, null, 2, 'held'],
    [1, -2, null, null, 1, 'npc'],
    [1, -1, 'ひだまり雑貨', '防具屋(盾)', 1, 'new'],
  ];
  function applyFixture(town) {
    const d = town.districts[2];
    const C = d.cols;
    const at = (row, col) => d.lots[row * C + (col < 0 ? C + col : col)];
    const evict = [];
    for (const [row, col] of FIXTURE) {
      const l = at(row, col);
      if (l.holder) evict.push(town.shops.get(l.holder));
      l.state = 'vacant';
      l.holder = null;
    }
    const roles = {};
    FIXTURE.forEach(([row, col, shop, job, shelves, role], i) => {
      const l = at(row, col);
      if (role === 'npc') return;
      const s = {
        som: 'som9' + String(i + 1).padStart(3, '0'),
        owner: 'ダミー店主' + String.fromCharCode(0x41 + i),
        shop: shop ?? '（閉店した店）',
        job: job ?? '',
        resting: role === 'resting',
        shelves, size: sizeOfShelves(shelves), hue: [200, 330, 20, 140, 45, 0, 0, 260][i], wishes: [], isNew: role === 'new', role,
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

  // ---- Muse にも渡す地図データ (地区 = チャンクごとのマス目) ----
  /** 地面のマップチップ番号。人間の地図も Muse のスペースも、同じ番号で同じ絵を描く */
  const GROUND = { grass: 0, avenue: 1, alley: 2, canal: 3, hedge: 4, plaza: 5, lawn: 6, path: 7, flowerbed: 8, curb: 9, field: 10, bridge: 11 };
  /** 地面の上に置く小物 (1チップ) */
  const DECO = { none: 0, tree: 1, bush: 2, lamp: 3, bench: 4, pot: 5, street_tree: 6, mailbox: 7, crate: 8, scarecrow: 9, reed: 10, flowers: 11 };
  /** A「焼き瓦と柳」の外観プリセット。 */
  const PALETTES = [
    { name: '赤レンガ', roof: '#a36550', wall: '#e6d7bd', door: '#694f40', trim: '#ccc2aa' },
    { name: '港の青', roof: '#4f6682', wall: '#e0ded3', door: '#3f536c', trim: '#d5d0bd' },
    { name: '若葉', roof: '#617852', wall: '#e1dcc0', door: '#5a4026', trim: '#cfc5aa' },
    { name: '藤', roof: '#7b5971', wall: '#e8ddd8', door: '#4e3358', trim: '#d3c8ba' },
    { name: '山吹', roof: '#a17a46', wall: '#e9dabc', door: '#d8c7a8', trim: '#cfc5aa' },
    { name: '灰桜', roof: '#a87582', wall: '#e8dad6', door: '#824d47', trim: '#d4c7b9' },
    { name: '墨', roof: '#535762', wall: '#e0d9ca', door: '#2c2a27', trim: '#c8c1ad' },
    { name: '浅葱', roof: '#4d8380', wall: '#e0e4d5', door: '#496b55', trim: '#ccd0bb' },
  ];
  const NPC_PALETTES = [
    { name: 'NPC 茶', roof: '#8a6f55', wall: '#e6dccb', door: '#5a4636', trim: '#efe8da' },
    { name: 'NPC 灰青', roof: '#6f7c8c', wall: '#e4e4e0', door: '#4a5260', trim: '#eeeeea' },
    { name: 'NPC 苔', roof: '#748a62', wall: '#e8e4d4', door: '#4f5c40', trim: '#f0ede0' },
    { name: 'NPC 煉瓦', roof: '#9a6a5c', wall: '#ebe0d6', door: '#5e4038', trim: '#f2ebe4' },
  ];

  /** 店の外観: プリセット (palette) に、屋根とドアの色だけ上書きできる。shop.look = { palette, roof, door } */
  function lookOf(shop) {
    const lk = shop?.look ?? {};
    const base = PALETTES[lk.palette ?? (shop ? Math.floor(shop.hue / 45) % PALETTES.length : 0)];
    return { ...base, ...(lk.roof ? { roof: lk.roof } : {}), ...(lk.door ? { door: lk.door } : {}) };
  }
  /** 屋根と入口を個別に変えるときの色。 */
  const ROOF_COLORS = PALETTES.map((p) => p.roof);
  const DOOR_COLORS = PALETTES.map((p) => p.door);


  // ---- チャンク (地区の格子 1マスぶん) ----
  // チャンクは配信の単位で、地形の境界ではない。どのチャンクも「自分の地区＋西と北の大通り (北西の交差点込み)」を持つ。
  // だから隣のチャンクと同じマスを2回描くことはない。東・南の端の大通りは、その外側の「街の外」チャンクが持つ。
  // 川と並木は列 (gy) で決まるので、地区をまたいでも、街の外へもそのまま続く。川と大通り・通りが交わる所には橋。
  const chunkId = (town, gx, gy) => town.grid.get(gx + ',' + gy)?.id ?? `o${gx}_${gy}`;
  /** 世界のマス (x, y) を持つチャンクの格子の位置 */
  function cellOf(town, x, y) {
    const g0 = geom(town.opts, 0, 0), A = town.opts.avenue;
    return [Math.floor((x + A) / (g0.w + A)), Math.floor((y + A) / (g0.h + A))];
  }
  /** そのマスが地区の中の通り (路地・中央通り) か */
  function interiorRoad(town, x, y) {
    const [gx, gy] = cellOf(town, x, y);
    const d = town.grid.get(gx + ',' + gy);
    return !!d && d.alleys.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
  }
  /** 表示する範囲: 地区を囲む長方形と、そのまわり1マスの「街の外」 */
  function viewCells(town, districts) {
    // 地区を囲む長方形＋まわり1マス (川や並木が途中で切れて見えないように、長方形で埋める)
    const ds = districts ?? town.districts;
    const xs = ds.map((d) => d.gx), ys = ds.map((d) => d.gy);
    const out = [];
    for (let gy = Math.min(...ys) - 1; gy <= Math.max(...ys) + 1; gy++) for (let gx = Math.min(...xs) - 1; gx <= Math.max(...xs) + 1; gx++) out.push([gx, gy]);
    return out;
  }
  function chunksFor(town, districts, opt) {
    return viewCells(town, districts).map(([gx, gy]) => chunkAt(town, gx, gy, opt));
  }
  const groupBox = (ls) => {
    const x1 = Math.min(...ls.map((p) => p.x)), y1 = Math.min(...ls.map((p) => p.y));
    return { x: x1, y: y1, w: Math.max(...ls.map((p) => p.x + p.w)) - x1, h: Math.max(...ls.map((p) => p.y + p.h)) - y1 };
  };

  /**
   * 格子 (gx, gy) のチャンク。地区があれば地区、無ければ「街の外」(野原・畑・川・並木)。
   * 返す形は Muse 向け API (案) の GET /town/chunks/{id} と同じ。
   */
  function chunkAt(town, gx, gy, opt) {
    const o = { sizeOverride: null, ...opt };
    const opts = town.opts, A = opts.avenue;
    const g = geom(opts, gx, gy);
    const d = town.grid.get(gx + ',' + gy) || null;
    const X = g.x0 - A, Y = g.y0 - A, W = g.w + A, H = g.h + A;
    const ground = new Array(W * H).fill(GROUND.grass);
    const deco = new Array(W * H).fill(DECO.none);
    const inC = (x, y) => x >= X && x < X + W && y >= Y && y < Y + H;
    const set = (arr, x, y, v) => { if (inC(x, y)) arr[(y - Y) * W + (x - X)] = v; };
    const get = (arr, x, y) => (inC(x, y) ? arr[(y - Y) * W + (x - X)] : -1);
    const box = (arr, x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(arr, i, j, v); };
    const has = (a, b) => town.grid.has(a + ',' + b);
    const roadW = has(gx, gy) || has(gx - 1, gy);
    const roadN = has(gx, gy) || has(gx, gy - 1);
    const roadC = roadW || roadN || has(gx - 1, gy - 1);
    const buildings = [], objects = [], bridges = [];
    const water = g.stripKind === 'canal';

    // 1. 大通り (西・北・北西の角)
    if (roadW) box(ground, X, g.y0, A, g.h, GROUND.avenue);
    if (roadN) box(ground, g.x0, Y, g.w, A, GROUND.avenue);
    if (roadC) box(ground, X, Y, A, A, GROUND.avenue);
    // 2. 川・並木 (地区の中も、街の外も、大通りの下も同じ列)
    for (let y = g.stripY; y < g.stripY + STRIP; y++) {
      for (let x = g.x0; x < g.x0 + g.w; x++) set(ground, x, y, water ? GROUND.canal : GROUND.hedge);
      if (!roadW || water) for (let x = X; x < X + A; x++) set(ground, x, y, water ? GROUND.canal : GROUND.hedge);
    }
    // 3. 地区の中
    if (d) district(d);
    else countryside();
    // 4. 大通りの歩道・街路樹・ガス灯 (地区の通りが出てくる所は切る)
    const sidewalk = (x, y, ax, ay) => {
      if (get(ground, x, y) !== GROUND.avenue) return false;
      if (interiorRoad(town, ax, ay)) return false;
      set(ground, x, y, GROUND.curb);
      return true;
    };
    if (roadW) {
      let k = 0;
      for (let y = g.y0; y < g.y0 + g.h; y++) {
        const a = sidewalk(X, y, X - 1, y), b = sidewalk(X + A - 1, y, X + A, y);
        if ((y - g.y0) % 4 === 2) { if (a && k % 2 === 0) set(deco, X, y, DECO.street_tree); if (b) set(deco, X + A - 1, y, k % 2 ? DECO.lamp : DECO.street_tree); k++; }
      }
    }
    if (roadN) {
      let k = 0;
      for (let x = g.x0; x < g.x0 + g.w; x++) {
        const a = sidewalk(x, Y, x, Y - 1), b = sidewalk(x, Y + A - 1, x, Y + A);
        if ((x - g.x0) % 3 === 1) { if (a) set(deco, x, Y, k % 2 ? DECO.street_tree : DECO.lamp); if (b) set(deco, x, Y + A - 1, k % 2 ? DECO.lamp : DECO.street_tree); k++; }
      }
    }
    // 4b. 中央の西と東のあいだの大通りは「広場の中央軸」: 石畳にして、両端に並木とガス灯 (歩道の段差は付けない)
    if (d?.center === 'east' && roadW) {
      for (let y = g.y0; y < g.y0 + g.h; y++) for (let x = X; x < X + A; x++) { set(ground, x, y, GROUND.plaza); set(deco, x, y, DECO.none); }
      for (let y = g.y0 + 1; y < g.y0 + g.h; y += 3) {
        if (y >= g.stripY - 1 && y <= g.stripY + STRIP) continue;
        if (interiorRoad(town, X - 1, y) || interiorRoad(town, X + A, y)) continue;
        set(deco, X, y, (y - g.y0) % 6 === 1 ? DECO.street_tree : DECO.lamp);
        set(deco, X + A - 1, y, (y - g.y0) % 6 === 1 ? DECO.street_tree : DECO.lamp);
      }
    }
    // 5. 橋: 大通り (と中央通り) が川を渡る所。川幅より両岸へ1マスずつ長い
    const bridge = (x, w, road) => {
      box(ground, x, g.stripY - 1, w, STRIP + 2, GROUND.bridge);
      box(deco, x, g.stripY - 1, w, STRIP + 2, DECO.none);
      bridges.push({ x, y: g.stripY - 1, w, h: STRIP + 2, axis: 'ns', road, water: [g.stripY, g.stripY + STRIP] });
    };
    if (water && roadW) bridge(X, A, 'avenue');
    if (water && d?.center === 'west') bridge(g.ns.x, g.ns.w, 'street');

    function countryside() {
      // 街の外: 野原に木・花、川辺に葦、並木の列は林、畑と農家を1つ
      const h0 = hash2(opts.seed, (gx + 500) * 1000 + gy + 500);
      for (let y = g.y0; y < g.y0 + g.h; y++) for (let x = g.x0; x < g.x0 + g.w; x++) {
        if (get(ground, x, y) !== GROUND.grass) continue;
        const h = hash2(h0, y * 4099 + x);
        const nearStrip = y >= g.stripY - 2 && y < g.stripY + STRIP + 2;
        if (nearStrip && water && (y === g.stripY - 1 || y === g.stripY + STRIP) && h % 3 === 0) set(deco, x, y, DECO.reed);
        else if (nearStrip && !water && h % 2 === 0) set(deco, x, y, DECO.tree);
        else if (h % 100 < 6) set(deco, x, y, DECO.tree);
        else if (h % 100 < 8) set(deco, x, y, DECO.bush);
        else if (h % 100 < 11) set(deco, x, y, DECO.flowers);
      }
      const fx = g.x0 + 3 + (h0 % Math.max(1, g.w - 16)), fy = (h0 >>> 8) % 2 ? g.y0 + 3 : g.stripY + STRIP + 4;
      for (let y = fy; y < fy + 6; y++) for (let x = fx; x < fx + 9; x++) { set(ground, x, y, (y - fy) % 2 ? GROUND.grass : GROUND.field); set(deco, x, y, DECO.none); }
      set(deco, fx + 4, fy + 2, DECO.scarecrow);
      box(deco, fx + 10, fy, 3, 3, DECO.none);
      buildings.push({ lot: null, kind: 'npc', x: fx + 10, y: fy, w: 2, h: 2, palette: NPC_PALETTES[(h0 >>> 4) % NPC_PALETTES.length], door: 'down' });
    }

    function district(d) {
      for (const a of d.alleys) box(ground, a.x, a.y, a.w, a.h, GROUND.alley);
      // 公共の区画をまとめる: 同じ種類で、同じ行に続いていて、中央通りをまたがないもの (噴水は2行まとめて)
      const groups = new Map();
      for (const l of d.lots) {
        if (l.kind !== 'public') continue;
        const half = d.center && l.col >= d.cols / 2 ? 'e' : 'w';
        const key = l.publicKind === 'plot' ? 'plot:' + l.id : l.publicKind === 'fountain' || l.publicKind === 'bigpark' ? l.publicKind : `${l.publicKind}:${l.row}:${d.center ? half : l.col}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(l);
      }
      for (const [key, ls] of groups) publicPlace(d, key, ls, groupBox(ls));
      for (const l of d.lots) if (l.kind === 'shop') homeLot(d, l);
    }

    function publicPlace(d, key, ls, b) {
      const l = ls[0], kind = l.publicKind, up = l.front === 'down';
      const front = (bb, h) => (up ? bb.y + bb.h - 1 - (h ?? 0) : bb.y + (h ?? 0));
      if (kind === 'bigpark') return bigPark(d, l, b);
      if (kind === 'plot') return plot(l);
      if (kind === 'fountain') {
        box(ground, b.x, b.y, b.w, b.h, GROUND.plaza);
        objects.push({ kind: 'fountain', x: b.x + b.w / 2 - 2, y: b.y + b.h / 2 - 2, w: 4, h: 4, name: l.publicName });
        for (const [tx, ty] of [[b.x + 1, b.y + 1], [b.x + b.w - 2, b.y + 1], [b.x + 1, b.y + b.h - 2], [b.x + b.w - 2, b.y + b.h - 2]]) set(deco, tx, ty, DECO.tree);
        for (const [tx, ty] of [[b.x + 3, b.y + 3], [b.x + b.w - 4, b.y + b.h - 4]]) set(deco, tx, ty, DECO.bench);
        return;
      }
      if (kind === 'park' || kind === 'garden' || kind === 'tree') {
        box(ground, b.x, b.y, b.w, b.h, GROUND.lawn);
        const h = hash2(opts.seed, l.id);
        if (kind === 'tree') {
          objects.push({ kind: 'facility', sub: 'bigtree', x: b.x + b.w / 2 - 3, y: b.y + (up ? 0 : 1), w: 6, h: 5, name: l.publicName });
          for (let x = b.x; x < b.x + b.w; x += 3) set(deco, x, front(b), DECO.bench);
          return;
        }
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          if ((x + y + h) % 3 === 0) set(deco, x, y, kind === 'garden' ? DECO.flowers : (x * 7 + y) % 5 ? DECO.tree : DECO.bush);
        }
        if (kind === 'garden') for (let x = b.x + 1; x < b.x + b.w - 1; x += 2) set(ground, x, b.y + Math.floor(b.h / 2), GROUND.flowerbed);
        set(deco, b.x + 2, front(b), DECO.bench);
        set(deco, b.x + 3, front(b), DECO.none);
        set(ground, b.x + 3, front(b), GROUND.path);
        return;
      }
      box(ground, b.x, b.y, b.w, b.h, GROUND.plaza);
      const facility = { hall: 1, guild: 1, market: 1, board: 1 }[kind];
      if (facility) {
        const sub = kind === 'market' && l.row === 3 ? 'stalls' : kind;
        const bh = kind === 'board' ? 2 : b.h - 2;
        const bw = kind === 'board' ? Math.min(4, b.w - 2) : b.w - 2;
        const bx = b.x + (b.w - bw) / 2;
        const by = kind === 'board' ? b.y + 2 : up ? b.y : b.y + 2;
        objects.push({ kind: 'facility', sub, x: bx, y: by, w: bw, h: bh, name: l.publicName, door: up ? 'down' : 'up' });
        set(deco, b.x, front(b), DECO.street_tree); set(deco, b.x + b.w - 1, front(b), DECO.street_tree);
        if (kind === 'board') for (const x of [b.x + 1, b.x + b.w - 2]) set(deco, x, front(b), DECO.bench);
        return;
      }
      // 地区の目印 (船着き場は川のある側の岸に寄せる)
      const riverSide = g.stripKind === 'canal' && (l.row === 1 || l.row === 2);
      if (kind === 'pier' && riverSide) {
        objects.push({ kind: 'landmark', sub: kind, x: l.x + 1, y: l.row === 1 ? l.y + l.h - 3 : l.y, w: 4, h: 3, name: l.publicName });
        set(deco, l.x, l.row === 1 ? l.y : l.y + l.h - 1, DECO.tree); set(deco, l.x + 5, l.row === 1 ? l.y : l.y + l.h - 1, DECO.crate);
        return;
      }
      objects.push({ kind: 'landmark', sub: kind, x: l.x + 2, y: l.y + 2, w: 2, h: 2, name: l.publicName });
      set(deco, l.x, l.y, DECO.tree); set(deco, l.x + 5, l.y, DECO.tree); set(deco, l.x + 1, front(l), DECO.bench);
    }

    /** 中央公園: 芝に池・東屋・小道・並木。中を通る路地は石畳の遊歩道に */
    function bigPark(d, l, b) {
      const hs = hash2(opts.seed, l.id * 7);
      box(ground, b.x, b.y, b.w, b.h, GROUND.lawn);
      const al = d.alleys[0];
      box(ground, b.x, al.y, b.w, al.h, GROUND.plaza);
      // 小道 (南北に2本)
      for (const px of [b.x + 5, b.x + b.w - 6]) for (let y = b.y; y < b.y + b.h; y++) if (get(ground, px, y) === GROUND.lawn) set(ground, px, y, GROUND.path);
      // 池 (北側)
      const pw = 6, ph = 3, pxx = b.x + Math.floor((b.w - pw) / 2), pyy = b.y + 1;
      box(ground, pxx, pyy, pw, ph, GROUND.canal);
      for (let x = pxx - 1; x <= pxx + pw; x += 2) { set(deco, x, pyy - 1, DECO.reed); set(deco, x, pyy + ph, DECO.flowers); }
      // 東屋 (南側)
      objects.push({ kind: 'facility', sub: 'gazebo', x: b.x + b.w / 2 - 1.5, y: al.y + al.h + 1, w: 3, h: 3, name: '東屋' });
      // 木と花 (小道・池・東屋の上は避ける)
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (get(ground, x, y) !== GROUND.lawn) continue;
        if (x >= b.x + b.w / 2 - 2.5 && x < b.x + b.w / 2 + 2.5 && y >= al.y + al.h && y < al.y + al.h + 5) continue;
        const h = hash2(hs, y * 977 + x);
        if (h % 100 < 16) set(deco, x, y, DECO.tree);
        else if (h % 100 < 22) set(deco, x, y, DECO.flowers);
        else if (h % 100 < 25) set(deco, x, y, DECO.bush);
      }
      for (let x = b.x + 2; x < b.x + b.w - 1; x += 4) { set(deco, x, al.y - 1, DECO.bench); set(deco, x + 2, al.y + al.h, DECO.lamp); }
    }
    /** 予定地: 空き地にせず、花壇・遊歩道・石畳・緑地のどれかに見せる (あとで施設に置き換える) */
    function plot(l) {
      const up = l.front === 'down';
      const fy = up ? l.y + l.h - 1 : l.y;
      box(ground, l.x, l.y, l.w, l.h, GROUND.lawn);
      if (l.look === 'flower') {
        for (let y = l.y + 1; y < l.y + l.h - 1; y += 2) for (let x = l.x + 1; x < l.x + l.w - 1; x++) set(ground, x, y, GROUND.flowerbed);
        for (let y = l.y; y < l.y + l.h; y++) set(ground, l.x + 3, y, GROUND.path);
        set(deco, l.x, l.y, DECO.tree); set(deco, l.x + 5, l.y + 5, DECO.tree);
      } else if (l.look === 'walk') {
        for (let i = 1; i < 5; i++) { set(ground, l.x + i, l.y + 1, GROUND.path); set(ground, l.x + i, l.y + 4, GROUND.path); set(ground, l.x + 1, l.y + i, GROUND.path); set(ground, l.x + 4, l.y + i, GROUND.path); }
        set(ground, l.x + 2, fy, GROUND.path);
        for (const [x, y] of [[0, 0], [5, 0], [0, 5], [5, 5]]) set(deco, l.x + x, l.y + y, DECO.tree);
        set(deco, l.x + 2, l.y + 2, DECO.bush); set(deco, l.x + 3, l.y + 3, DECO.flowers); set(deco, l.x + 2, l.y + 3, DECO.bench);
      } else if (l.look === 'stone') {
        box(ground, l.x, l.y, l.w, l.h, GROUND.plaza);
        for (const [x, y] of [[0, 0], [5, 0], [0, 5], [5, 5]]) set(deco, l.x + x, l.y + y, DECO.pot);
        set(deco, l.x + 2, l.y + 2, DECO.tree); set(deco, l.x + 1, l.y + 3, DECO.bench); set(deco, l.x + 4, l.y + 3, DECO.bench);
      } else {
        const h = hash2(opts.seed, l.id);
        for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) { const v = hash2(h, y * 31 + x) % 100; if (v < 18) set(deco, x, y, DECO.tree); else if (v < 26) set(deco, x, y, DECO.bush); }
        set(ground, l.x + 2, fy, GROUND.path); set(deco, l.x + 2, fy, DECO.none);
      }
    }

    function homeLot(d, l) {
      const h = hash2(opts.seed, l.id);
      const upper = l.front === 'down';
      const frontY = upper ? l.y + l.h - 1 : l.y; // 路地に面した列
      const backY = upper ? l.y : l.y + l.h - 1;
      box(ground, l.x, l.y, l.w, l.h, GROUND.lawn);
      const shop = l.holder ? town.shops.get(l.holder) : null;
      if (l.state === 'vacant') {
        // NPC の家: 長屋 (S が2軒) / M が1軒 / S と畑
        const pal = NPC_PALETTES[(h >>> 4) % NPC_PALETTES.length];
        const shape = (h >>> 6) % 3;
        if (shape === 0) {
          buildings.push({ lot: l.id, kind: 'npc', x: l.x + 1, y: upper ? l.y + 3 : l.y + 1, w: 2, h: 2, palette: pal, door: upper ? 'down' : 'up' });
          buildings.push({ lot: l.id, kind: 'npc', x: l.x + 3, y: upper ? l.y + 3 : l.y + 1, w: 2, h: 2, palette: NPC_PALETTES[(h >>> 8) % NPC_PALETTES.length], door: upper ? 'down' : 'up' });
          set(deco, l.x, backY, DECO.tree); set(deco, l.x + 5, backY, DECO.tree); set(deco, l.x + 3, backY, DECO.crate);
        } else if (shape === 1) {
          buildings.push({ lot: l.id, kind: 'npc', x: l.x + 1, y: l.y + 1, w: 4, h: 4, palette: pal, door: upper ? 'down' : 'up' });
          set(deco, l.x, frontY, DECO.pot); set(deco, l.x + 5, backY, DECO.tree);
        } else {
          buildings.push({ lot: l.id, kind: 'npc', x: l.x + 1, y: upper ? l.y + 3 : l.y + 1, w: 2, h: 2, palette: pal, door: upper ? 'down' : 'up' });
          for (let y = l.y + 1; y < l.y + 5; y++) for (let x = l.x + 3; x < l.x + 6; x++) if ((y + (upper ? 0 : 1)) % 2) set(ground, x, y, GROUND.field);
          set(deco, l.x + 4, upper ? l.y + 1 : l.y + 4, DECO.scarecrow);
        }
        set(ground, l.x + 2, frontY, GROUND.path);
        return;
      }
      // 店 (空き家も同じ建物を灰色で)
      const size = (o.sizeOverride && o.sizeOverride.lot === l.id ? o.sizeOverride.size : l.size) || 'S';
      const bs = HOME[size];
      const bx = l.x + (l.w - bs) / 2;
      const gap = size === 'L' ? 0 : 1; // 店先に1チップの前庭
      const byy = upper ? l.y + l.h - gap - bs : l.y + gap;
      const held = l.state === 'held';
      const pal = held ? { name: '空き家', roof: '#7d7468', wall: '#c9c4ba', door: '#5a5248', trim: '#ddd' } : lookOf(shop);
      // 空き家は前の持ち主を外に出さない (som も店名も null)
      buildings.push({ lot: l.id, kind: held ? 'held' : 'shop', size, x: bx, y: byy, w: bs, h: bs, palette: pal, door: upper ? 'down' : 'up', som: held ? null : shop?.som ?? null, resting: !held && !!shop?.resting, admin: !!l.reserved });
      if (size !== 'L') {
        const cx = l.x + 2 + (h % 2);
        set(ground, cx, frontY, GROUND.path);
        if (size === 'S') {
          set(ground, l.x, frontY, GROUND.flowerbed); set(ground, l.x + 1, frontY, GROUND.flowerbed);
          set(ground, l.x + 4, frontY, GROUND.flowerbed); set(ground, l.x + 5, frontY, GROUND.flowerbed);
          for (let y = l.y; y < l.y + l.h; y++) if (y !== frontY && get(ground, cx, y) === GROUND.lawn && (upper ? y > byy + bs - 1 : y < byy)) set(ground, cx, y, GROUND.path);
          set(deco, l.x, backY, DECO.tree); set(deco, l.x + 5, backY, DECO.tree);
          set(deco, l.x + 1, backY, (h >>> 3) % 2 ? DECO.bush : DECO.bench);
          set(deco, l.x + 4, backY, (h >>> 5) % 2 ? DECO.pot : DECO.bush);
          set(deco, l.x, upper ? frontY - 2 : frontY + 2, DECO.bush);
          set(deco, l.x + 5, upper ? frontY - 2 : frontY + 2, DECO.tree);
        } else {
          set(ground, l.x, frontY, GROUND.flowerbed); set(ground, l.x + 5, frontY, GROUND.flowerbed);
          set(deco, l.x + 5, frontY, (h >>> 3) % 2 ? DECO.pot : DECO.none);
          set(deco, l.x, backY, DECO.tree);
        }
        set(deco, cx + 1, frontY, DECO.mailbox);
      }
    }

    return {
      v: 2,
      id: chunkId(town, gx, gy),
      kind: d ? (d.center ? 'center' : 'district') : 'outskirts',
      part: d?.center || null,
      grid: [gx, gy],
      name: d?.name ?? null,
      origin: [X, Y],
      size: [W, H],
      chip: CHIP,
      tileset: 'kit/town/tiles-v1.png',
      tileset_manifest: 'kit/town/tileset-v1.json',
      terrain: g.stripKind,
      neighbors: { n: chunkId(town, gx, gy - 1), e: chunkId(town, gx + 1, gy), s: chunkId(town, gx, gy + 1), w: chunkId(town, gx - 1, gy) },
      ground,
      deco,
      buildings,
      objects,
      bridges,
      streets: d ? d.alleys.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y, w: a.w, h: a.h })) : [],
      lots: d ? d.lots.map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, kind: l.kind, public: l.publicKind ?? null, plan: l.publicKind === 'plot' ? 'reserved_for_facility' : null, street: l.street, number: l.number, state: l.state, som: l.holder && l.state === 'occupied' ? l.holder : null })) : [],
    };
  }
  /** 地区のチャンク (前の版の呼び方) */
  const chunkData = (town, d, opt) => chunkAt(town, d.gx, d.gy, opt);

  root.TownGen = {
    GROUND, DECO, PALETTES, NPC_PALETTES, ROOF_COLORS, DOOR_COLORS, lookOf, chunkData, chunkAt, chunksFor, viewCells, chunkId, cellOf, geom, districtIdentity, centerPlan, WATER_MARKS, GROVE_MARKS, CENTER_NAME,
    FIXTURE,
    CHIP, MOD, LOT, COLS, ROWS, STRIP, HOME, SHELF_COST, sizeOfShelves,
    mulberry32, hash2, spiral, layoutDistrict, createTown, openDistrict, placeInitial, addShop, closeShop, expireHolds,
    npcLook, addressText, addressForms, districtLabel, MUSE_NAMES, neighborsJson, aroundJson, roadCells, bounds, makeShops, addRelations, demoTown, conflicts, mutualGroups, shopLots, vacantLots,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
