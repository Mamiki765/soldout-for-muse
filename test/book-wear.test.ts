// SOLD OUT for Muse — 1.0.3 本・地図の耐久値制 (すり切れの天井と床) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';
import { meData } from '../src/api/views.js';

const T0 = 1_800_000_000;
const BOOK = itemNoByName('薬調合入門');

function fixture(seed: number) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(seed), T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = 'drug';
  dt.item[BOOK - 1] = 1000;
  return { g, dt };
}

/** 1回作る (材料はその都度足す。時間は気にしない) */
function brew(g: Game, dt: ReturnType<typeof fixture>['dt'], name: string): boolean {
  const u = BASE_ITEMS[BOOK].uses.find((x) => x.name === name)!;
  dt.exp[BOOK] = 1000;
  for (const l of u.use) if (l.item_no !== BOOK) dt.item[l.item_no - 1] = Math.max(dt.item[l.item_no - 1], l.count);
  dt.time = g.now - 48 * 3600;
  enterShop(g, dt, true);
  const before = dt.item[BOOK - 1];
  useItemAction(g, dt, BOOK, u.no, { count: 1 });
  return dt.item[BOOK - 1] < before;
}

test('1.0.3: 本の傷みは1回ごとに今の確率ぶん、寿命 0.7〜1.3 に届くまで壊れず、平均の冊数は今と同じ', () => {
  for (const [name, p] of [['ポーションを作成する', 0.038], ['エリ草を作成する', 0.115]] as const) {
    const { g, dt } = fixture(name.length);
    const n = 4000;
    const gaps: number[] = [];
    let last = 0;
    for (let i = 1; i <= n; i++) {
      if (brew(g, dt, name)) {
        gaps.push(i - last);
        last = i;
      }
    }
    const lost = gaps.length;
    // 期待 n*p 冊 (ポーション152・エリ草460)。寿命のゆらぎだけなので誤差は数%以内
    assert.ok(Math.abs(lost / (n * p) - 1) < 0.05, `${name}: ${lost} 冊 (期待 ${n * p})`);
    // 床と天井: 寿命 0.7〜1.3 → 間隔は 0.7/p-1 回より長く、1.3/p+1 回より短い (続けて壊れない)
    assert.ok(Math.min(...gaps) >= Math.floor(0.7 / p) - 1, `${name} 最短 ${Math.min(...gaps)}`);
    assert.ok(Math.max(...gaps) <= Math.ceil(1.3 / p) + 1, `${name} 最長 ${Math.max(...gaps)}`);
  }
});

test('1.0.3: 同じ本で重さの違う品を混ぜても、それぞれの確率の合計どおりに壊れる', () => {
  const { g, dt } = fixture(7);
  const mix = ['ポーションを作成する', 'エーテルを作成する', 'ハイエーテルを作成する', 'エリ草を作成する'];
  const wear = (n: string) => Number(BASE_ITEMS[BOOK].uses.find((x) => x.name === n)!.params[0]) / 1000;
  let expect = 0;
  let lost = 0;
  for (let i = 0; i < 4000; i++) {
    const name = mix[i % mix.length];
    expect += wear(name);
    if (brew(g, dt, name)) lost++;
  }
  assert.ok(Math.abs(lost / expect - 1) < 0.05, `${lost} 冊 (期待 ${expect})`);
});

test('1.0.3: 傷みは作った結果と me の倉庫 (wear%) に出る。0冊にしても傷みは残る', () => {
  const { g, dt } = fixture(1);
  dt.bookwear = { [BOOK]: [0.5, 1.2] };
  const u = BASE_ITEMS[BOOK].uses.find((x) => x.name === 'ポーションを作成する')!;
  dt.exp[BOOK] = 1000;
  for (const l of u.use) if (l.item_no !== BOOK) dt.item[l.item_no - 1] = l.count;
  dt.time = g.now - 48 * 3600;
  enterShop(g, dt, true);
  const r = useItemAction(g, dt, BOOK, u.no, { count: 1 });
  const msgs = useResultMessages(g, dt, r);
  assert.ok(msgs.includes('薬調合入門の傷み: 53%'), msgs.join('\n'));
  const row = meData(g, dt).stock.find((s) => s.item === BOOK)!;
  assert.equal(row.wear, 53);
  dt.item[BOOK - 1] = 0;
  assert.equal(meData(g, dt).stock.find((s) => s.item === BOOK)?.wear, 53);
  // 使ったことのない本には wear を出さない
  dt.item[itemNoByName('剣の鍛え方') - 1] = 1;
  assert.equal(meData(g, dt).stock.find((s) => s.item === itemNoByName('剣の鍛え方'))!.wear, undefined);
});
