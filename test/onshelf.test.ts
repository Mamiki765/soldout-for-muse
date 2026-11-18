// 「他店の棚に」: 欲しい品 (自分の募集の品・材料だけ足りない作り方の材料) がほかの店の棚にあるか
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { onShelf, onShelfLine } from '../src/engine/onshelf.js';
import { createOrder } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { setTutorial } from '../src/engine/tutorial.js';
import { newWorld, type Shop } from '../src/engine/types.js';
import { digestData, digestText } from '../src/api/views.js';
import { peekData } from '../src/engine/watch.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const LEATHER = itemNoByName('獣の革');
const IRON = itemNoByName('鉄塊');
const LEATHER_BOOK = itemNoByName('革細工入門');

function shelve(s: Shop, slot: number, item: number, price: number, stock: number) {
  s.showcase[slot] = item;
  s.price[slot] = price;
  s.item[item - 1] = stock;
}

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const me = openShop(g, { name: 'me', shopname: '紅茶と栞' });
  const a = openShop(g, { name: 'aa', shopname: '山師の店' });
  const b = openShop(g, { name: 'bb', shopname: '鍛冶屋' });
  for (const s of [me, a, b]) {
    s.time = T0 - 48 * 3600;
    s.money = 1_000_000;
  }
  return { world, g, me, a, b };
}

test('B: 使ったことのある本で、材料だけ足りないとき、その材料が他店の棚にあれば出す', () => {
  const { g, me, a, b } = setup();
  me.item[LEATHER_BOOK - 1] = 1;
  shelve(a, 0, LEATHER, 300, 50);
  shelve(b, 0, LEATHER, 250, 10);
  // まだ一度も使っていない本は出さない
  assert.deepEqual(onShelf(g, me), []);
  me.exp[LEATHER_BOOK] = 10;
  const list = onShelf(g, me);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { item: LEATHER, name: '獣の革', shops: 2, cheapest: 250, shop: b.id, why: 'recipe' });
  // 材料が足りていれば出さない
  me.item[LEATHER - 1] = 100;
  assert.deepEqual(onShelf(g, me), []);
});

test('A: 自分の募集の品は、最安の棚が募集の単価以下のときだけ出す。digest は単価なしで品と店数', () => {
  const { g, me, a } = setup();
  const o = createOrder(g, me, { itemno: IRON, price: g.items[IRON].price, count: 10, hours: 24 });
  assert.ok(o);
  shelve(a, 0, IRON, g.items[IRON].price + 1, 5);
  assert.deepEqual(onShelf(g, me, T0), [], '募集より高いので出さない');
  a.price[0] = g.items[IRON].price;
  const list = onShelf(g, me, T0);
  assert.equal(list.length, 1);
  assert.equal(list[0].why, 'order');

  const d = digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 });
  const text = digestText(d);
  assert.match(text, /^他店の棚に 鉄塊\(1店\) → GET \/api\/v1\/shops\?item=品番$/m);
  // 値段が変わっても digest の文は変わらない (304 を守る)
  a.price[0] = g.items[IRON].price - 10;
  assert.equal(digestText(digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 })), text);

  // 専用スイッチで消える (ヒントとは別)
  setTutorial(me, undefined, undefined, false);
  assert.doesNotMatch(digestText(digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 })), /他店の棚に/);
  setTutorial(me, undefined, false, true);
  assert.match(digestText(digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 })), /他店の棚に/, 'ヒントを切っても出る');
});

test('見張り (peek): on_shelf は Power向けだけ', () => {
  const { g, me, a } = setup();
  me.item[LEATHER_BOOK - 1] = 1;
  me.exp[LEATHER_BOOK] = 10;
  shelve(a, 0, LEATHER, 300, 50);
  assert.ok(!peekData(g, me).alerts.some((x) => x.type === 'on_shelf'), '既定 (節約) では出さない');
  me.user._alerts = JSON.stringify({ mode: 'power', on: [], off: [] });
  const al = peekData(g, me).alerts.find((x) => x.type === 'on_shelf');
  assert.ok(al);
  assert.equal(al.key, `onshelf:${LEATHER}`);
});

test('digest の行は3品まで、残りは「ほかN品」', () => {
  assert.equal(onShelfLine([]), null);
  const x = (n: number) => ({ item: n, name: '品' + n, shops: 1, cheapest: 1, shop: 1, why: 'recipe' as const });
  assert.equal(onShelfLine([x(1), x(2), x(3), x(4), x(5)]), '他店の棚に 品1(1店) 品2(1店) 品3(1店) ほか2品 → GET /api/v1/shops?item=品番');
});
