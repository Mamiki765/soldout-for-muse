// SOLD OUT for Muse — 作業時間で育つ職レベルと、共通のポイント曲線。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS, isPublicItem, makesHiddenItem } from '../data/catalog.js';
import type { Shop } from './types.js';

export const PROGRESS_MAX_LV = 10;
export const PROGRESS_THRESHOLDS = Object.freeze([
  0, ...Array.from({ length: PROGRESS_MAX_LV }, (_, i) => 10 * (i + 2) ** 5),
]);

export function progressAt(point: number) {
  let lv = PROGRESS_MAX_LV;
  while (lv > 0 && point < PROGRESS_THRESHOLDS[lv]) lv--;
  return { lv, point, next: PROGRESS_THRESHOLDS[lv + 1] ?? null };
}

export const JOBLV_YIELD_PCT = 2;

export function joblvProgress(dt: Shop, no: number) {
  return progressAt(Math.trunc((dt.joblvpt?.[no] ?? 0) / 60));
}

const eligibleItems = [...new Set(BASE_ITEMS.flatMap((it) => {
  if (!isPublicItem(it.no)) return [];
  const expno = it.expitem ?? it.no;
  return isPublicItem(expno) && it.uses.some((u) =>
    u.exp && Math.max(u.time, u.exptime) > 0 &&
    u.get.every((line) => isPublicItem(line.item_no)) && !makesHiddenItem(it.no, u.no),
  ) ? [expno] : [];
}))];

/** 持っている品か、熟練・作業時間の記録がある品の職レベル。 */
export function joblvData(dt: Shop) {
  return Object.fromEntries(eligibleItems
    .filter((no) => dt.item[no - 1] || dt.exp[no] || dt.joblvpt?.[no])
    .map((no) => [no, joblvProgress(dt, no)]));
}

/** 営業店を均等に数える。作業記録のある品を店ごとに平均し、記録がなければ等倍。 */
export function averageJoblvYield(shops: Shop[]): number {
  const sum = shops.reduce((total, dt) => {
    const worked = Object.keys(dt.joblvpt ?? {});
    const lvs = worked.reduce((s, no) => s + joblvProgress(dt, Number(no)).lv, 0);
    return total + lvs / (worked.length || 1);
  }, 0);
  return 1 + (JOBLV_YIELD_PCT * sum) / (100 * (shops.length || 1));
}

/** 上がった品だけを記録し、次の決算まで digest に出せるようにする。 */
export function settleJoblv(dt: Shop, at: number): void {
  if (!dt.joblvpt) return;
  const raised: Record<number, number> = {};
  const reached = dt.joblvReached ??= {};
  for (const no of eligibleItems) {
    const { lv } = joblvProgress(dt, no);
    if (lv <= (reached[no] ?? 0)) continue;
    reached[no] = lv;
    raised[no] = lv;
  }
  dt.joblvNotice = Object.keys(raised).length ? { at, raised } : undefined;
}
