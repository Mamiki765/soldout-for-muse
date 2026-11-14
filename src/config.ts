// SOLD OUT for Muse — 原作 _config.cgi のうちゲームの動きに関わる設定値。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

/** ゲームの設定値。原作 _config.cgi の同名変数に対応する。 */
export interface GameConfig {
  /** 新装開店許可最大店舗数 ($MAX_USER) */
  maxUser: number;
  /** 最短更新サイクル(秒) ($UPDATE_TIME) */
  updateTime: number;
  /** 未ログイン登録抹消期限(秒) ($EXPIRE_TIME) */
  expireTime: number;
  /** 未ログイン登録抹消期限延長時間(秒)、経営期間1日毎 ($EXPIRE_EX_TIME) */
  expireExTime: number;
  /** 未ログイン登録抹消期限最大(秒) ($EXPIRE_MAX_TIME) */
  expireMaxTime: number;
  /** 決算サイクル(秒) ($ONE_DAY_TIME) */
  oneDayTime: number;
  /** 決算時刻をずらす秒数 ($DATE_REVISE_TIME) */
  dateReviseTime: number;
  /** GMTからの時差 ($TZ_JST) */
  tzOffset: number;
  /** 最大持ち時間(秒) ($MAX_STOCK_TIME) */
  maxStockTime: number;
  /**
   * 週1の時間クーポン(秒)。0 なら無し。この移植で追加 (案: リカさんより)。
   * 行動の時間はクーポンから先に使い、足りない分を持ち時間から使う。
   * 毎週 couponWeekday 曜 couponHour 時 (tzOffset の時刻) にこの量へ戻る (繰り越さない)。
   * 持ち時間の上限 maxStockTime とは別枠で、クーポンを使っている間も持ち時間はたまる。
   */
  couponTime: number;
  /** クーポンが戻る曜日 (0=日 … 6=土) */
  couponWeekday: number;
  /** クーポンが戻る時刻 (時) */
  couponHour: number;
  /** 最近の出来事の保存期限(秒) ($LOG_EXPIRE_TIME)。実際はこの2倍保存される */
  logExpireTime: number;
  /** 点数計算の際考慮する過去の純利益(期) ($PROFIT_DAY_COUNT) */
  profitDayCount: number;
  /** 売れ行き倍率 ($SALE_SPEED) */
  saleSpeed: number;
  /** 人気自然減少率 ($POP_DOWN_RATE) */
  popDownRate: number;
  /** 熟練度の合計値リミット 0:上限無し ($LIMIT_EXP) */
  limitExp: number;
  /** 決算時に自然減少する熟練度ポイント ($EXP_DOWN_POINT) */
  expDownPoint: number;
  /** 決算時に自然減少する熟練度割合 ($EXP_DOWN_RATE) */
  expDownRate: number;
  /** ギルド無所属の店舗に課すペナルティ率 ($GUILD_UNATTACH_PENALTY) */
  guildUnattachPenalty: number;
  /** 店舗名として使用できない文字列 (@NG_SHOP_NAME) */
  ngShopName: string[];
}

export const DEFAULT_CONFIG: GameConfig = {
  maxUser: 100,
  updateTime: 60 * 5,
  expireTime: 3600 * 24 * 7,
  expireExTime: 3600 * 4,
  expireMaxTime: 3600 * 24 * 14,
  oneDayTime: 3600 * 27,
  dateReviseTime: 0,
  tzOffset: 60 * 60 * 9,
  maxStockTime: 48 * 60 * 60,
  couponTime: 48 * 60 * 60,
  couponWeekday: 0,
  couponHour: 0,
  logExpireTime: 3600 * 24,
  profitDayCount: 3,
  saleSpeed: 10,
  popDownRate: 5,
  limitExp: 0,
  expDownPoint: 5,
  expDownRate: 60,
  guildUnattachPenalty: 0,
  ngShopName: ['管理', '馬鹿', '阿呆'],
};
