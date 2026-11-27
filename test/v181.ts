// SOLD OUT for Muse — 1.8.1 転職のススメの説明の書き足し (tools/v181.json) を、前の版の期待値に当てるためのテスト用の手伝い。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import { BASE_ITEMS, type ItemDef } from '../src/data/catalog.js';

const v181 = JSON.parse(readFileSync('tools/v181.json', 'utf8')) as { job_change_info_suffix: string };

/** 転職のススメ (78) の13職の説明に 1.8.1 の書き足しを当てる。その場で書き換える */
export function v181Item(item: ItemDef): ItemDef {
  if (item.no !== 78) return item;
  for (const u of item.uses) {
    const book = Number(u.params?.[0] ?? 0);
    if (book) u.info += v181.job_change_info_suffix.replaceAll('{book}', BASE_ITEMS[book].name);
  }
  return item;
}
