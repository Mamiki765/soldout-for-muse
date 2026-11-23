// SOLD OUT for Muse — 職レベルの曲線、作業、決算のテスト。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestData, digestText, meData } from '../src/api/views.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { averageJoblvYield, progressAt, PROGRESS_THRESHOLDS } from '../src/engine/joblv.js';
import { turn } from '../src/engine/turn.js';
import { newWorld } from '../src/engine/types.js';
import { itemUseTime, useItemAction, type RtUse } from '../src/engine/use.js';

const NOW = 1_800_000_000;
const MINE = 9;
const BOOK_KIT = 10;
const JOB_CHANGE = 78;

function fixture(job = '') {
  const g = new Game(newWorld(NOW, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0.5 }, NOW);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = NOW - 48 * 3600;
  dt.job = job;
  enterShop(g, dt, true);
  return { g, dt };
}

function supply(dt: ReturnType<typeof fixture>['dt'], item: number, use: number, count: number) {
  for (const l of BASE_ITEMS[item].uses.find((u) => u.no === use)!.use) {
    dt.item[l.item_no - 1] = l.count * (l.proba ? count : 1);
  }
  dt.item[item - 1] = Math.max(dt.item[item - 1], 1);
}

test('累計ポイントの境目と上限', () => {
  assert.deepEqual(PROGRESS_THRESHOLDS, [0, 320, 2430, 10240, 31250, 77760, 168070, 327680, 590490, 1000000, 1610510]);
  for (const [lv, point] of PROGRESS_THRESHOLDS.entries()) {
    assert.deepEqual(progressAt(point), { lv, point, next: PROGRESS_THRESHOLDS[lv + 1] ?? null });
    if (lv > 0) assert.equal(progressAt(point - 1).lv, lv - 1);
  }
  assert.equal(progressAt(2_000_000).lv, 10);
});

test('レベル0は従来の成果・抽選順で、レベル1は確定の成果にも1個ずつ追加抽選', () => {
  // ロボットの解体は各素材が確定。材料と成果の抽選はレベル0では不要。
  const no = 39;
  const use = 11;
  const run = (seconds: number | undefined) => {
    const { g, dt } = fixture();
    dt.exp[no] = 1000;
    if (seconds === undefined) delete dt.joblvpt;
    else dt.joblvpt = { [no]: seconds };
    supply(dt, no, use, 1);
    const rolls: number[] = [];
    g.rand = (n = 1) => {
      rolls.push(n);
      return rolls.length % 2 ? 19 : 20;
    };
    const result = useItemAction(g, dt, no, use, { count: 1 });
    return { result, rolls };
  };
  const old = run(undefined);
  const beforeThreshold = run(320 * 60 - 1);
  assert.deepEqual(old.rolls, []);
  assert.deepEqual(beforeThreshold.rolls, old.rolls);
  assert.deepEqual(beforeThreshold.result.result, old.result.result);
  const raised = run(320 * 60);
  const guaranteed = BASE_ITEMS[no].uses.find((u) => u.no === use)!.get;
  assert.deepEqual(old.result.result.additem, guaranteed.map(({ item_no, count }) => ({ item_no, count })));
  let units = 0;
  const expected = guaranteed.map(({ item_no, count }) => {
    const extra = Math.ceil((units + count) / 2) - Math.ceil(units / 2);
    units += count;
    return { item_no, count: Math.min(BASE_ITEMS[item_no].limit, count + extra) };
  });
  assert.deepEqual(raised.result.result.additem, expected);
  assert.match(raised.result.result.trashmsg.join(' '), /禁断の書を1/);
  assert.deepEqual(raised.result.result.useitem, old.result.result.useitem);
  assert.ok(raised.rolls.every((n) => n === 1000));
  assert.equal(raised.rolls.length, units);
});

test('失敗した作業と熟練100%の作業でも、職ボーナス適用後の実行秒数を積む', () => {
  const work = (job: string): RtUse => {
    const { g, dt } = fixture(job);
    dt.exp[MINE] = 1000;
    supply(dt, MINE, 0, 2);
    g.rand = (n = 1) => n - 1;
    const oldTime = dt.time;
    const u = useItemAction(g, dt, MINE, 0, { count: 2 });
    assert.equal(u.result.count, 2);
    assert.deepEqual(u.result.additem, []);
    assert.equal(dt.exp[MINE], 1000);
    assert.equal(dt.joblvpt?.[MINE], dt.time - oldTime);
    assert.deepEqual(meData(g, dt).joblv[MINE], progressAt(Math.trunc(itemUseTime(dt, u) * 2 / 60)));
    return u;
  };
  assert.equal(work('mine').exptime * 2, work('').exptime);
});

test('熟練共有先に加算し、転職は職レベルを移さない', () => {
  const { g, dt } = fixture();
  const milk = 26;
  supply(dt, milk, 1, 1);
  const u = useItemAction(g, dt, milk, 1, { count: 1 });
  assert.deepEqual(dt.joblvpt, { [u.expno]: u.time });
  dt.joblvpt![MINE] = 320 * 60;
  dt.exp[MINE] = 600;
  const before = { ...dt.joblvpt };
  const intoBook = BASE_ITEMS[JOB_CHANGE].uses.find((x) => x.params[3] === 'book')!;
  supply(dt, JOB_CHANGE, intoBook.no, 1);
  useItemAction(g, dt, JOB_CHANGE, intoBook.no, { count: 1 });
  assert.equal(dt.job, 'book');
  assert.deepEqual(dt.joblvpt, before);
});

test('搾乳は職レベルの作業時間に入るが、get 行を通さず精製する牛乳は同じ', () => {
  const cow = 25;
  for (const use of [0, 1, 2]) {
    const milk = (seconds: number) => {
      const { g, dt } = fixture('cow');
      dt.joblvpt = { [cow]: seconds };
      supply(dt, cow, use, 1);
      const u = useItemAction(g, dt, cow, use, { count: 1 });
      assert.equal(u.result.count, 1);
      assert.equal(u.result.create.length, 0);
      assert.ok(u.result.additem.some((l) => l.item_no === 26 && l.count > 0));
      assert.equal(dt.joblvpt[cow], seconds + itemUseTime(dt, u));
      return u.result;
    };
    assert.deepEqual(milk(0), milk(PROGRESS_THRESHOLDS[10] * 60));
  }
});

test('干し草を与えて搾る: 牛乳の期待本数は職レベルで変わらない (飼い葉桶あり・なし)', () => {
  const cow = itemNoByName('ミノタウロス♀');
  const milk = itemNoByName('ミノ牛乳');
  const hay = itemNoByName('干し草');
  const trough = itemNoByName('飼い葉桶');
  const heads = 10;
  const outcomes = 2 * heads + 1; // 1回の搾乳では、基礎本数の上に 0〜頭数×2 が一様に乗る
  const expectedMilk = (seconds: number, hasTrough: boolean) => {
    let bottles = 0;
    for (let roll = 0; roll < outcomes; roll++) {
      const { g, dt } = fixture('cow');
      dt.joblvpt = { [cow]: seconds };
      dt.item[cow - 1] = heads;
      dt.item[hay - 1] = heads;
      dt.item[trough - 1] = hasTrough ? 1 : 0;
      g.rand = (n = 1) => n === outcomes ? roll : n / 2;
      const u = useItemAction(g, dt, cow, 2, { count: 1 });
      assert.equal(u.result.count, 1);
      bottles += u.result.additem.find((l) => l.item_no === milk)!.count;
    }
    return bottles / outcomes;
  };
  for (const hasTrough of [false, true]) {
    const baseline = 6 * heads + (hasTrough ? heads : 0);
    assert.equal(expectedMilk(0, hasTrough), baseline);
    assert.equal(expectedMilk(PROGRESS_THRESHOLDS[10] * 60, hasTrough), baseline);
  }
});

test('決算で作業秒数が減らず、上がった品だけがその決算の digest 1行に載る', () => {
  const { dt, g: started } = fixture();
  let g = started;
  dt.joblvpt = { [MINE]: 320 * 60, [BOOK_KIT]: 319 * 60 };
  dt.exp[MINE] = 100;
  const digest = () => digestText(digestData(g, dt, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 }));
  const settle = () => {
    g = new Game(g.world, g.config, { next: () => 0.5 }, g.nextPeriodTime());
    assert.equal(turn(g), true);
  };
  assert.doesNotMatch(digest(), /決算で職レベル/);
  const before = { ...dt.joblvpt };
  settle();
  assert.deepEqual(dt.joblvpt, before);
  assert.match(digest(), /決算で職レベルが上がりました 近くの鉱山への地図 1\n/);
  assert.equal(averageJoblvYield([dt]), 1.01);
  settle();
  assert.doesNotMatch(digest(), /決算で職レベル/);
  assert.deepEqual(dt.joblvpt, before);
});
