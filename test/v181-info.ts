// SOLD OUT for Muse — 1.8.1 アイテム説明の書き足し (tools/v181-item-info.json) を、前の版の期待値に当てるためのテスト用の手伝い。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import type { ItemDef } from '../src/data/catalog.js';

export interface ItemInfoChange {
  item: number;
  use_name?: string;
  before: string;
  after: string;
}

export const v181Info = JSON.parse(readFileSync('tools/v181-item-info.json', 'utf8')) as { version: string; info_changes: ItemInfoChange[] };

/** 1.8.1 の説明の書き足しを当てる。その場で書き換える */
export function v181InfoItem(item: ItemDef): ItemDef {
  for (const ch of v181Info.info_changes) {
    if (ch.item !== item.no) continue;
    if (ch.use_name === undefined) {
      if (item.info === ch.before) item.info = ch.after;
      continue;
    }
    for (const u of item.uses) if (u.name === ch.use_name && u.info === ch.before) u.info = ch.after;
  }
  return item;
}
