// SOLD OUT for Muse — Party #4 固めプリン (案) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, EVENTS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const PUDDING = 114;

function fixture() {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}

const recipe = () => {
  const uses = BASE_ITEMS[26].uses.filter((u) => u.get.some((l) => l.item_no === PUDDING));
  assert.equal(uses.length, 1, 'ミノ牛乳の使い方に固めプリンがちょうど1つ');
  return uses[0];
};

test('固めプリン: 品番114・甘いもの (薬) 枠・市場に自然入荷しない', () => {
  const it = BASE_ITEMS[PUDDING];
  assert.equal(it.name, '固めプリン');
  assert.equal(it.type, 3);
  assert.equal(it.price, 2600, '1.0.0 で 2200→2600');
  assert.equal(it.cost, 70);
  assert.equal(it.popular, 7200);
  assert.equal(it.limit, 100);
  assert.equal(it.plus, 0);
  assert.equal(it.wslimit, BASE_ITEMS[35].wslimit, '市場の扱いはミノヨーグルトと同じ');
  assert.match(it.info, /苦め/);
  assert.deepEqual(it.uses, [], '使う効果は無し');
});

test('固めプリン: 本も熟練も要らず、ミノ5頭は減らずに牛乳10・砂糖3が減って2個できる', () => {
  const u = recipe();
  assert.ok(!u.needexp);
  assert.deepEqual([u.name, u.action, u.scale], ['固めプリンを作成する', '作る', 'セット'], '「飲む」「本」を引き継がない');
  assert.deepEqual([u.exp, u.time, u.exptime], [10, 1600, 1200], '熟練はミノタウロス♀と共有。1.0.0 で熟練0は26分40秒、最大で20分');
  const { g, dt } = fixture();
  dt.item[25 - 1] = 5;
  dt.item[26 - 1] = 30;
  dt.item[103 - 1] = 9;
  const r = useItemAction(g, dt, 26, u.no, { count: 3 });
  assert.equal(r.result.count, 3);
  assert.equal(dt.item[25 - 1], 5, 'ミノタウロスは道具');
  assert.equal(dt.item[26 - 1], 0);
  assert.equal(dt.item[103 - 1], 0);
  assert.equal(dt.item[PUDDING - 1], 6, '失敗なしで1回2個');
  assert.equal(dt.item[113 - 1], 0, '『乳菓のレシピ』は要らない');
});

test('固めプリン: ミノが4頭だと作れない・材料ぶんしか作らない', () => {
  const u = recipe();
  const { g, dt } = fixture();
  dt.item[25 - 1] = 4;
  dt.item[26 - 1] = 30;
  dt.item[103 - 1] = 9;
  assert.throws(() => useItemAction(g, dt, 26, u.no, { count: 1 }));
  dt.item[25 - 1] = 5;
  dt.item[103 - 1] = 4; // 砂糖は1回分だけ
  const r = useItemAction(g, dt, 26, u.no, { count: 3 });
  assert.equal(r.result.count, 1);
  assert.equal(dt.item[26 - 1], 20);
  assert.equal(dt.item[103 - 1], 1);
  assert.equal(dt.item[PUDDING - 1], 2);
});

test('固めプリン: 1回26分40秒 (1.0.0)、酪農家は13分20秒', () => {
  const u = recipe();
  for (const [job, sec] of [['', 1600], ['cow', 800]] as const) {
    const { g, dt } = fixture();
    dt.job = job;
    dt.item[25 - 1] = 5;
    dt.item[26 - 1] = 20;
    dt.item[103 - 1] = 6;
    const before = dt.time - g.couponTime(dt);
    useItemAction(g, dt, 26, u.no, { count: 2 });
    assert.equal(dt.time - g.couponTime(dt) - before, 2 * sec, job || '職業なし');
  }
});

test('固めプリン: 乳製品ブームで需要が増える (他の乳製品と同じ ÷1.5・人気×2)', () => {
  const e = EVENTS.get('boom-milk')!;
  const ps = e.params.filter((p) => p.item_no === PUDDING).map((p) => [p.key, p.op, p.value]);
  assert.deepEqual(ps, [['popular', '/', 1.5], ['point', '*', 2]]);
});

test('固めプリン: アイコンは 16x16 の PNG', () => {
  const png = readFileSync(`public/images/item-no-${PUDDING}.png`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 16);
  assert.equal(png[25], 6, 'RGBA');
});
