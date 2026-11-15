// SOLD OUT for Muse — 熟練の共有 (ミノ牛乳 ↔ ミノタウロス♀) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { itemDetailData, itemDetailText } from '../src/api/views.js';

const T0 = 1_800_000_000;
const MILK = 26;
const MINO = 25;

function fixture(job = '') {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  dt.job = job;
  return { g, dt };
}

/** ミノ牛乳の「物を作る」使い方 (飲む以外) */
const makes = BASE_ITEMS[MILK].uses.filter((u) => u.get.length);

function stock(dt: ReturnType<typeof fixture>['dt'], u: (typeof makes)[number], sets: number) {
  for (const l of u.use) dt.item[l.item_no - 1] = l.proba === 0 ? l.count : l.count * sets;
  dt.item[MILK - 1] += 1; // 使い方はミノ牛乳を1本以上持っていないと開けない (クリームから作る品のため)
}

test('ミノ牛乳の作る使い方はすべて熟練0で今の時間、熟練最大で3/4、1セットで熟練+1%', () => {
  assert.ok(makes.length >= 5);
  for (const u of makes) {
    assert.equal(u.exptime, Math.trunc(u.time * 0.75), u.name!);
    assert.equal(u.exp, 10, u.name!);
  }
  const drink = BASE_ITEMS[MILK].uses[0];
  assert.equal(drink.get.length, 0);
  assert.deepEqual([drink.exp, drink.time, drink.exptime], [0, 180, 180], '飲むは変えない');
});

test('時間はミノタウロス♀の熟練で縮み (ミノ牛乳自身の熟練は見ない)、熟練はミノタウロス♀に入る', () => {
  for (const u of makes) {
    for (const [job, div] of [['', 1], ['cow', 2]] as const) {
      for (const exp of [0, 500, 1000]) {
        const { g, dt } = fixture(job);
        if (exp) dt.exp[MINO] = exp;
        dt.exp[MILK] = 1000; // 無関係であることの確認
        stock(dt, u, 1);
        const before = dt.time - g.couponTime(dt);
        const r = useItemAction(g, dt, MILK, u.no, { count: 1 });
        assert.equal(r.result.count, 1, u.name!);
        const t = Math.trunc(u.time / div), e = Math.trunc(u.exptime / div);
        assert.equal(dt.time - g.couponTime(dt) - before, t - Math.trunc(((t - e) * exp) / 1000), `${u.name} ${job} 熟練${exp}`);
        assert.equal(dt.exp[MINO], Math.min(1000, exp + 10), `${u.name}: ミノタウロス♀の熟練が増える`);
        assert.equal(dt.exp[MILK], 1000, 'ミノ牛乳の熟練は動かない');
      }
    }
  }
});

test('搾乳でためた熟練 (と転職で集めた熟練) がそのまま乳製品の時間に効く', () => {
  const { g, dt } = fixture('cow');
  dt.item[MINO - 1] = 1;
  useItemAction(g, dt, MINO, 0, { count: 3 });
  assert.equal(dt.exp[MINO], 30, '搾乳は今までどおり1回+1%');
  const yogurt = makes.find((u) => u.get[0].item_no === 35)!;
  stock(dt, yogurt, 1);
  const before = dt.time - g.couponTime(dt);
  useItemAction(g, dt, MILK, yogurt.no, { count: 1 });
  const t = Math.trunc(yogurt.time / 2), e = Math.trunc(yogurt.exptime / 2);
  assert.equal(dt.time - g.couponTime(dt) - before, t - Math.trunc(((t - e) * 30) / 1000));
  assert.equal(dt.exp[MINO], 40);
});

test('商品の説明に熟練の共有先が出る', () => {
  const { g, dt } = fixture();
  const d = itemDetailData(g, MILK, dt);
  assert.deepEqual(d.skill_item, { item: MINO, name: 'ミノタウロス♀' });
  assert.match(itemDetailText(d), /熟練はミノタウロス♀と共通/);
  assert.equal('skill_item' in itemDetailData(g, 35, dt), false);
});
