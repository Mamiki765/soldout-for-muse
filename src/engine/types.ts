// SOLD OUT for Muse — ゲームの状態の型。原作 data.cgi の中身に対応する。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

/**
 * 店舗 1 件。原作の $DT (@DTindexnamelist の各項目＋棚・倉庫など)。
 * 原作で未定義(=0)になりうる数値は 0 で持つ。
 */
export interface Shop {
  id: number;
  /** 最後に行動した時刻 (秒) */
  lastlogin: number;
  /** ログイン名 (原作の name)。この移植では API の識別名 */
  name: string;
  shopname: string;
  /** 資金 */
  money: number;
  /**
   * 持ち時間の基準時刻 (秒)。(現在時刻 - time) が持ち時間。上限は maxStockTime。
   * 行動すると time が進む。
   */
  time: number;
  /** 人気 0〜10000 (10000=100%) */
  rank: number;
  showcasecount: number;
  comment: string;
  saleyesterday: number;
  saletoday: number;
  costyesterday: number;
  rankingcount: number;
  pointyesterday: number;
  /** 前期の順位。新規店は 0 (原作では '') */
  rankingyesterday: number;
  paytoday: number;
  payyesterday: number;
  profitstock: number;
  costtoday: number;
  taxyesterday: number;
  /** 入金庫 (売上はここに入る。資金へは入金処理で移す) */
  moneystock: number;
  taxtoday: number;
  guild: string;
  /** 開店日時 */
  foundation: number;
  job: string;
  /** 陳列棚の商品番号 (0=空) */
  showcase: number[];
  /** 陳列棚の価格 */
  price: number[];
  /** 倉庫。index = 商品番号-1 */
  item: number[];
  itemyesterday: Record<number, number>;
  itemtoday: Record<number, number>;
  /** 熟練度。商品番号 → 0〜1000 */
  exp: Record<number, number>;
  /** 拡張データ (原作の user) */
  user: Record<string, string>;
  /** 点数 (保存しない。SortDT で再計算) */
  point: number;
  /** 1=営業中 0=閉店処理済み (保存しない) */
  status: number;
}

/**
 * 最近の出来事 1 件。原作 log-s0/s1 の 1 行。
 * 原作は 1 日ごとにファイルを世代交代して 1〜2 日分を残していた。
 * この移植では保存側 (store) が通し番号を付けて、logExpireTime の 2 倍より古いものを消す。
 */
export interface LogEntry {
  time: number;
  /** 0:通常 1:重要 2:街の出来事 3:噂 */
  mode: number;
  /** 0 なら街全体、店舗 id ならその店だけの記録 */
  from: number;
  to: number;
  msg: string;
}

/** 街全体の状態。原作 data.cgi のヘッダ部分。 */
export interface World {
  /** 最後に売上計算した時刻 ($DTlasttime) */
  lasttime: number;
  /** 街の人口 ($DTpeople) */
  people: number;
  /** 次の店舗 id ($DTnextid) */
  nextid: number;
  /** 市場の在庫。index = 商品番号-1 ($DTwholestore) */
  wholestore: number[];
  /** 開催中のイベント。code → 終了時刻 (%DTevent)。挿入順を保つ */
  events: Record<string, number>;
  /** 街の拡張データ ($DTtown) */
  town: Record<string, string>;
  shops: Shop[];
  /** 前回の決算のときの出来事 (原作 period.cgi)。古い順 */
  periodLog: LogEntry[];
  /** 買い取り募集 (原作にない追加。古い保存データには無い) */
  orders?: BuyOrder[];
  /** 最後に付けた募集の番号 */
  orderSeq?: number;
  /** 募集・納品の今日の回数 (決算で空になる) */
  orderStats?: OrderStats;
}

/** 買い取り募集 1 件 (engine/orders.ts) */
export interface BuyOrder {
  id: number;
  /** 募集した店 */
  shop: number;
  item: number;
  /** 単価 */
  price: number;
  /** 募集した数 */
  count: number;
  /** まだ届いていない数 */
  left: number;
  /** 1回の納品の最低数 (0 なら指定なし) */
  min: number;
  /** 預り金の残り (円) */
  escrow: number;
  /** 募集のときに先に払った取引時間 (秒) */
  time: number;
  /** time のうち時間クーポンから払った分 (秒)。戻すときはクーポンへ (配られた週が同じときだけ) */
  coupon?: number;
  /** coupon を払った週 (Game.couponWeekStart) */
  couponWeek?: number;
  created: number;
  expires: number;
}

export interface OrderStats {
  /** 決算の区切りの番号 */
  period: number;
  /** 店id → 今日出した募集の数 */
  posted: Record<string, number>;
  /** 店id → 今日応じた募集の数 */
  filled: Record<string, number>;
  /** "売り手>買い手" → 今日納品したか */
  pairs: Record<string, number>;
}

export function newShop(id: number, maxItem: number): Shop {
  return {
    id,
    lastlogin: 0,
    name: '',
    shopname: '',
    money: 0,
    time: 0,
    rank: 0,
    showcasecount: 0,
    comment: '',
    saleyesterday: 0,
    saletoday: 0,
    costyesterday: 0,
    rankingcount: 0,
    pointyesterday: 0,
    rankingyesterday: 0,
    paytoday: 0,
    payyesterday: 0,
    profitstock: 0,
    costtoday: 0,
    taxyesterday: 0,
    moneystock: 0,
    taxtoday: 0,
    guild: '',
    foundation: 0,
    job: '',
    showcase: [],
    price: [],
    item: new Array(maxItem).fill(0),
    itemyesterday: {},
    itemtoday: {},
    exp: {},
    user: {},
    point: 0,
    status: 1,
  };
}

/** 画面に出す人口。内部の値は10倍で持っている (原作 inc-html-ranking.cgi の int($DTpeople/10)) */
export const shownPeople = (w: { people: number }): number => Math.trunc(w.people / 10);

/** 原作 admin.cgi の初期化と同じ初期状態 (人口100000, 次のid 100) */
export function newWorld(now: number, maxItem: number): World {
  return {
    lasttime: now,
    people: 100000,
    nextid: 100,
    wholestore: new Array(maxItem).fill(0),
    events: {},
    town: {},
    shops: [],
    periodLog: [],
  };
}
