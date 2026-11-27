// SOLD OUT for Muse — 1.8.4 ナユタの首飾りがすり減る の決まりのテスト。
// すり減る量はデータ (tools/v184.json → items.json の param) の1か所だけに置き、ここでは
// 「効いている店だけ人気が上がってすり減る」「効いていない店は何も変わらない」「在庫は負にならない」を確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { BOOK_LIFE_MAX, BOOK_LIFE_MIN, TURN_FUNCS, bookDurability } from '../src/engine/scripts.js';
import { newWorld, type Shop } from '../src/engine/types.js';

const T0 = 1_800_000_000;
const NAYUTA = itemNoByName('ナユタの首飾り');
const TICK = DEFAULT_CONFIG.updateTime;
const PERIOD = DEFAULT_CONFIG.oneDayTime;
const turnFn = TURN_FUNCS[BASE_ITEMS[NAYUTA].code];

function fixture(seed = 1) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(seed), T0);
  const shops = ['a', 'b', 'c'].map((n) => openShop(g, { name: n, shopname: '試験商店' + n }));
  return { g, shops };
}

function display(dt: Shop, shelf: number, price: number, count: number): void {
  dt.showcasecount = Math.max(dt.showcasecount, shelf + 1);
  dt.showcase[shelf] = NAYUTA;
  dt.price[shelf] = price;
  dt.item[NAYUTA - 1] = count;
}

/** 売上計算と同じく、首飾りを持っている店だけを渡して periods 決算ぶん回す */
function run(g: Game, shops: Shop[], periods: number): void {
  const item = g.items[NAYUTA];
  for (let t = 0; t < (periods * PERIOD) / TICK; t++) turnFn(g, item, shops.filter((dt) => dt.item[NAYUTA - 1]), TICK);
}

test('1.8.4: ナユタの首飾りはすり減る量をデータに持ち、説明にもすり減ると書いてある', () => {
  assert.ok(Number(BASE_ITEMS[NAYUTA].param) > 0);
  assert.match(BASE_ITEMS[NAYUTA].info, /すり減/);
});

test('1.8.4: 1番目の棚に標準価格以下なら人気が上がり、首飾りはデータの量のとおりすり減る', () => {
  const { g, shops } = fixture();
  const [a] = shops;
  const std = g.items[NAYUTA].price;
  const limit = g.items[NAYUTA].limit;
  display(a, 0, std, limit);
  a.rank = 1000;
  const periods = 5;
  run(g, [a], periods);
  assert.ok(a.rank > 1000, '人気が上がる');
  const lost = limit - a.item[NAYUTA - 1];
  // 平均で 1決算 param/1000 個。寿命の幅 (BOOK_LIFE_MIN〜MAX) の分だけ前後する
  const mean = (periods * Number(g.items[NAYUTA].param)) / 1000;
  assert.ok(lost >= Math.floor(mean / BOOK_LIFE_MAX), `減った数 ${lost}`);
  assert.ok(lost <= Math.ceil(mean / BOOK_LIFE_MIN), `減った数 ${lost}`);
  assert.ok(bookDurability(a, NAYUTA) !== undefined, '耐久が倉庫に出る');
});

test('1.8.4: 2番目の棚・標準価格より高いときは、人気も上がらずすり減りもしない', () => {
  const { g, shops } = fixture();
  const [b, c] = shops;
  const std = g.items[NAYUTA].price;
  const limit = g.items[NAYUTA].limit;
  display(b, 1, std, limit);
  display(c, 0, std + 1, limit);
  b.rank = c.rank = 1000;
  run(g, [b, c], 3);
  for (const dt of [b, c]) {
    assert.equal(dt.rank, 1000);
    assert.equal(dt.item[NAYUTA - 1], limit);
    assert.equal(bookDurability(dt, NAYUTA), undefined);
  }
});

test('1.8.4: すり減って在庫がなくなると効果は止まり、在庫は負にならない', () => {
  const { g, shops } = fixture(7);
  const [a] = shops;
  display(a, 0, g.items[NAYUTA].price, 1);
  a.rank = 1000;
  // 1個の寿命の上限を十分に超えるまで回す
  run(g, [a], Math.ceil((BOOK_LIFE_MAX * 1000) / Number(g.items[NAYUTA].param)) + 2);
  assert.equal(a.item[NAYUTA - 1], 0);
  const after = a.rank;
  run(g, [a], 1);
  assert.equal(a.rank, after, '首飾りが無ければ人気は上がらない');
  assert.equal(a.item[NAYUTA - 1], 0);
});
