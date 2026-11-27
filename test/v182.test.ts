// SOLD OUT for Muse — 1.8.2 地図と干し草の品不足 (目安箱#12) の決まりのテスト。
// 数字はデータ (tools/v182.json → items.json) の1か所だけに置き、ここでは大小関係と出し分けを確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { BATCH_WEAR_TIP } from '../src/engine/scripts.js';
import { SURPLUS_COST_MIN, SURPLUS_MAX, inWarehouseLine, inWarehouses, surplusItems } from '../src/engine/surplus.js';
import { newWorld, type BuyOrder, type Shop } from '../src/engine/types.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const HAY = itemNoByName('干し草');
const COW = itemNoByName('ミノタウロス♀');
const MINE_MAP = itemNoByName('近くの鉱山への地図');
const MOUNTAIN_MAP = itemNoByName('近くの山への地図');
const SWORD_MAP = itemNoByName('剣市への地図');

function fixture() {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g, { name: 'a', shopname: '試験商店A' });
  const b = openShop(g, { name: 'b', shopname: '試験商店B' });
  return { g, a, b };
}

/** 維持費が下限ちょうどになる個数 (データの cost から出す) */
function hayAtThreshold(): number {
  return Math.ceil(SURPLUS_COST_MIN / BASE_ITEMS[HAY].cost);
}

function addOrder(g: Game, shop: Shop, item: number): void {
  const list = (g.world.orders ??= []);
  list.push({ id: list.length + 1, shop: shop.id, item, price: 1, count: 10, left: 10, min: 0, escrow: 10 } as BuyOrder);
}

function lostbookWear(item: number): number[] {
  return BASE_ITEMS[item].uses.filter((u) => u.func === 'lostbook').map((u) => Number(u.params[0]));
}

test('1.8.2: 鉱山・山の地図は剣市への地図より傷みにくく、市場の天井は1店1冊以上', () => {
  for (const map of [MINE_MAP, MOUNTAIN_MAP]) {
    const wear = lostbookWear(map);
    assert.ok(wear.length > 0);
    for (const w of wear) for (const s of lostbookWear(SWORD_MAP)) assert.ok(w < s, `${BASE_ITEMS[map].name} ${w} < ${s}`);
    assert.ok(BASE_ITEMS[map].wslimit >= 1, BASE_ITEMS[map].name);
  }
  // 干し草は山の地図1回の副産物より多く市場に置ける (天井が使い道より低いと、市場はすぐ0になる)
  assert.ok(BASE_ITEMS[HAY].wslimit > 1);
});

test('1.8.2: 使わない品の案内は、使わない店だけに、維持費が下限以上のときに出る', () => {
  const { g, a } = fixture();
  const n = hayAtThreshold();
  a.item[HAY - 1] = n - 1;
  assert.deepEqual(surplusItems(g, a), [], '下限未満なら出さない');
  a.item[HAY - 1] = n;
  const list = surplusItems(g, a);
  assert.equal(list.length, 1);
  assert.equal(list[0].item, HAY);
  assert.ok(list[0].cost >= SURPLUS_COST_MIN);

  // 牛を飼っている店では干し草は材料なので出さない
  a.item[COW - 1] = 1;
  assert.deepEqual(surplusItems(g, a), []);
  a.item[COW - 1] = 0;

  // 棚に並べている・ほしい物リスト・自分の募集の品は出さない
  a.showcase[0] = HAY;
  assert.deepEqual(surplusItems(g, a), []);
  a.showcase[0] = 0;
  a.wish = [HAY];
  assert.deepEqual(surplusItems(g, a), []);
  a.wish = [];
  addOrder(g, a, HAY);
  assert.deepEqual(surplusItems(g, a), []);
});

test('1.8.2: 使わない品の案内は材料になる品だけで、品数の上限を超えない', () => {
  const { g, a } = fixture();
  for (let no = 1; no <= g.maxItem; no++) {
    const it = BASE_ITEMS[no];
    if (!it || !(it.cost > 0)) continue;
    a.item[no - 1] = Math.ceil(SURPLUS_COST_MIN / it.cost);
  }
  const list = surplusItems(g, a);
  assert.ok(list.length <= SURPLUS_MAX);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].cost >= list[i].cost, '維持費の多い順');
  for (const x of list) {
    assert.equal(BASE_ITEMS[x.item].uses.length, 0, `${x.name} は本・道具ではない`);
    assert.ok(a.item[x.item - 1] > 0);
  }
});

test('1.8.2: 倉庫に持っている店がある品は、棚にも市場にも無く、自分で募集していないときだけ出る', () => {
  const { g, a, b } = fixture();
  a.wish = [HAY];
  g.world.wholestore[HAY - 1] = 0;
  assert.deepEqual(inWarehouses(g, a), [], 'だれも持っていなければ出さない');
  b.item[HAY - 1] = 1;
  const list = inWarehouses(g, a);
  assert.deepEqual(list.map((x) => [x.item, x.shops]), [[HAY, 1]]);
  const line = inWarehouseLine(list)!;
  assert.ok(line.includes(BASE_ITEMS[HAY].name));
  assert.ok(!line.includes(b.shopname), '店名は出さない');
  assert.equal(inWarehouseLine([]), null);

  // 市場にある
  g.world.wholestore[HAY - 1] = 1;
  assert.deepEqual(inWarehouses(g, a), []);
  g.world.wholestore[HAY - 1] = 0;
  // ほかの店の棚に並んでいる
  b.showcase[0] = HAY;
  b.price[0] = 100;
  assert.deepEqual(inWarehouses(g, a), []);
  b.showcase[0] = 0;
  // 自分で募集を出している
  addOrder(g, a, HAY);
  assert.deepEqual(inWarehouses(g, a), []);
});

test('1.8.2: 地図の耐久の行は1回ずつ使ったときだけ「まとめても傷みは1回分」を添える', () => {
  const { g, a } = fixture();
  const u = BASE_ITEMS[MOUNTAIN_MAP].uses.find((x) => x.func === 'lostbook')!;
  const run = (count: number) => {
    a.item[MOUNTAIN_MAP - 1] = 100;
    a.exp[MOUNTAIN_MAP] = 1000;
    for (const l of u.use) if (l.item_no !== MOUNTAIN_MAP) a.item[l.item_no - 1] = Math.max(a.item[l.item_no - 1], l.count * count);
    a.time = g.now - 48 * 3600;
    enterShop(g, a, true);
    const r = useItemAction(g, a, MOUNTAIN_MAP, u.no, { count });
    const line = useResultMessages(g, a, r).find((m) => m.startsWith(`${BASE_ITEMS[MOUNTAIN_MAP].name}の耐久`));
    assert.ok(line, useResultMessages(g, a, r).join('\n'));
    return line;
  };
  assert.ok(run(1).includes(BATCH_WEAR_TIP));
  assert.ok(!run(2).includes(BATCH_WEAR_TIP));
});
