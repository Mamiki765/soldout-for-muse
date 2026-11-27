// SOLD OUT for Muse — 1.7.0 道具3職の梱包と自分の品・買い取り募集の上限と注意・納品のお礼・募集の案内
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
import { v170, v170Own } from './v170.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const HERB = itemNoByName('薬草');
const LEATHER = itemNoByName('獣の革');
const CIGARETTE = 132;

test('1.7.0: 梱包6種だけ時間×1.24、職ボーナスは残し、お祝いグッズは変えない', () => {
  const kit = BASE_ITEMS[39];
  for (const name of v170.packing.uses) {
    const u = kit.uses.find((x) => x.name === name)!;
    assert.ok(u, name);
    assert.deepEqual(u.jobs, [{ job: 'tool', key: 'times', op: '/', value: 2 }], name);
  }
  const leather = kit.uses.find((x) => x.name === '革製装備一式を梱包する')!;
  assert.deepEqual([leather.time, leather.exptime], [17856, 8928], '4h→4h58分、2h→2h29分');
  const gift = kit.uses.find((x) => x.name === 'お祝いグッズを梱包する')!;
  assert.deepEqual([gift.time, gift.exptime], [28800, 28800]);
});

test('1.7.0: 道具3職の自分の品16種の取れる数 (革1.2・木工1.14・装飾1.3)、ほかの品は変えない', () => {
  const want: Record<string, [number, number | undefined]> = {
    'ヒョウ柄ミニスカート': [12, undefined], '厚底ブーツ': [12, undefined], 'ルーズソックス': [12, undefined], '革のロングコート': [12, undefined],
    '寄木の髪飾り': [11, 400], '漆塗りの小箱': [11, 400], '揺り椅子': [11, 400], '木のリュート': [11, 400],
    '鉄のピアス': [26, undefined], 'ミスリルの指輪': [26, undefined], 'オリハルコンの腕輪': [26, undefined], 'ナユタの首飾り': [1, 300],
    'ラメのチョーカー': [13, undefined], '宝石のブローチ': [13, undefined], '魔晶のペンダント': [13, undefined], '黒玉のブローチ': [1, 300],
  };
  assert.equal(v170Own.size, 16);
  for (const [name, [count, fraction]] of Object.entries(want)) {
    const no = itemNoByName(name);
    assert.ok(v170Own.has(no), name);
    const lines = BASE_ITEMS.flatMap((it) => it?.uses ?? []).flatMap((u) => u.get).filter((l) => l.item_no === no);
    assert.ok(lines.length >= 1, name);
    for (const l of lines) assert.deepEqual([l.count, l.fraction], [count, fraction], name);
  }
});

test('1.7.0: 近くの山への地図のふもと以外の行き先でも薬草が採れる', () => {
  const want: Record<string, number> = { '山のふもとを探索': 120, '林道を探索': 40, '獣道を探索': 40, '雑木林の奥を探索': 40, '樹脂林で樹液を採る': 20, '香木林を探索する': 20, '霊草の谷を探す': 20, '牧草地で草を刈る': 20 };
  const uses = BASE_ITEMS[12].uses;
  assert.equal(uses.length, Object.keys(want).length);
  for (const u of uses) {
    const herb = u.get.filter((l) => l.item_no === HERB);
    assert.equal(herb.length, 1, u.name!);
    assert.deepEqual([herb[0].count, herb[0].proba], [want[u.name!], 900], u.name!);
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

test('1.7.0: 募集の単価は標準価格の300%まで、150%を超えると採算の注意 (納品側の売却税つき)', () => {
  const { world, buyer } = setup();
  assert.equal(ORDER_RULES.maxPercent, 300);
  act(world, buyer, T0, (g, me) => {
    assert.throws(() => createOrder(g, me, { itemno: LEATHER, price: 301, count: 1, hours: 24 }), GameError);
    assert.equal(orderPriceWarning(g, LEATHER, 150), null, '150%ちょうどは注意しない');
    const w = orderPriceWarning(g, LEATHER, 200)!;
    assert.match(w, /^採算に注意: 獣の革の単価￥200は標準価格￥100の200%です/);
    assert.match(w, /募集上限300%.*この単価による5%に店ごとの基本税率が加わります/);
    assert.match(orderPriceWarning(g, LEATHER, 300)!, /この単価による20%に店ごとの基本税率が加わります/);
    createOrder(g, me, { itemno: LEATHER, price: 300, count: 1, hours: 24 });
  });
});

test('1.7.0: 納品のお礼は標準価格で5,000円ぶん以上の1セットに1本、1期2回まで (1本だけ投げてももらえない)', () => {
  const { world, buyer, buyer2, buyer3, buyer4, seller } = setup();
  // 薬草 (標準20円) を1本だけ300%で: 標準価格で20円ぶんなのでお礼なし
  const tiny = act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 60, count: 1, hours: 24 }));
  // 薬草250本 (標準5,000円ちょうど)
  const o2 = act(world, buyer2, T0, (g, me) => createOrder(g, me, { itemno: HERB, price: 20, count: 250, hours: 24 }));
  const o3 = act(world, buyer3, T0, (g, me) => createOrder(g, me, { itemno: LEATHER, price: 100, count: 60, hours: 24 }));
  const o4 = act(world, buyer, T0, (g, me) => createOrder(g, me, { itemno: LEATHER, price: 100, count: 60, hours: 24 }));
  const cig = () => world.shops.find((s) => s.id === seller.id)!.item[CIGARETTE - 1];
  act(world, seller, T0 + 60, (g, me) => {
    const m1 = deliver(g, me, buyer.id, [{ order: tiny.id, count: 1 }, { order: o4.id, count: 49 }]);
    assert.equal(cig(), 0, '1本+革49枚 = 標準4,920円');
    assert.ok(!m1.some((m) => m.includes('お礼')));
    const m2 = deliver(g, me, buyer2.id, [{ order: o2.id, count: 250 }]);
    assert.equal(cig(), 1);
    assert.ok(m2.some((m) => m.includes('納品のお礼にタイムシガレットを1本受け取りました (今期あと1回)')), m2.join('\n'));
    deliver(g, me, buyer3.id, [{ order: o3.id, count: 50 }]);
    assert.equal(cig(), 2);
  });
  // 今期3回目の大きな納品にはお礼なし
  const o5 = act(world, buyer4, T0 + 120, (g, me) => createOrder(g, me, { itemno: LEATHER, price: 100, count: 60, hours: 24 }));
  const m5 = act(world, seller, T0 + 180, (g, me) => deliver(g, me, buyer4.id, [{ order: o5.id, count: 60 }]));
  assert.equal(cig(), 2);
  assert.ok(!m5.some((m) => m.includes('お礼')));
  assert.equal(world.orderStats!.thanked![seller.id], 2);
  // 次の期は戻る
  const next = T0 + DEFAULT_CONFIG.oneDayTime + 60;
  const o6 = act(world, buyer, next, (g, me) => createOrder(g, me, { itemno: LEATHER, price: 100, count: 60, hours: 24 }));
  act(world, seller, next + 60, (g, me) => deliver(g, me, buyer.id, [{ order: o6.id, count: 60 }]));
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

test('1.7.0 所持上限: 息苦しかった6品だけ上げ、「1個だけ」がわざとの品はそのまま', () => {
  assert.equal(v170.limits.items.length, 6);
  assert.equal(BASE_ITEMS[itemNoByName('オリハルコンの剣')].limit, 50, '需要より上限が大きい品は上げない');
  for (const [no, limit] of v170.limits.items) assert.equal(BASE_ITEMS[no].limit, limit, BASE_ITEMS[no].name);
  assert.equal(BASE_ITEMS[itemNoByName('ナユタの首飾り')].limit, 10);
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

test('1.7.0 ナユタの首飾り: 作る時間は熟練100%で2時間 (0%で2.4時間)、需要は popular×4 で絞る', () => {
  const it = BASE_ITEMS[itemNoByName('ナユタの首飾り')];
  assert.deepEqual([it.popular, it.limit], [691200, 10]);
  const u = BASE_ITEMS[66].uses.find((x) => x.get[0]?.item_no === it.no)!;
  assert.deepEqual([u.time, u.exptime], [8640, 7200]);
  assert.deepEqual(u.get[0], { item_no: it.no, count: 1, proba: 1000, fraction: 300 }, '1.7.0 の装飾+30%はそのまま');
});
