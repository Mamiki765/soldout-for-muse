// SOLD OUT for Muse — 木工品と職バランスの追加調整。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { itemDetailData, itemDetailText } from '../src/api/views.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, type ItemDef, type UseLine } from '../src/data/catalog.js';
import { buy, enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { PROGRESS_THRESHOLDS } from '../src/engine/joblv.js';
import { MERCHANT_JOB_MULTIPLIER } from '../src/engine/jobs.js';
import { seedWholeStore } from '../src/engine/market.js';
import { addMerchantYen, MERCHANT_CAP_PER_PERIOD, settleMerchant } from '../src/engine/merchant.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';
import { Store } from '../src/store.js';
import { V140 } from '../src/updates.js';

const T0 = 1_800_000_000;
const WOODWORK = 17;
const LACQUER = 138;

function fixture(job = 'woodwork') {
  const g = new Game(newWorld(T0, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0.1 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = job;
  dt.time = T0 - 48 * 3600;
  dt.money = 500_000;
  enterShop(g, dt, true);
  return { g, dt };
}

test('8本・地図の全レシピに出来高調整を適用し、指定の2価格・8時間以外の既存品データを保つ', () => {
  const old = JSON.parse(execFileSync('perl', ['tools/dump-items.pl', 'normal', '--before-v140-balance'], { encoding: 'utf8' })) as { items: ItemDef[] };
  const multipliers: Record<number, number> = { 10: 112, 12: 120, 14: 135, 15: 117, 20: 122, 21: 127, 22: 118, 23: 130 };
  const times = new Map([
    [82, [10800, 8100]], [83, [7800, 5100]], [85, [6300, 4800]], [68, [9000, 2400]],
    [69, [9900, 3900]], [84, [10800, 8100]], [86, [5400, 4500]], [130, [9000, 4500]],
  ]);
  const adjusted = (l: UseLine, percent: number): UseLine => {
    const value = l.count * percent;
    const remainder = value % 100;
    return l.count < 5
      ? { ...l, count: Math.floor(value / 100), ...(remainder ? { fraction: remainder * 10 } : {}) }
      : { ...l, count: Math.round(value / 100) };
  };
  const shortened: number[] = [];
  for (const item of old.items) {
    if (item.no === 71) item.price = 3966;
    if (item.no === 72) item.price = 7159;
    for (const u of item.uses) {
      if (item.no === 12 && u.no === 4) u.get.push({ item_no: LACQUER, count: 20, proba: 800 });
      u.get = u.get.map((l) => adjusted(l, multipliers[item.no] ?? 100));
      const product = u.get[0]?.item_no;
      const time = (item.no === 16 || item.no === 66) && times.get(product);
      if (time) {
        [u.time, u.exptime] = time;
        shortened.push(product);
      }
    }
    const current = BASE_ITEMS[item.no];
    assert.deepEqual({ ...current, uses: current.uses.slice(0, item.uses.length) }, item, item.name);
    assert.equal(current.uses.length, item.uses.length + (item.no === WOODWORK ? 3 : 0), item.name);
  }
  assert.deepEqual(shortened.sort(), [...times.keys()].sort());
});

test('木工品3つの製作は熟練30%で初めて開き、市場からは熟練なしでも仕入れられる', () => {
  const specs = [
    { no: 135, price: 7000, popular: 57600, time: 7200, exptime: 5400, chance: 700, materials: [[99, 10], [138, 10], [102, 2]] },
    { no: 136, price: 9000, popular: 86400, time: 7200, exptime: 5400, chance: 700, materials: [[4, 6], [99, 20], [101, 6]] },
    { no: 137, price: 12000, popular: 129600, time: 10200, exptime: 7800, chance: 600, materials: [[99, 10], [100, 6], [98, 3], [138, 10]] },
  ];
  assert.deepEqual(V140.new_items?.map((i) => i.item), [135, 136, 137, 138]);
  const lacquer = BASE_ITEMS[LACQUER];
  assert.deepEqual([lacquer.price, lacquer.popular, lacquer.cost, lacquer.limit, lacquer.plus, lacquer.type], [500, 7200, 30, 2000, -1200, 1]);
  const { g: buyer, dt: buyerShop } = fixture('');
  seedWholeStore(buyer, [135, 136, 137, 138], 12);
  for (const { no, price, popular, time, exptime, chance, materials } of specs) {
    const item = BASE_ITEMS[no];
    assert.deepEqual([item.price, item.popular, item.cost, item.limit, item.plus, item.type], [price, popular, 1000, 50, 0, 8]);
    buy(buyer, buyerShop, { from: 0, itemno: no, count: 1 });
    assert.equal(buyerShop.item[no - 1], 1, '取引に熟練条件はない');
    const { g, dt } = fixture('drug'); // 熟練を積めば木工細工屋以外でも作れる
    const u = BASE_ITEMS[WOODWORK].uses.find((recipe) => recipe.get[0]?.item_no === no)!;
    assert.deepEqual([u.time, u.exptime, u.needexp, u.exp, u.func, u.params[0]], [time, exptime, 300, 10, 'lostbook', '50']);
    assert.deepEqual(u.get, [{ item_no: no, count: 10, proba: chance }]);
    assert.deepEqual(u.use, materials.map(([item_no, count]) => ({ item_no, count, proba: 1000 })));
    assert.deepEqual(u.jobs, [{ job: 'tool', key: 'times', op: '/', value: 2 }]);
    dt.item[WOODWORK - 1] = 1;
    for (const [id, count] of materials) dt.item[id - 1] = count;
    dt.exp[WOODWORK] = 299;
    const before = structuredClone(dt);
    assert.throws(() => useItemAction(g, dt, WOODWORK, u.no, { count: 1 }), /熟練が足りません \(要30%/);
    assert.deepEqual(dt, before);
    dt.exp[WOODWORK] = 300;
    const result = useItemAction(g, dt, WOODWORK, u.no, { count: 1 });
    assert.equal(dt.item[no - 1], 10);
    assert.equal(dt.exp[WOODWORK], 310);
    assert.ok(useResultMessages(g, dt, result).includes(item.name + 'を作りました'));
  }
});

test('本執筆の端数は1セットごとに抽選し、職レベルでも成功率が上がる', () => {
  const run = (lv: number, rolls: number[]) => {
    const { g, dt } = fixture('book');
    const recipe = BASE_ITEMS[10].uses[0];
    dt.joblvpt = { 10: PROGRESS_THRESHOLDS[lv] * 60 };
    for (const l of recipe.use) dt.item[l.item_no - 1] = 2 * l.count;
    g.rand = () => rolls.shift()!;
    useItemAction(g, dt, 10, 0, { count: 2 });
    assert.equal(rolls.length, 0);
    return dt.item[15 - 1];
  };
  assert.equal(run(0, [119, 120]), 3, '12%で1冊を追加');
  assert.equal(run(10, [199, 200, 143, 144]), 4, '職レベルで1冊の追加20%、端数の追加14.4%');
  const { g } = fixture();
  assert.match(itemDetailText(itemDetailData(g, 10)), /薬調合入門x1 \+1個\(12%\)/);
});

test('商人ポイントは13職の補正を取引ごとに適用し、転職前の取引はそのまま数える', () => {
  assert.equal(MERCHANT_CAP_PER_PERIOD, 2000);
  const expected: Record<string, number> = {
    mine: 2, wood: 1.9, peddle: 1.7, cow: 1.4, leather: 1.3, woodwork: 1.3, deco: 1.3,
    book: 1, drug: 1, sword: 1, staff: 1, shield: 1, mail: 1, '': 1,
  };
  for (const [job, multiplier] of Object.entries(expected)) {
    assert.equal(MERCHANT_JOB_MULTIPLIER[job], multiplier, job);
    const { dt } = fixture(job);
    addMerchantYen(dt, 10_000);
    settleMerchant(dt, T0);
    assert.equal(dt.merchantpt, 10 * multiplier, job);
  }
  const { dt } = fixture('mine');
  addMerchantYen(dt, 600); // 1,200円ぶん
  dt.job = 'wood';
  addMerchantYen(dt, 500); // 950円ぶん
  dt.job = 'book';
  settleMerchant(dt, T0);
  assert.equal(dt.merchantpt, 2);
});

test('1.4.0の市場初期投入は一度だけ。アイコン4点は16×16のPNG', () => {
  for (const { item } of V140.new_items!) {
    const png = readFileSync(`public/images/item-no-${item}.png`);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [16, 16]);
  }
  const dir = mkdtempSync(join(tmpdir(), 'soldout-v140-balance-'));
  const db = join(dir, 'seed.sqlite');
  const seed = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/src/main.js', 'seed-market'], {
    env: { ...process.env, DB_PATH: db }, encoding: 'utf8',
  });
  try {
    const first = seed();
    assert.equal(first.status, 0, first.stderr);
    const second = seed();
    assert.equal(second.status, 1, second.stderr);
    const store = new Store(db);
    try {
      const w = store.loadWorld(T0);
      assert.deepEqual(w.wholestore.slice(134), [1, 1, 1, 24]);
      assert.ok(store.getSetting('market_seeded:1.4.0'));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
