// 1.3.0 13職を職コードごとに分ける。
// 原作の職コードは9つ (道具屋・武器屋・防具屋・山師が転職先をまとめていた) で、転職先は熟練のいちばん高い本・地図で見分けていた。
// 1.3.0 から転職先そのものを職コード (子) にする。職ボーナスは今までどおり親の職コードに付けたままで、
// 子の職は親のボーナスを全部受ける＝分ける前と遊び方は何も変わらない (剣屋にも杖屋にも武器屋のボーナスが全部付く)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import type { Shop } from './types.js';

/** 店のお金が動いた時点の職で補正する。親職のままの山師は木こりと同じ値。 */
export const MERCHANT_JOB_MULTIPLIER: Readonly<Record<string, number>> = {
  mine: 2, wood: 1.9, peddle: 1.7, cow: 1.4,
  leather: 1.3, woodwork: 1.3, deco: 1.3,
  book: 1, drug: 1, sword: 1, staff: 1, shield: 1, mail: 1,
  '': 1, material: 1.9, tool: 1.3, weapon: 1, armor: 1,
};

/** 子の職コード → 親の職コード (職ボーナスはこちらに付いている) */
export const JOB_PARENT: Record<string, string> = {
  mine: 'material',
  wood: 'material',
  leather: 'tool',
  woodwork: 'tool',
  deco: 'tool',
  sword: 'weapon',
  staff: 'weapon',
  shield: 'armor',
  mail: 'armor',
};

/** 親の職コード → [熟練を集める本・地図, 子の職コード] (転職のススメの並び) */
export const JOB_CHILDREN: Record<string, [number, string][]> = {
  material: [[9, 'mine'], [12, 'wood']],
  tool: [[16, 'leather'], [17, 'woodwork'], [66, 'deco']],
  weapon: [[20, 'sword'], [23, 'staff']],
  armor: [[21, 'shield'], [22, 'mail']],
};

/** その店に職ボーナス jobCode (データ上の職コード) が付くか。子の職は親のボーナスも受ける */
export function hasJobBonus(dt: Shop, jobCode: string): boolean {
  return jobCode === dt.job || JOB_PARENT[dt.job] === jobCode;
}

/**
 * 保存データの親の職コードを子に分ける (読み込みのたびに呼んでよい)。
 * 熟練のいちばん高い本・地図の職にする (1.2.x までの「道具屋(革細工)」の括弧と同じ決め方)。
 * いちばん高いものが並ぶ (どれも0を含む) 店は分けられないので親のまま (ボーナスは同じ)
 */
export function splitJob(dt: Shop): void {
  const children = JOB_CHILDREN[dt.job];
  if (!children) return;
  let best = '';
  let bestExp = 0;
  let tie = false;
  for (const [itemno, code] of children) {
    const exp = dt.exp[itemno] ?? 0;
    if (exp > bestExp) {
      best = code;
      bestExp = exp;
      tie = false;
    } else if (exp === bestExp) {
      tie = true;
    }
  }
  if (best && !tie) dt.job = best;
}
