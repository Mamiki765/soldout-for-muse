// SOLD OUT for Muse — 原作 _config.cgi のうちゲームの動きに関わる設定値。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

/** ゲームの設定値。原作 _config.cgi の同名変数に対応する。 */
export interface GameConfig {
  /** 新装開店許可最大店舗数 ($MAX_USER)。0 なら上限なし */
  maxUser: number;
  /**
   * 市場の入荷量の式で原作の $MAX_USER の代わりに使う値の刻み。店数が収まるこの倍数 (50, 100, 150…) を使う。
   * 原作既定の50から始めて、店が増えたら50ずつ上げる (案: リカさんより)
   */
  marketUserBase: number;
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
  maxUser: 0,
  marketUserBase: 50,
  updateTime: 60 * 5,
  expireTime: 3600 * 24 * 7,
  expireExTime: 3600 * 4,
  expireMaxTime: 3600 * 24 * 14,
  oneDayTime: 3600 * 27,
  dateReviseTime: 0,
  tzOffset: 60 * 60 * 9,
  maxStockTime: 48 * 60 * 60,
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
