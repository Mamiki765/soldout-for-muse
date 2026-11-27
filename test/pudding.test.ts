// SOLD OUT for Muse — Party #4 固めプリンの決まり。数字は品のデータから読む (AGENTS.md「テストの決まり」)
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

const MINO = 25;
const MILK = 26;
const SUGAR = 103;
const need = (no: number) => recipe().use.find((l) => l.item_no === no)!;
/** 1回 (1セット) の材料をそろえる */
const stock = (dt: ReturnType<typeof fixture>['dt'], sets: number) => {
  dt.item[MINO - 1] = need(MINO).count;
  dt.item[MILK - 1] = need(MILK).count * sets;
  dt.item[SUGAR - 1] = need(SUGAR).count * sets;
};

test('固めプリン: 甘いもの (薬) 枠で、市場に自然入荷せず、市場の扱いはミノヨーグルトと同じ。使う効果は無し', () => {
  const it = BASE_ITEMS[PUDDING];
  assert.equal(it.name, '固めプリン');
  assert.equal(it.type, 3);
  assert.equal(it.plus, 0);
  assert.equal(it.wslimit, BASE_ITEMS[35].wslimit);
  assert.ok(it.price > 0 && it.limit > 1);
  assert.match(it.info, /苦め/);
  assert.deepEqual(it.uses, []);
});

test('固めプリン: 本も熟練も要らず、ミノは減らない道具で、牛乳と砂糖が回数ぶん減り、失敗なしで定義の数できる', () => {
  const u = recipe();
  assert.ok(!u.needexp);
  assert.deepEqual([u.name, u.action, u.scale], ['固めプリンを作成する', '作る', 'セット'], '「飲む」「本」を引き継がない');
  assert.equal(need(MINO).proba, 0, 'ミノは減らない');
  assert.ok(u.exptime <= u.time);
  const per = u.get.find((l) => l.item_no === PUDDING)!;
  assert.equal(per.proba, 1000, '失敗なし');
  const { g, dt } = fixture();
  stock(dt, 3);
  const r = useItemAction(g, dt, MILK, u.no, { count: 3 });
  assert.equal(r.result.count, 3);
  assert.equal(dt.item[MINO - 1], need(MINO).count);
  assert.equal(dt.item[MILK - 1], 0);
  assert.equal(dt.item[SUGAR - 1], 0);
  assert.equal(dt.item[PUDDING - 1], per.count * 3);
  assert.equal(dt.item[113 - 1], 0, '『乳菓のレシピ』は要らない');
});

test('固めプリン: ミノが1頭足りないと作れず、材料ぶんしか作らない', () => {
  const u = recipe();
  const { g, dt } = fixture();
  stock(dt, 3);
  dt.item[MINO - 1]--;
  assert.throws(() => useItemAction(g, dt, MILK, u.no, { count: 1 }));
  stock(dt, 3);
  dt.item[SUGAR - 1] = need(SUGAR).count; // 砂糖は1回分だけ
  const r = useItemAction(g, dt, MILK, u.no, { count: 3 });
  assert.equal(r.result.count, 1);
  assert.equal(dt.item[MILK - 1], need(MILK).count * 2);
  assert.equal(dt.item[SUGAR - 1], 0);
});

test('固めプリン: 回数に比例して時間がかかり、酪農家は半分', () => {
  const u = recipe();
  const spent = (job: string, count: number) => {
    const { g, dt } = fixture();
    dt.job = job;
    stock(dt, count);
    const before = dt.time - g.couponTime(dt);
    useItemAction(g, dt, MILK, u.no, { count });
    return dt.time - g.couponTime(dt) - before;
  };
  assert.equal(spent('', 2), spent('', 1) * 2);
  assert.equal(spent('cow', 2) * 2, spent('', 2));
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
