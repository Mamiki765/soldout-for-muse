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
import { addMerchantYen, merchantBalanceFingerprint, MERCHANT_BALANCE_FINGERPRINT, MERCHANT_CAP_PER_PERIOD, settleMerchant } from '../src/engine/merchant.js';
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
    '職バランスが変わりました。tools/merchant-cap/ で上限を出し直し、MERCHANT_CAP_PER_PERIOD と指紋を両方更新してください');
}

test('商人ポイント上限の指紋は現行バランスと一致し、レシピ1か所の変更を検出する', () => {
  verifyFingerprint();
  const changed = BASE_ITEMS.map((it) => it.no === 21
    ? { ...it, uses: it.uses.map((u, i) => i ? u : { ...u, exptime: u.exptime + 1 }) }
    : it);
  assert.throws(() => verifyFingerprint(changed), /MERCHANT_CAP_PER_PERIOD と指紋を両方更新/);
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
  assert.match(digest(), /決算で商人レベル1/);
  addMerchantYen(buyer, (MERCHANT_CAP_PER_PERIOD + 3000) * 1000);
  settle();
  assert.equal(buyer.merchantpt, 320 + MERCHANT_CAP_PER_PERIOD);
  assert.equal(buyer.merchantYen, undefined);
  settle();
  assert.equal(buyer.merchantpt, 320 + MERCHANT_CAP_PER_PERIOD, '枠から溢れた額は次の決算に持ち越さない');
  assert.doesNotMatch(digest(), /決算で商人レベル/);
});

test('棚の仕入・売上・実際の税額と、買い取りの成立分だけを数える', () => {
  const { g, buyer, seller } = fixture();
  const price = 100;
  seller.profitstock = 100_000;
  enterShop(g, seller, true);
  editShowcase(g, seller, { slot: 0, itemno: LEATHER, price });
  enterShop(g, buyer, true);
  buy(g, buyer, { from: seller.id, itemno: LEATHER, count: 10 });
  assert.equal(buyer.merchantYen, 1000);
  assert.equal(seller.merchantYen, 1050);
  const offer = createOrder(g, buyer, { itemno: LEATHER, price, count: 50, hours: 1 });
  assert.equal(buyer.merchantYen, 1000);
  enterShop(g, seller, true);
  deliver(g, seller, buyer.id, [{ order: offer.id, count: 20 }]);
  assert.equal(buyer.merchantYen, 3000);
  assert.equal(seller.merchantYen, 3150);
  enterShop(g, buyer, true);
  cancelOrder(g, buyer, offer.id);
  assert.equal(buyer.merchantYen, 3000);
  g.recordDepositTax(buyer, 1000);
  settleMerchant(buyer, NOW);
  assert.equal(buyer.merchantpt, 4);
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
  assert.equal(before.money, 2400);
  assert.equal(before.order, 675);
  assert.equal(before.market, 337);
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
