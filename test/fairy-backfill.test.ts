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
import { MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { applyFairyBackfill, fastestSkillSeconds, planFairyBackfill } from '../src/engine/fairy-backfill.js';
import { Game } from '../src/engine/game.js';
import { MERCHANT_CAP_PER_PERIOD } from '../src/engine/merchant.js';
import { newWorld } from '../src/engine/types.js';
import { Store } from '../src/store.js';

const NOW = 1_800_000_000;
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

test('職ボーナス・熟練条件付きの最短秒数を使い、同じ店の過去最大の熟練と決算の上限から試算する', () => {
  const { dt, world } = legacy();
  const before = structuredClone(world);
  const backup = structuredClone(world);
  backup.shops[0].exp[MINE] = 600;
  const differentShop = structuredClone(world);
  differentShop.shops[0].foundation--;
  differentShop.shops[0].exp[MINE] = 1000;
  // 探鉱夫は半分。初めの20回は鉄鉱山、200pt以降の80回は砂鉄の河床が最短。
  assert.equal(fastestSkillSeconds()[MINE], 440_640);
  const rows = planFairyBackfill(world, () => 10n ** 20n, DEFAULT_CONFIG, [backup, differentShop]);
  assert.deepEqual(rows, [{ id: dt.id, shopname: dt.shopname, joblvpt: { [MINE]: 264_384 }, merchantpt: 3 * MERCHANT_CAP_PER_PERIOD }]);
  assert.deepEqual(world, before, '試算で街を更新しない');
  assert.equal(applyFairyBackfill(world, rows), 1);
  assert.equal(dt.joblvReached?.[MINE], 2);
  assert.equal(applyFairyBackfill(world, rows), 0);
  assert.deepEqual(planFairyBackfill(world, () => 30n), []);
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
    dt.joblvpt = {}; // 値が空でも、保存済みなら過去の熟練からは移さない。
    store.saveWorld(world, [], NOW, 86400,
      () => store.addTaxTotals(new Map([[dt.id, { sales: 990_000n, deposit: 9_900_000n }]])));
    store.close();
    const bytes = readFileSync(file);
    const result = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning', 'tools/fairy-backfill/report.mjs', file, '--backup', backup,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.shops, [{ id: dt.id, shopname: dt.shopname, merchantpt: 1000 }]);
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
  assert.deepEqual(saved.joblvpt, { [MINE]: 110_160 });
  assert.equal(saved.merchantpt, 0);
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
