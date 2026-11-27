// SOLD OUT for Muse — 目安箱 #6 禁断の書を使いたくないので警察に届け出を出す のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const BOOK = 65;

function fixture() {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}

const report = () => {
  const u = BASE_ITEMS[BOOK].uses.find((x) => x.name === '使いたくないので警察に届け出を出す');
  assert.ok(u, '禁断の書に「使いたくないので警察に届け出を出す」がある');
  return u;
};

test('禁断の書: 元の3つの使い方と品の定義 (処分不可・譲渡不可・需要なし) はそのまま', () => {
  const it = BASE_ITEMS[BOOK];
  assert.equal(it.name, '禁断の書');
  assert.equal(it.flag, 'mt');
  assert.equal(it.popular, 0);
  assert.deepEqual(it.uses.slice(0, 3).map((u) => u.name), ['悪い噂を流す', '万引きする', '業種の悪い噂を流す']);
  assert.equal(it.uses.length, 4);
});

test('禁断の書: 届け出は標的なし・1回ずつ・熟練なしで、熟練で時間が変わらず、本を1冊必ず使う', () => {
  const u = report();
  assert.equal(u.no, 3);
  assert.ok(u.time > 0);
  assert.equal(u.exptime, u.time);
  assert.equal(u.exp, 0);
  assert.equal(u.arg, 'nocount', '標的の店を選ばず、1回ずつ');
  assert.deepEqual(u.get, []);
  assert.deepEqual(u.use.map((l) => [l.item_no, l.count, l.proba]), [[BOOK, 1, 1000]], '本を1冊必ず消費');
});

test('禁断の書: 届け出ると本がなくなり、人気が上がり、定義の時間を使い、街の出来事に出る', () => {
  const { g, dt } = fixture();
  dt.item[BOOK - 1] = 1;
  dt.rank = 3000;
  const time = dt.time;
  const r = useItemAction(g, dt, BOOK, report().no, { count: 1 });
  assert.equal(r.result.count, 1);
  assert.equal(dt.item[BOOK - 1], 0, '本は手元に残らない (維持費が止まる)');
  assert.ok(dt.rank > 3000);
  assert.match(r.result.function_return ?? '', new RegExp(`人気${(dt.rank - 3000) / 100}%アップ`), '上がった分が返事に出る');
  assert.equal(dt.time, time + report().time);
  assert.ok(g.newLogs.some((l) => l.mode === 3 && l.msg === '試験商店が禁断の書を警察に届け出ました'));
});

test('禁断の書: 人気は上限 (100%) を超えない', () => {
  const { g, dt } = fixture();
  dt.item[BOOK - 1] = 1;
  dt.rank = 9950;
  useItemAction(g, dt, BOOK, report().no, { count: 1 });
  assert.equal(dt.rank, 10000);
});

test('禁断の書: 本が無いと届け出られない', () => {
  const { g, dt } = fixture();
  dt.item[BOOK - 1] = 0;
  dt.rank = 3000;
  assert.throws(() => useItemAction(g, dt, BOOK, report().no, { count: 1 }));
  assert.equal(dt.rank, 3000);
});
