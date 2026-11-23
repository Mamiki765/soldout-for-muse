// SOLD OUT for Muse — 商いで育つ商人レベル。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { createHash } from 'node:crypto';
import { BASE_ITEMS, type ItemDef } from '../data/catalog.js';
import { progressAt } from './joblv.js';
import { JOB_PARENT } from './jobs.js';
import type { Shop } from './types.js';

export const MERCHANT_YEN_PER_POINT = 1000;
// 1.4.0 の仮値。再現できる試算は tools/merchant-cap/ を参照。
export const MERCHANT_CAP_PER_PERIOD = 1000;
export const MERCHANT_BALANCE_FINGERPRINT = 'deebae2903c9bfd7351ce1e0139fadb3a7d8858ae99333b0a3c73c4350da6f80';

/** 計算に使う職バランスの数値。説明文や翻訳の更新では変わらない。 */
export function merchantBalanceFingerprint(items: ItemDef[] = BASE_ITEMS): string {
  const recipes = items.map((it) => [
    it.no, it.expitem, it.price, it.popular, it.limit, it.cost,
    it.uses.map((u) => [
      u.no, u.time, u.exptime, u.exp, u.needexp, u.money, u.func, u.func_before, u.params,
      u.get.map(({ item_no, count, proba }) => [item_no, count, proba]),
      u.use.map(({ item_no, count, proba }) => [item_no, count, proba]),
      u.jobs.map(({ job, key, op, value }) => [job, key, op, value]),
    ]),
  ]);
  return createHash('sha256').update(JSON.stringify([recipes, JOB_PARENT])).digest('hex');
}

export function merchantData(dt: Shop) {
  return { ...progressAt(dt.merchantpt ?? 0), cap: MERCHANT_CAP_PER_PERIOD };
}

/** 期中の1,000円未満はまとめて数え、枠を超えた分はその場で捨てる。 */
export function addMerchantYen(dt: Shop, amount: number): void {
  if (amount <= 0) return;
  dt.merchantYen = Math.min((dt.merchantYen ?? 0) + amount, MERCHANT_CAP_PER_PERIOD * MERCHANT_YEN_PER_POINT);
}

export function settleMerchant(dt: Shop, at: number): void {
  const before = merchantData(dt);
  const gain = Math.floor((dt.merchantYen ?? 0) / MERCHANT_YEN_PER_POINT);
  if (gain) dt.merchantpt = before.point + gain;
  delete dt.merchantYen;
  const after = merchantData(dt);
  dt.merchantNotice = after.lv > before.lv ? { at, lv: after.lv } : undefined;
}

export function merchantTime(seconds: number, dt: Shop | undefined): number {
  const lv = dt ? merchantData(dt).lv : 0;
  return Math.trunc(seconds * 0.95 ** lv);
}
