// SOLD OUT for Muse — 1.8.3 AI がはまる落とし穴 (同じ陳列・仕入れの失敗・倒産警告と引き出し) の決まりのテスト。
// 時間や値段の数字はデータの1か所だけに置き、ここでは「減らない」「変わらない」「次の一手が書いてある」を確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { buy, deposit, editShowcase, enterShop, maxDeposit, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { periodEstimate } from '../src/engine/watch.js';
import { digestData } from '../src/api/views.js';
import { TIPS } from '../src/tips.js';

const T0 = 1_800_000_000;
const HERB = itemNoByName('薬草');

/** noCoupon: 時間クーポンの無い街 (持ち時間だけで確かめる) */
function fixture(noCoupon = false) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, noCoupon ? { ...DEFAULT_CONFIG, couponTime: 0 } : DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g, { name: 'a', shopname: '試験商店A' });
  const b = openShop(g, { name: 'b', shopname: '試験商店B' });
  // 持ち時間は満タン
  a.time = g.now - g.config.maxStockTime;
  b.time = g.now - g.config.maxStockTime;
  enterShop(g, a, true);
  return { g, a, b };
}

test('1.8.3: 同じ棚に同じ品・同じ値段で並べ直しても、持ち時間は減らず棚も変わらない', () => {
  const { g, a } = fixture();
  a.item[HERB - 1] = 5;
  editShowcase(g, a, { slot: 0, itemno: HERB, percent: 100 });
  const time1 = a.time;
  assert.ok(time1 > T0 - g.config.maxStockTime, '初めて並べるときは時間を使う');
  const shelf = [a.showcase[0], a.price[0]];
  const msg = editShowcase(g, a, { slot: 0, itemno: HERB, percent: 100 });
  assert.equal(a.time, time1, '同じ設定なら時間を使わない');
  assert.deepEqual([a.showcase[0], a.price[0]], shelf);
  assert.match(msg, /変更なし/);
  // 値段で書いても、今と同じなら同じ扱い
  editShowcase(g, a, { slot: 0, itemno: HERB, price: a.price[0] });
  assert.equal(a.time, time1);
  // 値段を変えるときは、今までどおり時間を使う
  editShowcase(g, a, { slot: 0, itemno: HERB, price: a.price[0] + 1 });
  assert.ok(a.time > time1, '変えるときは時間を使う');
  // 陳列をやめるのは時間を使い、もう空の棚をもう一度空にしても時間を使わない
  const time2 = a.time;
  editShowcase(g, a, { slot: 0, itemno: 0 });
  const time3 = a.time;
  assert.ok(time3 > time2);
  editShowcase(g, a, { slot: 0, itemno: 0 });
  assert.equal(a.time, time3);
});

test('1.8.3: 同じ陳列は時間待ちの最中でも失敗しない (変えるときは今までどおり待ちが要る)', () => {
  const { g, a } = fixture(true);
  a.item[HERB - 1] = 5;
  editShowcase(g, a, { slot: 0, itemno: HERB, percent: 100 });
  a.time = g.now + 3600; // 待ち中
  assert.doesNotThrow(() => editShowcase(g, a, { slot: 0, itemno: HERB, percent: 100 }));
  assert.throws(() => editShowcase(g, a, { slot: 0, itemno: HERB, price: a.price[0] + 1 }), GameError);
});

test('1.8.3: 仕入れの失敗は時間を使わず、何を読み直すか (棚・市場の調べ方) を返す', () => {
  const { g, a, b } = fixture();
  const time0 = a.time;
  const money0 = a.money;
  // 並んでいない品
  assert.throws(() => buy(g, a, { from: b.id, itemno: HERB, count: 1 }), (e: unknown) => e instanceof GameError && e.message.includes(`/api/v1/shops?item=${HERB}`) && e.message.includes('/api/v1/market'));
  // 並んでいたが売り切れ
  b.item[HERB - 1] = 1;
  b.showcase[0] = HERB;
  b.price[0] = 100;
  b.item[HERB - 1] = 0;
  assert.throws(() => buy(g, a, { from: b.id, itemno: HERB, count: 1 }), (e: unknown) => e instanceof GameError && e.message.includes(`/api/v1/shops?item=${HERB}`));
  // 値段が変わった: 今の値段と、送り直し方が書いてある
  b.item[HERB - 1] = 3;
  assert.throws(() => buy(g, a, { from: b.id, itemno: HERB, count: 1, expectPrice: b.price[0] + 1 }), (e: unknown) => e instanceof GameError && e.message.includes(`price を ${b.price[0]}`));
  assert.equal(a.time, time0);
  assert.equal(a.money, money0);
});

test('1.8.3: 引き出しが時間不足で失敗したら、今引き出せる額が書いてあり、その額なら引き出せる', () => {
  const { g, a } = fixture(true);
  a.moneystock = g.maxMoney - a.money;
  // 引き出しの基本の時間は使えて、全額には足りない持ち時間にする
  const want = a.moneystock;
  a.time = g.now - g.timeDeal(1, undefined, undefined, a);
  assert.ok(g.usableTime(a) < g.timeDeal(want, undefined, undefined, a), '全額には時間が足りない店を作る');
  const stock0 = a.moneystock;
  let message = '';
  assert.throws(() => deposit(g, a, want), (e: unknown) => e instanceof GameError && ((message = e.message), message.startsWith('時間が足りません')));
  assert.equal(a.moneystock, stock0, '失敗では入金庫は変わらない');
  const max = maxDeposit(g, a);
  assert.ok(max > 0 && max < want);
  assert.ok(message.includes(`￥${max}`), message);
  assert.doesNotThrow(() => deposit(g, a, max));
});

test('1.8.3: 入金庫の税が無いとき、入金庫から資金へ移しても決算の不足は縮まない。注意は引き出しを勧めない', () => {
  const { g, a } = fixture();
  a.showcasecount = 8;
  a.money = 0;
  a.moneystock = 1000;
  const before = periodEstimate(g, a);
  assert.equal(before.tax, 0);
  assert.ok(before.short > 0, '倒産見込みの店を作る');
  deposit(g, a, a.moneystock);
  const after = periodEstimate(g, a);
  assert.equal(after.short, before.short);
  const w = digestData(g, a, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 }).warnings.find((x: string) => x.includes('倒産の恐れ'));
  assert.ok(w, '倒産の注意が出る');
  assert.match(w!, /縮みません/);
  assert.match(w!, /棚を減らして/);
  // コツ集も、引き出しを倒産よけとして勧めない
  const line = TIPS.split('\n').find((l) => l.includes('倒産の恐れ'));
  assert.ok(line && /縮みません/.test(line));
});
