// SOLD OUT for Muse — 商人ポイント・取引時間・職バランスの指紋。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestData, digestText, meData } from '../src/api/views.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { buy, deposit, editShowcase, enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { PROGRESS_THRESHOLDS } from '../src/engine/joblv.js';
import { addMerchantYen, merchantBalanceFingerprint, MERCHANT_BALANCE_FINGERPRINT, MERCHANT_CAP_PER_PERIOD, MERCHANT_YEN_PER_POINT, settleMerchant } from '../src/engine/merchant.js';
import { cancelOrder, createOrder, deliver } from '../src/engine/orders.js';
import { turn } from '../src/engine/turn.js';
import { newWorld } from '../src/engine/types.js';

const NOW = 1_800_000_000;
const LEATHER = itemNoByName('獣の革');
const INSIGHT = itemNoByName('目利きの真髄');

function fixture() {
  const g = new Game(newWorld(NOW, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0.5 }, NOW);
  const buyer = openShop(g, { name: 'buyer', shopname: '仕入れ店' });
  const seller = openShop(g, { name: 'seller', shopname: '売り手商店' });
  for (const dt of [buyer, seller]) {
    dt.time = NOW - 48 * 3600;
    dt.money = 500_000;
  }
  seller.item[LEATHER - 1] = 300;
  return { g, buyer, seller };
}

function verifyFingerprint(items = BASE_ITEMS) {
  assert.equal(merchantBalanceFingerprint(items), MERCHANT_BALANCE_FINGERPRINT,
    '職バランスが変わりました。tools/merchant-cap/ のシミュレーションで補正表と上限を出し直して、表と指紋を両方更新してください');
}

test('商人ポイント上限の指紋は現行バランスと一致し、レシピ1か所の変更を検出する', () => {
  verifyFingerprint();
  const changed = BASE_ITEMS.map((it) => it.no === 21
    ? { ...it, uses: it.uses.map((u, i) => i ? u : { ...u, exptime: u.exptime + 1 }) }
    : it);
  assert.throws(() => verifyFingerprint(changed), /補正表と上限を出し直して、表と指紋を両方更新/);
});

test('複数回の端数を決算で合算し、今期の上限・レベル上昇の通知・次期への切り替えを守る', () => {
  const { g: initial, buyer } = fixture();
  let g = initial;
  const settle = () => {
    g = new Game(g.world, g.config, { next: () => 0.5 }, g.nextPeriodTime());
    assert.equal(turn(g), true);
  };
  const digest = () => digestText(digestData(g, buyer, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 }));
  buyer.merchantpt = 319;
  addMerchantYen(buyer, 499);
  addMerchantYen(buyer, 502);
  assert.equal(meData(g, buyer).merchant.lv, 0);
  settle();
  assert.deepEqual(meData(g, buyer).merchant, { lv: 1, point: 320, next: 2430, cap: MERCHANT_CAP_PER_PERIOD });
  assert.match(digest(), /お手伝い妖精が決算で育ちました（商人レベル1/);
  addMerchantYen(buyer, (MERCHANT_CAP_PER_PERIOD + 3000) * 1000);
  settle();
  assert.equal(buyer.merchantpt, 320 + MERCHANT_CAP_PER_PERIOD);
  assert.equal(buyer.merchantYen, undefined);
  settle();
  assert.equal(buyer.merchantpt, 320 + MERCHANT_CAP_PER_PERIOD, '枠から溢れた額は次の決算に持ち越さない');
  assert.doesNotMatch(digest(), /お手伝い妖精が決算で育ちました/);
});

test('棚の仕入・売上・実際の税額と、買い取りの成立分だけを数える', () => {
  const { g, buyer, seller } = fixture();
  const price = BASE_ITEMS[LEATHER].price; // 標準価格で売る (数字はデータから)
  seller.profitstock = 100_000;
  enterShop(g, seller, true);
  editShowcase(g, seller, { slot: 0, itemno: LEATHER, price });
  enterShop(g, buyer, true);
  buy(g, buyer, { from: seller.id, itemno: LEATHER, count: 10 });
  // 買った側は代金、売った側は代金＋実際に払った売却税を数える
  assert.equal(buyer.merchantYen, price * 10);
  const sold10 = seller.merchantYen!;
  assert.ok(sold10 >= price * 10, '売った側は代金に税が乗る');
  const offer = createOrder(g, buyer, { itemno: LEATHER, price, count: 50, hours: 1 });
  assert.equal(buyer.merchantYen, price * 10, '募集を出しただけでは数えない');
  enterShop(g, seller, true);
  deliver(g, seller, buyer.id, [{ order: offer.id, count: 20 }]);
  assert.equal(buyer.merchantYen, price * 30, '成立した分だけ数える');
  assert.ok(Math.abs(seller.merchantYen! - sold10 * 3) <= 1, '同じ単価なら棚の売買と同じ割合で数える');
  enterShop(g, buyer, true);
  cancelOrder(g, buyer, offer.id);
  assert.equal(buyer.merchantYen, price * 30, '取り下げても減らない');
  g.recordDepositTax(buyer, 1000);
  const yen = buyer.merchantYen!;
  assert.equal(yen, price * 30 + 1000, '入金庫の税も数える');
  settleMerchant(buyer, NOW);
  assert.equal(buyer.merchantpt, Math.floor(yen / MERCHANT_YEN_PER_POINT));
});

test('全商人レベルで引き出し・取引が短縮され、行商人・目利き・市場にも重なる', () => {
  const { g, buyer } = fixture();
  buyer.job = 'peddle';
  buyer.item[INSIGHT - 1] = 1;
  enterShop(g, buyer, true);
  const before = {
    money: g.timeDeal(50_000),
    order: g.timeDeal(1000, LEATHER, 10),
    shop: g.buyTime(LEATHER, 100, false),
    market: g.buyTime(LEATHER, 100, true),
  };
  assert.ok(before.money > 0 && before.order > 0 && before.shop > 0 && before.market > 0);
  assert.ok(before.market <= before.shop, '市場で買うほうが棚より速いか同じ');
  for (const [lv, point] of PROGRESS_THRESHOLDS.entries()) {
    buyer.merchantpt = point;
    const expected = (t: number) => Math.trunc(t * 0.95 ** lv);
    assert.equal(g.timeDeal(50_000), expected(before.money), `引き出し ${lv}`);
    assert.equal(g.timeDeal(1000, LEATHER, 10), expected(before.order), `募集 ${lv}`);
    assert.equal(g.buyTime(LEATHER, 100, false), expected(before.shop), `棚 ${lv}`);
    assert.equal(g.buyTime(LEATHER, 100, true), expected(before.market), `市場 ${lv}`);
  }
  buyer.moneystock = 50_000;
  const beforeTime = buyer.time;
  deposit(g, buyer, 50_000);
  assert.equal(buyer.time - beforeTime, g.timeDeal(50_000));
  assert.equal(buyer.merchantYen, undefined, '入金庫から資金に移すだけではポイントを得ない');
});
