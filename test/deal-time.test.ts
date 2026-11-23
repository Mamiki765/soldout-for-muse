// SOLD OUT for Muse — 仕入れの時間を買う前に見せる・上限で止める (1.2.3)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { buy, editShowcase, enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { getWholeStore } from '../src/engine/market.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { itemDetailData, itemDetailText, marketData, marketText, shopsData, shopsText } from '../src/api/views.js';

const H = 3600;
const NOW = Date.UTC(2027, 0, 13, 3, 0, 0) / 1000; // 水曜

function setup() {
  const world = newWorld(NOW, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), NOW);
  const seller = openShop(g, { name: 'bob', shopname: 'ボブ商店' });
  const me = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  // 標準価格の高い品 (1/12 にしても端数で倍率がずれないように)
  const item = g.items.findIndex((it, i) => i > 0 && it && it.price >= 12000 && it.price % 12 === 0);
  const std = g.items[item].price;
  // 標準の 1/12 で棚に並べる (かかる時間は基本30分の12倍 = 6時間)
  enterShop(g, seller, true);
  seller.item[item - 1] = 100;
  editShowcase(g, seller, { slot: 0, itemno: item, price: Math.max(1, Math.floor(std / 12)) });
  enterShop(g, me, true);
  me.money = 10_000_000;
  return { world, g, seller, me, item, price: seller.price[0], std };
}

test('buyTime は今までの timeDeal と同じ値 (市場は基本時間が半分)', () => {
  const { g, item, std } = setup();
  for (const unit of [1, Math.floor(std / 30), Math.floor(std / 12), Math.floor(std / 2), std, std * 2]) {
    for (const num of [1, 7, 500]) {
      assert.equal(g.buyTime(item, unit, false), g.timeDeal(unit * num, item, num), `棚 単価${unit} ${num}個`);
      const keep = g.timeSendItem;
      g.timeSendItem = Math.trunc(keep / 2);
      const market = g.timeDeal(unit * num, item, num);
      g.timeSendItem = keep;
      assert.equal(g.buyTime(item, unit, true), market, `市場 単価${unit} ${num}個`);
    }
  }
  assert.equal(g.buyTime(item, std, false), 1800);
  assert.equal(g.buyTime(item, 1, false), 1800 * 20, '倍率は最大20倍');
});

test('他店の棚の一覧に、自分が1回買う時間が出る', () => {
  const { g, seller, item, price } = setup();
  const t = g.buyTime(item, price, false);
  assert.ok(t >= 6 * H - 60 && t <= 6 * H + 600, `約6時間 (${t})`);
  const d = shopsData(g, { limit: 100 });
  const row = d.find((s) => s.id === seller.id)!;
  assert.equal(row.shelves[0].deal_time, t);
  const text = shopsText(d);
  assert.match(text, /個数に関係なし/);
  assert.match(text, new RegExp(`1:${item}:[^ ]+@${price}x100/6h\\d\\dm!`));
});

test('行商人は棚の取引時間も半分で出る', () => {
  const { g, me, item, price } = setup();
  me.job = 'peddle';
  enterShop(g, me, false);
  assert.equal(shopsData(g, { limit: 100 })[0].shelves.find((x) => x.item === item)?.deal_time, Math.trunc(Math.trunc(1800 / 2) * (g.items[item].price / price)));
});

test('max_minutes を超える仕入れは時間を使わずに中止、付けなければ上限なし', () => {
  const { g, me, seller, item, price } = setup();
  me.time = g.now - 2 * H; // 持ち時間 2h (クーポンは48h)
  const coupon = g.couponTime(me);
  const usetime = g.buyTime(item, price, false);
  assert.throws(() => buy(g, me, { from: seller.id, itemno: item, count: 10, maxTime: 60 * 60 }), (e: unknown) => {
    assert.ok(e instanceof GameError);
    assert.match(e.message, /中止。時間は使っていません/);
    assert.match(e.message, /まとめて買う/);
    return true;
  });
  assert.equal(g.stockTime(me), 2 * H);
  assert.equal(g.couponTime(me), coupon);
  assert.equal(me.item[item - 1], 0);

  // 上限より短ければ買える
  const msg = buy(g, me, { from: seller.id, itemno: item, count: 10, maxTime: usetime });
  assert.equal(me.item[item - 1], 10);
  // 持ち時間 2h を使い切り、残りはクーポンから。結果にクーポンの分が出る
  assert.equal(g.stockTime(me), 0);
  assert.equal(g.couponTime(me), coupon - (usetime - 2 * H));
  assert.match(msg, /うちクーポン/);
});

test('時間は個数に関係しない: 1個でも10個でも同じだけ使う', () => {
  const a = setup();
  a.me.time = a.g.now - 48 * H;
  buy(a.g, a.me, { from: a.seller.id, itemno: a.item, count: 1 });
  const b = setup();
  b.me.time = b.g.now - 48 * H;
  buy(b.g, b.me, { from: b.seller.id, itemno: b.item, count: 10 });
  assert.equal(a.g.stockTime(a.me), b.g.stockTime(b.me));
});

test('市場の一覧と品の詳細に、市場で1回買う時間が出る', () => {
  const { g, me } = setup();
  g.world.wholestore[0] = 5000; // 品番1 をたくさん入荷 → 単価が下がる
  const c = getWholeStore(g).find((x) => x.itemno === 1)!;
  const d = marketData(g);
  const row = d.items.find((x) => x.item === 1)!;
  assert.equal(row.deal_time, g.buyTime(1, c.price, true));
  assert.match(marketText(d), /取引=あなたが1回買うのにかかる時間/);
  const det = itemDetailData(g, 1, me);
  assert.equal(det.market_deal_time, row.deal_time);
  assert.match(itemDetailText(det), /何個買っても1回ぶん/);
  // 店のトークンなしの詳細には出さない
  assert.equal(itemDetailData(g, 1).market_deal_time, undefined);
});
