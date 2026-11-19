// SOLD OUT for Muse — 見張り (peek) のための判定。原作にない追加機能。
// 各 Muse の番犬スクリプトが短い間隔で GET /api/v1/peek を読み、ここで判定したアラートがあるときだけ Muse を起こす。
// ここは「読むだけ」: 時間を進めない・保存しない・最後の行動時刻も変えない
// (時間計算の回数が増えると人気の自然減が増えるため。値は最後に時間計算した時点 as_of のもの)。
// 案: アキさん (トリガー式アラート)、ミュートさん (as-of、起こすラインは各 Muse の番犬で)、ラピス (2026-11-15)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { createHash } from 'node:crypto';
import { CATALOG, EVENTS } from '../data/catalog.js';
import type { Game } from './game.js';
import { onShelf } from './onshelf.js';
import { orders } from './orders.js';
import type { Shop } from './types.js';

/** アラートの重さ。番犬はこれと type を見て起こすかを決める */
export type AlertLevel = 'critical' | 'high' | 'mid' | 'low';

export interface Alert {
  /** 'admin' は管理者として許可した店にだけ出す (ALERT_TYPES には入れない。設定でも選べない) */
  type: AlertType | 'admin';
  level: AlertLevel;
  /** 同じ状態のあいだ変わらない鍵。番犬はこれで「もう知らせた」を判断する */
  key: string;
  msg: string;
}

export const ALERT_TYPES = [
  'bankrupt_risk',
  'closing_soon',
  'shelf1_low',
  'shelves_empty',
  'period_soon',
  'coupon_expiring',
  'soldout_soon',
  'event',
  'order_closed',
  'order_discard',
  'time_full',
  'wanted',
  'on_shelf',
  'update',
  'mail',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * プリセット (省トークン = save が既定)。飼い主さんに見せる名前は 節約 / ふつう / Power向け、
 * 「おまかせ」はサーバー側では normal にして、起きるかどうかを Muse が facts を見て決める使い方 (案: ミュートより)
 */
export const ALERT_MODES: Record<'save' | 'normal' | 'power' | 'off', readonly AlertType[]> = {
  // mail (郵便の未読、0.7.0) は返事を待っている相手がいるので、節約でも届ける
  save: ['bankrupt_risk', 'closing_soon', 'shelf1_low', 'shelves_empty', 'period_soon', 'coupon_expiring', 'update', 'mail'],
  normal: ['bankrupt_risk', 'closing_soon', 'shelf1_low', 'shelves_empty', 'period_soon', 'coupon_expiring', 'soldout_soon', 'event', 'order_closed', 'order_discard', 'time_full', 'update', 'mail'],
  power: ALERT_TYPES,
  off: [],
};
export type AlertMode = keyof typeof ALERT_MODES;

/** プリセットの別名 (日本語や旧名でも受け付ける) */
export const ALERT_MODE_ALIASES: Record<string, AlertMode> = {
  節約: 'save', ふつう: 'normal', 普通: 'normal', power: 'power', Power向け: 'power', all: 'power', おまかせ: 'normal', omakase: 'normal', なし: 'off',
};

export function alertMode(x: unknown): AlertMode | undefined {
  const k = String(x ?? '').trim();
  if (k in ALERT_MODES) return k as AlertMode;
  return ALERT_MODE_ALIASES[k] ?? ALERT_MODE_ALIASES[k.toLowerCase()];
}

/** 判定のきまり (時間は秒) */
export const WATCH_RULES = {
  /** 決算の何秒前から period_soon */
  periodSoon: 2 * 3600,
  /** 不在閉店の何秒前から closing_soon */
  closingSoon: 2 * 86400,
  /** クーポンがこれ以上残っていて */
  couponLeft: 12 * 3600,
  /** 戻るまでこれ以内なら coupon_expiring */
  couponSoon: 6 * 3600,
  /** 1番棚がこの時間以内に空く見込みなら soldout_soon */
  soonFirst: 4 * 3600,
  /** ほかの棚は、この時間以内に空く見込みの棚が2つ以上で soldout_soon */
  soonOther: 6 * 3600,
  /** 持ち時間が満タンまでこれ以内なら time_full (やることがあるときだけ) */
  timeFull: 3 * 3600,
  /** 他店の募集が標準価格のこの%以上なら wanted */
  wantedPercent: 120,
  /** 自分の募集が締まった知らせを出し続ける時間 */
  orderClosedFor: 24 * 3600,
};

/** 店ごとの設定 (Shop.user に JSON で保存) */
export const ALERT_SETTING = '_alerts';

export interface AlertSetting {
  mode: AlertMode;
  on: AlertType[];
  off: AlertType[];
}

export function alertSetting(dt: Shop): AlertSetting {
  try {
    const s = JSON.parse(dt.user[ALERT_SETTING] ?? '') as Partial<AlertSetting>;
    const mode = alertMode(s.mode) ?? 'save';
    const pick = (a: unknown): AlertType[] => (Array.isArray(a) ? a.filter((x): x is AlertType => (ALERT_TYPES as readonly string[]).includes(x)) : []);
    return { mode, on: pick(s.on), off: pick(s.off) };
  } catch {
    return { mode: 'save', on: [], off: [] };
  }
}

export function enabledTypes(s: AlertSetting): Set<AlertType> {
  const set = new Set<AlertType>(ALERT_MODES[s.mode]);
  for (const t of s.on) set.add(t);
  for (const t of s.off) set.delete(t);
  return set;
}

/** 時刻 t のあとに来る決算の時刻 (Game.nextPeriodTime は最後の時間計算からなので、こちらは任意の時刻で) */
export function periodAfter(g: Game, t: number): number {
  const offset = g.config.tzOffset - g.config.dateReviseTime;
  const x = t + offset;
  return x + g.config.oneDayTime - (x % g.config.oneDayTime) - offset;
}

/**
 * いまの倉庫・棚・募集の預かり分にかかる維持費 (1日あたり)。時間計算 (turn.ts) と同じ数え方:
 * 棚に並べている品は 1/10、買い取り募集で預かり中の品は受け取る店の倉庫にあるものとして数える。
 */
export function costPerDay(g: Game, dt: Shop): number {
  const shown = new Set<number>();
  for (let i = 0; i < dt.showcasecount; i++) {
    const no = dt.showcase[i] ?? 0;
    if (no && dt.item[no - 1]) shown.add(no);
  }
  let sum = 0;
  for (let no = 1; no <= g.maxItem; no++) {
    const c = dt.item[no - 1];
    if (!c) continue;
    sum += g.items[no].cost * (shown.has(no) ? c / 10 : c);
  }
  for (const o of g.world.orders ?? []) {
    if (o.shop === dt.id && o.count > o.left) sum += g.items[o.item].cost * (o.count - o.left);
  }
  return sum;
}

/**
 * 次の決算でいくら引かれるかの見込み (原作 period.cgi の順: 当期の維持費＋棚の維持費＋入金庫の税)。
 * 当期の維持費は「ここまでの額」に、いまの倉庫・棚・預かり分のまま決算まで置いたときの額を足す。
 * (0.3.3 までは「ここまでの額 ÷ 経過時間」で伸ばしていたので、最近仕入れた品の分を見落としていた。監査 A06)
 * 売上は入れない (悪いほうに見る)。
 */
export function periodEstimate(g: Game, dt: Shop, asOf = g.world.lasttime) {
  const next = periodAfter(g, asOf);
  const costSoFar = Math.trunc(dt.costtoday);
  const costProjected = Math.trunc(dt.costtoday + (costPerDay(g, dt) * Math.max(0, next - asOf)) / 86400);
  const showcaseCost = CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0;
  const [tax, taxRate] = g.taxToday(dt);
  const total = costProjected + showcaseCost + tax;
  const available = dt.money + dt.moneystock;
  return {
    next_period: next,
    cost_so_far: costSoFar,
    cost_projected: costProjected,
    showcase_cost: showcaseCost,
    tax,
    tax_rate: taxRate,
    total,
    available,
    /** 足りない額 (0 なら足りる) */
    short: Math.max(0, total - available),
  };
}

/** peek の order_closed に出す募集の記録 (DB から先に絞るための言葉。下の正規表現と合わせる) */
export const ORDER_CLOSED_WORDS = ['を集め終わりました', 'を期限切れで終了'];

/** 最後の行動からの不在閉店の時刻 (原作 turn.cgi 末尾) */
export function closingAt(g: Game, dt: Shop): number {
  return dt.lastlogin + g.config.expireTime + g.expireTimeExtend(dt);
}

export interface PeekShelf {
  slot: number;
  item: number;
  name: string;
  price: number;
  stock: number;
  /** 今の売れ行きで空くまでの見込み (秒)。売れていなければ null */
  empty_in: number | null;
}

export interface PeekLog {
  id: number;
  time: number;
  msg: string;
}

/** 見張りの結果 (事実＋アラート) */
export function peekData(g: Game, dt: Shop, myLogs: PeekLog[] = []) {
  const w = g.world;
  const now = g.now;
  const asOf = w.lasttime;
  const setting = alertSetting(dt);
  const on = enabledTypes(setting);
  const alerts: Alert[] = [];
  const add = (a: Alert) => {
    if (a.type !== 'admin' && on.has(a.type)) alerts.push(a);
  };

  // ---- 事実
  const est = periodEstimate(g, dt, asOf);
  const periodStart = est.next_period - g.config.oneDayTime;
  const elapsed = asOf - periodStart;
  const shelves: PeekShelf[] = [];
  for (let i = 0; i < dt.showcasecount; i++) {
    const no = dt.showcase[i] ?? 0;
    const stock = no ? dt.item[no - 1] : 0;
    let emptyIn: number | null = null;
    if (no && stock > 0) {
      // 今期の売れ行き。始まって1時間たっていなければ前期の売れ行きで見る
      const rate = elapsed >= 3600 ? (dt.itemtoday[no] ?? 0) / elapsed : (dt.itemyesterday[no] ?? 0) / g.config.oneDayTime;
      // 見込みなので分単位に丸める
      if (rate > 0) emptyIn = Math.max(0, Math.round((stock / rate - (now - asOf)) / 60) * 60);
    } else if (no) emptyIn = 0;
    shelves.push({ slot: i + 1, item: no, name: no ? g.items[no].name : '', price: no ? dt.price[i] : 0, stock, empty_in: emptyIn });
  }
  const stockTime = g.stockTime(dt);
  const timeFullIn = Math.max(0, g.config.maxStockTime - stockTime);
  const coupon = g.couponTime(dt);
  const couponReset = g.nextCouponTime();
  const closeAt = closingAt(g, dt);
  const myItems = new Set<number>();
  for (let i = 0; i < g.maxItem; i++) if (dt.item[i]) myItems.add(i + 1);
  for (const s of shelves) if (s.item) myItems.add(s.item);
  // イベントの終わる時刻は出さない (原作でも見えない先の情報。抜き取られると有利になる)。説明と、自分の品に関係するかだけ
  const events: { code: string; info: string; mine: boolean }[] = [];
  for (const code of Object.keys(w.events)) {
    const ev = EVENTS.get(code);
    const mine = !!ev?.params.some((p) => myItems.has(p.item_no));
    events.push({ code, info: ev?.info ?? code, mine });
  }

  // ---- アラート
  // 決算の時刻は as_of ではなく今から数える (as_of が古くて決算をまたいでいても、次の決算を指すように)
  const nextPeriod = periodAfter(g, now);
  // as_of のあとの決算時刻をもう過ぎているのに、まだ計算していない (次のアクセスで決算する)。
  // 見込み (est) は過ぎたほうの決算のもの。鍵も同じ決算に結びつける (監査 A08)
  const periodPending = est.next_period <= now;
  if (est.short > 0) {
    const key = periodPending ? `bankrupt:${est.next_period}:pending` : `bankrupt:${nextPeriod}:${stage(nextPeriod - now, [6 * 3600, 2 * 3600])}`;
    const head = periodPending ? '決算の時刻を過ぎていて、まだ反映されていません (次のアクセスで計算)。倒産の恐れ' : 'このままだと決算で倒産の恐れ';
    add({ type: 'bankrupt_risk', level: 'critical', key, msg: `${head}: 見込み支払い￥${est.total} (維持費${est.cost_projected}+棚${est.showcase_cost}+税${est.tax}) に対し資金+入金庫￥${est.available}、不足￥${est.short}` });
  }
  if (closeAt - now <= WATCH_RULES.closingSoon) {
    // 期限を過ぎていれば、次の街の計算で閉店する。行動がその計算より先に届けば間に合うが、確かではない (監査 A08)
    const msg = closeAt <= now
      ? '不在閉店の期限を過ぎています。次の街の計算で閉店します (すぐ行動すれば間に合うこともありますが、確かではありません)'
      : `行動が無いまま${hours(closeAt - now)}で不在閉店します (見るだけでは延びません。何か1つ行動してください)`;
    add({ type: 'closing_soon', level: 'critical', key: `closing:${dt.lastlogin}:${closeAt <= now ? 'past' : stage(closeAt - now, [86400, 6 * 3600])}`, msg });
  }
  const s1 = shelves[0];
  if (s1 && (!s1.item || s1.stock <= 1)) {
    add({ type: 'shelf1_low', level: 'high', key: `shelf1:${s1.item}`, msg: s1.item ? `1番棚の${s1.name}が${s1.stock ? '残り1' : '売切'}` : '1番棚が空' });
  }
  const emptyOthers = shelves.slice(1).filter((s) => !s.item || s.stock === 0);
  if (emptyOthers.length >= 2) {
    add({ type: 'shelves_empty', level: 'mid', key: `shelves:${emptyOthers.map((s) => s.slot).join(',')}`, msg: `棚${emptyOthers.map((s) => s.slot).join('・')}が空/売切` });
  }
  if (nextPeriod - now <= WATCH_RULES.periodSoon) {
    add({ type: 'period_soon', level: 'high', key: `period:${nextPeriod}`, msg: `決算まで${hours(nextPeriod - now)}` + (est.tax ? ` 入金庫の税の見込み￥${est.tax} (${est.tax_rate}%、入金庫100万を超えた分)` : '') + ` 見込み支払い￥${est.total}` });
  }
  if (coupon >= WATCH_RULES.couponLeft && couponReset - now <= WATCH_RULES.couponSoon) {
    add({ type: 'coupon_expiring', level: 'mid', key: `coupon:${couponReset}`, msg: `時間クーポンが${hours(coupon)}残ったまま、${hours(couponReset - now)}後に戻ります (繰り越しなし)` });
  }
  const soonFirst = s1?.item && s1.stock > 1 && s1.empty_in !== null && s1.empty_in <= WATCH_RULES.soonFirst ? s1 : undefined;
  const soonOthers = shelves.slice(1).filter((s) => s.item && s.stock > 0 && s.empty_in !== null && s.empty_in <= WATCH_RULES.soonOther);
  if (soonFirst || soonOthers.length >= 2) {
    const list = [...(soonFirst ? [soonFirst] : []), ...(soonOthers.length >= 2 ? soonOthers : [])];
    add({ type: 'soldout_soon', level: 'mid', key: `soon:${list.map((s) => `${s.slot}-${s.item}`).join(',')}`, msg: '売り切れ見込み ' + list.map((s) => `棚${s.slot}${s.name}あと約${hours(s.empty_in ?? 0)}`).join(' ') });
  }
  for (const e of events) {
    if (e.mine) add({ type: 'event', level: 'mid', key: `event:${e.code}`, msg: `あなたの品に関係するイベント: ${e.info}` });
  }
  for (const l of myLogs) {
    if (now - l.time > WATCH_RULES.orderClosedFor) continue;
    if (/^募集#\d+ .*を(集め終わりました|期限切れで終了)/.test(l.msg)) add({ type: 'order_closed', level: 'mid', key: `order:${l.id}`, msg: l.msg });
  }
  let wantedCount = 0;
  const discards = discardPlan(g, dt);
  for (const o of orders(g)) {
    if (o.expires <= now) continue;
    const it = g.items[o.item];
    if (o.shop === dt.id) {
      const over = discards.get(o.id) ?? 0;
      if (over > 0) add({ type: 'order_discard', level: 'mid', key: `discard:${o.id}`, msg: `募集#${o.id}を締めると${it.name}が所持上限を${over}${it.scale}超えて破棄` });
      continue;
    }
    if (!dt.item[o.item - 1] || !g.shopById(o.shop)) continue;
    if (o.price * 100 < it.price * WATCH_RULES.wantedPercent) continue;
    wantedCount++;
    add({ type: 'wanted', level: 'low', key: `wanted:${o.id}`, msg: `あなたの在庫の${it.name}を募集#${o.id}が単価￥${o.price}で募集中 (残り${o.left}${it.scale})` });
  }
  // 欲しい品 (自分の募集の品・材料だけ足りない作り方の材料) がほかの店の棚にある。仕入れのチャンス (Power向けだけ)
  if (on.has('on_shelf')) {
    for (const x of onShelf(g, dt, now)) {
      const it = g.items[x.item];
      add({ type: 'on_shelf', level: 'low', key: `onshelf:${x.item}`, msg: `${x.why === 'order' ? '募集中の' : '材料の'}${it.name}がほかの店の棚に${x.shops}店 (最安 店${x.shop} ￥${x.cheapest})。GET /api/v1/shops?item=${x.item}` });
    }
  }
  const somethingToDo = shelves.some((s) => !s.item || s.stock === 0) || wantedCount > 0;
  if (timeFullIn <= WATCH_RULES.timeFull && somethingToDo) {
    add({ type: 'time_full', level: 'low', key: `timefull:${dt.time}`, msg: timeFullIn ? `持ち時間があと${hours(timeFullIn)}で満タン` : '持ち時間が満タン (溢れています)' });
  }

  // 次に「時間で」鳴る予定 (番犬がそれまで見張りを間引けるように)
  const timed: number[] = [];
  // 今まさに鳴っている時刻のものは、その次の回も入れる (決算前の2時間に読んだとき、次の決算の予告を飛ばさないように)
  if (on.has('period_soon')) timed.push(nextPeriod - WATCH_RULES.periodSoon, nextPeriod + g.config.oneDayTime - WATCH_RULES.periodSoon);
  // 重い知らせは段階ごとに鍵が変わるので、その切り替わりの時刻も入れる (next_timed まで寝る番犬が見逃さないように)
  if (on.has('closing_soon')) timed.push(closeAt - WATCH_RULES.closingSoon, closeAt - 86400, closeAt - 6 * 3600);
  if (on.has('bankrupt_risk') && est.short > 0) timed.push(nextPeriod - 6 * 3600, nextPeriod - 2 * 3600);
  if (on.has('coupon_expiring')) {
    if (coupon >= WATCH_RULES.couponLeft) timed.push(couponReset - WATCH_RULES.couponSoon);
    // 次の週はクーポンが満タンから始まる
    if (g.config.couponTime >= WATCH_RULES.couponLeft) timed.push(couponReset + 7 * 86400 - WATCH_RULES.couponSoon);
  }
  const nextTimed = timed.filter((t) => t > now).sort((a, b) => a - b)[0] ?? null;

  return {
    as_of: asOf,
    now,
    /** as_of から何秒たっているか (値の古さ) */
    age: now - asOf,
    alerts,
    next_timed: nextTimed,
    setting: { mode: setting.mode, on: setting.on, off: setting.off, enabled: [...on] },
    facts: {
      // digest・me と同じ整数の% (内部の細かい値は出さない)
      popularity: Math.trunc(dt.rank / 100),
      money: dt.money,
      moneystock: dt.moneystock,
      time: stockTime,
      time_full_in: timeFullIn,
      coupon,
      coupon_reset: couponReset,
      closing_at: closeAt,
      /** pending: 決算の時刻を過ぎたが、まだ計算していない (この見込みは過ぎたほうの決算のもの) */
      period: { ...est, pending: periodPending },
      shelves,
      events,
    },
  };
}

/** アラートの鍵の短い印 (cursor 用) */
export function alertMark(key: string): string {
  return createHash('sha1').update(key).digest('base64url').slice(0, 6);
}

/**
 * 重いアラートの段階。残り時間が区切り (降順) を下回るたびに段階が上がり、鍵が変わるので、番犬にはもう一度「新着」として届く
 * (例: 不在閉店は 2日前 → 1日前 → 6時間前。案: GPT レビューより)
 */
/**
 * 自分の募集を締めたときに、所持上限を超えて捨てられる数 (募集ごと)。
 * 同じ品の募集が複数あれば、締まる順 (並び順) に前の募集の預かり分を足して数える
 */
export function discardPlan(g: Game, dt: Shop): Map<number, number> {
  const held = new Map<number, number>();
  const out = new Map<number, number>();
  for (const o of orders(g)) {
    if (o.shop !== dt.id) continue;
    const got = o.count - o.left;
    if (got <= 0) continue;
    const before = held.get(o.item) ?? 0;
    held.set(o.item, before + got);
    const room = g.items[o.item].limit - dt.item[o.item - 1] - before;
    const over = Math.min(got, got - Math.max(0, room));
    if (over > 0) out.set(o.id, over);
  }
  return out;
}

function stage(left: number, marks: number[]): number {
  return marks.filter((m) => left <= m).length;
}

function hours(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) return `${Math.floor(h / 24)}日${h % 24}時間`;
  return h ? `${h}時間${m}分` : `${m}分`;
}
