// 1.3.0 山師を探鉱夫 (mine) と木こり (wood) に分ける。
// - 地図の職ボーナスは、近くの鉱山への地図 = 探鉱夫、近くの山への地図 = 木こり。
// - 1.3.0 より前に山師だった店 (元山師) は、分けたあとも両方の地図のボーナスを持ったまま。転職し直すと普通の職になる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import type { Shop } from './types.js';

/** 元山師の印 (店の user に分けた版を入れる) */
export const FORMER_MATERIAL_KEY = '_former_material';
/** 分ける前の職コード (山師) */
export const MATERIAL = 'material';
const MINE_MAP = 9;
const MOUNT_MAP = 12;

/** その店に職ボーナス jobCode が付くか。元山師 (と分けられなかった山師) は探鉱夫・木こりの両方が付く */
export function hasJobBonus(dt: Shop, jobCode: string): boolean {
  if (jobCode === dt.job) return true;
  if (jobCode !== 'mine' && jobCode !== 'wood') return false;
  return dt.job === MATERIAL || !!dt.user?.[FORMER_MATERIAL_KEY];
}

/** 元山師か (分けたあとの探鉱夫・木こりで、両方のボーナスが残っている) */
export function isFormerMaterial(dt: Shop): boolean {
  return !!dt.user?.[FORMER_MATERIAL_KEY] && (dt.job === 'mine' || dt.job === 'wood');
}

/**
 * 保存データの山師を探鉱夫か木こりに分ける (読み込みのたびに呼んでよい)。
 * 熟練の高いほうの地図の職にする。並んでいる (どちらも0を含む) 店は分けられないので山師のまま (両方のボーナスが付く)
 */
export function splitMaterialJob(dt: Shop): void {
  if (dt.job !== MATERIAL) return;
  const mine = dt.exp[MINE_MAP] ?? 0;
  const wood = dt.exp[MOUNT_MAP] ?? 0;
  if (mine === wood) return;
  dt.job = mine > wood ? 'mine' : 'wood';
  dt.user ??= {};
  dt.user[FORMER_MATERIAL_KEY] = '1.3.0';
}

/** 転職したとき: 元山師の印を外す */
export function clearFormerMaterial(dt: Shop): void {
  if (dt.user) delete dt.user[FORMER_MATERIAL_KEY];
}
