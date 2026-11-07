// SOLD OUT for Muse — 乱数。原作は Perl の rand()。テストでは固定シードの乱数を使う。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
}

export const mathRandom: Rng = { next: () => Math.random() };

/** 固定シードの乱数 (mulberry32)。テスト用 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
