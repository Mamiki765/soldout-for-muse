// SOLD OUT for Muse — ゲーム本体のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { buy, editShowcase, enterShop, openShop, deposit } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { getWholeStore } from '../src/engine/market.js';
import { seededRng } from '../src/engine/rng.js';
import { turn } from '../src/engine/turn.js';
import { newWorld, type World } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;

function step(world: World, now: number, seed: number): Game {
  const g = new Game(world, DEFAULT_CONFIG, seededRng(seed), now);
  turn(g);
  return g;
}

function assertSane(world: World): void {
  for (const s of world.shops) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${s.shopname}.${k} = ${v}`);
    }
    for (const v of s.item) assert.ok(Number.isFinite(v) && v >= 0, `item ${v}`);
    assert.ok(s.rank >= 0 && s.rank <= 10000);
  }
  for (const v of world.wholestore) assert.ok(Number.isFinite(v) && v >= 0);
  assert.ok(Number.isFinite(world.people));
}

test('原作79種と追加23種、計102商品を読み込める', () => {
  assert.equal(MAX_ITEM, 102);
  assert.equal(BASE_ITEMS[1].name, '薬草');
  assert.equal(BASE_ITEMS[70].name, 'ナユタの首飾り');
});

test('開店して、市場から仕入れて、並べて、時間がたつと売れる', () => {
  const world = newWorld(T0, MAX_ITEM);
  let g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  openShop(g, { name: 'bob', shopname: 'ボブの店' });
  assert.equal(world.shops.length, 2);
  assert.equal(a.money, 100000);
  assert.equal(a.showcasecount, 1);
  assert.equal(a.item[itemNoByName('陳列棚増築取壊キット') - 1], 1);

  // 市場に商品が入るまで時間を進める
  let now = T0;
  for (let i = 0; i < 12; i++) {
    now += 600;
    g = step(world, now, 100 + i);
  }
  assertSane(world);
  const cases = getWholeStore(g);
  assert.ok(cases.length > 0, '市場に商品が入荷している');

  // 薬草 (1) を仕入れて並べる
  const yakusou = itemNoByName('薬草');
  g = new Game(world, DEFAULT_CONFIG, seededRng(7), now);
  const shopA = world.shops.find((s) => s.name === 'alice')!;
  enterShop(g, shopA, true);
  const msg = buy(g, shopA, { from: 0, itemno: yakusou, count: 30 });
  assert.match(msg, /市場より薬草を/);
  assert.ok(shopA.item[yakusou - 1] > 0);
  editShowcase(g, shopA, { slot: 0, itemno: yakusou, percent: 100 });
  assert.equal(shopA.showcase[0], yakusou);

  const before = shopA.item[yakusou - 1];
  for (let i = 0; i < 36; i++) {
    now += 600;
    g = step(world, now, 1000 + i);
    assertSane(world);
  }
  const after = world.shops.find((s) => s.name === 'alice')!;
  assert.ok(after.item[yakusou - 1] < before, `売れている ${before} -> ${after.item[yakusou - 1]}`);
  assert.ok(after.moneystock > 0);

  g = new Game(world, DEFAULT_CONFIG, seededRng(9), now);
  enterShop(g, after, true);
  deposit(g, after, after.moneystock);
  assert.equal(after.moneystock, 0);
});

test('3日間 (決算を2回またぐ) 動かしても値が壊れない', () => {
  const world = newWorld(T0, MAX_ITEM);
  let g = new Game(world, DEFAULT_CONFIG, seededRng(2), T0);
  for (let i = 0; i < 8; i++) openShop(g, { name: 'm' + i, shopname: 'ミューズ' + i + '号店' });
  let now = T0;
  for (let i = 0; i < 6 * 24 * 3; i++) {
    now += 600;
    g = step(world, now, 5000 + i);
    if (i % 12 === 0) {
      // 各店がときどき仕入れて並べる
      for (const s of [...world.shops]) {
        const cases = getWholeStore(g);
        if (!cases.length) break;
        const c = cases[i % cases.length];
        enterShop(g, s, true);
        try {
          buy(g, s, { from: 0, itemno: c.itemno, count: 5 });
          editShowcase(g, s, { slot: 0, itemno: c.itemno, percent: 110 });
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
        }
      }
    }
    assertSane(world);
  }
  assert.ok(world.shops.some((s) => s.rankingyesterday > 0), '決算が行われた');
  assert.ok(world.periodLog.length > 0);
});

test('商品を使う: 資金調達の方法 (ティッシュ配り)', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(3), T0);
  const s = openShop(g, { name: 'carol', shopname: 'キャロル堂' });
  const no = itemNoByName('資金調達の方法');
  s.item[no - 1] = 1;
  enterShop(g, s, true);
  const before = s.money;
  const u = useItemAction(g, s, no, 0, { count: 2 });
  assert.ok(u.result.count > 0);
  assert.equal(s.money, before + 3000 * u.result.count);
});

test('陳列棚増築取壊キット: 同じ数なら何も使わずキャンセル、変えたら増減と維持費を数字で返す', () => {
  const world = newWorld(T0, MAX_ITEM);
  const now = T0 + 24 * 3600;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(3), now);
  const a = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  a.time = now - 48 * 3600;
  enterShop(g, a, true);
  const kit = itemNoByName('陳列棚増築取壊キット');
  const before = { money: a.money, time: a.time };

  // use:0 は「棚を1つにする」。今も1つなのでキャンセル
  assert.throws(() => useItemAction(g, a, kit, 0, { count: 1 }), (e: unknown) => e instanceof GameError && /変更なし/.test(e.message));
  assert.equal(a.item[kit - 1], 1);
  assert.deepEqual({ money: a.money, time: a.time }, before);

  // use:2 は「棚を3つにする」(増築)
  const u = useItemAction(g, a, kit, 2, { count: 1 });
  assert.equal(a.showcasecount, 3);
  assert.equal(u.result.function_return, '棚 1→3: 陳列枠+2、棚の維持費(決算ごと) ￥0→￥5000');
  assert.equal(a.item[kit - 1], 0);

  // 取り壊し
  a.item[kit - 1] = 1;
  const d = useItemAction(g, a, kit, 0, { count: 1 });
  assert.equal(a.showcasecount, 1);
  assert.equal(d.result.function_return, '棚 3→1: 陳列枠-2、棚の維持費(決算ごと) ￥5000→￥0');
});

test('ランキングに職業と「○専門店」を出す (原作 inc-html-ranking.cgi)', async () => {
  const { rankingData, rankingText } = await import('../src/api/views.js');
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(5), T0);
  const a = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  let r = rankingData(g)[0];
  assert.deepEqual([r.job, r.specialty], ['', '']);
  a.job = 'weapon';
  const yakusou = itemNoByName('薬草');
  a.showcasecount = 2;
  a.showcase = [yakusou, 0];
  r = rankingData(g)[0];
  assert.deepEqual([r.job, r.specialty], ['武器屋', ''], '空の棚があれば専門店にしない');
  a.showcase = [yakusou, yakusou];
  r = rankingData(g)[0];
  assert.equal(r.specialty, '原料');
  assert.match(rankingText(rankingData(g), []), /専門店:【武器屋】アリス商店/);
  // 山師は熟練の高い地図で呼び分ける (同じなら山師だけ)
  a.job = 'material';
  assert.equal(rankingData(g)[0].job, '山師');
  a.exp[itemNoByName('近くの鉱山への地図')] = 300;
  assert.equal(rankingData(g)[0].job, '山師(探鉱夫)');
  a.exp[itemNoByName('近くの山への地図')] = 500;
  assert.equal(rankingData(g)[0].job, '山師(木こり)');
});

test('開店数に上限なし・市場の入荷式は 50, 100, 150… (案: リカさんより)', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(9), T0);
  for (let i = 0; i < 35; i++) openShop(g, { name: 's' + i, shopname: '店舗' + i + '号店' });
  assert.equal(g.marketUsers(), 50, '50店までは原作既定の50');
  for (let i = 35; i < 51; i++) openShop(g, { name: 's' + i, shopname: '店舗' + i + '号店' });
  assert.equal(g.marketUsers(), 100, '51店から100');
  for (let i = 51; i < 120; i++) openShop(g, { name: 's' + i, shopname: '店舗' + i + '号店' });
  assert.equal(world.shops.length, 120, '100店を超えても開店できる');
  assert.equal(g.marketUsers(), 150);
});
