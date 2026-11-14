// SOLD OUT for Muse — 週1の時間クーポンのテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, type GameConfig } from '../src/config.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { editShowcase, openShop } from '../src/engine/actions.js';
import { cancelOrder, createOrder, sweepOrders } from '../src/engine/orders.js';
import { itemNoByName } from '../src/data/catalog.js';
import { Game, GameError } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type World } from '../src/engine/types.js';
import { digestData, digestText, meData } from '../src/api/views.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';
import { deposit } from '../src/engine/actions.js';

const H = 3600;
// 2027-01-13 (水) 12:00 JST
const WED = Date.UTC(2027, 0, 13, 3, 0, 0) / 1000;
// 2027-01-17 (日) 0:00 JST
const SUN = Date.UTC(2027, 0, 16, 15, 0, 0) / 1000;

function game(world: World, now: number, config: GameConfig = DEFAULT_CONFIG): Game {
  return new Game(world, config, seededRng(1), now);
}

function setup(now = WED) {
  const world = newWorld(now, MAX_ITEM);
  const g = game(world, now);
  const dt = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  return { world, g, dt };
}

/** 陳列の時間 (CATALOG.timeEditShowcase) を n 秒ぶん使う代わりに、useTime を直接呼ぶ */
function use(g: Game, id: number, sec: number) {
  g.dt = g.world.shops.find((s) => s.id === id)!;
  g.useTime(sec);
}

test('配布時刻は日曜0時 (日本時間)、次は7日後', () => {
  const { g } = setup();
  assert.equal(g.couponWeekStart(), SUN - 7 * 24 * H);
  assert.equal(g.nextCouponTime(), SUN);
  assert.equal(g.couponWeekStart(SUN - 1), SUN - 7 * 24 * H);
  assert.equal(g.couponWeekStart(SUN), SUN);
  const jst = new Date((SUN + 9 * H) * 1000);
  assert.equal(jst.getUTCDay(), 0);
  assert.equal(jst.getUTCHours(), 0);
});

test('新しい店は48時間のクーポンを持っていて、クーポンから先に使う', () => {
  const { g, dt } = setup();
  const time0 = dt.time;
  assert.equal(g.couponTime(dt), 48 * H);
  use(g, dt.id, 10 * H);
  assert.equal(g.couponTime(dt), 38 * H);
  assert.equal(dt.time, time0, '持ち時間は減らない');
});

test('クーポンが足りない分は持ち時間から使う', () => {
  const { g, dt } = setup();
  const stock0 = g.stockTime(dt);
  use(g, dt.id, 50 * H);
  assert.equal(g.couponTime(dt), 0);
  assert.equal(g.stockTime(dt), stock0 - 2 * H);
});

test('持ち時間が0以下でもクーポンが残っていれば動ける。両方なければ時間待ち', () => {
  const { g, dt } = setup();
  dt.time = g.now + H; // 持ち時間 -1h
  use(g, dt.id, 48 * H);
  assert.equal(g.couponTime(dt), 0);
  assert.throws(() => use(g, dt.id, 60), (e: unknown) => e instanceof GameError && e.message.startsWith('時間待ちでしょ？'));
});

test('次の日曜0時に48時間へ戻る (繰り越さない)', () => {
  const { world, g, dt } = setup();
  use(g, dt.id, 30 * H);
  assert.equal(g.couponTime(dt), 18 * H);
  // 土曜23:59 はまだ同じ週
  assert.equal(game(world, SUN - 60).couponTime(dt), 18 * H);
  const g2 = game(world, SUN);
  assert.equal(g2.couponTime(dt), 48 * H);
  // 使わなかった週も 48h のまま (96h にはならない)
  assert.equal(game(world, SUN + 7 * 24 * H).couponTime(dt), 48 * H);
});

test('持ち時間の48h上限とは別枠: クーポンを使っている間も持ち時間はたまる', () => {
  const { world, g, dt } = setup();
  dt.time = g.now - 48 * H; // 満タン
  use(g, dt.id, 20 * H);
  const g2 = game(world, WED + 5 * H);
  assert.equal(g2.stockTime(dt), 48 * H, '満タンのまま');
  assert.equal(g2.usableTime(dt), 76 * H);
});

test('棚の陳列などふつうの行動でもクーポンが減る', () => {
  const { g, dt } = setup();
  g.dt = dt;
  const time0 = dt.time;
  editShowcase(g, dt, { slot: 0, itemno: 0 });
  assert.ok(g.couponTime(dt) < 48 * H);
  assert.equal(dt.time, time0);
});

test('couponTime 0 ならクーポン無し (原作どおり)', () => {
  const cfg = { ...DEFAULT_CONFIG, couponTime: 0 };
  const world = newWorld(WED, MAX_ITEM);
  const g = game(world, WED, cfg);
  const dt = openShop(g, { name: 'bob', shopname: 'ボブの店です' });
  const time0 = dt.time;
  assert.equal(g.couponTime(dt), 0);
  use(g, dt.id, H);
  assert.equal(dt.time, time0 + H);
  assert.equal(dt.user._coupon_left, undefined);
});

test('digest と me にクーポンが出る', () => {
  const { g, dt } = setup();
  use(g, dt.id, 30 * H);
  const d = digestData(g, dt, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 });
  assert.equal(d.coupon, 18 * H);
  assert.equal(d.coupon_reset, SUN);
  assert.match(digestText(d), / 券18h00m /);
  const me = meData(g, dt);
  assert.equal(me.coupon, 18 * H);
  assert.equal(me.coupon_max, 48 * H);
});

test('買い取り募集が1個も届かずに締まったら、クーポンで払った分はクーポンへ戻る (週が変わっていれば戻らない)', () => {
  const LEATHER = itemNoByName('獣の革');
  const { world, g, dt } = setup();
  dt.money = 1_000_000;
  g.dt = dt;
  const time0 = dt.time;
  const o = createOrder(g, dt, { itemno: LEATHER, price: 100, count: 10, hours: 1 });
  assert.ok(o.time > 0);
  assert.equal(o.coupon, o.time);
  assert.equal(g.couponTime(dt), 48 * H - o.time);
  const g2 = game(world, WED + 60);
  g2.dt = dt;
  cancelOrder(g2, dt, o.id);
  assert.equal(g2.couponTime(dt), 48 * H, 'クーポンへ戻る');
  assert.equal(dt.time, time0, '持ち時間は増えない');

  // 週をまたいで期限切れ: 先週のクーポン分は捨てる
  const g3 = game(world, SUN - 1800);
  g3.dt = dt;
  const o2 = createOrder(g3, dt, { itemno: LEATHER, price: 100, count: 10, hours: 1 });
  assert.equal(o2.coupon, o2.time);
  const g4 = game(world, SUN + 1800);
  assert.equal(sweepOrders(g4), true);
  assert.equal(g4.couponTime(dt), 48 * H);
  // 募集のとき満タン (48h) で止められ、その後1時間たっただけ。先週のクーポン分は足されない
  assert.equal(g4.now - dt.time, 48 * H + 3600, '持ち時間には入らない');
});

test('持ち時間がマイナスでクーポンがそれより少なくても、生産数は負にならず在庫も時間も変わらない', () => {
  const { g, dt } = setup();
  g.dt = dt;
  // 本執筆キット (品番10) で『薬調合入門』を書く材料をそろえる (1冊6時間)
  const kit = 10, book = 15;
  dt.item[kit - 1] = 5; dt.item[1 - 1] = 300; dt.item[30 - 1] = 100; dt.item[32 - 1] = 100;
  dt.money = 10_000_000;
  dt.time = g.now + 10 * H; // 持ち時間 -10h (前の取引の待ち)
  use(g, dt.id, 46 * H); // クーポン残り 2h (< 待ちの10h)
  assert.equal(g.couponTime(dt), 2 * H);
  const before = { items: [...dt.item], time: dt.time, coupon: g.couponTime(dt), money: dt.money };
  const u = useItemAction(g, dt, kit, 0, { count: 3 });
  assert.equal(u.result.count, 0);
  assert.deepEqual(dt.item, before.items, '材料が戻ったり本が減ったりしない');
  assert.equal(dt.item[book - 1], 0);
  assert.equal(dt.time, before.time);
  assert.equal(g.couponTime(dt), before.coupon);
  assert.equal(dt.money, before.money);
  assert.deepEqual(useResultMessages(g, dt, u), ['実行できませんでした (持ち時間が足りません)']);
  for (const it of dt.item) assert.ok(it >= 0);
});

test('持ち時間がマイナスでも、クーポンで払える数だけは作れる (マイナス分がクーポンを食わない)', () => {
  const { g, dt } = setup();
  g.dt = dt;
  const kit = 10, book = 15;
  dt.item[kit - 1] = 5; dt.item[1 - 1] = 300; dt.item[30 - 1] = 100; dt.item[32 - 1] = 100;
  dt.money = 10_000_000;
  dt.time = g.now + 10 * H;
  use(g, dt.id, 35 * H); // クーポン残り 13h → 6h の本は2冊まで
  const time0 = dt.time;
  const u = useItemAction(g, dt, kit, 0, { count: 3 });
  assert.equal(u.result.count, 2);
  assert.equal(dt.item[book - 1], 2);
  assert.equal(g.couponTime(dt), 1 * H);
  assert.equal(dt.time, time0, '待ちは増えない');
});

test('持ち時間がマイナスのとき、入金に使える時間はクーポンの分だけ', () => {
  const { g, dt } = setup();
  g.dt = dt;
  dt.time = g.now + 10 * H;
  use(g, dt.id, 48 * H - 60); // クーポン残り 1分
  assert.equal(g.usableTime(dt), 60);
  dt.moneystock = 100_000_000;
  assert.throws(() => deposit(g, dt, 100_000_000), (e: unknown) => e instanceof GameError && e.message === '時間が足りません');
});

test('使えない使い方は理由を返す (材料・熟練)', () => {
  const { g, dt } = setup();
  g.dt = dt;
  dt.item[10 - 1] = 1; // 本執筆キットだけ (紙などが無い)
  assert.throws(() => useItemAction(g, dt, 10, 0, { count: 1 }), (e: unknown) => e instanceof GameError && /^使えません \(足りない: /.test(e.message));
  assert.throws(() => useItemAction(g, dt, 10, 99, { count: 1 }), (e: unknown) => e instanceof GameError && /使い方の番号 99 はありません/.test(e.message));
});
