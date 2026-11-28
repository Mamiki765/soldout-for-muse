// SOLD OUT for Muse — 商品データ (items.json) の型と読み込み。
// items.json は tools/dump-items.pl が原作定義＋Muse追加定義から生成する。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import raw from './items.json' with { type: 'json' };
import refRaw from './item-ref.json' with { type: 'json' };

/** レシピの材料・成果物 1行 (use / get / need) */
export interface UseLine {
  item_no: number;
  count: number;
  /** 消費/取得確率 (1000=100%)。need の場合は 0 */
  proba: number;
  /** 取得行の端数。1セットにつき、1個ぶんの抽選に掛ける割合 (1000分率)。 */
  fraction?: number;
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
  /** 新版の市場初期投入で一度だけ足す個数。定期入荷には使わない。 */
  seedmarket?: number;
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
  /** 熟練の共有: この品の使い方は、この品番の熟練で時間が縮み、熟練もそこに入る (Muse 追加。無ければ自分) */
  expitem?: number;
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
  /** 1.9.0 客に売れた素材のうち、市場の掘り出し物の枠へ戻す割合 (千分率) */
  resaleRate: num('resalerate'),
  /** 1.9.0 plus が0以下の品の、掘り出し物の卸値の倍率 (千分率) */
  bargainPrice: num('bargainprice'),
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

// ---------------------------------------------------------------------------
// 商品の公開範囲と、入手の補足 (item-ref.json)
//   visibility: 品番 → "hidden" (一覧では「品番 ？？？」、ほかでは無い品と同じ) / "teaser" (名前だけ予告)。
//               書いていない品はすべて公開。
//   notes:      レシピの表から自動では逆引きできない入手方法 (from: [[道具の品番, 使い方の番号], ...]) と一言


export type ItemVisibility = 'public' | 'hidden' | 'teaser';

interface ItemRefFile {
  visibility: Record<string, string>;
  notes: Record<string, { from?: [number, number][]; note?: string }>;
}

const ref = refRaw as unknown as ItemRefFile;
const VISIBILITY = new Map<number, ItemVisibility>();
for (const [k, v] of Object.entries(ref.visibility)) {
  if (v !== 'hidden' && v !== 'teaser') throw new Error(`item-ref.json: 品番${k} の公開範囲 "${v}" は hidden / teaser のどちらかです`);
  VISIBILITY.set(Number(k), v);
}

let visibilityVersion = 0;

/** 公開範囲を書き換える (テスト用)。v を省くと公開に戻す */
export function overrideItemVisibility(no: number, v?: Exclude<ItemVisibility, 'public'>): void {
  if (v) VISIBILITY.set(no, v);
  else VISIBILITY.delete(no);
  visibilityVersion++;
}

/** 公開範囲が変わるたびに増える (逆引きの索引を作り直すため) */
export function itemVisibilityVersion(): number {
  return visibilityVersion;
}

/** 隠した品の名前の代わり */
export const HIDDEN_NAME = '？？？';

export function itemVisibility(no: number): ItemVisibility {
  return VISIBILITY.get(no) ?? 'public';
}

export function isPublicItem(no: number): boolean {
  return !VISIBILITY.has(no);
}

/** 道具 tool の使い方 useNo が、処理で隠した品を出すか (notes.from に書いた関係) */
export function makesHiddenItem(tool: number, useNo: number): boolean {
  for (const [no, v] of VISIBILITY) {
    if (v && ref.notes[String(no)]?.from?.some(([t, u]) => t === tool && u === useNo)) return true;
  }
  return false;
}

/** 入手の補足。from は [道具の品番, 使い方の番号]。from の道具が隠されていれば一言 (note) は返さない */
export function itemNote(no: number): { from: [number, number][]; note?: string } {
  const n = ref.notes[String(no)];
  const from = n?.from ?? [];
  // 一言は道具の名前を書くことが多い。道具を隠しているあいだは一言も出さない
  const showNote = !!n?.note && from.every(([t]) => isPublicItem(t));
  return { from, ...(showNote ? { note: n!.note } : {}) };
}
