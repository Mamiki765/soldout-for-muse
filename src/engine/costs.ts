// SOLD OUT for Muse — 維持費の内訳 (原作にない追加。SOLD OUT 目安箱 #5)。
// 維持費そのものの計算 (陳列中の品は在庫まるごと1/10、時間に比例して積み上げ、決算で1円未満切り捨て) は
// 原作 turn.cgi / period.cgi のまま。ここでは同じ値を品物ごとに分けて覚えておき、決算で引いた額の明細を残すだけ。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG } from '../data/catalog.js';
import type { Game } from './game.js';
import type { CostReport, Shop } from './types.js';

/** 店ごとに残す決算の明細の数 (新しい順) */
export const COST_REPORT_KEEP = 3;

/**
 * 1区間ぶんの品物の維持費を、品番ごとの累計に足す (turn.ts の維持費計算と同じ値を渡す)。
 * stock: 倉庫 (陳列の割引後)、held: 買い取り募集で預かり中、saved: 陳列で安くなった額 (払っていない額)。
 */
export function addItemCost(dt: Shop, itemno: number, stock: number, held: number, saved: number): void {
  if (!dt.costitems) startTracking(dt);
  const items = dt.costitems!;
  const a = (items[itemno] ??= [0, 0, 0]);
  a[0] += stock;
  a[1] += held;
  a[2] += saved;
}

/**
 * 内訳の記録を始める。古い保存データの店は、それまでにたまった今期の維持費の内訳を持たないので、
 * その額は「記録を始める前の分」として分けておく (品物に割り振って推測しない)。
 */
export function startTracking(dt: Shop): void {
  dt.costitems = {};
  if (dt.costtoday) dt.costuntracked = dt.costtoday;
  else delete dt.costuntracked;
}

/** 決算で今期の累計を空にする (dt.costtoday = 0 と一緒に) */
export function resetTracking(dt: Shop): void {
  dt.costitems = {};
  delete dt.costuntracked;
}

/** 明細の1行 (円・整数) */
export interface CostLine {
  item: number;
  /** 倉庫に置いていた分 */
  stock: number;
  /** 買い取り募集で預かり中だった分 */
  held: number;
  /** 陳列で安くなった額 (払っていない。参考) */
  saved: number;
}

/**
 * 今期の累計から明細 (円・整数) を作る。品物の維持費の合計は、決算で実際に引く Math.trunc(costtoday) に必ず一致させる。
 * 各行の端数は最大剰余法で配る (端数の大きい行から1円ずつ)。同じ端数なら品番の小さいほうを先にする。
 */
export function itemCostLines(dt: Shop): { items: number; lines: CostLine[]; untracked: number; adjust: number } {
  const target = Math.trunc(dt.costtoday);
  const acc = dt.costitems;
  // 記録を始める前の分 (古いデータ)。まだ一度も区間を計算していない店は今期の全額がそれにあたる
  const untrackedRaw = acc ? (dt.costuntracked ?? 0) : dt.costtoday;
  const parts: { key: string; raw: number }[] = [];
  if (untrackedRaw > 0) parts.push({ key: 'u', raw: untrackedRaw });
  const nos = Object.keys(acc ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  for (const no of nos) {
    const [s, h] = acc![no];
    if (s > 0) parts.push({ key: `s${no}`, raw: s });
    if (h > 0) parts.push({ key: `h${no}`, raw: h });
  }
  const yen = new Map<string, number>();
  let sum = 0;
  for (const p of parts) {
    const f = Math.floor(p.raw);
    yen.set(p.key, f);
    sum += f;
  }
  let diff = target - sum;
  if (diff > 0) {
    // 端数の大きい順に1円ずつ (浮動小数の誤差で足りなければもう一巡)
    const order = [...parts].sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)));
    for (let i = 0; diff > 0 && order.length && i < order.length * 2; i++, diff--) {
      const k = order[i % order.length].key;
      yen.set(k, yen.get(k)! + 1);
    }
  } else if (diff < 0) {
    // 累計の足し算の順序の誤差で、切り捨て後の合計を1円超えたときだけ。端数の小さい行から1円ずつ戻す
    const order = [...parts].sort((a, b) => (a.raw - Math.floor(a.raw)) - (b.raw - Math.floor(b.raw)));
    for (let i = 0; diff < 0 && i < order.length * 2; i++) {
      const k = order[i % order.length].key;
      if (yen.get(k)! > 0) {
        yen.set(k, yen.get(k)! - 1);
        diff++;
      }
    }
  }
  const lines: CostLine[] = [];
  for (const no of nos) {
    const [, , sv] = acc![no];
    const line = { item: no, stock: yen.get(`s${no}`) ?? 0, held: yen.get(`h${no}`) ?? 0, saved: Math.trunc(sv) };
    if (line.stock || line.held || line.saved) lines.push(line);
  }
  // diff が残るのは累計が壊れているときだけ (ふつうは 0)。隠さずに「調整」として出す
  return { items: target, lines, untracked: yen.get('u') ?? 0, adjust: diff };
}

/** 決算で引いた額の明細を作って店に残す (period.ts から、costtoday を空にする前に呼ぶ) */
export function recordCostReport(dt: Shop, at: number, showcase: number, tax: number): CostReport {
  const { items, lines, untracked, adjust } = itemCostLines(dt);
  const report: CostReport = {
    at,
    total: items + showcase,
    showcase,
    showcasecount: dt.showcasecount,
    items,
    untracked,
    adjust,
    lines: lines.map((l) => [l.item, l.stock, l.held, l.saved]),
    tax,
  };
  dt.costreports = [report, ...(dt.costreports ?? [])].slice(0, COST_REPORT_KEEP);
  return report;
}

// ---------------------------------------------------------------------------
// 表示

export function costReportData(g: Game, dt: Shop, ago: number) {
  if (ago === 0) {
    // 今期ここまで (まだ引かれていない。決算の時点で引く額はこの先も増える)
    const { items, lines, untracked, adjust } = itemCostLines(dt);
    const showcase = CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0;
    return costView(g, {
      kind: 'current' as const,
      at: g.world.lasttime,
      next_period: g.nextPeriodTime(),
      total: items + showcase,
      showcase,
      showcasecount: dt.showcasecount,
      items,
      untracked,
      adjust,
      lines,
      tax: null,
    });
  }
  const r = dt.costreports?.[ago - 1];
  if (!r) {
    return {
      kind: 'none' as const,
      ago,
      recorded: dt.costreports?.length ?? 0,
      last_total: ago === 1 ? dt.costyesterday : null,
    };
  }
  return costView(g, {
    kind: 'settled' as const,
    at: r.at,
    next_period: null,
    total: r.total,
    showcase: r.showcase,
    showcasecount: r.showcasecount,
    items: r.items,
    untracked: r.untracked,
    adjust: r.adjust,
    lines: r.lines.map(([item, stock, held, saved]) => ({ item, stock, held, saved })),
    tax: r.tax,
  });
}

interface ViewInput {
  kind: 'current' | 'settled';
  at: number;
  next_period: number | null;
  total: number;
  showcase: number;
  showcasecount: number;
  items: number;
  untracked: number;
  adjust: number;
  lines: CostLine[];
  tax: number | null;
}

function costView(g: Game, r: ViewInput) {
  const types = new Map<number, { type: number; name: string; stock: number; held: number; total: number }>();
  let stock = 0;
  let held = 0;
  let saved = 0;
  const lines = r.lines
    .map((l) => {
      const it = g.items[l.item];
      const t = it?.type ?? 0;
      const c = types.get(t) ?? { type: t, name: CATALOG.itemTypes[t] || '?', stock: 0, held: 0, total: 0 };
      c.stock += l.stock;
      c.held += l.held;
      c.total += l.stock + l.held;
      types.set(t, c);
      stock += l.stock;
      held += l.held;
      saved += l.saved;
      return { item: l.item, name: it?.name ?? '?', type: CATALOG.itemTypes[t] || '?', total: l.stock + l.held, stock: l.stock, held: l.held, saved: l.saved };
    })
    .sort((a, b) => b.total - a.total || b.saved - a.saved || a.item - b.item);
  const tool = types.get(TOOL_TYPE);
  return {
    kind: r.kind,
    at: r.at,
    next_period: r.next_period,
    /** 維持費の合計 = 棚の維持費 + 品物の維持費 */
    total: r.total,
    showcase: { count: r.showcasecount, cost: r.showcase },
    /** 品物の維持費 (= stock + held + untracked + adjust) */
    items: r.items,
    stock,
    /** stock のうち道具・キット類 (分類「道具」) */
    tools: tool ? tool.stock : 0,
    held,
    untracked: r.untracked,
    adjust: r.adjust,
    saved,
    by_type: [...types.values()].filter((c) => c.total > 0).sort((a, b) => a.type - b.type),
    lines,
    /** 同じ決算で引いた入金庫の税 (維持費ではない。参考) */
    stock_tax: r.tax,
    rounding: '品物の維持費は今期の累計を1円未満切り捨て (決算と同じ)。品物ごとの円は合計に合うよう端数の大きい順に1円ずつ配分',
  };
}

const TOOL_TYPE = 10;

export function costReportText(d: ReturnType<typeof costReportData>, fmt: (t: number) => string): string {
  if (d.kind === 'none') {
    const head = d.ago === 1 ? '前期' : `${d.ago}期前`;
    const tail = d.last_total !== null ? ` 前期に引いた維持費は合計￥${d.last_total} (/api/v1/me と同じ)。` : '';
    return `${head}の維持費の内訳は記録されていません (内訳の記録はこの機能を入れた後の決算から。残っているのは${d.recorded}期分)。${tail}今期ここまでは ?ago=0\n`;
  }
  const lines: string[] = [];
  if (d.kind === 'current') {
    lines.push(`維持費の内訳 今期ここまで (${fmt(d.at)} 時点、決算 ${fmt(d.next_period!)} で引かれる。品物の分はそれまで増え続けます)`);
  } else {
    lines.push(`維持費の内訳 決算 ${fmt(d.at)} に引いた額`);
  }
  lines.push(`合計 ￥${d.total} = 棚の維持費 ￥${d.showcase.cost} (棚${d.showcase.count}) + 品物の維持費 ￥${d.items}`);
  const parts = [`倉庫 ￥${d.stock}${d.tools ? ` (うち道具・キット ￥${d.tools})` : ''}`, `募集の預かり ￥${d.held}`];
  if (d.untracked) parts.push(`記録開始前の分 ￥${d.untracked} (品物別は不明)`);
  if (d.adjust) parts.push(`調整 ￥${d.adjust}`);
  lines.push('品物の維持費 = ' + parts.join(' + '));
  if (d.by_type.length) lines.push('分類別 ' + d.by_type.map((c) => `${c.name}￥${c.total}`).join(' '));
  if (d.lines.length) {
    lines.push('# 品番 名前 維持費 (倉庫/預かり) 陳列で安くなった額');
    for (const l of d.lines) {
      lines.push(`${l.item} ${l.name} ￥${l.total} (${l.stock}/${l.held})${l.saved ? ` 割引${l.saved}` : ''}`);
    }
  }
  if (d.saved) lines.push(`陳列で安くなった額 計￥${d.saved} (棚に出している品は在庫まるごと維持費1/10。払った額には入っていません)`);
  if (d.stock_tax !== null) lines.push(`参考: 同じ決算で入金庫の税 ￥${d.stock_tax} (維持費ではありません)`);
  lines.push('端数: 品物の維持費は決算と同じく1円未満切り捨て。品物ごとの円は合計に合うよう端数の大きい順に配分');
  return lines.join('\n') + '\n';
}
