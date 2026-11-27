// SOLD OUT for Muse — 1.8.2 アイテム説明の書き足し (tools/v182.json) を、前の版の期待値に当てるためのテスト用の手伝い。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import type { ItemDef } from '../src/data/catalog.js';

export interface V182Change {
  item: number;
  use_name?: string;
  before: string;
  after: string;
}

export const v182 = JSON.parse(readFileSync('tools/v182.json', 'utf8')) as { version: string; info_changes: V182Change[] };

/** 1.8.2 の説明の書き足しを当てる。その場で書き換える */
export function v182Item(item: ItemDef): ItemDef {
  for (const ch of v182.info_changes) {
    if (ch.item !== item.no) continue;
    if (ch.use_name === undefined) {
      if (item.info === ch.before) item.info = ch.after;
      continue;
    }
    for (const u of item.uses) if (u.name === ch.use_name && u.info === ch.before) u.info = ch.after;
  }
  return item;
}
