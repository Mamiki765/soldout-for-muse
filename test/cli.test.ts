// SOLD OUT for Muse — 管理コマンド (dist/src/main.js) の決まり。デプロイのときに本番の DB に打つものなので、
// 「二重に配らない」「変な引数は何も書かずに断る」を確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { sha256, Store } from '../src/store.js';

const CIG = 132;

function withDb(fn: (db: string, run: (...args: string[]) => ReturnType<typeof spawnSync>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'so-cli-'));
  const db = join(dir, 'so.sqlite');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/src/main.js', ...args], {
      env: { ...process.env, DB_PATH: db },
      encoding: 'utf8',
      windowsHide: true,
    });
  try {
    fn(db, run);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedShop(db: string): void {
  const store = new Store(db);
  const now = Math.floor(Date.now() / 1000);
  const world = store.loadWorld(now);
  const g = new Game(world, DEFAULT_CONFIG, { next: Math.random }, now);
  openShop(g, { name: 'mute', shopname: 'ミュート商店' });
  store.saveWorld(world, g.newLogs, now, DEFAULT_CONFIG.logExpireTime);
  store.close();
}

const cigarettes = (db: string): number => {
  const store = new Store(db);
  const w = store.loadWorld(Math.floor(Date.now() / 1000));
  store.close();
  return w.shops[0].item[CIG - 1];
};

test('set-invite: 招待コードを入れ、引数なしで消す', () => {
  withDb((db, run) => {
    assert.equal(run('set-invite', 'abc').status, 0);
    let store = new Store(db);
    assert.equal(store.getSetting('invite_hash'), sha256('abc'));
    store.close();
    assert.equal(run('set-invite').status, 0);
    store = new Store(db);
    assert.equal(store.getSetting('invite_hash'), undefined);
    store.close();
  });
});

test('set-party-invite: mip_ で始まらない値は断り、何も書かない', () => {
  withDb((db, run) => {
    assert.notEqual(run('set-party-invite', 'mct_xxx').status, 0);
    const store = new Store(db);
    assert.equal(store.getSetting('party_join_invite'), undefined);
    store.close();
  });
});

test('give-time: 同じ名前の配布は一度きり。二度目は断り、持ち物も増えない', () => {
  withDb((db, run) => {
    seedShop(db);
    const r1 = run('give-time', '4', 'cli-test');
    assert.equal(r1.status, 0, String(r1.stderr));
    const after = cigarettes(db);
    assert.ok(after > 0);
    const r2 = run('give-time', '4', 'cli-test');
    assert.notEqual(r2.status, 0);
    assert.equal(cigarettes(db), after);
    // 名前を変えれば別の配布として配れる
    assert.equal(run('give-time', '4', 'cli-test-2').status, 0);
    assert.ok(cigarettes(db) >= after);
  });
});

test('give-time: 本数や名前がおかしいときは断る', () => {
  withDb((db, run) => {
    seedShop(db);
    assert.notEqual(run('give-time', '0', 'x').status, 0);
    assert.notEqual(run('give-time', '4', 'Bad Name').status, 0);
    assert.equal(cigarettes(db), 0);
  });
});
