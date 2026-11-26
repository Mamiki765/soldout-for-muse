// SOLD OUT for Muse — 1.7.0 道具3職の梱包と自分の品 (tools/v170-tool-jobs.json) を、前の版の期待値に当てるためのテスト用の手伝い。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import type { ItemDef, UseLine } from '../src/data/catalog.js';

export const v170 = JSON.parse(readFileSync('tools/v170-tool-jobs.json', 'utf8')) as {
  version: string;
  packing: { book: number; uses: string[]; time_percent: number };
  own_yield_percent: Record<string, { percent: number; items: number[] }>;
  herbs: { book: number; item: number; proba: number; routes: [string, number][] };
};

/** 品番 → 取れる数の倍率 (%) */
export const v170Own = new Map(Object.values(v170.own_yield_percent).flatMap((s) => s.items.map((no) => [no, s.percent] as const)));

/** できる品の1行に 1.7.0 の倍率を当てる (個数＋端数の期待値×倍率、四捨五入して1000分の1個まで) */
export function v170Line<T extends Pick<UseLine, 'item_no' | 'count'> & { fraction?: number }>(l: T): T {
  const pct = v170Own.get(l.item_no);
  if (!pct) return l;
  const milli = Math.floor(((l.count * 1000 + (l.fraction ?? 0)) * pct + 50) / 100);
  const { fraction: _drop, ...rest } = l;
  const out = { ...rest, count: Math.floor(milli / 1000) } as T;
  if (milli % 1000) out.fraction = milli % 1000;
  return out;
}

/** 品の定義に 1.7.0 の直しを当てる (梱包6種の時間、近くの山への地図の薬草、自分の品の取れる数)。その場で書き換える */
export function v170Item(item: ItemDef): ItemDef {
  for (const u of item.uses) {
    if (item.no === v170.packing.book && v170.packing.uses.includes(u.name!)) {
      u.time = Math.trunc((u.time * v170.packing.time_percent) / 100);
      u.exptime = Math.trunc((u.exptime * v170.packing.time_percent) / 100);
    }
    const herb = item.no === v170.herbs.book && v170.herbs.routes.find(([name]) => name === u.name);
    if (herb) {
      const line = u.get.find((l) => l.item_no === v170.herbs.item);
      if (line) Object.assign(line, { count: herb[1], proba: v170.herbs.proba });
      else u.get.push({ item_no: v170.herbs.item, count: herb[1], proba: v170.herbs.proba });
    }
    u.get = u.get.map(v170Line);
  }
  return item;
}
