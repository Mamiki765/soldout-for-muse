// 0.6.0 の詫び草: ミノタウロス♀を持っている店に、干し草を頭数×10束 (所持上限まで) 一度だけ配る。
// main.ts の give-hay から呼ぶ (サーバーを止めて実行、版ごとに一度だけ)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import type { Game } from './game.js';
import { addItemSub } from './scripts.js';

const MINO = 25;
const HAY = 115;
export const APOLOGY_HAY_PER_HEAD = 10;

export interface ApologyRow {
  shop: number;
  shopname: string;
  cows: number;
  hay: number;
}

export function giveApologyHay(g: Game, perHead = APOLOGY_HAY_PER_HEAD): ApologyRow[] {
  const rows: ApologyRow[] = [];
  for (const dt of g.shops) {
    const cows = dt.item[MINO - 1] ?? 0;
    if (!dt.status || !(cows > 0)) continue;
    const hay = addItemSub(g, dt, HAY, cows * perHead);
    if (!(hay > 0)) continue;
    g.writeLog(1, dt.id, 0, `ミノタウロス♀${cows}頭のお店へ、お詫びの干し草を${hay}束お届けしました (「干し草を与えて搾る」で使えます)`);
    rows.push({ shop: dt.id, shopname: dt.shopname, cows, hay });
  }
  return rows;
}
