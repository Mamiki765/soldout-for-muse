// 買い取り募集 (原作にない追加) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { CATALOG, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { cancelOrder, createOrder, deliver, ORDER_RULES, orders, periodNo, priceRange, setOrderRenew, sweepOrders } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { digestData, digestText, ordersData, ordersText } from '../src/api/views.js';

// 時間の増減を dt.time で見るので、週1の時間クーポンは切っておく (クーポンとの組み合わせは coupon.test.ts)
const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const LEATHER = itemNoByName('獣の革');

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const buyer = openShop(g0, { name: 'ruri', shopname: '瑠璃のしおり堂' });
  const seller = openShop(g0, { name: 'yama', shopname: '山師の店' });
  const other = openShop(g0, { name: 'kawa', shopname: '革屋' });
  for (const s of [buyer, seller, other]) {
    s.time = T0 - 48 * 3600; // 持ち時間を満タンに
    s.money = 1_000_000;
  }
  seller.item[LEATHER - 1] = 500;
  other.item[LEATHER - 1] = 500;
  return { world, buyer, seller, other };
}

/** 店 dt として 1 行動する (失敗したら元に戻す: app の runAction と同じ) */
function act<T>(world: World, dt: Shop, now: number, fn: (g: Game) => T): T {
  const snap = structuredClone(world);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(2), now);
  const me = g.shopById(dt.id)!;
  enterShop(g, me, true);
  try {
    return fn(g);
  } catch (e) {
    Object.assign(world, snap);
    throw e;
  }
}

test('募集→部分納品→取り下げで、代金と税・時間が棚売買と同じに動き、差額が戻る', () => {
  const { world, buyer, seller } = setup();
  const [lo, hi] = priceRange(new Game(world, DEFAULT_CONFIG, seededRng(1), T0), LEATHER);
  assert.equal(lo, 50);
  assert.equal(hi, 150);

  const bt0 = buyer.time;
  const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 120, count: 300, hours: 24 }));
  const b = () => world.shops.find((s) => s.id === buyer.id)!;
  const s = () => world.shops.find((x) => x.id === seller.id)!;
  assert.equal(b().money, 1_000_000 - 36000, '代金は全額預ける');
  assert.ok(b().time > bt0, '取引時間を先に使う');
  const prepaid = b().time - bt0;

  const st0 = s().time;
  act(world, seller, T0 + 10, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 100 }]));
  assert.equal(s().item[LEATHER - 1], 400);
  assert.equal(b().item[LEATHER - 1], 0, '届いた品は締めるまで預かり');
  assert.ok(st0 <= T0 - 48 * 3600);
  assert.equal(s().time, T0 + 10 - 48 * 3600 + CATALOG.timeEditShowcase, '陳列1回ぶんの手間 (持ち時間は満タンから)');
  assert.equal(s().saletoday, 12000, '売上に入る');
  assert.ok(s().moneystock > 0 && s().moneystock <= 12000, '代金は入金庫へ (税を引く)');
  assert.equal(orders(new Game(world, DEFAULT_CONFIG, seededRng(1), T0)).find((x) => x.id === o.id)!.left, 200);

  // 取り下げ: 残り200個ぶんが戻る。1個でも買えたので時間は戻らない
  const before = b().money;
  const btime = b().time;
  act(world, buyer, T0 + 20, (g) => cancelOrder(g, g.shopById(buyer.id)!, o.id));
  assert.equal(b().money - before, 24000);
  assert.equal(b().item[LEATHER - 1], 100, '取り下げで届いた分をまとめて受け取る');
  assert.equal(b().time, btime);
  assert.equal(world.orders!.length, 0);
  assert.ok(prepaid > 0);
});

test('1個も届かずに期限切れなら、代金も時間も全部戻る', () => {
  const { world, buyer } = setup();
  const bt0 = buyer.time;
  act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 10, hours: 1 }));
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0 + 3600);
  assert.equal(sweepOrders(g), true);
  const b = world.shops.find((s) => s.id === buyer.id)!;
  assert.equal(b.money, 1_000_000);
  assert.equal(b.time, bt0);
  assert.equal(world.orders!.length, 0);
});

test('制限: 単価・期限・同時件数・同じ相手1期1セット (逆向きは別)・まとめ納品・最低納品数', () => {
  const { world, buyer, seller, other } = setup();
  const mk = (dt: Shop, req: Partial<{ price: number; count: number; hours: number; min: number; itemno: number }>) =>
    act(world, dt, T0, (g) => createOrder(g, g.shopById(dt.id)!, { itemno: LEATHER, price: 100, count: 10, hours: 24, ...req }));
  assert.throws(() => mk(buyer, { price: 49 }), GameError);
  assert.throws(() => mk(buyer, { price: 151 }), GameError);
  assert.throws(() => mk(buyer, { hours: 49 }), GameError);
  assert.throws(() => mk(buyer, { count: 5000 }), /所持上限/);
  assert.equal(world.orders?.length ?? 0, 0, '失敗は何も残さない');

  // 棚1つ → 同時に1件
  const o1 = mk(buyer, { min: 5 });
  assert.throws(() => mk(buyer, {}), /棚の数/);
  // 棚を2つにして2件目 (別の品)
  world.shops.find((s) => s.id === buyer.id)!.showcasecount = 2;
  const wood = itemNoByName('木の枝');
  const o2 = mk(buyer, { itemno: wood, price: 200 });
  world.shops.find((s) => s.id === seller.id)!.item[wood - 1] = 50;

  // 最低納品数
  assert.throws(() => act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o1.id, count: 3 }])), /以上/);
  // 2種類を1セットで
  const msgs = act(world, seller, T0 + 2, (g) =>
    deliver(g, g.shopById(seller.id)!, buyer.id, [
      { order: o1.id, count: 5 },
      { order: o2.id, count: 10 },
    ]),
  );
  assert.equal(msgs.length, 2);
  assert.equal(world.orders!.find((o) => o.id === o2.id), undefined, '集め終わった募集は消える');
  // 同じ相手へ2セット目は不可
  assert.throws(() => act(world, seller, T0 + 3, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o1.id, count: 5 }])), /1期1セット/);
  // 別の店からは納品できる
  act(world, other, T0 + 4, (g) => deliver(g, g.shopById(other.id)!, buyer.id, [{ order: o1.id, count: 5 }]));
  // 逆向き (買い手→売り手) は別に1セット
  const o3 = mk(seller, {});
  world.shops.find((s) => s.id === buyer.id)!.item[LEATHER - 1] += 10;
  act(world, buyer, T0 + 5, (g) => deliver(g, g.shopById(buyer.id)!, seller.id, [{ order: o3.id, count: 10 }]));
  // 自分の募集には納品できない
  const o4 = mk(other, {});
  assert.throws(() => act(world, other, T0 + 6, (g) => deliver(g, g.shopById(other.id)!, other.id, [{ order: o4.id, count: 1 }])), /自分/);
});

test('応じられる募集は1期10種類、出せる募集は棚×3回 (決算で戻る)', () => {
  const { world, seller } = setup();
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const buyers: Shop[] = [];
  for (let i = 0; i < 11; i++) {
    const s = openShop(g0, { name: 'b' + i, shopname: '買い手' + i + '号店' });
    s.time = T0 - 48 * 3600;
    s.money = 1_000_000;
    buyers.push(s);
  }
  const ids = buyers.map((bb) => act(world, bb, T0, (g) => createOrder(g, g.shopById(bb.id)!, { itemno: LEATHER, price: 100, count: 5, hours: 48 })).id);
  for (let i = 0; i < 10; i++) {
    act(world, seller, T0 + i + 1, (g) => deliver(g, g.shopById(seller.id)!, buyers[i].id, [{ order: ids[i], count: 1 }]));
  }
  assert.throws(() => act(world, seller, T0 + 20, (g) => deliver(g, g.shopById(seller.id)!, buyers[10].id, [{ order: ids[10], count: 1 }])), /10種類/);

  // 出す回数: 棚1つなら1日3回。取り下げても戻らない
  const b = buyers[0];
  const t = T0 + 30;
  act(world, b, t, (g) => cancelOrder(g, g.shopById(b.id)!, ids[0]));
  for (let i = 0; i < 2; i++) {
    const o = act(world, b, t + i, (g) => createOrder(g, g.shopById(b.id)!, { itemno: LEATHER, price: 100, count: 1, hours: 24 }));
    act(world, b, t + i, (g) => cancelOrder(g, g.shopById(b.id)!, o.id));
  }
  assert.throws(() => act(world, b, t + 5, (g) => createOrder(g, g.shopById(b.id)!, { itemno: LEATHER, price: 100, count: 1, hours: 24 })), /3回/);
  // 次の決算の後なら応じられる
  act(world, seller, T0 + DEFAULT_CONFIG.oneDayTime, (g) => deliver(g, g.shopById(seller.id)!, buyers[10].id, [{ order: ids[10], count: 1 }]));
});

test('digest に「あなたの在庫が募集中」が出て、一覧が読める', () => {
  const { world, buyer, seller } = setup();
  act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 130, count: 50, hours: 24 }));
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0 + 1);
  const n = { newMine: 0, newTown: 0, newChat: 0, newBbs: 0, newReplies: 0 };
  const txt = digestText(digestData(g, g.shopById(seller.id)!, n));
  assert.match(txt, /あなたの在庫が募集中 獣の革@130/);
  assert.match(digestText(digestData(g, g.shopById(buyer.id)!, n)), /自分の募集 #1獣の革残50/);
  const list = ordersText(ordersData(g, g.shopById(seller.id)!, {}));
  assert.match(list, /#1 獣の革@130\(130%\) 残50\/50 瑠璃のしおり堂/);
  assert.match(list, /今期 募集0\/3回/);
});

test('締めるまでに買い足して上限を超えた分は破棄される', () => {
  const { world, buyer, seller } = setup();
  const lim = new Game(world, DEFAULT_CONFIG, seededRng(1), T0).items[LEATHER].limit;
  const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 100, hours: 24 }));
  act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 60 }]));
  const b = world.shops.find((s) => s.id === buyer.id)!;
  b.item[LEATHER - 1] = lim - 20; // 棚などで買い足した
  const msg = act(world, buyer, T0 + 2, (g) => cancelOrder(g, g.shopById(buyer.id)!, o.id));
  assert.equal(b.item[LEATHER - 1], lim);
  assert.match(msg, /40枚は破棄/);
});

test('納品で売り切れても人気は下がらない (意図的。1期10種類で抑える)', () => {
  const { world, buyer, seller } = setup();
  const s = world.shops.find((x) => x.id === seller.id)!;
  s.rank = 5000;
  s.item[LEATHER - 1] = 10;
  const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 10, hours: 24 }));
  act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 10 }]));
  assert.equal(s.item[LEATHER - 1], 0);
  assert.equal(s.rank, 5000);
});

test('期限切れは決算より先に処理される (長くアクセスが無くても)', async () => {
  const { turn } = await import('../src/engine/turn.js');
  const { world, buyer } = setup();
  // 決算の直前に期限が来る募集を出す
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const cfg = DEFAULT_CONFIG;
  const off = cfg.tzOffset - cfg.dateReviseTime;
  const nextPeriod = (Math.floor((T0 + off) / cfg.oneDayTime) + 1) * cfg.oneDayTime - off;
  const hours = Math.max(1, Math.floor((nextPeriod - T0) / 3600) - 1);
  assert.ok(T0 + hours * 3600 < nextPeriod && hours <= 48);
  void g0;
  act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 10, hours }));
  world.lasttime = T0;
  // 決算を2つまたいだ時刻に初めてアクセスがある
  const g = new Game(world, DEFAULT_CONFIG, seededRng(5), nextPeriod + cfg.oneDayTime + 60);
  assert.equal(turn(g), true);
  const msgs = g.newLogs.map((l) => l.msg);
  const expired = msgs.findIndex((m) => m.includes('期限切れで終了'));
  const period = msgs.findIndex((m) => m.includes('優勝店'));
  assert.ok(expired >= 0 && period >= 0, msgs.join('\n'));
  assert.ok(expired < period, '返金が決算より先');
  assert.equal(world.orders!.length, 0);
});

test('セットの途中で失敗したら、先に入れた分も含めて全部元に戻る', () => {
  const { world, buyer, seller } = setup();
  world.shops.find((s) => s.id === buyer.id)!.showcasecount = 2;
  const o1 = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 10, hours: 24 }));
  const wood = itemNoByName('木の枝');
  const o2 = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: wood, price: 200, count: 10, hours: 24 }));
  const before = JSON.stringify(world);
  // 木の枝は持っていないので2件目で失敗する
  assert.throws(
    () =>
      act(world, seller, T0 + 1, (g) =>
        deliver(g, g.shopById(seller.id)!, buyer.id, [
          { order: o1.id, count: 5 },
          { order: o2.id, count: 5 },
        ]),
      ),
    /在庫が足りません/,
  );
  assert.equal(JSON.stringify(world), before);
});

test('保存して読み直しても、募集・預り金・届いた数・今期の回数が残る', async () => {
  const { Store } = await import('../src/store.js');
  const { world, buyer, seller } = setup();
  const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 120, count: 50, hours: 24 }));
  act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 20 }]));
  const store = new Store(':memory:');
  store.saveWorld(world, [], T0 + 2, 86400);
  const w2 = store.loadWorld(T0 + 2);
  assert.deepEqual(w2.orders, world.orders);
  assert.equal(w2.orders![0].escrow, 30 * 120);
  assert.equal(w2.orders![0].count - w2.orders![0].left, 20);
  assert.deepEqual(w2.orderStats, world.orderStats);
  assert.equal(w2.orderSeq, 1);
});

test('預かり中の品を受け取ると上限を超えるときは digest の注意に出る', () => {
  const { world, buyer, seller } = setup();
  const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 100, hours: 24 }));
  act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 60 }]));
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0 + 2);
  const b = g.shopById(buyer.id)!;
  b.item[LEATHER - 1] = g.items[LEATHER].limit - 20;
  const n = { newMine: 0, newTown: 0, newChat: 0, newBbs: 0, newReplies: 0 };
  assert.match(digestText(digestData(g, b, n)), /募集#1を締めると獣の革が所持上限を40枚超えて破棄/);
});

test('預かり中の品にも、受け取る店の維持費が掛かる', async () => {
  const { turnProc } = await import('../src/engine/turn.js');
  const run = (deliverIt: boolean) => {
    const { world, buyer, seller } = setup();
    const o = act(world, buyer, T0, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 300, hours: 48 }));
    if (deliverIt) act(world, seller, T0 + 1, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 300 - 1 }]));
    world.lasttime = T0 + 1;
    const g = new Game(world, DEFAULT_CONFIG, seededRng(7), T0 + 1 + 3600);
    const b = g.shopById(buyer.id)!;
    const before = b.costtoday;
    turnProc(g);
    return b.costtoday - before;
  };
  const without = run(false);
  const withHeld = run(true);
  // 獣の革 299枚 × 維持費30/日 × 1時間
  assert.ok(Math.abs(withHeld - without - (299 * 30) / 24) < 1, `${withHeld} - ${without}`);
});

test('部分納品済みの募集が区間の途中で期限切れになっても、区間全体の維持費が掛かる', async () => {
  const { turnProc } = await import('../src/engine/turn.js');
  const cfg = DEFAULT_CONFIG;
  const off = cfg.tzOffset - cfg.dateReviseTime;
  // 決算の直後から始めて、決算をまたがない26時間を1区間で計算する
  const start = (Math.floor((T0 + off) / cfg.oneDayTime) + 1) * cfg.oneDayTime - off + 60;
  const run = (held: boolean) => {
    const { world, buyer, seller } = setup();
    for (const s of world.shops) s.time = start - 48 * 3600;
    if (held) {
      const o = act(world, buyer, start, (g) => createOrder(g, g.shopById(buyer.id)!, { itemno: LEATHER, price: 100, count: 300, hours: 3 }));
      act(world, seller, start, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o.id, count: 299 }]));
    }
    world.lasttime = start;
    const g = new Game(world, DEFAULT_CONFIG, seededRng(7), start + 26 * 3600);
    const b = g.shopById(buyer.id)!;
    turnProc(g);
    return { cost: b.costtoday, leather: b.item[LEATHER - 1], orders: world.orders?.length ?? 0 };
  };
  const base = run(false);
  const r = run(true);
  assert.equal(r.orders, 0, '期限切れで締まっている');
  assert.equal(r.leather, 299, '届いた分を受け取っている');
  // 3時間の預かり中 + 23時間の倉庫 = 26時間ぶん、299枚 × 30/日
  assert.ok(Math.abs(r.cost - base.cost - (299 * 30 * 26) / 24) < 1, `${r.cost} - ${base.cost}`);
});

test('決まりの一文がヘルプ・告知・一覧で同じ', async () => {
  const { readFileSync } = await import('node:fs');
  const { ORDER_RULES_LINE } = await import('../src/engine/orders.js');
  const { UPDATES } = await import('../src/updates.js');
  assert.ok(readFileSync('docs/API.md', 'utf8').includes(ORDER_RULES_LINE));
  assert.ok(JSON.stringify(UPDATES).includes(ORDER_RULES_LINE));
  const { ORDER_RENEW_LINE } = await import('../src/engine/orders.js');
  assert.ok(readFileSync('docs/API.md', 'utf8').includes(ORDER_RENEW_LINE));
});

// ---------------------------------------------------------------------------
// 期限切れの扱い (renew): A=未成立なら無料延長 / B=回数を決めて再掲 / C=無期限で再掲

const H = 3600;
const shopOf = (world: World, id: number) => world.shops.find((x) => x.id === id)!;
const at = (world: World, now: number) => new Game(world, DEFAULT_CONFIG, seededRng(9), now);
const post = (world: World, dt: Shop, now: number, req: Partial<Parameters<typeof createOrder>[2]>) =>
  act(world, dt, now, (g) => createOrder(g, g.shopById(dt.id)!, { itemno: LEATHER, price: 100, count: 300, hours: 10, ...req }));
const give = (world: World, from: Shop, to: Shop, now: number, order: number, count: number) =>
  act(world, from, now, (g) => deliver(g, g.shopById(from.id)!, to.id, [{ order, count }]));
const logsOf = (world: World, g: Game, id: number) => g.newLogs.filter((l) => l.from === id).map((l) => l.msg);

test('A 延長: 1個も届かなければ同じ長さだけ無料で延ばす (何回分でも一度に)。時間・代金・回数を使わず、届いたら期限で締める', () => {
  const { world, buyer, seller } = setup();
  const o = post(world, buyer, T0, { renew: 'extend' });
  const time0 = shopOf(world, buyer.id).time;
  const money0 = shopOf(world, buyer.id).money;
  const posted0 = world.orderStats!.posted[buyer.id];

  const g = at(world, T0 + 35 * H);
  sweepOrders(g);
  const o1 = orders(g).find((x) => x.id === o.id)!;
  assert.ok(o1, '延長されて残る');
  assert.equal(o1.expires, T0 + 40 * H, '10時間ずつ、今を越えるまで');
  assert.equal(o1.renewed, 3);
  assert.equal(shopOf(world, buyer.id).time, time0, '時間は使わず、戻しもしない');
  assert.equal(shopOf(world, buyer.id).money, money0);
  assert.equal(o1.escrow, 30000);
  assert.equal(o1.count, 300);
  assert.equal(world.orderStats!.posted[buyer.id] ?? 0, world.orderStats!.period === periodNo(at(world, T0)) ? posted0 : 0, '募集の回数を使わない');
  assert.equal(logsOf(world, g, buyer.id).filter((m) => m.includes('期限を延ばしました')).length, 1, 'ログは1回分にまとめる');

  give(world, seller, buyer, T0 + 36 * H, o.id, 50);
  const stock0 = shopOf(world, buyer.id).item[LEATHER - 1];
  const g2 = at(world, T0 + 40 * H);
  sweepOrders(g2);
  assert.equal(orders(g2).length, 0, '1個でも届いていれば締める');
  assert.equal(shopOf(world, buyer.id).item[LEATHER - 1], stock0 + 50);
  assert.equal(shopOf(world, buyer.id).money, money0 + 25000, '届かなかった分の代金が戻る');
  assert.equal(shopOf(world, buyer.id).time, time0, '届いたので時間は戻らない');
});

test('B 再掲: 残りを同じ単価・長さで出し直し、そのたびに時間と回数を払う。届いた分は倉庫へ、預り金は引き継ぐ、最低納品数は残りまで', () => {
  const { world, buyer, seller, other } = setup();
  const o = post(world, buyer, T0, { renew: 'repost', repeat: 2, min: 280 });
  const money0 = shopOf(world, buyer.id).money;
  give(world, seller, buyer, T0 + H, o.id, 280);
  // 残り20。期限 T0+10h で再掲
  const stock0 = shopOf(world, buyer.id).item[LEATHER - 1];
  const before = shopOf(world, buyer.id).time;
  const g = at(world, T0 + 10 * H);
  const cost = g.timeDeal(20 * 100, LEATHER, 20);
  const p0 = world.orderStats!.period === periodNo(at(world, T0 + 10 * H)) ? world.orderStats!.posted[buyer.id] ?? 0 : 0;
  sweepOrders(g);
  const o1 = orders(g).find((x) => x.id === o.id)!;
  assert.equal(o1.left, 20);
  assert.equal(o1.count, 20);
  assert.equal(o1.min, 20, '最低納品数は残りの数まで下げる');
  assert.equal(o1.escrow, 2000, '預り金は残りの代金のまま (二重に取らない)');
  assert.equal(o1.expires, T0 + 20 * H);
  assert.equal(o1.repeat, 1);
  assert.equal(shopOf(world, buyer.id).item[LEATHER - 1], stock0 + 280, '届いた分は倉庫へ');
  assert.equal(shopOf(world, buyer.id).time, Math.max(before, T0 + 10 * H - 48 * H) + cost, '期限の時点の持ち時間 (48時間まで) から、新しい募集と同じ取引時間');
  assert.equal(world.orderStats!.posted[buyer.id], p0 + 1, '募集の回数を1回使う');
  assert.equal(shopOf(world, buyer.id).money, money0, '代金は動かない');

  // 同じ相手への納品は今期1セットのまま (再掲で戻らない)
  if (periodNo(at(world, T0 + H)) === periodNo(at(world, T0 + 11 * H))) {
    assert.throws(() => give(world, seller, buyer, T0 + 11 * H, o.id, 5), /1期1セット/);
  }
  // 最低納品数20 = 残り全部でないと受け付けない (今までの最低納品数の決まりのまま)
  assert.throws(() => give(world, other, buyer, T0 + 11 * H, o.id, 5), /20枚以上/);
  world.orders!.find((x) => x.id === o.id)!.min = 0; // ここからは部分納品を見るため (失敗した行動で world は巻き戻るので取り直す)
  give(world, other, buyer, T0 + 11 * H, o.id, 5);

  // 2回目の再掲 (最後) → 3回目の期限で締める
  const g2 = at(world, T0 + 30 * H);
  sweepOrders(g2);
  assert.equal(orders(g2).length, 0, '回数を使い切ったら締める');
  const b = shopOf(world, buyer.id);
  assert.equal(b.item[LEATHER - 1], stock0 + 285);
  assert.equal(b.money, money0 + 1500, '最後に残りの代金だけ戻る (届いた285個ぶんは払ったまま)');
  // 資金の合計: 300個ぶん預けて、285個ぶん払い、15個ぶん戻った
  assert.equal(1_000_000 - b.money, 285 * 100);
});

test('B 再掲: 全部届いたら締めて、新しい募集を始めない', () => {
  const { world, buyer, seller } = setup();
  const o = post(world, buyer, T0, { renew: 'forever', count: 100 });
  give(world, seller, buyer, T0 + H, o.id, 100);
  const g = at(world, T0 + 50 * H);
  sweepOrders(g);
  assert.equal(orders(g).length, 0);
  assert.equal(shopOf(world, buyer.id).money, 1_000_000 - 10000);
  assert.ok(!orders(g).some((x) => x.id === o.id));
});

test('B/C 再掲: 持ち時間・募集の回数が足りない、所持上限に入らないときは再掲せずに締め、代金と (届いていなければ) 時間を返す', () => {
  // 持ち時間が足りない (待ち中)
  {
    const { world, buyer } = setup();
    const o = post(world, buyer, T0, { renew: 'forever' });
    const b = shopOf(world, buyer.id);
    b.time = T0 + 30 * H; // 期限の時点では待ち中
    const t1 = b.time;
    const g = at(world, T0 + 10 * H);
    sweepOrders(g);
    assert.equal(orders(g).length, 0);
    assert.ok(logsOf(world, g, buyer.id).some((m) => m.includes(`募集#${o.id}`) && m.includes('期限切れで終了 (持ち時間が足りないため再掲せず)')));
    assert.equal(b.money, 1_000_000, '代金は全部戻る');
    assert.equal(b.time, t1 - o.time, '1個も届いていないので最初の時間は戻る (今までの締めと同じ)');
  }
  // 募集の回数を使い切っている
  {
    const { world, buyer } = setup();
    post(world, buyer, T0, { renew: 'repost', repeat: 5 });
    const g = at(world, T0 + 10 * H);
    const no = periodNo(g);
    world.orderStats = { period: no, posted: { [buyer.id]: shopOf(world, buyer.id).showcasecount * ORDER_RULES.postsPerShelf }, filled: {}, pairs: {} };
    sweepOrders(g);
    assert.equal(orders(g).length, 0);
    assert.ok(logsOf(world, g, buyer.id).some((m) => m.includes('今期の募集回数を使い切ったため再掲せず')));
  }
  // 所持上限 (募集の後で棚から買い足した)
  {
    const { world, buyer } = setup();
    post(world, buyer, T0, { renew: 'forever' });
    const b = shopOf(world, buyer.id);
    b.item[LEATHER - 1] = at(world, T0).items[LEATHER].limit - 100;
    const g = at(world, T0 + 10 * H);
    sweepOrders(g);
    assert.equal(orders(g).length, 0);
    assert.ok(logsOf(world, g, buyer.id).some((m) => m.includes('所持上限のため再掲せず')));
    assert.equal(b.money, 1_000_000);
  }
});

test('C 無期限・B 2147483647回: 長く放っておいても止まり、保存データも増えない', () => {
  for (const req of [{ renew: 'forever' as const }, { renew: 'repost' as const, repeat: 2_147_483_647 }]) {
    const { world, buyer } = setup();
    const o = post(world, buyer, T0, { ...req, hours: 1, count: 10 });
    const g = at(world, T0 + 400 * 24 * H);
    sweepOrders(g);
    const left = orders(g);
    assert.ok(left.length <= 1);
    const logs = logsOf(world, g, buyer.id).filter((m) => m.startsWith(`募集#${o.id}`));
    assert.ok(logs.length <= 1001, `ログは上限まで (${logs.length})`);
    assert.ok(JSON.stringify(world.orders).length < 1000);
    // 次のアクセスで続きを処理しても、預り金は増えも減りもしない
    for (let i = 0; i < 20 && orders(g).length; i++) sweepOrders(g);
    const b = shopOf(world, buyer.id);
    assert.equal(b.money + (orders(g)[0]?.escrow ?? 0), 1_000_000, '代金は増えも減りもしない');
  }
});

test('renew の指定: 範囲・組み合わせの確かめ、renew_order で変える、古い募集 (hours 無し) も扱える', () => {
  const { world, buyer } = setup();
  const bad = (req: Partial<Parameters<typeof createOrder>[2]>) => assert.throws(() => post(world, buyer, T0, req), GameError);
  bad({ renew: 'repost' });
  bad({ renew: 'repost', repeat: 0 });
  bad({ renew: 'repost', repeat: 2_147_483_648 });
  bad({ renew: 'extend', repeat: 3 });
  bad({ renew: 'forever', repeat: 3 });
  bad({ renew: 'auto' as never });
  const o = post(world, buyer, T0, {});
  assert.equal(o.renew, undefined);
  // 古い募集の形
  const raw = orders(at(world, T0)).find((x) => x.id === o.id)!;
  delete raw.hours;
  act(world, buyer, T0, (g) => setOrderRenew(g, g.shopById(buyer.id)!, o.id, 'extend', undefined));
  assert.equal(raw.renew, 'extend');
  assert.equal(raw.hours, 10);
  act(world, buyer, T0, (g) => setOrderRenew(g, g.shopById(buyer.id)!, o.id, 'repost', 7));
  assert.equal(raw.repeat, 7);
  act(world, buyer, T0, (g) => setOrderRenew(g, g.shopById(buyer.id)!, o.id, 'none', undefined));
  assert.equal(raw.renew, undefined);
  assert.equal(raw.repeat, undefined);
  // repeat だけ書いたら repost
  act(world, buyer, T0, (g) => cancelOrder(g, g.shopById(buyer.id)!, o.id));
  const o2 = post(world, buyer, T0, { repeat: 2, count: 1 });
  assert.equal(o2.renew, 'repost');
});
