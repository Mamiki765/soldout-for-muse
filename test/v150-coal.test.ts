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

test('石炭・黒玉の原石・黒玉のブローチの名前と値段', () => {
  assert.deepEqual([COAL, JET, BROOCH].map((no) => {
    const it = BASE_ITEMS[no];
    return [it.name, it.scale, it.type, it.price, it.popular, it.plus, it.seedmarket];
  }), [
    ['石炭', '個', 1, 300, 900, -1200, 0],
    ['黒玉の原石', '個', 1, 1500, 21600, -1200, 0],
    ['黒玉のブローチ', '個', 8, 12000, 172800, 0, 0],
  ]);
});

test('石炭と黒玉は寒波のほかのどのイベントの対象でもない', () => {
  for (const [code, ev] of EVENTS) {
    const touches = ev.params.some((p) => p.item_no === COAL || p.item_no === JET || p.item_no === BROOCH);
    assert.equal(touches, code === 'coldwave', code);
  }
  const cold = EVENTS.get('coldwave')!;
  // 寒波は石炭の値段1.5倍・客2倍、革のロングコート (85) の客1.5倍
  assert.deepEqual(cold.params.map((p) => [p.item_no, p.key, p.op, p.value]),
    [[COAL, 'price', '*', 1.5], [COAL, 'popular', '/', 2], [85, 'popular', '/', 1.5]]);
  assert.deepEqual([cold.startproba, cold.basetime, cold.plustime, cold.startmsg, cold.info, cold.endmsg],
    [40, 86400, 86400, '北から寒波がやってきました', '寒波で石炭がよく売れ、値も上がっています', '寒波が去りました']);
  assert.equal([...EVENTS.values()].filter((e) => e.group === cold.group).length, 1);
});

test('炭鉱に潜るは熟練なしで行け、探鉱夫は時間が半分', () => {
  const u = BASE_ITEMS[MINE_MAP].uses.find((u) => u.name === '炭鉱に潜る')!;
  assert.deepEqual([u.needexp, u.time, u.exptime, u.exp, u.func, u.params[0]], [null, 14400, 7200, 10, 'lostbook', '100']);
  assert.deepEqual(u.get.map((l) => [l.item_no, l.count, l.proba]), [[COAL, 80, 900], [JET, 1, 400]]);
  for (const [job, hours] of [['mine', 2], ['wood', 2], ['book', 4]] as const) {
    const { g, dt } = fixture(job);
    dt.item[MINE_MAP - 1] = 1;
    const before = dt.time;
    useItemAction(g, dt, MINE_MAP, u.no, { count: 1 });
    assert.equal(dt.time - before, hours * 3600, job);
    assert.ok(dt.item[COAL - 1] >= 70, job);
  }
});

test('黒玉のブローチは装飾の道具2つと黒玉の原石3・鉄塊1で作れ、装飾細工屋は時間が半分', () => {
  const u = BASE_ITEMS[DECO_BOOK].uses.find((u) => u.name === '黒玉のブローチを作成する')!;
  assert.deepEqual(u.use.map((l) => [l.item_no, l.count, l.proba]), [[18, 1, 0], [19, 1, 0], [JET, 3, 1000], [5, 1, 1000]]);
  assert.deepEqual(u.get.map((l) => [l.item_no, l.count, l.proba]), [[BROOCH, 1, 900]]);
  const { g, dt } = fixture('deco');
  dt.item[DECO_BOOK - 1] = 1;
  dt.item[17] = dt.item[18] = 1;
  dt.item[JET - 1] = 6;
  dt.item[4] = 2;
  const before = dt.time;
  useItemAction(g, dt, DECO_BOOK, u.no, { count: 2 });
  assert.equal(dt.time - before, 3600);
  assert.deepEqual([dt.item[JET - 1], dt.item[4], dt.item[17], dt.item[18]], [0, 0, 1, 1]);
});
