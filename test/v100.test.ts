// SOLD OUT for Muse — 1.0.0 職業バランスの見直しと新商品16種のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { V100 } from '../src/updates.js';

const T0 = 1_800_000_000;
const MINO = 25;
const MILK = 26;
const HAY = 115;
const TROUGH = 131;

function fixture(r = 0.2) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}
const FEED = BASE_ITEMS[MINO].uses.find((x) => x.name === '干し草を与えて搾る')!.no;

test('1.0.0: 新商品は116〜131の16品で、どれも作り方が1つある', () => {
  assert.equal(MAX_ITEM, 131);
  assert.deepEqual(V100.new_items!.map((i) => i.item), Array.from({ length: 16 }, (_, i) => 116 + i));
  for (let no = 116; no <= 131; no++) {
    const made = Object.values(BASE_ITEMS).flatMap((it) => it?.uses ?? []).filter((u) => u.get.some((l) => l.item_no === no));
    assert.ok(made.length >= 1, BASE_ITEMS[no].name);
  }
  const t = BASE_ITEMS[TROUGH];
  assert.deepEqual([t.name, t.price, t.limit], ['飼い葉桶', 20000, 10]);
});

test('1.0.0: 剣の鍛え方は6.4万円・すり切れ7.8%', () => {
  const book = BASE_ITEMS[20];
  assert.equal(book.price, 64000);
  const rates = new Set(book.uses.filter((u) => u.func === 'lostbook').map((u) => u.params[0]));
  assert.ok(rates.has('78'));
  assert.ok(!rates.has('100'));
});

test('飼い葉桶: 持っていると牛乳が頭数×1本増え、10%で1回ごとに1個すり減る', () => {
  // r=0.2: 壊れない (200 >= 100)
  let { g, dt } = fixture(0.2);
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  dt.item[TROUGH - 1] = 1;
  let u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 162 + 30, '10頭×3回で+30本');
  assert.equal(dt.item[TROUGH - 1], 1);
  assert.doesNotMatch(u.result.function_return!, /壊れ/);

  // r=0: 毎回壊れるが、持っている数より多くは壊れない
  ({ g, dt } = fixture(0));
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  dt.item[TROUGH - 1] = 2;
  u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 150 + 30);
  assert.equal(dt.item[TROUGH - 1], 0);
  assert.match(u.result.function_return!, /飼い葉桶が2個壊れました/);

  // 持っていなければ今までどおり
  ({ g, dt } = fixture(0.2));
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 162);
});
