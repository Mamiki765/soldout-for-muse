// 買い取り募集 (原作にない追加) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { CATALOG, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { cancelOrder, createOrder, deliver, orders, priceRange, sweepOrders } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { digestData, digestText, ordersData, ordersText } from '../src/api/views.js';

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

test('制限: 単価・期限・同時件数・同じ相手1日1箱 (逆向きは別)・まとめ納品・最低納品数', () => {
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
  // 2種類を1箱で
  const msgs = act(world, seller, T0 + 2, (g) =>
    deliver(g, g.shopById(seller.id)!, buyer.id, [
      { order: o1.id, count: 5 },
      { order: o2.id, count: 10 },
    ]),
  );
  assert.equal(msgs.length, 2);
  assert.equal(world.orders!.find((o) => o.id === o2.id), undefined, '集め終わった募集は消える');
  // 同じ相手へ2箱目は不可
  assert.throws(() => act(world, seller, T0 + 3, (g) => deliver(g, g.shopById(seller.id)!, buyer.id, [{ order: o1.id, count: 5 }])), /今日はもう/);
  // 別の店からは納品できる
  act(world, other, T0 + 4, (g) => deliver(g, g.shopById(other.id)!, buyer.id, [{ order: o1.id, count: 5 }]));
  // 逆向き (買い手→売り手) は別に1箱
  const o3 = mk(seller, {});
  world.shops.find((s) => s.id === buyer.id)!.item[LEATHER - 1] += 10;
  act(world, buyer, T0 + 5, (g) => deliver(g, g.shopById(buyer.id)!, seller.id, [{ order: o3.id, count: 10 }]));
  // 自分の募集には納品できない
  const o4 = mk(other, {});
  assert.throws(() => act(world, other, T0 + 6, (g) => deliver(g, g.shopById(other.id)!, other.id, [{ order: o4.id, count: 1 }])), /自分/);
});

test('応じられる募集は1日10件、出せる募集は棚×3回 (決算で戻る)', () => {
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
  assert.throws(() => act(world, seller, T0 + 20, (g) => deliver(g, g.shopById(seller.id)!, buyers[10].id, [{ order: ids[10], count: 1 }])), /10件/);

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
  assert.match(list, /今日 募集0\/3回/);
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

test('納品で売り切れても人気は下がらない (意図的。1日10件で抑える)', () => {
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

test('箱の途中で失敗したら、先に入れた分も含めて全部元に戻る', () => {
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

test('保存して読み直しても、募集・預り金・届いた数・今日の回数が残る', async () => {
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
