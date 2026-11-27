// SOLD OUT for Muse — 1.8.2 アイテム説明の書き足し: 説明に書いた数字が、データ (params) と合っているか。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_ITEMS, itemNoByName } from '../src/data/catalog.js';
import { v182 } from './v182.js';

const use = (item: string, name: string) => {
  const u = BASE_ITEMS[itemNoByName(item)].uses.find((x) => x.name === name);
  if (!u) throw new Error(`${item}/${name}`);
  return u;
};

test('1.8.2: 書き足した説明が items.json に入っている', () => {
  assert.equal(v182.info_changes.length, 27);
  for (const ch of v182.info_changes) {
    const it = BASE_ITEMS[ch.item];
    const info = ch.use_name === undefined ? it.info : it.uses.find((u) => u.name === ch.use_name)?.info;
    assert.equal(info, ch.after, `${it.name}/${ch.use_name ?? ''}`);
  }
});

test('1.8.2: 説明の数字がデータと合っている', () => {
  // 資金調達の方法: params[0] 円 × 回数
  assert.equal(use('資金調達の方法', 'ティッシュ配りで資金稼ぎ').params[0], '3000');
  assert.equal(use('資金調達の方法', '日雇い土木作業で資金稼ぎ').params[0], '10000');
  // 広告 (popup): 人気50% (rank 5000) で params[0]/100 %
  assert.equal(use('広告パック', 'ビラ配りで広告する').params[0], '200');
  assert.equal(use('広告パック', 'ポスターで広告する').params[0], '400');
  assert.equal(use('広告パック', 'キャンペーンで広告する').params[0], '1000');
  assert.equal(use('お祝いセット', 'お祝いパーティ').params[0], '1000');
  // 乳を搾る: 寿命は1回 p1*p1/1000 (0.1% と 0.4%)
  assert.equal(use('ミノタウロス♀', '乳を搾る').params[0], '1');
  assert.equal(use('ミノタウロス♀', 'ハードに乳を搾る').params[0], '2');
  // 剣市の2倍は剣の市場の使い方だけ
  assert.equal(use('剣市への地図', '剣の市場へ仕入に行く').func_before, '_local_b1');
  // 効果なしと書いた使い方は、関数も成果物も無い
  for (const [item, name] of [['七面鳥の丸焼き', '食べる'], ['こだわりのラム酒', '飲む'], ['おしゃれブーツ', '履いてお出かけする'], ['ミノヨーグルト', '食べる'], ['ミノチーズ', '食べる']]) {
    const u = use(item, name);
    assert.equal(u.func, null, item);
    assert.equal(u.get.length, 0, item);
  }
});
