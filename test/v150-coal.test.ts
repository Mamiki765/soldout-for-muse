// SOLD OUT for Muse — 1.5.0 石炭と寒波。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, EVENTS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const MINE_MAP = 9;
const DECO_BOOK = 66;
const COAL = 139;
const JET = 140;
const BROOCH = 141;

function fixture(job: string) {
  const g = new Game(newWorld(T0, MAX_ITEM), { ...DEFAULT_CONFIG, couponTime: 0 }, { next: () => 0.1 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = job;
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}

test('石炭・黒玉の原石は原料、黒玉のブローチは装飾品。市場には湧かず、初期投入もしない', () => {
  assert.deepEqual([COAL, JET, BROOCH].map((no) => {
    const it = BASE_ITEMS[no];
    return [it.name, it.type, it.plus <= 0, it.seedmarket];
  }), [
    ['石炭', 1, true, 0],
    ['黒玉の原石', 1, true, 0],
    ['黒玉のブローチ', 8, true, 0],
  ]);
  assert.ok(BASE_ITEMS[COAL].price < BASE_ITEMS[JET].price && BASE_ITEMS[JET].price < BASE_ITEMS[BROOCH].price, '石炭 < 原石 < ブローチ');
});

test('石炭と黒玉は寒波のほかのどのイベントの対象でもない', () => {
  for (const [code, ev] of EVENTS) {
    const touches = ev.params.some((p) => p.item_no === COAL || p.item_no === JET || p.item_no === BROOCH);
    assert.equal(touches, code === 'coldwave', code);
  }
  const cold = EVENTS.get('coldwave')!;
  // 寒波は石炭の値段と客を上げ (値段は * 1より大、客は popular を 1より大で割る)、革のロングコート (85) の客も上げる
  const up = (no: number, key: string, op: string) => cold.params.some((p) => p.item_no === no && p.key === key && p.op === op && p.value > 1);
  assert.ok(up(COAL, 'price', '*') && up(COAL, 'popular', '/') && up(85, 'popular', '/'));
  assert.ok(cold.startproba > 0 && cold.basetime > 0, '起こりうる');
  assert.deepEqual([cold.startmsg, cold.info, cold.endmsg], ['北から寒波がやってきました', '寒波で石炭がよく売れ、値も上がっています', '寒波が去りました']);
  assert.equal([...EVENTS.values()].filter((e) => e.group === cold.group).length, 1);
});

// 炭鉱はわざと鉱石より弱い (約8割、リカさん 2026-11-24)。ふだんは鉱石が得で、石炭は暴落時の逃げ道。
// 探鉱夫を上げたいときも石炭の個数は上げない (tools/v150-coal.json の note)。
test('炭鉱は熟練100%・職ボーナスで鉄・ミスリル鉱山の9割未満の稼ぎ (わざと弱い)', () => {
  const perHour = (u: (typeof BASE_ITEMS)[number]['uses'][number]) =>
    u.get.reduce((s, l) => s + l.count * l.proba / 1000 * BASE_ITEMS[l.item_no].price, 0) / (u.exptime / 2);
  const uses = BASE_ITEMS[MINE_MAP].uses;
  const coal = perHour(uses.find((u) => u.name === '炭鉱に潜る')!);
  for (const name of ['鉄鉱山へ行く', 'ミスリル鉱山へ行く']) {
    assert.ok(coal < perHour(uses.find((u) => u.name === name)!) * 0.9, name);
  }
});

test('炭鉱に潜るは熟練なし・材料なしで行け、石炭と黒玉の原石が取れ、探鉱夫・木こりは時間が半分', () => {
  const u = BASE_ITEMS[MINE_MAP].uses.find((u) => u.name === '炭鉱に潜る')!;
  assert.ok(!u.needexp);
  assert.deepEqual(u.use, []);
  assert.ok(u.exptime <= u.time);
  assert.deepEqual(u.get.map((l) => l.item_no), [COAL, JET]);
  const spent = (job: string) => {
    const { g, dt } = fixture(job);
    dt.item[MINE_MAP - 1] = 1;
    const before = dt.time;
    useItemAction(g, dt, MINE_MAP, u.no, { count: 1 });
    assert.ok(dt.item[COAL - 1] > 0, job);
    return dt.time - before;
  };
  assert.equal(spent('mine') * 2, spent('book'));
  assert.equal(spent('wood') * 2, spent('book'));
});

test('黒玉のブローチは装飾の道具2つ (減らない) と黒玉の原石・鉄塊で作れ、装飾細工屋は時間が半分', () => {
  const u = BASE_ITEMS[DECO_BOOK].uses.find((u) => u.name === '黒玉のブローチを作成する')!;
  assert.deepEqual(u.use.map((l) => [l.item_no, l.proba > 0]), [[18, false], [19, false], [JET, true], [5, true]]);
  assert.deepEqual(u.get.map((l) => l.item_no), [BROOCH]);
  const jet = u.use.find((l) => l.item_no === JET)!.count;
  const iron = u.use.find((l) => l.item_no === 5)!.count;
  const spent = (job: string) => {
    const { g, dt } = fixture(job);
    dt.item[DECO_BOOK - 1] = 1;
    dt.item[17] = dt.item[18] = 1;
    dt.item[JET - 1] = jet * 2;
    dt.item[4] = iron * 2;
    const before = dt.time;
    useItemAction(g, dt, DECO_BOOK, u.no, { count: 2 });
    assert.deepEqual([dt.item[JET - 1], dt.item[4], dt.item[17], dt.item[18]], [0, 0, 1, 1], job);
    return dt.time - before;
  };
  assert.equal(spent('deco') * 2, spent(''));
});
