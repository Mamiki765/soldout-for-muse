// SOLD OUT for Muse — 商品の使用 (製作・勉強・各種の効果)。原作 auto/use.cgi, item-use.cgi の移植。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { HIDDEN_NAME, isPublicItem, makesHiddenItem, type UseDef } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import { checkWholeStore } from './market.js';
import { durabilityLine, USE_BEFORE_FUNCS, USE_CANCEL_CHECKS, USE_FUNCS, wearStep } from './scripts.js';
import { gatherToolFor } from './gather-tools.js';
import type { Shop } from './types.js';
import { hasJobBonus } from './jobs.js';
import { JOBLV_YIELD_PCT, joblvProgress } from './joblv.js';

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
  create: { no: number; count: number; proba: number; fraction?: number; message?: string }[];
  function?: string;
  function_return?: string;
  expold?: number;
  /** count が 0 になった理由 (結果の「実行できませんでした」に添える) */
  failReason?: string;
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
  /** 熟練を読み書きする商品の番号 (ふつうは itemno。熟練の共有があればその先) */
  expno: number;
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
  /** 使えないときの理由 (熟練・材料・道具など)。Muse が次に何をすればよいか分かるように */
  ngReason?: string;
}

/** 商品 itemno の USE 一覧を作る (原作の require data/item/use/<code>.cgi) */
export function loadUses(g: Game, itemno: number): RtUse[] {
  const item = g.items[itemno];
  if (!item) return [];
  // 隠した品 (item-ref.json) が成果に入る使い方は、無いものとして扱う (名前からも品が分かってしまうため)。
  // 処理で品を出す使い方 (ミノタウロス♀の乳搾りなど) は item-ref.json の notes.from で分かる
  return item.uses.filter((def) => def.get.every((l) => isPublicItem(l.item_no)) && !makesHiddenItem(itemno, def.no)).map((def) => {
    const u: RtUse = {
      def,
      no: def.no,
      itemno,
      itemcode: item.code,
      expno: item.expitem ?? itemno,
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
        create: def.get.map((l) => ({ no: l.item_no, count: l.count, proba: l.proba, fraction: l.fraction, message: l.message })),
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
    if (ret !== 1) u.ngReason = useNgReason(g, dt, u);
    if (ret === 2) u.dispok = true;
    if (ret === 1) u.useok = true;
  }
  return uses;
}

/** 原作 CheckUseItem。1=使える 2=表示だけ 0=使えない */
function checkUseItem(g: Game, dt: Shop, u: RtUse): number {
  // 原作 _job_use_<no>_<job>_ : 職業による時間などの補正
  for (const jm of u.def.jobs) {
    if (!hasJobBonus(dt, jm.job)) continue;
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
  if ((dt.exp[u.expno] ?? 0) < u.needexp) return 0;
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

/** 使えない理由を短く (熟練 → 材料・道具の順。どちらでもなければ条件) */
function useNgReason(g: Game, dt: Shop, u: RtUse): string {
  const exp = dt.exp[u.expno] ?? 0;
  if (exp < u.needexp) return `熟練が足りません (${isPublicItem(u.expno) ? g.items[u.expno].name : HIDDEN_NAME}の熟練が要${u.needexp / 10}%、今${exp / 10}%)`;
  const short = u.use.filter((l) => dt.item[l.no - 1] < l.count).map((l) => `${isPublicItem(l.no) ? g.items[l.no].name : HIDDEN_NAME}x${l.count}${l.proba === 0 ? '(道具)' : ''}`);
  if (short.length) return '足りない: ' + short.join(',');
  return '今は条件に合いません';
}

/** 原作 GetItemUseTime: 熟練度に応じた 1 回あたりの所要時間 */
export function itemUseTime(dt: Shop, u: RtUse): number {
  const exp = u.result.expold !== undefined ? u.result.expold : dt.exp[u.expno] ?? 0;
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
  if (!u) throw new GameError(`使えません (使い方の番号 ${useNo} はありません。GET /api/v1/items/${itemno} の「使い方」を見てください)`);
  if (!u.useok) throw new GameError(`使えません (${u.ngReason ?? '今は条件に合いません'})`);

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
  const why = cancel?.(g, dt, u, req) ?? (req.confirm ? undefined : overflowCheck(g, dt, u, count));
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

/** 1,000分率で1個ずつ抽選する。確定の分は乱数を引かない。 */
function rollYield(g: Game, units: number, proba: number): number {
  const guaranteed = Math.floor(proba / 1000);
  const extra = proba % 1000;
  let produced = guaranteed * units;
  if (extra > 0) {
    for (let i = 0; i < units; i++) if (g.rand(1000) < extra) produced++;
  }
  return produced;
}

/**
 * 今の資金・持ち時間・材料・熟練で、この使い方を何回まで実行できるか (1.9.0)。
 * useItem の実行と、作り方の「今何回できるか」(max_count_now) の両方で使う。
 * why は、0回になった最初の理由 (1回に要る量と今の量を添える)
 */
export function runLimit(g: Game, dt: Shop, u: RtUse): { max: number; why: string } {
  let max = Infinity;
  let why = '';
  const cap = (n: number, reason: string) => {
    n = Math.max(0, Math.trunc(n) || 0);
    if (n < max) max = n;
    if (!n && !why) why = reason;
  };
  const usetime = itemUseTime(dt, u);
  const exp = dt.exp[u.expno] ?? 0;
  if (exp < u.needexp) cap(0, `熟練が足りません (要${u.needexp / 10}%、今${Math.trunc(exp) / 10}%)`);
  if (u.money > 0) cap(dt.money / u.money, `資金が足りません (1回￥${u.money}、資金￥${dt.money})`);
  // 時間クーポンの残りも使える。持ち時間がマイナス (待ち中) でも、クーポンの分は使える (useTime と同じ扱い)
  const avail = g.usableTime(dt);
  if (usetime > 0) cap(avail / usetime, `持ち時間が足りません (1回${formatHms(usetime)}、使える${formatHms(avail)})`);
  // 時間が増える使い方 (タイムシガレット) は、持ち時間の上限 (48時間) を超えない本数まで
  if (usetime < 0) cap((g.config.maxStockTime - (g.now - dt.time)) / -usetime, '持ち時間がいっぱいです (上限' + Math.trunc(g.config.maxStockTime / 3600) + '時間)');
  for (const line of u.use) {
    const have = dt.item[line.no - 1];
    const name = isPublicItem(line.no) ? g.items[line.no].name : HIDDEN_NAME;
    // 道具 (proba 0) は何回使っても line.count 個あればよい
    if (line.proba === 0) cap(have >= line.count ? Infinity : 0, `${name}が足りません (道具${line.count}、持っている${have})`);
    else cap(line.count > 0 ? have / line.count : Infinity, `${name}が足りません (1回${line.count}、持っている${have})`);
  }
  return { max, why };
}

/**
 * 確実にできる品だけで所持上限を超えるなら、実行前に確かめる (1.9.0)。
 * 超えた分は捨てられ、材料と時間は使ってしまうため。熟練上げなどでわざと作るときは confirm で続けられる。
 * スクリプトで何かする使い方 (搾乳・転職など) は、作る品の行だけでは結果が決まらないので見ない
 */
function overflowCheck(g: Game, dt: Shop, u: RtUse, countIn: number): string | undefined {
  if (u.result.function) return undefined;
  const count = Math.min(countIn, runLimit(g, dt, u).max);
  if (!(count > 0)) return undefined;
  const over: string[] = [];
  let fit = count;
  for (const line of u.result.create) {
    // 確実にできる分 (職レベル・道具の上乗せは数えない。少なめに見る)
    const sure = Math.floor(Math.max(0, Math.min(1000, line.proba)) / 1000) * line.count;
    if (sure <= 0) continue;
    const item = g.items[line.no];
    const room = Math.max(0, item.limit - dt.item[line.no - 1]);
    if (sure * count <= room) continue;
    over.push(`${item.name}は所持上限${item.limit}まであと${room}${item.scale}で、${count}回で確実にできる${sure * count}${item.scale}のうち${sure * count - room}${item.scale}は捨てられます`);
    fit = Math.min(fit, Math.floor(room / sure));
  }
  if (!over.length) return undefined;
  return (
    `確認: ${over.join('。')} (材料と時間は使います)。` +
    (fit > 0 ? `上限まで作るなら count を ${fit} にしてください。` : '倉庫を空けてから作るのがおすすめです。') +
    '熟練上げなどでこのまま作るなら、同じ行動に "confirm":true を付けて送り直してください (まだ何も変えていません)'
  );
}

/** 原作 UseItem($USE,$count) */
export function useItem(g: Game, dt: Shop, u: RtUse, countIn: number): void {
  // 実行数は 0 未満にしない (負の数で材料が増え、できた品が減るのを防ぐ)
  let count = Math.max(0, Math.trunc(countIn) || 0);
  let why = count ? '' : '数量が0です';
  const cap = (n: number, reason: string) => {
    n = Math.max(0, Math.trunc(n) || 0);
    if (n < count) count = n;
    if (!count && !why) why = reason;
  };
  const usetime = itemUseTime(dt, u);
  const lim = runLimit(g, dt, u);
  cap(lim.max, lim.why);
  u.result.count = count;
  if (!count) { // count が 0 なら失敗 (何も変えない)
    u.result.failReason = why || undefined;
    return;
  }
  u.result.useitem = [];
  u.result.additem = [];

  const spent = usetime * count;
  const earnsJoblv = u.exp !== 0 && spent > 0;
  const joblv = earnsJoblv ? joblvProgress(dt, u.expno).lv : 0;
  g.useTime(spent);
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
  // 職レベルの出来高倍率はレシピの get 行だけ。搾乳や、exp 0 の「働く」など、スクリプトの直接追加には掛けない。
  // 酪農家は元から強いので搾乳は意図して据え置く。搾乳の点は入り、草刈り・乳製品のレシピには倍率が効く (2026-11-23)。
  // 搾乳にも掛ける場合は scripts.ts の mino:_local_1 / mino:_local_2 の val に同じ倍率を掛ける。
  // 1.7.0 採る2職の道具 (ツルハシ・オノ): 持っていれば1回ごとに傷み、効いた回だけ取れる確率に +percent% (職レベルと足し算)。
  // 壊れたら残りの回には効かない (まとめて採っても1回ずつ採っても同じ)
  const tool = u.exp !== 0 && u.result.create.length ? gatherToolFor(u.itemno, u.name) : undefined;
  let toolUnits = 0;
  let toolBroken = 0;
  if (tool) {
    let have = dt.item[tool.tool - 1];
    for (let i = 0; i < count && have > 0; i++) {
      toolUnits++;
      if (wearStep(g, dt, tool.tool, tool.wear)) {
        have--;
        toolBroken++;
      }
    }
  }
  const yieldPct = 100 + JOBLV_YIELD_PCT * joblv;
  for (const line of u.result.create) {
    const roll = (units: number, pct: number): number => {
      const proba = Math.max(0, Math.min(1000, line.proba)) * pct / 100;
      let n = rollYield(g, line.count * units, proba);
      if (line.fraction) n += rollYield(g, units, proba * line.fraction / 1000);
      return n;
    };
    let itemcount = roll(count - toolUnits, yieldPct);
    if (toolUnits) itemcount += roll(toolUnits, yieldPct + tool!.percent);
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
  if (tool && toolUnits) {
    const name = g.items[tool.tool].name;
    if (toolBroken) {
      dt.item[tool.tool - 1] -= toolBroken;
      u.result.useitem.push({ item_no: tool.tool, count: toolBroken });
      u.result.usemsg.push(`${name}が壊れました`);
    }
    u.result.addmsg.push(`${name}で+${tool.percent}% (${toolUnits}回)`, durabilityLine(g, dt, tool.tool, '耐久', 'いつ壊れてもおかしくない'));
  }
  checkWholeStore(g);

  const fname = u.result.function;
  if (fname) {
    const fn = USE_FUNCS[`${u.itemcode}:${fname}`] ?? USE_FUNCS[fname];
    if (!fn) throw new Error(`未移植の function: ${u.itemcode}:${fname}`);
    const dts = u.arg.targetidx !== undefined ? g.shops[u.arg.targetidx] : undefined;
    u.result.function_return = fn(g, dt, u, { dts, count: u.result.count }) || undefined;
  }

  if (earnsJoblv) {
    const points = dt.joblvpt ??= {};
    points[u.expno] = (points[u.expno] ?? 0) + spent;
  }
  if (u.exp) {
    const exp = dt.exp[u.expno] ?? 0;
    u.result.expold = exp;
    let expplus = u.exp * u.result.count;
    if (exp + expplus > 1000) expplus = 1000 - exp;
    dt.exp[u.expno] = exp + expplus;
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
  if (!count) return [u.result.failReason ? `実行できませんでした (${u.result.failReason})` : '実行できませんでした'];
  if (u.result.function_return) out.push(...u.result.function_return.split('<br>').filter(Boolean));
  out.push(`実行数: ${count}${u.scale}`);
  if (u.money * count) out.push(`費用:￥${u.money * count}`);
  const spent = itemUseTime(dt, u) * count;
  out.push(spent < 0 ? `持ち時間+${formatHms(-spent)}` : `時間:${formatHms(spent)}`);
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
