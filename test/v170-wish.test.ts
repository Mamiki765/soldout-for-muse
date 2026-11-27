// SOLD OUT for Muse — 1.7.0 ほしい物リスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { onShelf, onShelfLine } from '../src/engine/onshelf.js';
import { createOrder } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { editWish, wishedFor, wishedLine } from '../src/engine/wish.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const HERB = 1;
const LEATHER = 2;
const IRON = 5;

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const shops = ['一の店', '二の店', '三の店', '四の店'].map((s, i) => openShop(g0, { name: 'w' + i, shopname: s }));
  for (const s of shops) {
    s.showcasecount = 3;
    s.time = T0 - 48 * 3600;
    s.money = 5_000_000;
  }
  return { world, shops };
}
function act<T>(world: World, dt: Shop, fn: (g: Game, me: Shop) => T, now = T0 + 60): T {
  const g = new Game(world, DEFAULT_CONFIG, seededRng(2), now);
  const me = g.shopById(dt.id)!;
  enterShop(g, me, true);
  return fn(g, me);
}

test('1.7.0 ほしい物リスト: 足す・外す・見る。上限なし、同じ品は1つ、隠し品・無い品は入れられない', () => {
  const { world, shops: [a] } = setup();
  act(world, a, (g, me) => {
    assert.equal(editWish(g, me, 0, false), 'ほしい物リストは空です');
    assert.equal(editWish(g, me, LEATHER, false), 'ほしい物リストに獣の革を足しました。ほしい物リスト (1品): 獣の革');
    assert.equal(editWish(g, me, HERB, false), 'ほしい物リストに薬草を足しました。ほしい物リスト (2品): 薬草 / 獣の革');
    assert.match(editWish(g, me, HERB, false), /^薬草はもうほしい物リストにあります/);
    for (let no = 3; no <= 60; no++) editWish(g, me, no, false);
    assert.equal(me.wish!.length, 60, '上限なし');
    assert.match(editWish(g, me, HERB, true), /^ほしい物リストから薬草を外しました/);
    assert.throws(() => editWish(g, me, MAX_ITEM + 1, false), GameError);
  });
});

test('1.7.0 ほしい物リスト: 採る側には店の数だけ (うち募集中) を1行で、自分は数えない', () => {
  const { world, shops: [a, b, c, seller] } = setup();
  seller.item[HERB - 1] = 500;
  act(world, a, (g, me) => editWish(g, me, HERB, false));
  act(world, b, (g, me) => editWish(g, me, HERB, false));
  act(world, c, (g, me) => createOrder(g, me, { itemno: HERB, price: 30, count: 300, hours: 24 }));
  act(world, seller, (g, me) => editWish(g, me, HERB, false)); // 自分は数えない
  act(world, seller, (g, me) => {
    const list = wishedFor(g, me, [HERB, LEATHER]);
    assert.deepEqual(list.map((w) => [w.name, w.shops, w.ordering, w.price]), [['薬草', 3, 1, 30]]);
    assert.equal(
      wishedLine(g, me, list),
      'ほしい物リスト: 薬草 3店 (うち募集中 1店・最高￥30) → 募集は GET /api/v1/orders?item=品番 を見て deliver で納品できます (1セットの標準価格合計が5,000円以上で、所持上限に空きがあればタイムシガレット1本。今期あと2回)',
    );
    assert.equal(wishedLine(g, me, wishedFor(g, me, [LEATHER])), null);
  });
  // 一の店から見ると、二の店・採る店 (リスト) と三の店 (募集) の3店
  act(world, a, (g, me) => {
    me.item[HERB - 1] = 10;
    assert.equal(wishedLine(g, me, wishedFor(g, me, [HERB])), 'ほしい物リスト: 薬草 3店 (うち募集中 1店・最高￥30) → 募集は GET /api/v1/orders?item=品番 を見て deliver で納品できます (1セットの標準価格合計が5,000円以上で、所持上限に空きがあればタイムシガレット1本。今期あと2回)');
    me.item[HERB - 1] = 0;
    assert.equal(wishedLine(g, me, wishedFor(g, me, [HERB])), 'ほしい物リスト: 薬草 2店 → 棚に並べると売れるかもしれません', '手持ちがないと募集には納品できないので、リストの2店だけ');
  });
});

test('1.7.0 ほしい物リスト: 作る側は digest の「他店の棚に」の1行に、棚か市場に出た品を足す', () => {
  const { world, shops: [a, b] } = setup();
  act(world, a, (g, me) => {
    editWish(g, me, LEATHER, false);
    editWish(g, me, IRON, false);
  });
  assert.deepEqual(act(world, a, (g, me) => onShelf(g, me, g.now)), [], 'どこにもなければ出さない');
  b.item[LEATHER - 1] = 50;
  b.showcase[0] = LEATHER;
  b.price[0] = 120;
  world.wholestore[IRON - 1] = 30;
  const list = act(world, a, (g, me) => onShelf(g, me, g.now));
  assert.deepEqual(list.map((x) => [x.name, x.why, x.shops, x.market ?? false]), [['獣の革', 'wish', 1, false], ['鉄塊', 'wish', 0, true]]);
  assert.equal(onShelfLine(list), '他店の棚に 獣の革(1店) 鉄塊(市場) → GET /api/v1/shops?item=品番 (市場は GET /api/v1/market)');
  assert.equal(onShelfLine(list.filter((x) => x.shops === 0)), '市場に 鉄塊(市場) → GET /api/v1/market');
});
