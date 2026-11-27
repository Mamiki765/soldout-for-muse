// SOLD OUT for Muse — 保存からの試算・起動時の移し替え・通知。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { App } from '../src/api/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { applyFairyBackfill, fastestSkillSeconds, planFairyBackfill, type FairyBackfillSnapshot } from '../src/engine/fairy-backfill.js';
import { Game } from '../src/engine/game.js';
import { settleJoblv } from '../src/engine/joblv.js';
import { MERCHANT_CAP_PER_PERIOD } from '../src/engine/merchant.js';
import { newWorld, type World } from '../src/engine/types.js';
import { Store } from '../src/store.js';

const NOW = 1_800_000_000;
/** 熟練100%までの最短秒数 (職ボーナスつき)。レシピの時間から出る */
const seconds = fastestSkillSeconds();
const skillPt = (exp: number) => Math.round((seconds[MINE] * exp) / 1000);
const MINE = 9;

function legacy() {
  const world = newWorld(NOW, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.5 }, NOW);
  const dt = openShop(g, { name: 'legacy', shopname: '前からある店' });
  dt.foundation = NOW - 3 * DEFAULT_CONFIG.oneDayTime;
  dt.job = 'mine';
  dt.exp[MINE] = 250;
  delete dt.joblvpt;
  delete dt.merchantpt;
  return { g, dt, world };
}

const snap = (world: World, sales = 0n, deposit = 0n): FairyBackfillSnapshot =>
  ({ world, salesTax: () => sales, depositTax: () => deposit });

test('職ボーナス・熟練条件付きの最短秒数を使い、同じ店の過去最大の熟練と決算の上限から試算する', () => {
  const { dt, world } = legacy();
  const before = structuredClone(world);
  const backup = structuredClone(world);
  backup.shops[0].exp[MINE] = 600;
  const differentShop = structuredClone(world);
  differentShop.shops[0].foundation--;
  differentShop.shops[0].exp[MINE] = 1000;
  // 探鉱夫は半分。初めの20回は鉄鉱山、200pt以降の80回は砂鉄の河床が最短。
  // 秒数はレシピの時間 (データ) から出るので、ここでは数字を書かない。熟練 x‰ ぶんの働きは「熟練100%までの秒数 × x/1000」
  assert.ok(seconds[MINE] > 0);
  assert.ok(seconds[itemNoByName('広告パック')] > 0, '広告パックには専用の職がなくても試算できる');
  const rows = planFairyBackfill(snap(world, 10n ** 20n), DEFAULT_CONFIG, [snap(backup), snap(differentShop)]);
  assert.deepEqual(rows, [{ id: dt.id, shopname: dt.shopname, joblvpt: { [MINE]: skillPt(600) }, merchantpt: 3 * MERCHANT_CAP_PER_PERIOD }]);
  assert.deepEqual(world, before, '試算で街を更新しない');
  assert.equal(applyFairyBackfill(world, rows, NOW), 1);
  assert.equal(dt.joblvReached?.[MINE], 2);
  assert.equal(dt.fairyBackfilledAt, NOW);
  assert.equal(applyFairyBackfill(world, rows, NOW), 0, '1店1回きり');
  assert.deepEqual(planFairyBackfill(snap(world, 30n), DEFAULT_CONFIG, [snap(backup)]), []);
});

test('1.4.0 で貯まったポイントは消さず、1.4.0 より前の時点の分だけを足す', () => {
  const { dt, world } = legacy();
  const pre = structuredClone(world);
  pre.shops[0].exp[MINE] = 600;
  pre.shops[0].saleyesterday = 400_000;
  pre.shops[0].payyesterday = 100_000;
  // 1.4.0 で働いた後: 熟練は上がり、ポイントも少し貯まっている。この時点の熟練・売上は数えない。
  dt.exp[MINE] = 900;
  dt.joblvpt = { [MINE]: 5_000 };
  dt.joblvReached = {};
  dt.merchantpt = 50;
  dt.merchantYen = 3_000;
  dt.saleyesterday = 9_000_000;
  const rows = planFairyBackfill(snap(world, 10n ** 9n, 10n ** 9n), DEFAULT_CONFIG, [snap(pre, 99_000n, 1_000n)]);
  // 前期の売上と仕入れ 50万円 × 探鉱夫2.0 = 1,000点 > 税からの下限 (10万+9.9万+1千円) × 2.0 = 400点
  assert.deepEqual(rows, [{ id: dt.id, shopname: dt.shopname, joblvpt: { [MINE]: skillPt(600) }, merchantpt: 1_000 }]);
  assert.equal(applyFairyBackfill(world, rows, NOW), 1);
  assert.equal(dt.joblvpt[MINE], skillPt(600) + 5_000);
  assert.equal(dt.merchantpt, 1_050);
  assert.equal(dt.merchantYen, 3_000, '今期の分はそのまま');
  // バックアップがなく、今の街にも 1.4.0 前の時点がない店は何も足さない。
  const { world: touched } = legacy();
  touched.shops[0].joblvpt = { [MINE]: 1 };
  touched.shops[0].merchantpt = 1;
  assert.deepEqual(planFairyBackfill(snap(touched, 10n ** 9n)), []);
});

test('期ごとの実績はその時点の職で補正し、後で転職したバックアップを足しても変わらない', () => {
  const { world } = legacy();
  const old = structuredClone(world);
  old.shops[0].saleyesterday = 500_000;
  const later = structuredClone(world);
  later.shops[0].job = 'book';
  later.lasttime += DEFAULT_CONFIG.oneDayTime * 2;
  const one = planFairyBackfill(snap(world), DEFAULT_CONFIG, [snap(old)]);
  const two = planFairyBackfill(snap(world), DEFAULT_CONFIG, [snap(old), snap(later)]);
  assert.equal(one[0].merchantpt, 1_000);
  assert.equal(two[0].merchantpt, 1_000);
});

test('まだ決算を迎えていない 1.4.0 の段も、移した後のレベルも、決算で知らせ直さない', () => {
  const { dt, world, g } = legacy();
  dt.joblvpt = { [MINE]: 19_200 };
  dt.joblvReached = {};
  const pre = structuredClone(world);
  delete pre.shops[0].joblvpt;
  pre.shops[0].exp[MINE] = 700;
  assert.equal(applyFairyBackfill(world, planFairyBackfill(snap(world), DEFAULT_CONFIG, [snap(pre)]), NOW), 1);
  settleJoblv(dt, g.now);
  assert.equal(dt.joblvNotice, undefined);
});

test('期ごとの実績は1期2,000点で頭打ちにし、同じ期は大きい方だけ数える', () => {
  const { dt, world } = legacy();
  dt.job = 'book';
  const a = structuredClone(world);
  a.shops[0].saleyesterday = 5_000_000;
  const b = structuredClone(world);
  b.shops[0].saleyesterday = 700_000;
  b.shops[0].saletoday = 300_000;
  const rows = planFairyBackfill(snap(world), DEFAULT_CONFIG, [snap(a), snap(b)]);
  assert.equal(rows[0].merchantpt, MERCHANT_CAP_PER_PERIOD + 300);
});

test('試算コマンドは現在・過去のファイルを読み取り専用で使い、保存済み欄を触らない', () => {
  const { dt, world } = legacy();
  const dir = mkdtempSync(join(tmpdir(), 'soldout-backfill-'));
  try {
    const file = join(dir, 'soldout.sqlite');
    const backup = join(dir, '11.json');
    const snapshot = structuredClone(world);
    snapshot.shops[0].exp[MINE] = 800;
    writeFileSync(backup, JSON.stringify(snapshot));
    const store = new Store(file);
    store.createOwner({ shopId: dt.id, name: dt.name, nameSource: 'local', now: dt.foundation });
    dt.joblvpt = {}; // 値が空でも、保存済みなら今の熟練からは移さない (1.4.0 で働いた分と重なる)。
    store.saveWorld(world, [], NOW, 86400,
      () => store.addTaxTotals(new Map([[dt.id, { sales: 990_000n, deposit: 9_900_000n }]])));
    store.close();
    const bytes = readFileSync(file);
    const result = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning', 'tools/fairy-backfill/report.mjs', file, '--backup', backup,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    // 熟練は1.4.0前のバックアップの80%から。商人は売上税99万円→売上100万+税99万+入金庫税990万、探鉱夫2.0倍、3期の上限まで。
    assert.deepEqual(report.shops, [{ id: dt.id, shopname: dt.shopname, joblvpt: { [MINE]: skillPt(800) }, merchantpt: 3 * MERCHANT_CAP_PER_PERIOD }]);
    assert.equal(report.summary.merchant_points, 3 * MERCHANT_CAP_PER_PERIOD);
    assert.deepEqual(readFileSync(file), bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('起動時は有効にしたときだけ保存し、合鍵では初回 digest の案内を消さない', async () => {
  const { dt, world } = legacy();
  const store = new Store(':memory:');
  store.saveWorld(world, [], NOW, 86400);
  store.addToken(dt.id, 'so_test_fairy_migration', NOW);
  store.addViewKey(dt.id, 'vk_test_fairy_migration', 0, 'fixed');
  const opt = { store, clock: () => NOW };
  const ordinary = new App(opt);
  assert.equal(ordinary.world.shops[0].joblvpt, undefined);
  assert.equal(ordinary.world.shops[0].merchantpt, undefined);
  const migrated = new App({ ...opt, fairyBackfill: [] });
  const saved = store.loadWorld(NOW).shops[0];
  assert.deepEqual(saved.joblvpt, { [MINE]: skillPt(250) });
  assert.equal(saved.merchantpt, undefined, '数えられる商いがなければ欄を作らない');
  assert.equal(saved.fairyBackfillNotice, true);
  const app = new App({ ...opt, fairyBackfill: [] });
  assert.deepEqual(app.world.shops[0].joblvpt, migrated.world.shops[0].joblvpt);
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/digest`;
  const digest = async (token: string) => {
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(res.status, 200);
    return res.text();
  };
  const notice = /今までの働きぶんを入れました/;
  try {
    assert.doesNotMatch(await digest('vk_test_fairy_migration'), notice);
    assert.match(await digest('so_test_fairy_migration'), notice);
    assert.doesNotMatch(await digest('so_test_fairy_migration'), notice);
    assert.equal(store.loadWorld(NOW).shops[0].fairyBackfillNotice, undefined);
  } finally {
    server.close();
    store.close();
  }
});
