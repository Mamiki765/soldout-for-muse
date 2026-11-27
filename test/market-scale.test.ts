// SOLD OUT for Muse — 1.0.2 市場の値段を街の広さ (店50軒ごと) に合わせる
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
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
  // 魔石の標準価格・pricebase・pricehalf はデータから読む
  const it = BASE_ITEMS[MASEKI];
  const formula = (shops: number, stock: number) => {
    const k = Math.max(1, shops / 50);
    return Math.trunc(it.price / ((stock - it.pricebase * k) / (it.pricehalf * k) + 1));
  };
  const stock = it.pricebase * 4 + 948;
  assert.equal(priceAt(1, stock), priceAt(50, stock), '50店までは店数で変わらない');
  assert.equal(priceAt(50, stock), formula(50, stock));
  assert.equal(priceAt(51, stock), formula(51, stock));
  assert.equal(priceAt(150, stock), formula(150, stock));
  assert.ok(priceAt(150, stock) > priceAt(50, stock), '同じ在庫なら、街が広いほど高い');
  // 1.0.4: 150→151店で値段が跳ねない (1.0.3 までは倍率が3→4に上がっていた)
  assert.ok(Math.abs(priceAt(151, 1348) - priceAt(150, 1348)) <= 2);
  // 在庫が pricebase より少ないと標準より高い (原作どおり)
  assert.ok(priceAt(107, 10) > it.price);
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
