// SOLD OUT for Muse — 1.7.0 梱包・薬草・買い取り募集の上限と注意・納品のお礼・募集の案内の決まり。数字はデータと ORDER_RULES から読む (AGENTS.md「テストの決まり」)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { BASE_ITEMS, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { createOrder, deliver, ORDER_RULES, orderPriceWarning, shelfOrderHint, wantedFor, wantedLine } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { digestData } from '../src/api/views.js';
import { v170 } from './v170.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const HERB = itemNoByName('薬草');
const LEATHER = itemNoByName('獣の革');
const CIGARETTE = 132;

/** 標準価格 (データから) と、その何%かの単価 */
const std = (no: number) => BASE_ITEMS[no].price;
const at = (no: number, percent: number) => Math.round((std(no) * percent) / 100);

test('1.7.0: 梱包の使い方には職ボーナスが付き、熟練で長くならない', () => {
  const kit = BASE_ITEMS[39];
  for (const name of v170.packing.uses) {
    const u = kit.uses.find((x) => x.name === name)!;
    assert.ok(u, name);
    assert.deepEqual(u.jobs, [{ job: 'tool', key: 'times', op: '/', value: 2 }], name);
    assert.ok(u.exptime <= u.time, name);
  }
});

test('1.7.0: 近くの山への地図はどの行き先でも薬草が1行だけ採れ、ふもとがいちばん多い。木こりの職業ボーナスつき', () => {
  const uses = BASE_ITEMS[12].uses;
  const herbOf = (u: (typeof uses)[number]) => {
    const herb = u.get.filter((l) => l.item_no === HERB);
    assert.equal(herb.length, 1, u.name!);
    return herb[0].count;
  };
  const foot = uses.find((u) => u.name === '山のふもとを探索')!;
  for (const u of uses) {
    assert.ok(herbOf(u) <= herbOf(foot), u.name!);
    assert.deepEqual(u.jobs, [{ job: 'material', key: 'times', op: '/', value: 2 }], '木こりの職業ボーナスつき');
  }
});

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const buyer = openShop(g0, { name: 'a', shopname: '買う店' });
  const buyer2 = openShop(g0, { name: 'b', shopname: '買う店2' });
  const buyer3 = openShop(g0, { name: 'c', shopname: '買う店3' });
  const buyer4 = openShop(g0, { name: 'e', shopname: '買う店4' });
  const seller = openShop(g0, { name: 'd', shopname: '採る店' });
  for (const s of [buyer, buyer2, buyer3, buyer4, seller]) {
    s.showcasecount = 3;
    s.time = T0 - 48 * 3600;
    s.money = 5_000_000;
  }
  seller.item[HERB - 1] = 2000;
  seller.item[LEATHER - 1] = 500;
  return { world, buyer, buyer2, buyer3, buyer4, seller };
}

function act<T>(world: World, dt: Shop, now: number, fn: (g: Game, me: Shop) => T): T {
  const g = new Game(world, DEFAULT_CONFIG, seededRng(2), now);
  const me = g.shopById(dt.id)!;
  enterShop(g, me, true);
  return fn(g, me);
}

test('1.7.0: 募集の単価は標準価格の上限%まで、注意の%を超えると採算の注意 (納品側の売却税つき)', () => {
  const { world, buyer } = setup();
  const { maxPercent, warnPercent } = ORDER_RULES;
  act(world, buyer, T0, (g, me) => {
    const hi = Math.floor((std(LEATHER) * maxPercent) / 100);
    assert.throws(() => createOrder(g, me, { itemno: LEATHER, price: hi + 1, count: 1, hours: 24 }), GameError);
    assert.equal(orderPriceWarning(g, LEATHER, Math.floor((std(LEATHER) * warnPercent) / 100)), null, '注意の%ちょうどまでは注意しない');
    const p = at(LEATHER, 200);
    const w = orderPriceWarning(g, LEATHER, p)!;
    assert.match(w, new RegExp(`^採算に注意: 獣の革の単価￥${p}は標準価格￥${std(LEATHER)}の200%です`));
    assert.match(w, new RegExp(`募集上限${maxPercent}%.*この単価による\\d+%に店ごとの基本税率が加わります`));
    const rate = (price: number) => Number(orderPriceWarning(g, LEATHER, price)!.match(/この単価による(\d+)%/)![1]);
    assert.ok(rate(hi) > rate(p), '単価が高いほど納品側の税が上がる');
    createOrder(g, me, { itemno: LEATHER, price: hi, count: 1, hours: 24 });
  });
});

test('1.7.0: 納品のお礼は標準価格の合計がきまり以上の1セットに1本、1期にきまりの回数まで (1本だけ投げてももらえない)', () => {
  const { world, buyer, buyer2, buyer3, buyer4, seller } = setup();
  const { thanksMinStd: min, thanksPerPeriod } = ORDER_RULES;
  assert.equal(thanksPerPeriod, 2, 'このテストは1期2回で組んである');
  const big = Math.ceil(min / std(LEATHER)); // 革だけで標準価格の合計がちょうど足りる枚数
  // 薬草1本を高値で: 標準価格の合計はわずかなのでお礼なし
  const tiny = act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: at(HERB, 300), count: 1, hours: 24 }));
  const herbs = Math.ceil(min / std(HERB)); // 薬草だけで足りる本数
  const o2 = act(world, buyer2, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: std(HERB), count: herbs, hours: 24 }));
  const o3 = act(world, buyer3, T0, (g, me) => createOrder(g, me, { itemno: LEATHER, price: std(LEATHER), count: big + 10, hours: 24 }));
  const o4 = act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: LEATHER, price: std(LEATHER), count: big + 10, hours: 24 }));
  const cig = () => world.shops.find((s) => s.id === seller.id)!.item[CIGARETTE - 1];
  act(world, seller, T0 + 60, (g, me) => {
    // 薬草1本＋革で、合計がきまりに1円でも届かない数
    const short = Math.floor((min - std(HERB) - 1) / std(LEATHER));
    const m1 = deliver(g, me, buyer.id, [{ order: tiny.id, count: 1 }, { order: o4.id, count: short }]);
    assert.equal(cig(), 0, '標準価格の合計がきまりに届かない');
    assert.ok(!m1.some((m) => m.includes('お礼')));
    const m2 = deliver(g, me, buyer2.id, [{ order: o2.id, count: herbs }]);
    assert.equal(cig(), 1);
    assert.ok(m2.some((m) => m.includes('納品のお礼にタイムシガレットを1本受け取りました (今期あと1回)')), m2.join('\n'));
    deliver(g, me, buyer3.id, [{ order: o3.id, count: big }]);
    assert.equal(cig(), 2);
  });
  // 今期3回目の大きな納品にはお礼なし
  const o5 = act(world, buyer4, T0 + 120, (g, me) => createOrder(g, me, { itemno: LEATHER, price: std(LEATHER), count: big, hours: 24 }));
  const m5 = act(world, seller, T0 + 180, (g, me) => deliver(g, me, buyer4.id, [{ order: o5.id, count: big }]));
  assert.equal(cig(), 2);
  assert.ok(!m5.some((m) => m.includes('お礼')));
  assert.equal(world.orderStats!.thanked![seller.id], 2);
  // 次の期は戻る
  const next = T0 + DEFAULT_CONFIG.oneDayTime + 60;
  const o6 = act(world, buyer, next, (g, me) => createOrder(g, me, { itemno: LEATHER, price: std(LEATHER), count: big, hours: 24 }));
  act(world, seller, next + 60, (g, me) => deliver(g, me, buyer.id, [{ order: o6.id, count: big }]));
  assert.equal(cig(), 3);
});

test('1.7.0: 自分の在庫を欲しがる募集は、今納品できるものだけ数え、採取の戻りの1行にする', () => {
  const { world, buyer, buyer2, seller } = setup();
  act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 30, count: 100, hours: 2 }));
  act(world, buyer2, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 25, count: 50, hours: 24 }));
  act(world, buyer2, T0, (g, me) => createOrder(g, me, { itemno: LEATHER, price: 100, count: 5, hours: 24 }));
  act(world, seller, T0 + 60, (g, me) => {
    const all = wantedFor(g, me);
    assert.deepEqual(all.map((w) => [w.name, w.orders, w.price, w.left]), [['薬草', 2, 30, 150], ['獣の革', 1, 100, 5]]);
    assert.deepEqual(wantedFor(g, me, [HERB]).map((w) => w.item), [HERB]);
    assert.equal(wantedLine(g, me, wantedFor(g, me, [HERB])), '募集中: 薬草 2件 (最高￥30・残り150本) → GET /api/v1/orders?item=品番 を見て deliver で納品できます (1セットの標準価格合計が5,000円以上で、所持上限に空きがあればタイムシガレット1本。今期あと2回)');
    assert.equal(wantedLine(g, me, []), null);
    // その店へ今期もう納品したら、その店の募集は数えない
    const lv = world.orders!.find((o) => o.shop === buyer2.id && o.item === LEATHER)!;
    deliver(g, me, buyer2.id, [{ order: lv.id, count: 1 }]);
    assert.deepEqual(wantedFor(g, me).map((w) => [w.name, w.orders]), [['薬草', 1]]);
    assert.deepEqual(digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 } as never, null).wanted.map((w) => w.name), ['薬草']);
  });
  // 最低納品数に手持ちが届かない募集・買い手の倉庫が空かない募集も数えない
  const { world: w2, buyer: b2, buyer2: b22, seller: s2 } = setup();
  w2.shops.find((x) => x.id === s2.id)!.item[HERB - 1] = 10;
  act(w2, b2, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 20, count: 100, hours: 24, min: 50 }));
  act(w2, b22, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 20, count: 5, hours: 24 }));
  w2.shops.find((x) => x.id === b22.id)!.item[HERB - 1] = BASE_ITEMS[HERB].limit;
  act(w2, s2, T0 + 60, (g, me) => assert.deepEqual(wantedFor(g, me), []));
  // 期限が切れた募集も数えない
  act(world, seller, T0 + 3 * 3600, (g, me) => assert.deepEqual(wantedFor(g, me), []));
});

test('「1個だけ」がわざとの品は所持上限1のまま', () => {
  for (const name of ['禁断の書', '転居許可証', '店用ペンキ', '店番ロボット', 'お祝いセット', '転職のススメ']) assert.equal(BASE_ITEMS[itemNoByName(name)].limit, 1, name);
});

test('1.7.0: 棚の売値より高い募集があれば、単価がいちばん高い募集と残りがいちばん多い募集を知らせる', () => {
  const { world, buyer, buyer2, buyer3, seller } = setup();
  act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 40, count: 30, hours: 24 }));
  act(world, buyer2, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 25, count: 300, hours: 24 }));
  act(world, buyer3, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 18, count: 900, hours: 24 }));
  act(world, seller, T0 + 60, (g, me) => {
    assert.equal(
      shelfOrderHint(g, me, HERB, 20),
      'その売値 (￥20) より高い買い取り募集があります: 最高￥40 (残り30本) / 最多 残り300本 (￥25) → GET /api/v1/orders?item=1 を見て deliver で納品できます (1セットの標準価格合計が5,000円以上で、所持上限に空きがあればタイムシガレット1本。今期あと2回)',
      '￥18の募集は売値より安いので数えない',
    );
    assert.match(shelfOrderHint(g, me, HERB, 30)!, /: 最高￥40 \(残り30本\) → /, '高い募集が1件だけなら1つ');
    assert.equal(shelfOrderHint(g, me, HERB, 40), null, '同じ値段は知らせない');
    assert.equal(shelfOrderHint(g, me, LEATHER, 50), null, '募集のない品');
    assert.equal(shelfOrderHint(g, me, 0, 0), null, '棚を空にしたとき');
  });
});
