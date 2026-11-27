// SOLD OUT for Muse — これまでテストが無かった原作の処理の決まり (2026-11-27 の棚卸しで足した)。
// 処分 (trash)、決算直後の「初心を忘れ」、禁断の書で他店をねらう使い方、ミノ牛乳を飲む。
// バランスの数字は書かず、「どちらに動くか」「上限・下限を守るか」だけを確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop, trash } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { updateResetAfter } from '../src/engine/period.js';
import type { Rng } from '../src/engine/rng.js';
import { newWorld, type Shop } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
/** 乱数をいつも同じ値にする (0 なら確率の判定はみな当たり、0.999 ならみな外れ) */
const fixed = (x: number): Rng => ({ next: () => x });

function town(rng: Rng, shops = 1) {
  const g = new Game(newWorld(T0, MAX_ITEM), DEFAULT_CONFIG, rng, T0);
  const list: Shop[] = [];
  for (let i = 0; i < shops; i++) {
    const dt = openShop(g, { name: 't' + i, shopname: '試験' + i });
    dt.time = T0 - 48 * 3600;
    enterShop(g, dt, true);
    list.push(dt);
  }
  return { g, shops: list };
}

const HERB = itemNoByName('薬草');
const BOOK = itemNoByName('禁断の書');
const MILK = itemNoByName('ミノ牛乳');
const TECHS = ['鍛冶屋の技術', '魔法の知識', '解体屋の魂', '目利きの真髄'].map(itemNoByName);
const total = (g: Game, no: number) => g.shops.reduce((s, x) => s + x.item[no - 1], 0) + g.world.wholestore[no - 1];

test('処分: 指定した数だけ倉庫から減り、市場の在庫に戻る (街の上限は超えない)', () => {
  const { g, shops: [dt] } = town(fixed(0.5));
  dt.item[HERB - 1] = 10;
  const before = g.world.wholestore[HERB - 1];
  trash(g, dt, HERB, 4);
  assert.equal(dt.item[HERB - 1], 6);
  assert.ok(g.world.wholestore[HERB - 1] >= before && g.world.wholestore[HERB - 1] <= before + 4);
  // 持っている数より多く指定しても、持っている分まで
  trash(g, dt, HERB, 999);
  assert.equal(dt.item[HERB - 1], 0);
  assert.ok(g.world.wholestore[HERB - 1] >= 0);
});

test('処分: 持っていない品・0個・捨てられない品は断り、何も変えない', () => {
  const { g, shops: [dt] } = town(fixed(0.5));
  assert.throws(() => trash(g, dt, HERB, 1), GameError);
  dt.item[HERB - 1] = 3;
  assert.throws(() => trash(g, dt, HERB, 0), GameError);
  assert.equal(dt.item[HERB - 1], 3);
  const noTrash = Object.values(g.items).find((it) => it && g.itemFlag(it.no, 'notrash'));
  if (noTrash) {
    dt.item[noTrash.no - 1] = 1;
    assert.throws(() => trash(g, dt, noTrash.no, 1), GameError);
    assert.equal(dt.item[noTrash.no - 1], 1);
  }
});

test('初心を忘れ: 熟練の合計が少ない店は技術書を失わない', () => {
  const { g, shops: [dt] } = town(fixed(0));
  for (const no of TECHS) dt.item[no - 1] = 1;
  dt.exp = { [HERB]: 1000 };
  updateResetAfter(g);
  for (const no of TECHS) assert.equal(dt.item[no - 1], 1);
});

test('初心を忘れ: 熟練の合計が多すぎると技術書を1冊ずつ失いうる (持っていない本は減らない・負にならない)', () => {
  const { g, shops: [dt] } = town(fixed(0));
  dt.item[TECHS[0] - 1] = 2;
  dt.exp = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, 1000]));
  updateResetAfter(g);
  assert.equal(dt.item[TECHS[0] - 1], 1);
  for (const no of TECHS.slice(1)) assert.equal(dt.item[no - 1], 0);
  assert.ok(g.newLogs.some((l) => l.msg.includes('初心を忘れ')));
  // 合計が上限を少し超えただけなら、乱数しだいで失わないこともある
  const b = town(fixed(0.999));
  b.shops[0].item[TECHS[0] - 1] = 1;
  b.shops[0].exp = { [HERB]: 5000 };
  updateResetAfter(b.g);
  assert.equal(b.shops[0].item[TECHS[0] - 1], 1);
});

function gossip(rng: Rng, useName: string) {
  const { g, shops: [me, other] } = town(rng, 2);
  me.item[BOOK - 1] = 1;
  me.rank = 5000;
  other.rank = 5000;
  const no = g.items[BOOK].uses.findIndex((u) => u.name === useName);
  assert.ok(no >= 0, useName);
  useItemAction(g, me, BOOK, no, { count: 1, target: other.id });
  return { g, me, other };
}

test('禁断の書 悪い噂: 成功すると相手の人気だけが下がり、失敗すると自分の人気だけが下がる。本は1冊減る', () => {
  const ok = gossip(fixed(0), '悪い噂を流す');
  assert.ok(ok.other.rank < 5000);
  assert.equal(ok.me.rank >= 5000, true);
  assert.equal(ok.me.item[BOOK - 1], 0);
  const ng = gossip(fixed(0.999), '悪い噂を流す');
  assert.ok(ng.me.rank < 5000);
  assert.equal(ng.other.rank, 5000);
});

test('禁断の書 万引き: 成功すると相手の棚の品が自分へ移る (品の総数は変わらず、所持上限を超えない)。失敗すると自分の人気が下がる', () => {
  const setup = (rng: Rng) => {
    const { g, shops: [me, other] } = town(rng, 2);
    me.item[BOOK - 1] = 1;
    me.rank = 5000;
    other.item[HERB - 1] = 40;
    other.showcase[0] = HERB;
    other.price[0] = 20;
    const no = g.items[BOOK].uses.findIndex((u) => u.name === '万引きする');
    const sum = total(g, HERB);
    useItemAction(g, me, BOOK, no, { count: 1, target: other.id });
    return { g, me, other, sum };
  };
  const ok = setup(fixed(0));
  assert.ok(ok.me.item[HERB - 1] > 0 && ok.other.item[HERB - 1] < 40);
  assert.equal(total(ok.g, HERB), ok.sum);
  assert.ok(ok.me.item[HERB - 1] <= ok.g.items[HERB].limit);
  const ng = setup(fixed(0.999));
  assert.equal(ng.me.item[HERB - 1], 0);
  assert.equal(ng.other.item[HERB - 1], 40);
  assert.ok(ng.me.rank < 5000);
});

test('ミノ牛乳を飲む: 少し飲むと人気は下がらず上限も超えない。いっぺんに飲みすぎると人気が下がる (0未満にはならない)', () => {
  const drink = (count: number, rank: number) => {
    const { g, shops: [dt] } = town(fixed(0.5));
    dt.item[MILK - 1] = count;
    dt.rank = rank;
    const no = g.items[MILK].uses.findIndex((u) => u.name === '飲む');
    useItemAction(g, dt, MILK, no, { count });
    return dt.rank;
  };
  assert.ok(drink(1, 5000) >= 5000);
  assert.ok(drink(1, 10000) <= 10000);
  assert.ok(drink(100, 5000) < 5000);
  assert.ok(drink(100, 10) >= 0);
});
