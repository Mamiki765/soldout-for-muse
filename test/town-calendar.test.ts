import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Game } from '../src/engine/game.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { newWorld } from '../src/engine/types.js';
import { Store } from '../src/store.js';

const NOW = 1_800_000_000;
const CYCLE = DEFAULT_CONFIG.oneDayTime;
const epoch = new Game(newWorld(NOW, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0 }, NOW).nextPeriodTime();

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
