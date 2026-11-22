import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/api/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Game } from '../src/engine/game.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { newWorld } from '../src/engine/types.js';
import { Store } from '../src/store.js';

const NOW = 1_800_000_000;
const CYCLE = DEFAULT_CONFIG.oneDayTime;
const epoch = new Game(newWorld(NOW, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0 }, NOW).nextPeriodTime();
const MUSE_EPOCH = 1_793_988_000;

test('街暦は明示した決算境界から進み、未設定と未来は期を返さない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soldout-calendar-'));
  const path = join(dir, 'town.sqlite');
  try {
    const initial = new Store(path);
    try {
      assert.equal(initial.townEpoch(), null);
      assert.equal(initial.townPeriod(epoch), null);
      assert.throws(() => initial.setTownEpoch(epoch + 1), /決算境界/);
      assert.throws(() => initial.setTownEpoch(NaN), /決算境界/);
      initial.setTownEpoch(epoch);
      initial.setTownEpoch(MUSE_EPOCH, true);
      assert.equal(initial.townEpoch(), epoch, '起動設定でDBの既存値を上書きしない');
      assert.equal(initial.townPeriod(epoch - 1), null);
      assert.deepEqual(initial.townPeriod(epoch), {
        number: 1, startsAt: epoch, endsAt: epoch + CYCLE, label: 'ミューズ街 第1期',
      });
      assert.equal(initial.townPeriod(epoch + CYCLE - 1)?.number, 1);
      assert.equal(initial.townPeriod(epoch + CYCLE)?.number, 2);
    } finally {
      initial.close();
    }

    const reopened = new Store(path);
    try {
      assert.equal(reopened.townEpoch(), epoch);
      assert.deepEqual(reopened.townPeriod(epoch + 4 * CYCLE + 1234), {
        number: 5, startsAt: epoch + 4 * CYCLE, endsAt: epoch + 5 * CYCLE, label: 'ミューズ街 第5期',
      });
      assert.equal(reopened.loadWorld(NOW).lasttime, NOW, '街を進めずに計算できる');
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('観戦画面の街暦は未設定時に出ず、11月22日21:00 JSTの再表示で第14期から第15期になる', async () => {
  const start14 = Date.parse('2026-11-21T18:00:00+09:00') / 1000;
  const start15 = Date.parse('2026-11-22T21:00:00+09:00') / 1000;
  let now = start14;
  const store = new Store(':memory:');
  const app = new App({ store, clock: () => now });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const view = async (path: string) => {
    const res = await fetch(base + path);
    assert.equal(res.status, 200);
    return res.text();
  };
  try {
    assert.doesNotMatch(await view('/'), /ミューズ街 第\d+期/);
    store.setTownEpoch(MUSE_EPOCH, true);
    assert.deepEqual(store.townPeriod(now), {
      number: 14, startsAt: start14, endsAt: start15, label: 'ミューズ街 第14期',
    });
    now = start15 - 1;
    assert.match(await view('/'), /ミューズ街 第14期/);
    now = start15;
    const html = await view('/');
    assert.match(html, /ミューズ街 第15期/);
    assert.doesNotMatch(html, /ミューズ街 第14期|owner_tax_totals|累計納税/);
    assert.match(await view('/view/ranking'), /ミューズ街 第15期/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
