// SOLD OUT for Muse — 商品データ (items.json) の型と読み込み。
// items.json は tools/dump-items.pl が原作 inc-item-data.cgi から生成する。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import raw from './items.json' with { type: 'json' };

/** レシピの材料・成果物 1行 (use / get / need) */
export interface UseLine {
  item_no: number;
  count: number;
  /** 消費/取得確率 (1000=100%)。need の場合は 0 */
  proba: number;
  message?: string;
}

/** 職業による USE の補正 (例: times/2) */
export interface JobModifier {
  job: string;
  key: string;
  op: string;
  value: number;
}

/** 商品の使い方 (@@USE) */
export interface UseDef {
  no: number;
  name: string | null;
  info: string | null;
  scale: string | null;
  action: string | null;
  money: number;
  time: number;
  exptime: number;
  exp: number;
  needexp: number | null;
  arg: string | null;
  argmessage: string | null;
  argselect: string | null;
  params: (string | null)[];
  use: UseLine[];
  get: UseLine[];
  okmsg: string | null;
  ngmsg: string | null;
  func: string | null;
  func_before: string | null;
  func_info: string | null;
  local_func: string | null;
  local_func_before: string | null;
  local_func_info: string | null;
  jobs: JobModifier[];
}

/** 商品 (@@ITEM) */
export interface ItemDef {
  no: number;
  sort: number;
  type: number;
  code: string;
  name: string;
  info: string;
  scale: string;
  price: number;
  cost: number;
  pricebase: number;
  pricehalf: number;
  limit: number;
  wslimit: number;
  popular: number;
  plus: number;
  point: number;
  param: string | null;
  flag: string;
  func: string | null;
  functurn: string | null;
  funcsale: string | null;
  funcbuy: string | null;
  local_func: string | null;
  local_functurn: string | null;
  local_funcsale: string | null;
  local_funcbuy: string | null;
  uses: UseDef[];
}

/** イベントによる商品パラメータの変更 */
export interface EventParam {
  item_no: number;
  key: string;
  op: string;
  value: number;
}

/** イベント (@@EVENT) */
export interface EventDef {
  code: string;
  group: string;
  startproba: number;
  auto_start: boolean;
  basetime: number;
  plustime: number;
  info: string | null;
  startmsg: string | null;
  endmsg: string | null;
  startfunc: string | null;
  startfuncparam: string | null;
  endfunc: string | null;
  endfuncparam: string | null;
  nowfunc: string | null;
  nowfuncparam: string | null;
  params: EventParam[];
}

interface CatalogFile {
  town_type: string;
  errors: string[];
  define: Record<string, string>;
  items: ItemDef[];
  events: EventDef[];
}

const file = raw as unknown as CatalogFile;

if (file.errors.length) {
  throw new Error('items.json の生成時にエラーがありました: ' + file.errors.join(' / '));
}

const define = file.define;

function num(key: string): number {
  const v = define[key];
  if (v === undefined || v === '') return 0;
  return Number(v);
}

/** 商品データの定数 (原作 data/item/item.cgi の変数に対応) */
export const CATALOG = {
  townType: file.town_type,
  version: define.version,
  heroName: define.HERO_NAME,
  /** 陳列棚維持費 (@SHOWCASE_COST)。index = 棚の数-1 */
  showcaseCost: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => num('costshowcase' + i)),
  /** 最大資金 ($MAX_MONEY) */
  maxMoney: num('maxmoney'),
  /** 陳列棚操作時間 ($TIME_EDIT_SHOWCASE) */
  timeEditShowcase: num('timeeditshowcase'),
  /** アイテム仕入/送信時間 ($TIME_SEND_ITEM) */
  timeSendItem: num('timesenditem'),
  /** 資金送信時間 ($TIME_SEND_MONEY) */
  timeSendMoney: num('timesendmoney'),
  /** 入金所要時間計算用金額 ($TIME_SEND_MONEY_PLUS) */
  timeSendMoneyPlus: num('timesendmoneyplus'),
  /** アイテム分類 (@ITEMTYPE)。index = type 番号 */
  itemTypes: Array.from({ length: 11 }, (_, i) => define['type' + i] ?? ''),
  /** 職業 (%JOBTYPE) code → 名前 */
  jobTypes: Object.fromEntries(
    Object.keys(define)
      .filter((k) => /^job-[a-z]+$/.test(k))
      .map((k) => [k.slice(4), define[k]]),
  ) as Record<string, string>,
  newShopMoney: num('NewShopMoney'),
  /** 初期持ち時間(秒)。原作では "12*60*60" のような式で書かれている */
  newShopTime: evalTimeExpression(define.NewShopTime ?? ''),
  /** 初期所持商品 (名前:個数:名前:個数...) */
  newShopItem: define.NewShopItem ?? '',
};

/** "12*60*60" のような掛け算だけの式を計算する（原作の eval の代わり） */
function evalTimeExpression(expr: string): number {
  if (!expr) return 0;
  if (!/^[\d*\s]+$/.test(expr)) throw new Error('NewShopTime の式が想定外です: ' + expr);
  return expr.split('*').reduce((acc, v) => acc * Number(v.trim()), 1);
}

/** 原作どおり 1 始まり。index 0 はダミー (原作の「なし」) */
export const BASE_ITEMS: ItemDef[] = [];
for (const item of file.items) BASE_ITEMS[item.no] = item;
/** 最大商品番号 ($MAX_ITEM) */
export const MAX_ITEM = BASE_ITEMS.length - 1;

/** イベント定義 (%EVENT)。auto_start=false のものも含む */
export const EVENTS: Map<string, EventDef> = new Map(file.events.map((e) => [e.code, e]));

export function itemNoByName(name: string): number {
  for (const item of file.items) {
    if (item.name === name || item.code === name) return item.no;
  }
  throw new Error('商品が見つかりません: ' + name);
}
