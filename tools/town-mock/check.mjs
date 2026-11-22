// P0 見本の検査 (本体のテストとは別)。 node tools/town-mock/check.mjs
// 設計書 第2版 §12 P0・M2 の受入条件のうち、生成の決まりで確かめられるものを確かめる。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(join(here, '../../public/town/town-gen.js'), 'utf8'), ctx);
const T = ctx.TownGen;

let fails = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ok  ' + msg);
  else {
    fails++;
    console.log('  NG  ' + msg);
  }
};

const snap = (town) =>
  JSON.stringify([...town.lots.values()].map((l) => [l.id, l.state, l.holder, l.size]));

for (const avenue of [3, 2]) {
  console.log(`\n# 大通り ${avenue * 32}px`);
  const a = T.demoTown({ avenue });
  const b = T.demoTown({ avenue });
  ok(snap(a) === snap(b), '同じ種・同じ入力なら同じ配置');

  const g = T.demoTown({ avenue, grow: 79 });
  const placedNow = [...g.shops.values()].filter((s) => s.lot).length;
  ok(g.shops.size === 200, `200店 (地区 ${g.districts.length})`);
  // 前からいる店の区画は変わらない (閉店で猶予中の店も同じ区画を持っている)
  let moved = 0;
  for (const [som, lot] of g.confirmed) if (g.shops.get(som).lot !== lot) moved++;
  ok(moved === 0, `121→200 で前からいる店の区画が1つも変わらない (動いた ${moved})`);
  ok(placedNow === 200, '200店すべてに区画がある');

  // 1人1区画・重なりなし
  const holders = [...g.lots.values()].filter((l) => l.holder).map((l) => l.holder);
  ok(new Set(holders).size === holders.length, '1人が2つの区画を持っていない');
  const cells = new Map();
  let overlap = 0;
  for (const l of T.shopLots(g))
    for (let x = l.x; x < l.x + l.w; x++)
      for (let y = l.y; y < l.y + l.h; y++) {
        const k = x + ',' + y;
        if (cells.has(k)) overlap++;
        cells.set(k, l.id);
      }
  const roads = T.roadCells(g);
  let onRoad = 0;
  for (const k of roads) if (cells.has(k)) onRoad++;
  ok(overlap === 0, '区画どうしの重なり 0');
  ok(onRoad === 0, '店の区画が道にはみ出していない (中央の公共の区画は中央通りが通る)');

  // 道だけをたどって中央の噴水広場まで行ける
  const start = [...roads][0];
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift().split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = x + dx + ',' + (y + dy);
      if (roads.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push(k);
      }
    }
  }
  ok(seen.size === roads.size, `道がすべてつながっている (${roads.size} チップ)`);
  let noFront = 0;
  for (const l of T.shopLots(g)) {
    const fy = l.front === 'down' ? l.y + l.h : l.y - 1;
    const fx = l.x + 2;
    if (!seen.has(fx + ',' + fy)) noFront++;
  }
  ok(noFront === 0, 'どの店の区画も店先が道 (路地) に面していて、そこから広場まで行ける');

  // ブロック
  let bad = 0;
  for (const l of T.shopLots(g)) {
    if (!l.holder) continue;
    for (const k of ['left', 'right', 'front']) {
      const o = l.links[k] && g.lots.get(l.links[k]);
      if (o && o.holder && (g.blocks.has(l.holder + '>' + o.holder) || g.blocks.has(o.holder + '>' + l.holder))) bad++;
    }
  }
  ok(bad === 0, 'ブロックし合っている2人が左右・向かいにいない');

  // おたがいの希望 (wishPlacement を入れたときだけ。既定はランダム優先で、この決まりは未決)
  {
  const g = T.demoTown({ avenue, grow: 79, wishPlacement: true });
  // (初めの配置は groupMax 人ずつのグループの中。後から来た店は 隣・向かい→同じ路地→同じ地区 の順)
  const base = [...g.shops.values()].filter((s) => !s.isNew);
  const sameGroup = new Set();
  for (const grp of T.mutualGroups(base, g.opts.groupMax)) for (const x of grp) for (const y of grp) sameGroup.add(x.som + '|' + y.som);
  let pairs = 0, near = 0;
  for (const s of g.shops.values()) {
    for (const t of s.wishes) {
      const o = g.shops.get(t);
      if (!o || !o.wishes.includes(s.som) || s.som > t) continue;
      if (!s.isNew && !o.isNew && !sameGroup.has(s.som + '|' + t)) continue;
      pairs++;
      const l = g.lots.get(s.lot), m = g.lots.get(o.lot);
      const adj = ['left', 'right', 'front'].some((k) => l.links[k] === m.id);
      const sameStreet = l.street === m.street;
      if (adj || sameStreet || ((s.isNew || o.isNew) && l.district === m.district)) near++;
    }
  }
  ok(near === pairs, `[希望を使う案] おたがいの希望 ${pairs} 組がすべて隣・向かい・同じ路地 (後から来た店は同じ地区まで) (${near})`);
  let gb = 0;
  for (const l of T.shopLots(g)) for (const k of ['left', 'right', 'front']) {
    const o = l.links[k] && g.lots.get(l.links[k]);
    if (o && l.holder && o.holder && (g.blocks.has(l.holder + '>' + o.holder) || g.blocks.has(o.holder + '>' + l.holder))) gb++;
  }
  ok(gb === 0, '[希望を使う案] 希望のグループの中でも、ブロックし合う2人は隣・向かいにならない');
  }

  // 川越し・裏どうしは隣にならない
  let across = 0;
  for (const l of T.shopLots(g)) {
    for (const k of ['left', 'right', 'front']) {
      const o = l.links[k] && g.lots.get(l.links[k]);
      if (o && o.street !== l.street) across++;
    }
  }
  ok(across === 0, '隣・向かいはいつも同じ路地 (水路・生け垣越しの裏どうしは隣にしない)');

  // 初めの配置は各地区 8割まで (後から来た店の入る余地)
  const a2 = T.demoTown({ avenue });
  let over = 0;
  for (const d of a2.districts) {
    const shopsIn = d.lots.filter((l) => l.kind === 'shop');
    const occ = shopsIn.filter((l) => l.holder).length;
    if (occ > Math.floor(shopsIn.length * 0.8)) over++;
  }
  ok(over === 0, `初めの配置で各地区が8割以下 (地区 ${a2.districts.length})`);

  // NPC の家は区画ID で決まる
  const lot = T.vacantLots(g)[0];
  ok(JSON.stringify(T.npcLook(g, lot.id)) === JSON.stringify(T.npcLook(T.demoTown({ avenue, grow: 79 }), lot.id)), 'NPC の家は何度作っても同じ見た目');

  // 猶予切れで NPC の家に戻る。まわりは変わらない
  const held = [...g.lots.values()].filter((l) => l.state === 'held');
  const before = snap(g);
  T.expireHolds(g, 30 * 86400);
  const after = JSON.parse(snap(g));
  const diff = JSON.parse(before).filter((x, i) => JSON.stringify(x) !== JSON.stringify(after[i]));
  ok(held.length === 2 && diff.length === held.length && held.every((l) => l.state === 'vacant'), '猶予が切れると空き家だけが NPC の家に戻る');
}

console.log('\n# 地形・チャンク・橋');
for (const opt of [{}, { cols: 8 }, { avenue: 2, alley: 1 }, { center: 'admin' }]) {
  const g = T.demoTown({ grow: 79, fixture: true, ...opt });
  const label = JSON.stringify(opt);
  const cs = T.chunksFor(g);
  // チャンクは重ならず、すき間なく並ぶ
  const owner = new Map();
  let dup = 0;
  for (const c of cs) for (let j = 0; j < c.size[1]; j++) for (let i = 0; i < c.size[0]; i++) {
    const k = c.origin[0] + i + ',' + (c.origin[1] + j);
    if (owner.has(k)) dup++;
    owner.set(k, c);
  }
  ok(dup === 0, `${label} チャンクどうしで同じマスを持たない (${cs.length} チャンク)`);
  const at = (x, y) => { const c = owner.get(x + ',' + y); return c ? c.ground[(y - c.origin[1]) * c.size[0] + (x - c.origin[0])] : null; };
  // 道はチャンクのデータでもつながっている (大通り・歩道・路地・橋・広場)
  const R = new Set([T.GROUND.avenue, T.GROUND.curb, T.GROUND.alley, T.GROUND.bridge, T.GROUND.plaza]);
  let miss = 0;
  for (const k of T.roadCells(g)) { const [x, y] = k.split(',').map(Number); if (!R.has(at(x, y))) miss++; }
  ok(miss === 0, `${label} 道のマスがチャンクのデータでも道・橋・広場 (違う ${miss})`);
  // 川と並木は地区の境目で切れない: 横に続く帯は、どの列でも同じ地形が左右に続く
  let breaks = 0;
  for (const c of cs) {
    const gm = T.geom(g.opts, c.grid[0], c.grid[1]);
    for (let y = gm.stripY; y < gm.stripY + 2; y++) for (let x = c.origin[0]; x < c.origin[0] + c.size[0]; x++) {
      const v = at(x, y);
      const okv = gm.stripKind === 'canal' ? [T.GROUND.canal, T.GROUND.bridge] : [T.GROUND.hedge, T.GROUND.avenue, T.GROUND.curb, T.GROUND.alley];
      if (!okv.includes(v)) breaks++;
    }
  }
  ok(breaks === 0, `${label} 川・並木が地区をまたいで切れずに続く (切れ目 ${breaks})`);
  // 道が川を渡る所はすべて橋。橋は川幅より両岸へ1マスずつ長い
  let noBridge = 0, short = 0, nb = 0;
  for (const c of cs) for (const b of c.bridges) { nb++; if (b.h !== 2 + 2 || at(b.x, b.y) !== T.GROUND.bridge || at(b.x, b.y + b.h - 1) !== T.GROUND.bridge) short++; }
  for (const k of T.roadCells(g)) {
    const [x, y] = k.split(',').map(Number);
    const c = owner.get(k);
    const gm = T.geom(g.opts, ...T.cellOf(g, x, y));
    if (gm.stripKind === 'canal' && y >= gm.stripY && y < gm.stripY + 2 && at(x, y) !== T.GROUND.bridge) noBridge++;
  }
  ok(noBridge === 0 && nb > 0, `${label} 道と川が交わる所はすべて橋 (橋 ${nb})`);
  ok(short === 0, `${label} 橋は両岸の陸へ1マスずつ延びる (川 64px → 橋 128px)`);
  // 中央地区
  const center = g.districts[0], east = g.districts[1];
  const shopsIn = [...center.lots, ...east.lots].filter((l) => l.kind === 'shop');
  ok(center.gx === 0 && center.gy === 0 && east.gx === 1 && east.gy === 0 && east.center === 'east', `${label} 中央は横に2チャンク (西=公共施設、東=公園と予定地)`);
  ok(east.lots.some((l) => l.publicKind === 'plot') && east.lots.every((l) => l.kind === 'public'), `${label} 中央の東は公園と予定地だけ (予定地 ${east.lots.filter((l) => l.publicKind === 'plot').length} 区画)`);
  // 中央の2チャンクのあいだは石畳の中央軸 (大通りの段差・歩道なし、川の上は橋)
  const ax = owner.get(east.x0 - 1 + ',' + (east.y0 + 2));
  ok(at(east.x0 - 1, east.y0 + 2) === T.GROUND.plaza, `${label} 中央の2チャンクのあいだは石畳の中央軸`);
  ok(opt.center === 'admin' ? shopsIn.length === 1 && shopsIn[0].holder === 'som0002' : shopsIn.length === 0, `${label} 中央地区の店: ${opt.center === 'admin' ? '管理人の店 (som0002) だけ' : 'なし (公共施設だけ)'}`);
  // 空き家は前の持ち主を外に出さない
  const leak = cs.some((c) => c.buildings.some((b) => b.kind === 'held' && b.som) || c.lots.some((l) => l.state === 'held' && l.som));
  ok(!leak, `${label} 空き家のデータに前の持ち主の som が出ない`);
}

console.log('\n# 地区名・ブロック・閉店の猶予');
{
  const a = T.demoTown({}), b = T.demoTown({ grow: 79 });
  const same = a.districts.every((d, i) => b.districts[i].name === d.name && b.districts[i].landmark.name === d.landmark.name);
  ok(same, `店が増えても前からある地区の名前・目印は変わらない (${a.districts.length} → ${b.districts.length} 地区)`);
  const names = b.districts.map((d) => d.name);
  ok(new Set(names).size === names.length, '地区名がかぶらない');
  // 空きはあるがブロックで入れる所が無い
  const t = T.demoTown({});
  const lone = { som: 'somX001', shop: 'x', owner: 'x', job: '', shelves: 1, size: 'S', hue: 0, wishes: [] };
  const blocks = new Set(t.blocks);
  for (const s of t.shops.values()) blocks.add('somX001>' + s.som);
  let threw = false, got = null;
  try { got = T.addShop(t, lone, blocks); } catch (e) { threw = true; }
  ok(!threw && got && !T.conflicts(t, got, 'somX001', blocks), '全員をブロックしていても新しい店は例外にならず、ブロック相手の隣でない区画に入る');
  // 猶予中に同じ som が戻ると元の区画へ。猶予の満了で新しい住所が消えない
  const u = T.demoTown({});
  const s0 = [...u.shops.values()].find((s) => s.lot && !s.resting);
  const lot0 = s0.lot;
  T.closeShop(u, s0.som, 0, 14);
  T.addShop(u, s0, u.blocks);
  T.expireHolds(u, 30 * 86400);
  ok(s0.lot === lot0 && u.lots.get(lot0).state === 'occupied' && u.lots.get(lot0).holder === s0.som, '(案) 猶予中に戻った店は元の区画に戻り、満了で住所が消えない');
  // 別の区画で開き直していた場合も、満了で新しい住所は消えない
  const v = T.demoTown({});
  const s1 = [...v.shops.values()].find((s) => s.lot && !s.resting);
  const old = s1.lot;
  T.closeShop(v, s1.som, 0, 14);
  const nl = T.vacantLots(v)[0];
  nl.state = 'occupied'; nl.holder = s1.som; s1.lot = nl.id; // 別の区画で開き直した
  T.expireHolds(v, 30 * 86400);
  ok(s1.lot === nl.id && v.lots.get(old).state === 'vacant', '別の区画で開き直していても、古い猶予の満了は古い区画だけを空ける');
}

console.log(fails ? `\n${fails} 件 NG` : '\nすべて ok');
process.exit(fails ? 1 : 0);
