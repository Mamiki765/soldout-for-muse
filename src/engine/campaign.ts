// 0.7.0 の転職キャンペーンと、時間の配布 (タイムシガレット)。
// - 転職のススメで職に就いた・転職したとき、1店1回だけ、その職の道具を配る (最初の就職も1回に数える)。
// - 既存店には give-time (main.ts) でタイムシガレット8本 (4時間) を一度だけ配る。職のある店はそれで配布済みとし、無職の店は就職したときにもらえる。
// - アップデートのお詫び (12〜48時間ぶん = 24〜96本) も give-time で、名前を変えて別に配る。
// 数字は soldout/2026-11-19-job-change-campaign-draft.md 第2版 (1 = 7万円、30分 = 1本 = 1万円)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import type { Game } from './game.js';
import type { Shop } from './types.js';
import { addItemSub } from './scripts.js';

export const CIGARETTE = 132;
const KIT = 37; // 修行キット
/** 配布済みの印 (店の user に版を入れる) */
export const JOB_GIFT_KEY = '_job_gift';
/** 既存店へ配るタイムシガレットの本数 (4時間) */
export const EXISTING_SHOP_CIGARETTES = 8;

/** 転職先 (転職のススメの params[0] = 熟練の集まる品番) ごとの贈り物 [品番, 個数] */
export const JOB_GIFTS: Record<number, [number, number][]> = {
  66: [[66, 1], [KIT, 2]], // 装飾細工屋: 装飾細工入門 + 技術書2冊ぶんの修行キット
  20: [[20, 1], [KIT, 1]], // 剣屋
  21: [[21, 1], [CIGARETTE, 1], [KIT, 1]], // 盾屋 (不遇の保障30分)
  22: [[22, 1], [CIGARETTE, 1], [KIT, 1]], // 鎧屋
  23: [[23, 1], [CIGARETTE, 1], [KIT, 1]], // 杖屋
  17: [[17, 1], [CIGARETTE, 2]], // 木工細工屋
  16: [[16, 1], [CIGARETTE, 3]], // 革細工屋
  15: [[15, 3], [CIGARETTE, 3]], // 薬屋 (保障1時間込み)
  10: [[10, 2], [CIGARETTE, 6]], // 本屋: 執筆キットは維持費が重いので2個だけ
  9: [[9, 7]], // 探鉱夫
  12: [[12, 7], [CIGARETTE, 2]], // 木こり (保障1時間)
  14: [[14, 7]], // 行商人
  25: [[25, 7]], // 酪農家
};

/** 転職したときに呼ぶ。配ったら文を返す (配らなければ空) */
export function giveJobGift(g: Game, dt: Shop, toolNo: number): string {
  const gift = JOB_GIFTS[toolNo];
  if (!gift || dt.user[JOB_GIFT_KEY]) return '';
  dt.user[JOB_GIFT_KEY] = '0.7.0';
  const got: string[] = [];
  for (const [no, count] of gift) {
    const n = addItemSub(g, dt, no, count);
    if (n > 0) got.push(g.items[no].name + '×' + n);
  }
  const msg = '転職のお祝いに ' + (got.join('、') || '(持てる上限で受け取れませんでした)') + ' を受け取りました (1店1回)';
  g.writeLog(0, dt.id, 0, msg);
  return msg;
}

export interface TimeGiftRow {
  shop: number;
  shopname: string;
  cigarettes: number;
}

/**
 * 店へタイムシガレットを配る (give-time)。
 * markJobGift: 既存店への4時間 (8本) のときは true。職のある店は転職のお祝いも配布済みにする。
 * アップデートのお詫び (12〜48時間ぶん) など、ほかの配布は false。
 */
export function giveShopTime(g: Game, count = EXISTING_SHOP_CIGARETTES, markJobGift = true, note = '0.7.0 のお知らせ'): TimeGiftRow[] {
  const rows: TimeGiftRow[] = [];
  for (const dt of g.shops) {
    if (!dt.status) continue;
    const n = addItemSub(g, dt, CIGARETTE, count);
    if (markJobGift && dt.job) dt.user[JOB_GIFT_KEY] ??= '0.7.0';
    if (!(n > 0)) continue;
    g.writeLog(1, dt.id, 0, `${note}: タイムシガレットを${n}本お届けしました (1本で持ち時間が30分増えます。「吸う」で使えます)`);
    rows.push({ shop: dt.id, shopname: dt.shopname, cigarettes: n });
  }
  return rows;
}
