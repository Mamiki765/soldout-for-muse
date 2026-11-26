// SOLD OUT for Muse — 1.7.0 採る2職の道具 (ツルハシ・オノ)。データは tools/v170-tool-jobs.json の gather_tools。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

export interface GatherTool {
  /** この地図 (本) の行き先に効く */
  book: number;
  /** 道具の品番 */
  tool: number;
  /** 取れる確率に足す% (職レベルの出来高と足し算) */
  percent: number;
  /** 1回ごとの傷み (平均の寿命=1) */
  wear: number;
  /** 効かない行き先 (今はなし。炭鉱にも効く) */
  skip: readonly string[];
}

export const GATHER_TOOLS: readonly GatherTool[] = [
  { book: 9, tool: 142, percent: 10, wear: 0.05, skip: [] },
  { book: 12, tool: 143, percent: 10, wear: 0.05, skip: [] },
];

/** この使い方に効く道具 (なければ undefined) */
export function gatherToolFor(book: number, useName: string): GatherTool | undefined {
  const t = GATHER_TOOLS.find((x) => x.book === book);
  return t && !t.skip.includes(useName) ? t : undefined;
}
