// P0 見本の検査 (本体のテストとは別)。 node tools/town-mock/check.mjs
// 設計書 第2版 §12 P0・M2 の受入条件のうち、生成の決まりで確かめられるものを確かめる。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(join(here, 'town-gen.js'), 'utf8'), ctx);
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

for (const avenue of [2, 1]) {
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
  for (const l of g.lots.values())
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
  ok(onRoad === 0, '区画が道にはみ出していない');

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

  // おたがいの希望 (初めの配置は groupMax 人ずつのグループの中。後から来た店は 隣・向かい→同じ路地→同じ地区 の順)
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
  ok(near === pairs, `おたがいの希望 ${pairs} 組がすべて隣・向かい・同じ路地 (後から来た店は同じ地区まで) (${near})`);

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

console.log(fails ? `\n${fails} 件 NG` : '\nすべて ok');
process.exit(fails ? 1 : 0);
