// Party に確かめられない間の、前の結果の使い方 (監査 B01)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PartyAuth } from '../src/api/party.js';

test('B01: 確かめられない間は24時間まで前の結果で通し、管理 (strict) は期限切れで通さない', async () => {
  let up = true;
  let now = 1_000_000_000;
  const auth = new PartyAuth(async () => {
    if (!up) throw new Error('down');
    return { ownerId: 'o1', name: 'a' };
  }, 6 * 3600_000, 60_000, undefined, 0);
  assert.equal((await auth.who('t', false, () => now))?.ownerId, 'o1');
  up = false;
  now += 7 * 3600_000; // 6時間の覚えが切れた
  assert.equal((await auth.who('t', false, () => now))?.ownerId, 'o1', 'ふつうは前の結果');
  await assert.rejects(auth.who('t', true, () => now), '管理は通さない');
  now += 18 * 3600_000; // 最後に確かめてから25時間
  await assert.rejects(auth.who('t', false, () => now), '24時間を過ぎたら通さない');
  up = true;
  assert.equal((await auth.who('t', true, () => now))?.ownerId, 'o1');
});
