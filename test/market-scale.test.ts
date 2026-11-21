// SOLD OUT for Muse — 1.0.2 市場の値段を街の広さ (店50軒ごと) に合わせる
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { getWholeStore } from '../src/engine/market.js';
import { newWorld } from '../src/engine/types.js';

const T0 = 1_800_000_000;
const MASEKI = 8;

function priceAt(shops: number, stock: number): number {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.5 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  world.shops = Array(shops).fill(dt);
  world.wholestore[MASEKI - 1] = stock;
  return getWholeStore(g).find((c) => c.itemno === MASEKI)!.price;
}

test('1.0.2/1.0.4: 市場の値段は 50店までは原作どおり、それを超えると pricebase/pricehalf が 店数÷50 倍に伸びる', () => {
  // 魔石: 標準1000円、pricebase 100、pricehalf 500
  assert.equal(priceAt(1, 1348), 286);
  assert.equal(priceAt(50, 1348), 286);
  assert.equal(priceAt(51, 1348), Math.trunc(1000 / ((1348 - 102) / 510 + 1)));
  assert.equal(priceAt(115, 1346), 507);
  assert.equal(priceAt(150, 1348), Math.trunc(1000 / ((1348 - 300) / 1500 + 1)));
  // 1.0.4: 150→151店で値段が跳ねない (1.0.3 までは倍率が3→4に上がっていた)
  assert.ok(Math.abs(priceAt(151, 1348) - priceAt(150, 1348)) <= 2);
  // 在庫が pricebase より少ないと標準より高い (原作どおり)
  assert.ok(priceAt(107, 10) > 1000);
});

test('1.0.4: 市場の湧く量も 150→151店で段差がない', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.5 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  const factor = (shops: number) => {
    world.shops = Array(shops).fill(dt);
    return (g.marketUsers() + (shops - 1) - 1) * 0.2 + 1;
  };
  assert.ok(factor(151) / factor(150) < 1.01, `${factor(150)} → ${factor(151)}`);
  // 50店までは原作 ($MAX_USER=50) と同じ
  assert.equal(factor(50), (50 + 49 - 1) * 0.2 + 1);
});
