// SOLD OUT for Muse — 人口の見張り (1.7.0 P0)。式は変えず、止まっている店の割合だけを数える。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { Game } from './game.js';

/** 「止まっている」とみなす、モブに売れていない時間 (秒) */
export const IDLE_SALE_SECS = 72 * 3600;
/** これを超えたら強めに知らせる (止まっている店の割合) */
export const IDLE_WARN_RATE = 0.3;

export interface IdleShopStat {
  /** 数えた営業店 (改装中と、開店から72時間たっていない店は除く) */
  open: number;
  /** そのうち72時間モブ売上ゼロの店 */
  idle: number;
  /** idle / open (open が0なら0) */
  rate: number;
  /** 記録を始めてから72時間たったか (たつまでは数が正しくない) */
  ready: boolean;
}

/** 72時間モブ売上ゼロの営業店率 */
export function idleShopStat(g: Game): IdleShopStat {
  const since = g.world.mobsaleSince;
  const ready = since !== undefined && g.now - since >= IDLE_SALE_SECS;
  const from = g.now - IDLE_SALE_SECS;
  let open = 0;
  let idle = 0;
  for (const dt of g.shops) {
    if (dt.rest || dt.foundation > from) continue;
    open++;
    if (!(dt.lastmobsale !== undefined && dt.lastmobsale >= from)) idle++;
  }
  return { open, idle, rate: open ? idle / open : 0, ready };
}

/** 管理者向けの1行 */
export function idleShopLine(s: IdleShopStat): string {
  return `人口の見張り: 72時間モブ売上ゼロの営業店 ${s.idle}/${s.open}店 (${(s.rate * 100).toFixed(1)}%)${s.rate > IDLE_WARN_RATE ? ` ${IDLE_WARN_RATE * 100}%超え。止まっている店を自然減に数えない案 (P1) を考える目安です` : ''}`;
}
