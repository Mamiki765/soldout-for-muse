// SOLD OUT for Muse — 1.0.0 新商品16種・飼い葉桶・タイムシガレット・転職のお祝いの決まり。数字は品のデータから読む (AGENTS.md「テストの決まり」)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { V100 } from '../src/updates.js';

const T0 = 1_800_000_000;
const MINO = 25;
const MILK = 26;
const HAY = 115;
const TROUGH = 131;

function fixture(r = 0.2) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}
const FEED = BASE_ITEMS[MINO].uses.find((x) => x.name === '干し草を与えて搾る')!.no;

test('1.0.0: 新商品は116〜131の16品で、どれも作り方が1つある', () => {
  assert.ok(MAX_ITEM >= 132);
  assert.deepEqual(V100.new_items!.map((i) => i.item), Array.from({ length: 16 }, (_, i) => 116 + i));
  for (let no = 116; no <= 131; no++) {
    const made = Object.values(BASE_ITEMS).flatMap((it) => it?.uses ?? []).filter((u) => u.get.some((l) => l.item_no === no));
    assert.ok(made.length >= 1, BASE_ITEMS[no].name);
  }
  assert.equal(BASE_ITEMS[TROUGH].name, '飼い葉桶');
});

test('1.0.0: 剣の鍛え方は使っても毎回は無くならない (すり切れ率が100%未満。params[0] は千分率)', () => {
  const rates = BASE_ITEMS[20].uses.filter((u) => u.func === 'lostbook').map((u) => Number(u.params[0]));
  assert.ok(rates.length > 0);
  for (const r of rates) assert.ok(r > 0 && r < 1000, String(r));
});

test('飼い葉桶: 持っていると1回ごとに頭数ぶん牛乳が増え、使うたびに傷み、寿命で1個ずつ壊れる (1.1.0)', () => {
  const milk = (r: number, troughs: number, worn: boolean, count = 3, single = false) => {
    const { g, dt } = fixture(r);
    dt.item[MINO - 1] = 10;
    dt.item[HAY - 1] = 30;
    dt.item[TROUGH - 1] = troughs;
    if (worn) dt.bookwear = { [TROUGH]: [10, 0.7] };
    let last = '';
    if (single) for (let i = 0; i < count; i++) last = useItemAction(g, dt, MINO, FEED, { count: 1 }).result.function_return!;
    else last = useItemAction(g, dt, MINO, FEED, { count }).result.function_return!;
    return { milk: dt.item[MILK - 1], troughs: dt.item[TROUGH - 1], msg: last };
  };
  // 新しい桶は3回では壊れず、3回とも頭数ぶん上乗せ。耐久が返事に出る
  const fresh = milk(0.2, 1, false);
  assert.equal(fresh.milk, milk(0.2, 0, false).milk + 10 * 3);
  assert.equal(fresh.troughs, 1);
  assert.doesNotMatch(fresh.msg, /壊れ/);
  assert.match(fresh.msg, /飼い葉桶の耐久: \d+%/);
  // 傷みきった桶2個: 1回ごとに1個壊れ、桶が残っている2回だけ上乗せ
  const worn = milk(0, 2, true);
  assert.equal(worn.milk, milk(0, 0, false).milk + 10 * 2);
  assert.equal(worn.troughs, 0);
  assert.match(worn.msg, /飼い葉桶が2個壊れました/);
  // まとめて搾っても1回ずつ搾っても同じ
  assert.equal(milk(0, 1, true, 3).milk, milk(0, 1, true, 3, true).milk);
});

const CIG = 132;
const SMOKE = 0;

test('タイムシガレット: 吸った本数に比例して持ち時間が増え、待ち中でも吸え、持ち時間の上限を超える分は吸えない。売れない・譲れない', () => {
  const it = BASE_ITEMS[CIG];
  assert.equal(it.name, 'タイムシガレット');
  const { g, dt } = fixture();
  assert.ok(g.itemFlag(CIG, 'noshowcase') && g.itemFlag(CIG, 'nosend') && g.itemFlag(CIG, 'nobuy'), '売れない・譲れない');
  dt.item[CIG - 1] = 1000;
  // 待ち中 (持ち時間がマイナス) でも吸える
  dt.time = T0 + 3600;
  const t0 = g.stockTime(dt);
  useItemAction(g, dt, CIG, SMOKE, { count: 1 });
  const per = g.stockTime(dt) - t0;
  assert.ok(per > 0);
  useItemAction(g, dt, CIG, SMOKE, { count: 3 });
  assert.equal(g.stockTime(dt) - t0, per * 4);
  assert.equal(dt.item[CIG - 1], 996);
  // 上限まで吸える本数だけ吸い、それ以上は吸わない (本も減らない)
  const max = g.config.maxStockTime;
  const room = Math.floor((max - g.stockTime(dt)) / per);
  const u = useItemAction(g, dt, CIG, SMOKE, { count: 1000 });
  assert.equal(u.result.count, room);
  assert.ok(g.stockTime(dt) <= max);
  assert.equal(dt.item[CIG - 1], 996 - room);
  if (max - g.stockTime(dt) < per) {
    const full = useItemAction(g, dt, CIG, SMOKE, { count: 1 });
    assert.equal(full.result.count, 0);
    assert.match(full.result.failReason!, /いっぱい/);
    assert.equal(dt.item[CIG - 1], 996 - room);
  }
});

test('転職のお祝い: 13の転職先すべてに贈り物があり、職に就くと1店1回だけもらえる', async () => {
  const { giveJobGift, giveShopTime, JOB_GIFTS, EXISTING_SHOP_CIGARETTES } = await import('../src/engine/campaign.js');
  const change = BASE_ITEMS[78].uses.filter((u) => u.params[3] && u.params[3] !== '_default_');
  assert.equal(change.length, 13);
  for (const u of change) {
    const gift = JOB_GIFTS[Number(u.params[0])];
    assert.ok(gift?.length, u.name!);
    for (const [no, c] of gift) assert.ok(c > 0 && c <= BASE_ITEMS[no].limit, `${u.name}: ${BASE_ITEMS[no].name} は所持上限まで`);
  }
  const { g, dt } = fixture();
  dt.item[78 - 1] = 2;
  const toPeddle = change.find((u) => u.params[3] === 'peddle')!;
  const toCow = change.find((u) => u.params[3] === 'cow')!;
  let u = useItemAction(g, dt, 78, toPeddle.no, { count: 1, confirm: true });
  assert.equal(dt.job, 'peddle');
  for (const [no, c] of JOB_GIFTS[Number(toPeddle.params[0])]) assert.equal(dt.item[no - 1], c);
  assert.match(u.result.function_return!, /お祝い/);
  u = useItemAction(g, dt, 78, toCow.no, { count: 1, confirm: true });
  assert.equal(dt.job, 'cow');
  assert.equal(dt.item[25 - 1], 0, '2回目はもらえない');
  assert.equal(giveJobGift(g, dt, 25), '');

  // 既存店への配布: 職のある店は配布済みになり、無職の店はあとで就職するともらえる
  const a = fixture();
  const b = fixture();
  b.dt.job = 'weapon';
  a.g.allShops.push(b.dt); // g.shops は営業中の店の写し (1.1.0) なので、元の一覧に足す
  const rows = giveShopTime(a.g);
  assert.equal(a.dt.item[CIG - 1], EXISTING_SHOP_CIGARETTES);
  assert.equal(b.dt.item[CIG - 1], EXISTING_SHOP_CIGARETTES);
  assert.equal(rows.length, 2);
  assert.equal(giveJobGift(a.g, b.dt, 20), '');
  assert.match(giveJobGift(a.g, a.dt, 20), /剣の鍛え方×1/);
  // お詫びの配布は印を付けない
  const c = fixture();
  c.dt.job = 'armor';
  giveShopTime(c.g, 48, false, 'お詫び');
  assert.equal(c.dt.item[CIG - 1], 48);
  assert.match(giveJobGift(c.g, c.dt, 21), /盾の作り方×1/);
});
