// SOLD OUT for Muse — 改装中 (休業、1.1.0)。原作にない追加。
// 自分から申し出て、その期の維持費を払ったうえで店を丸ごと休ませる。
// 休んでいる間は売れず・費用もかからず、街の店数・市場・ランキング・賞から外れる (Game.shops に入らない)。
// 始めた期の決算が済むまでは再開できない。期限 (最長 REST_MAX_DAYS 日) が来たら自動で再開する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { GameError, type Game } from './game.js';
import { cancelOrder, orders } from './orders.js';
import { periodCharge, settleShop } from './period.js';
import type { Shop } from './types.js';

/** 1回に休める最長の日数 */
export const REST_MAX_DAYS = 30;

/** 改装中でもできる行動 (これ以外の行動は、再開できる時刻を過ぎていれば店を再開してから行う) */
export const REST_ALLOWED_ACTIONS: ReadonlySet<string> = new Set(['rest', 'reopen', 'alerts', 'tutorial', 'coupon', 'comment', 'rename', 'close']);

function fmt(g: Game, t: number): string {
  const d = new Date((t + g.config.tzOffset) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * 改装に入る。今期の維持費・棚の維持費・入金庫の税を、決算と同じ式でこの店だけ先に払う。
 * 出している買い取り募集は取り下げて返金する。
 * confirm が無ければ何も変えず、見込み (払う額・再開できる時刻・取り下げる募集) を「確認:」で返す (1.1.2)
 */
export function startRest(g: Game, dt: Shop, days: number, by = '', confirm = false): string[] {
  if (dt.rest) throw new GameError(`もう改装中です (${fmt(g, dt.rest.until)}に自動で再開します。早めに再開するなら {"type":"reopen"})`);
  if (!Number.isInteger(days) || days < 1 || days > REST_MAX_DAYS) throw new GameError(`days は1〜${REST_MAX_DAYS}の日数で指定してください (休める最長は${REST_MAX_DAYS}日)`);
  const charge = periodCharge(g, dt);
  if (charge > dt.money + dt.moneystock) {
    throw new GameError(`今期の維持費など ￥${charge} を払えないので、改装に入れません (資金と入金庫の合計 ￥${dt.money + dt.moneystock})`);
  }
  const mine = orders(g).filter((x) => x.shop === dt.id);
  if (!confirm) {
    const min = g.nextPeriodTime();
    const until = Math.max(min, g.now + days * 86400);
    throw new GameError(
      `確認: 改装中 (休業) に入ると、今期の維持費など ￥${charge} をすぐ払い、${fmt(g, min)} (この期の決算) までは再開できません。` +
        `${fmt(g, until)} には自動で再開します。` +
        (mine.length ? `出している買い取り募集${mine.length}件 (${mine.map((o) => '#' + o.id).join(' ')}) は取り下げて返金します。` : '') +
        '休んでいる間は売れず、ランキングと賞から外れます。よければ "confirm":true を付けて送り直してください',
    );
  }
  const msgs: string[] = [];
  for (const o of mine) msgs.push(cancelOrder(g, dt, o.id));
  // 今期ここまでの売れ数は、街の値動きの記録 (決算で書く) に残す。settleShop で店の記録は前期へ移るため
  const rs = (g.world.restsold ??= {});
  for (const [k, v] of Object.entries(dt.itemtoday)) rs[Number(k)] = (rs[Number(k)] ?? 0) + v;
  const rankNo = g.shopIndex(dt.id) + 1;
  settleShop(g, dt, g.now, rankNo);
  const min = g.nextPeriodTime();
  const until = Math.max(min, g.now + days * 86400);
  dt.rest = { since: g.now, min, until };
  g.writeLog(1, 0, 0, `${dt.shopname}は改装のため、しばらくお休みします (${fmt(g, until)}まで)`);
  g.sortShops();
  msgs.unshift(
    `${by}改装に入りました。今期の維持費など ￥${charge} を払いました。` +
      `${fmt(g, min)} (この期の決算) からは {"type":"reopen"} やほかの行動で再開でき、${fmt(g, until)} には自動で再開します。` +
      '休んでいる間は売れず、維持費もかからず、ランキングと賞から外れます',
  );
  return msgs;
}

/**
 * 改装を終えて営業を再開する。auto のとき (期限が来た) は at を再開の時刻とし、不在閉店の時計もそこから動かす。
 * 再開した期は前期の順位なし (新しく開いた店と同じく、次の決算までランキングの下側)
 */
export function endRest(g: Game, dt: Shop, at: number = g.now, auto = false): string {
  const r = dt.rest;
  if (!r) throw new GameError('改装中ではありません');
  if (!auto && at < r.min) throw new GameError(`改装はこの期の決算 (${fmt(g, r.min)}) が済むまで終われません`);
  dt.resttotal = (dt.resttotal ?? 0) + Math.max(0, at - r.since);
  delete dt.rest;
  dt.rankingyesterday = 0;
  dt.pointyesterday = 0;
  if (dt.lastlogin < at) dt.lastlogin = at;
  g.writeLog(1, 0, 0, `${dt.shopname}が改装を終えて、営業を再開しました`);
  g.sortShops();
  return '改装を終えて、営業を再開しました (人気・熟練・倉庫・棚は休む前のままです)';
}

/** 期限の来た改装中の店を再開する (時間経過の計算の最初に呼ぶ) */
export function wakeRested(g: Game): void {
  for (const dt of g.allShops) {
    if (dt.status && dt.rest && dt.rest.until <= g.now) endRest(g, dt, dt.rest.until, true);
  }
}

/**
 * 行動の前に呼ぶ。改装中で、改装中にできない行動なら、再開できる時刻を過ぎていれば再開する (そのお知らせを返す)。
 * まだ再開できなければ断る
 */
export function restGuard(g: Game, dt: Shop, type: string): string[] {
  if (!dt.rest || REST_ALLOWED_ACTIONS.has(type)) return [];
  if (g.now < dt.rest.min) {
    throw new GameError(`改装中です。この期の決算 (${fmt(g, dt.rest.min)}) が済むと、行動すれば再開できます (${fmt(g, dt.rest.until)}には自動で再開)`);
  }
  return [endRest(g, dt)];
}

/** 画面・digest 用 */
export function restInfo(dt: Shop): { since: number; reopen_from: number; until: number } | null {
  return dt.rest ? { since: dt.rest.since, reopen_from: dt.rest.min, until: dt.rest.until } : null;
}
