// SOLD OUT for Muse — 商品の使用 (製作・勉強・各種の効果)。原作 auto/use.cgi, item-use.cgi の移植。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { UseDef } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import { checkWholeStore } from './market.js';
import { USE_BEFORE_FUNCS, USE_CANCEL_CHECKS, USE_FUNCS } from './scripts.js';
import type { Shop } from './types.js';

export interface UseResultLine {
  item_no: number;
  count: number;
}

/** 使用結果 ($USE->{result}) */
export interface UseResult {
  count: number;
  useitem: UseResultLine[];
  additem: UseResultLine[];
  usemsg: (string | undefined)[];
  addmsg: (string | undefined)[];
  trashmsg: string[];
  message: { resultok?: string; resultng?: string };
  /** 取得する商品 (原作 result.create) */
  create: { no: number; count: number; proba: number; message?: string }[];
  function?: string;
  function_return?: string;
  expold?: number;
}

/** 使用の引数 ($USE->{arg} を解析したもの) */
export interface UseArg {
  target?: number;
  targetidx?: number;
  count: number;
  message: string;
  select?: string;
}

/** リクエスト中の USE。原作ではリクエストごとに data/item/use/<code>.cgi を読み込んで作る */
export interface RtUse {
  def: UseDef;
  no: number;
  /** この USE を持つ商品の番号 */
  itemno: number;
  itemcode: string;
  name: string;
  scale: string;
  money: number;
  time: number;
  exptime: number;
  exp: number;
  needexp: number;
  /** 原作の arg 文字列 (target|nocount|message40 など) */
  argspec: string;
  params: (string | null)[];
  use: { no: number; count: number; proba: number; message?: string }[];
  result: UseResult;
  arg: UseArg;
  useok: boolean;
  dispok: boolean;
}

/** 商品 itemno の USE 一覧を作る (原作の require data/item/use/<code>.cgi) */
export function loadUses(g: Game, itemno: number): RtUse[] {
  const item = g.items[itemno];
  if (!item) return [];
  return item.uses.map((def) => {
    const u: RtUse = {
      def,
      no: def.no,
      itemno,
      itemcode: item.code,
      name: def.name ?? '',
      scale: def.scale ?? item.scale,
      money: def.money,
      time: def.time,
      exptime: def.exptime,
      exp: def.exp,
      needexp: def.needexp ?? 0,
      argspec: def.arg ?? '',
      params: [...def.params],
      use: def.use.map((l) => ({ no: l.item_no, count: l.count, proba: l.proba, message: l.message })),
      result: {
        count: 0,
        useitem: [],
        additem: [],
        usemsg: [],
        addmsg: [],
        trashmsg: [],
        message: {
          ...(def.okmsg ? { resultok: def.okmsg } : {}),
          ...(def.ngmsg ? { resultng: def.ngmsg } : {}),
        },
        create: def.get.map((l) => ({ no: l.item_no, count: l.count, proba: l.proba, message: l.message })),
        function: def.func ?? undefined,
      },
      arg: { count: 0, message: '' },
      useok: false,
      dispok: false,
    };
    return u;
  });
}

/** 原作 GetUseItemListSub: 各 USE が使えるか判定する (職業補正もここで掛かる) */
export function checkUses(g: Game, dt: Shop, uses: RtUse[]): RtUse[] {
  for (const u of uses) {
    const ret = checkUseItem(g, dt, u);
    if (ret === 2) u.dispok = true;
    if (ret === 1) u.useok = true;
  }
  return uses;
}

/** 原作 CheckUseItem。1=使える 2=表示だけ 0=使えない */
function checkUseItem(g: Game, dt: Shop, u: RtUse): number {
  // 原作 _job_use_<no>_<job>_ : 職業による時間などの補正
  for (const jm of u.def.jobs) {
    if (jm.job !== dt.job) continue;
    const keys = jm.key === 'times' ? (['time', 'exptime'] as const) : ([jm.key] as const);
    for (const key of keys) {
      const rec = u as unknown as Record<string, number>;
      const cur = rec[key] ?? 0;
      switch (jm.op) {
        case '+': rec[key] = cur + jm.value; break;
        case '-': rec[key] = cur - jm.value; break;
        case '*': rec[key] = cur * jm.value; break;
        case '/': rec[key] = Math.trunc(cur / jm.value); break;
        case '=': rec[key] = jm.value; break;
        default: throw new Error('未知の職業補正: ' + jm.op);
      }
    }
  }
  if ((dt.exp[u.itemno] ?? 0) < u.needexp) return 0;
  const before = u.def.func_before;
  if (before) {
    const fn = USE_BEFORE_FUNCS[`${u.itemcode}:${before}`] ?? USE_BEFORE_FUNCS[before];
    if (!fn) throw new Error(`未移植の functionbefore: ${u.itemcode}:${before}`);
    const ret = fn(g, dt, u);
    if (ret === 2) return 2;
    if (ret === 1) return 0;
  }
  for (const line of u.use) {
    if (dt.item[line.no - 1] < line.count) return 0;
  }
  return 1;
}

/** 原作 GetItemUseTime: 熟練度に応じた 1 回あたりの所要時間 */
export function itemUseTime(dt: Shop, u: RtUse): number {
  const exp = u.result.expold !== undefined ? u.result.expold : dt.exp[u.itemno] ?? 0;
  return u.time - Math.trunc(((u.time - u.exptime) * exp) / 1000);
}

/** 使用のときに必要な追加情報 */
export interface UseRequest {
  count: number;
  target?: number;
  message?: string;
  select?: string;
  /** 取り返しのつかない使い方 (棚を減らすなど) の確認 */
  confirm?: boolean;
}

/** 原作 item-use.cgi の実行部分: 引数を検査して UseItem を呼ぶ */
export function useItemAction(g: Game, dt: Shop, itemno: number, useNo: number, req: UseRequest): RtUse {
  if (itemno < 1 || itemno > g.maxItem) throw new GameError('そんなアイテムはないです。');
  if (!dt.item[itemno - 1]) throw new GameError('アイテムの在庫がありません。');
  if (req.target !== undefined && req.target !== 0 && g.shopIndex(req.target) < 0) {
    throw new GameError('標的が見つかりません');
  }
  const uses = checkUses(g, dt, loadUses(g, itemno));
  if (!uses.length) throw new GameError('使えません');
  const u = uses.find((x) => x.no === useNo);
  if (!u || !u.useok) throw new GameError('使えません');

  let message = req.message ?? '';
  const mm = /message(\d*)/.exec(u.argspec);
  if (mm) {
    const limit = Number(mm[1] || 80);
    message = escapeHtml(message);
    if (message.length > limit) throw new GameError('入力文字数が多すぎます (<>&"は4～6文字に換算されます)');
  }
  // 原作の画面では nocount の場合は個数 1 で送信される
  let count = u.argspec.includes('nocount') ? 1 : Math.trunc(req.count);
  if (!(count > 0)) count = 0;
  if (u.argspec.includes('target') && (req.target === undefined || g.shopIndex(req.target) < 0)) {
    throw new GameError('標的が見つかりません');
  }
  const cancel = u.result.function ? (USE_CANCEL_CHECKS[`${u.itemcode}:${u.result.function}`] ?? USE_CANCEL_CHECKS[u.result.function]) : undefined;
  const why = cancel?.(g, dt, u, req);
  if (why) throw new GameError(why);
  u.arg = {
    target: req.target,
    targetidx: req.target !== undefined ? g.shopIndex(req.target) : undefined,
    count,
    message,
    select: req.select,
  };
  useItem(g, dt, u, count);
  return u;
}

/** 原作 UseItem($USE,$count) */
export function useItem(g: Game, dt: Shop, u: RtUse, countIn: number): void {
  let count = countIn;
  const usetime = itemUseTime(dt, u);
  if ((dt.exp[u.itemno] ?? 0) < u.needexp) count = 0;
  if (dt.money < u.money * count) count = Math.trunc(dt.money / u.money);
  if (dt.time + usetime * count > g.now) count = Math.trunc((g.now - dt.time) / usetime);
  for (const line of u.use) {
    const itemcount = line.count * (line.proba === 0 ? 1 : count);
    if (dt.item[line.no - 1] < itemcount) count = Math.trunc(dt.item[line.no - 1] / line.count);
  }
  u.result.count = count;
  if (!count) return; // count が 0 なら失敗
  u.result.useitem = [];
  u.result.additem = [];

  g.useTime(usetime * count);
  dt.money -= u.money * count;
  dt.paytoday += u.money * count;

  for (const line of u.use) {
    let itemcount = line.proba < 1000 ? 0 : line.count * count;
    if (line.proba > 0 && line.proba < 1000) {
      for (let i = 0; i < line.count * count; i++) if (g.rand(1000) < line.proba) itemcount++;
    }
    if (itemcount) {
      dt.item[line.no - 1] -= itemcount;
      u.result.useitem.push({ item_no: line.no, count: itemcount });
      u.result.usemsg.push(line.message);
    }
  }
  for (const line of u.result.create) {
    let itemcount = line.proba < 1000 ? 0 : line.count * count;
    if (line.proba > 0 && line.proba < 1000) {
      for (let i = 0; i < line.count * count; i++) if (g.rand(1000) < line.proba) itemcount++;
    }
    if (itemcount) {
      const item = g.items[line.no];
      if (itemcount + dt.item[line.no - 1] > item.limit) {
        itemcount -= item.limit - dt.item[line.no - 1];
        u.result.trashmsg.push(`これ以上持てないので${item.name}を${itemcount}${item.scale}破棄しました`);
        g.world.wholestore[line.no - 1] += itemcount;
        itemcount = item.limit - dt.item[line.no - 1];
      }
      dt.item[line.no - 1] += itemcount;
      u.result.additem.push({ item_no: line.no, count: itemcount });
      u.result.addmsg.push(line.message);
    }
  }
  checkWholeStore(g);

  const fname = u.result.function;
  if (fname) {
    const fn = USE_FUNCS[`${u.itemcode}:${fname}`] ?? USE_FUNCS[fname];
    if (!fn) throw new Error(`未移植の function: ${u.itemcode}:${fname}`);
    const dts = u.arg.targetidx !== undefined ? g.shops[u.arg.targetidx] : undefined;
    u.result.function_return = fn(g, dt, u, { dts, count: u.result.count }) || undefined;
  }

  if (u.exp) {
    const exp = dt.exp[u.itemno] ?? 0;
    u.result.expold = exp;
    let expplus = u.exp * u.result.count;
    if (exp + expplus > 1000) expplus = 1000 - exp;
    dt.exp[u.itemno] = exp + expplus;
    let expsum = 0;
    for (const v of Object.values(dt.exp)) expsum += v;
    if (g.config.limitExp > 0 && expsum > g.config.limitExp) {
      expsum -= g.config.limitExp;
      const keys = Object.keys(dt.exp)
        .map(Number)
        .sort((a, b) => dt.exp[a] - dt.exp[b]);
      let keycnt = keys.length - 1;
      for (const k of keys) {
        if (k === u.itemno) continue;
        let expdown = Math.trunc(expsum / keycnt);
        if (dt.exp[k] < expdown) expdown = dt.exp[k];
        dt.exp[k] -= expdown;
        if (!dt.exp[k]) delete dt.exp[k];
        expsum -= expdown;
        keycnt--;
      }
    }
  }
}

/** 原作 inc-html-item-use.cgi の結果表示を文字列の配列にしたもの */
export function useResultMessages(g: Game, dt: Shop, u: RtUse): string[] {
  const out: string[] = [];
  const count = u.result.count;
  if (!count) return ['実行できませんでした'];
  if (u.result.function_return) out.push(...u.result.function_return.split('<br>').filter(Boolean));
  out.push(`${count}${u.scale}`);
  if (u.money * count) out.push(`費用:￥${u.money * count}`);
  out.push(`時間:${formatHms(itemUseTime(dt, u) * count)}`);
  for (const m of u.result.addmsg) if (m) out.push(m);
  if (u.result.additem.length) {
    if (u.result.message.resultok) out.push(u.result.message.resultok);
    out.push(...u.result.trashmsg);
    out.push(
      '入手:' +
        u.result.additem
          .map((a) => `${g.items[a.item_no].name} +${a.count} (残${dt.item[a.item_no - 1]})`)
          .join(' '),
    );
  } else if (u.result.message.resultng) {
    out.push(u.result.message.resultng);
  }
  for (const m of u.result.usemsg) if (m) out.push(m);
  if (u.result.useitem.length) {
    out.push(
      '消費:' +
        u.result.useitem
          .map((a) => `${g.items[a.item_no].name} -${a.count} (残${dt.item[a.item_no - 1]})`)
          .join(' '),
    );
  }
  return out;
}

/** 原作 EscapeHTML */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 原作 GetTime2HMS */
export function formatHms(tm: number, mode?: boolean): string {
  const s = tm % 60;
  if (tm < 60) return String(s).padStart(2, '0') + '秒';
  const m = (tm - s) % 3600;
  if (tm < 3600) return m / 60 + '分';
  const h = (tm - s - m) / 3600;
  if (h < 24 * 3) return h + '時間' + (m && !mode ? String(m / 60).padStart(2, '0') + '分' : '');
  return Math.trunc(h / 24) + '日';
}
