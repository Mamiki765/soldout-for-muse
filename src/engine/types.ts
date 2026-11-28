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
  /** 職レベルの累計作業秒数。熟練を共有する品は同じ品番に加算する。 */
  joblvpt?: Record<number, number>;
  /** 決算までに到達した職レベルと、前回の決算で上がった品。 */
  joblvReached?: Record<number, number>;
  joblvNotice?: { at: number; raised: Record<number, number> };
  /** 商人レベルの累計ポイントと、今期動かした職補正後の金額 (円)。 */
  merchantpt?: number;
  merchantYen?: number;
  merchantNotice?: { at: number; lv: number };
  /** 移し替え後に店主が digest を読むまで残す。 */
  fairyBackfillNotice?: boolean;
  /** 1.4.0 より前の働きを職・商人ポイントに足した時刻 (1.4.1)。1店1回きり */
  fairyBackfilledAt?: number;
  /** 拡張データ (原作の user) */
  user: Record<string, string>;
  /**
   * 今期の品物の維持費の内訳 (原作にない追加)。品番 → [倉庫, 募集の預かり, 陳列で安くなった額] の累計 (円、端数あり)。
   * 古い保存データには無い (engine/costs.ts)
   */
  costitems?: Record<number, [number, number, number]>;
  /** 内訳の記録を始める前にたまっていた今期の品物の維持費 (円、端数あり) */
  costuntracked?: number;
  /** 決算で引いた維持費の明細。新しい順に COST_REPORT_KEEP 件まで */
  costreports?: CostReport[];
  /**
   * 本・地図の傷み (1.1.0)。品番 → [傷み g, 寿命 T]。1回使うごとに今の壊れる確率ぶん g が増え、
   * g が T (0.7〜1.3、平均1) に届いたら1冊壊れる。古い保存データには無い (engine/scripts.ts の addBookWear)
   */
  bookwear?: Record<number, [number, number]>;
  /**
   * 改装中 (休業、1.1.0)。原作にない追加。since=始めた時刻、min=これより前は再開できない (始めた期の決算の時刻)、
   * until=この時刻に自動で再開する。改装中の店は売れず・費用もかからず、街の店数・ランキング・賞から外れる (engine/rest.ts)
   */
  rest?: ShopRest;
  /** 最後にモブ (街の客) に売れた時刻 (1.7.0 人口の見張り)。まだ記録がなければ無い */
  lastmobsale?: number;
  /** ほしい物リスト (品番、1.7.0)。上限なし */
  wish?: number[];
  /** これまで改装中だった秒数の合計。不在閉店の延長 (営業日数ぶん) の計算から引く */
  resttotal?: number;
  /** 点数 (保存しない。SortDT で再計算) */
  point: number;
  /** 1=営業中 0=閉店処理済み (保存しない) */
  status: number;
}

/** 決算で引いた維持費の明細 (engine/costs.ts) */
export interface CostReport {
  /** 決算の時刻 */
  at: number;
  /** 維持費の合計 (= showcase + items)。決算で資金から引いた額 (costyesterday と同じ) */
  total: number;
  /** 棚の維持費 */
  showcase: number;
  showcasecount: number;
  /** 品物の維持費 (今期の累計の1円未満切り捨て) */
  items: number;
  /** items のうち内訳の記録を始める前の分 */
  untracked: number;
  /** items のうち品物に配れなかった差 (ふつうは 0) */
  adjust: number;
  /** [品番, 倉庫, 募集の預かり, 陳列で安くなった額] (円)。items = Σ倉庫 + Σ預かり + untracked + adjust */
  lines: [number, number, number, number][];
  /** 同じ決算で引いた入金庫の税 (維持費ではない。参考) */
  tax: number;
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
  /** 段 3 などでも「街の噂」として商店街の酒場に流す印 (保存はしない。1.8.0) */
  news?: true;
}

/** 街全体の状態。原作 data.cgi のヘッダ部分。 */
export interface World {
  /** 最後に売上計算した時刻 ($DTlasttime) */
  lasttime: number;
  /** 累計納税の記録を始めた Unix 秒。旧版からの最初の時間更新と同時に保存する */
  taxTrackingStartedAt?: number;
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
  /** 1.9.0 市場の掘り出し物 (客に売れた素材の還流)。古い保存データには無い */
  resale?: ResaleState;
  /** モブ売上の時刻を記録し始めた時刻 (1.7.0)。これより前の売上は lastmobsale に無い */
  mobsaleSince?: number;
  /** 最後に付けた募集の番号 */
  orderSeq?: number;
  /** 募集・納品の今日の回数 (決算で空になる) */
  orderStats?: OrderStats;
  /** 今期に改装中 (休業) へ入った店の、入る前の今期の売れ数 (品番 → 個数)。決算の値動きの記録に足して空にする (1.1.0) */
  restsold?: Record<number, number>;
  /** 今期ここまでの相場・市場の単価の最安・最高 (engine/prices.ts。0.6.0 から。決算で空になる) */
  mstat?: PriceStat;
}

/** 今期ここまでの値動き。items は品番 → [相場の最安, 相場の最高, 単価の最安, 単価の最高] (見ていなければ 0) */
export interface PriceStat {
  /** 記録を始めた時刻 (前の決算、または 0.6.0 にしてから最初に見た時刻) */
  since: number;
  items: Record<string, [number, number, number, number]>;
}

/** 改装中 (休業) の期間 (engine/rest.ts) */
export interface ShopRest {
  since: number;
  min: number;
  until: number;
}

/** 期限切れのときの自動の張り直し方 (engine/orders.ts) */
export type OrderRenew = 'extend' | 'repost' | 'forever';

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
  /** 募集の期限の長さ (時間)。延長・再掲で同じ長さを足す (自動の張り直しより前の募集には無い) */
  hours?: number;
  /**
   * 期限切れのときの扱い (無ければ締める)。
   * extend: 1個も届いていなければ同じ長さだけ無料で延長 / repost: 回数を決めて有料で再掲 / forever: 無期限で有料で再掲
   */
  renew?: OrderRenew;
  /** repost の残り回数 */
  repeat?: number;
  /** これまでに延長・再掲した回数 (表示用) */
  renewed?: number;
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
  /** 店id → 今期受け取った納品のお礼の数 (1.7.0。古い保存データには無い) */
  thanked?: Record<string, number>;
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
    joblvpt: {},
    merchantpt: 0,
    user: {},
    costitems: {},
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

/** 1.9.0 掘り出し物の枠。どれも品番 → 個数 */
export interface ResaleState {
  /** 掘り出し物の在庫 */
  stock: Record<number, number>;
  /** 今期 (前の決算から) の記録: 戻った数・市場で買われた数・上限で戻せなかった数 */
  today: Record<number, ResaleCount>;
  /** 前期の記録 */
  yesterday: Record<number, ResaleCount>;
}

export interface ResaleCount {
  made: number;
  bought: number;
  rejected: number;
}
