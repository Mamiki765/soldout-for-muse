// SOLD OUT for Muse — 1.4.0 木工品・本執筆の端数・商人ポイント・新しい品のアイコンの決まり。数字は品のデータから読む (AGENTS.md「テストの決まり」)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { itemDetailData, itemDetailText } from '../src/api/views.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { buy, enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { PROGRESS_THRESHOLDS } from '../src/engine/joblv.js';
import { MERCHANT_JOB_MULTIPLIER } from '../src/engine/jobs.js';
import { seedWholeStore } from '../src/engine/market.js';
import { addMerchantYen, MERCHANT_CAP_PER_PERIOD, settleMerchant } from '../src/engine/merchant.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';
import { Store } from '../src/store.js';
import { V140, V150, V170 } from '../src/updates.js';

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

test('木工品3つの製作は熟練の条件で初めて開き、市場からは熟練なしでも仕入れられる。職が違っても熟練を積めば作れる', () => {
  const WOODS = [135, 136, 137];
  assert.deepEqual(V140.new_items?.map((i) => i.item), [...WOODS, LACQUER]);
  const lacquer = BASE_ITEMS[LACQUER];
  assert.deepEqual([lacquer.type, lacquer.plus < 0], [1, true], '漆は原料で、市場に湧かない');
  const { g: buyer, dt: buyerShop } = fixture('');
  seedWholeStore(buyer, [...WOODS, LACQUER], 12);
  for (const no of WOODS) {
    const item = BASE_ITEMS[no];
    assert.deepEqual([item.type, item.plus], [8, 0], `${item.name}: 装飾品で市場に湧かない`);
    buy(buyer, buyerShop, { from: 0, itemno: no, count: 1 });
    assert.equal(buyerShop.item[no - 1], 1, '取引に熟練条件はない');
    const { g, dt } = fixture('drug'); // 熟練を積めば木工細工屋以外でも作れる
    const u = BASE_ITEMS[WOODWORK].uses.find((recipe) => recipe.get[0]?.item_no === no)!;
    const need = u.needexp!;
    assert.ok(need > 0 && u.exptime < u.time && u.exp > 0 && u.func === 'lostbook', item.name);
    assert.deepEqual(u.jobs, [{ job: 'tool', key: 'times', op: '/', value: 2 }]);
    assert.ok(u.use.every((l) => l.proba > 0), '材料はみな消費する');
    dt.item[WOODWORK - 1] = 1;
    for (const l of u.use) dt.item[l.item_no - 1] = l.count;
    dt.exp[WOODWORK] = need - 1;
    const before = structuredClone(dt);
    assert.throws(() => useItemAction(g, dt, WOODWORK, u.no, { count: 1 }), new RegExp(`熟練が足りません \\(木工細工入門の熟練が要${need / 10}%`));
    assert.deepEqual(dt, before);
    dt.exp[WOODWORK] = need;
    const result = useItemAction(g, dt, WOODWORK, u.no, { count: 1 });
    const made = u.get[0];
    assert.equal(dt.item[no - 1], made.count + (made.fraction ? 1 : 0)); // 乱数は 0.1 固定なので成功と端数の抽選も当たる
    assert.equal(dt.exp[WOODWORK], need + u.exp);
    for (const l of u.use) assert.equal(dt.item[l.item_no - 1], 0);
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

test('1.4.0・1.5.0・1.7.0の新しい品のアイコンは16×16のPNG。1.5.0の品は市場に初期投入しない', () => {
  for (const { item } of [...V140.new_items!, ...V150.new_items!, ...V170.new_items!]) {
    const png = readFileSync(`public/images/item-no-${item}.png`);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [16, 16]);
  }
  // 1.4.0 の4品の初期投入 (漆24滴・木工品各1点) は上の seedWholeStore で確かめている。
  // seed-market は品を足したいちばん新しい版 (1.7.0: ツルハシ・オノを20ずつ、ただし市場の上限まで) を見る。石炭・黒玉 (1.5.0) は市場に湧かない品なので0のまま
  const dir = mkdtempSync(join(tmpdir(), 'soldout-v140-balance-'));
  const db = join(dir, 'seed.sqlite');
  const seed = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/src/main.js', 'seed-market'], {
    env: { ...process.env, DB_PATH: db }, encoding: 'utf8',
  });
  try {
    const first = seed();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /142 山師のツルハシ: 0 → 1 \(\+1\)/, "店0の街では市場の上限 (wslimit×店数) で1本に収まる");
    const store = new Store(db);
    try {
      const w = store.loadWorld(T0);
      assert.deepEqual(w.wholestore.slice(138), [0, 0, 0, 1, 1]);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
