// SOLD OUT for Muse — 更新内容。テキストAPI・JSON・観戦画面で共用する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS, CATALOG } from './data/catalog.js';

export const APP_VERSION = CATALOG.version;
export const UPDATE_NOTICE = `v${APP_VERSION}: ファッション枠と新素材を追加。詳細は /updates`;

const materials = (rows: number[][]) => rows.map(([item, count]) => ({ item, name: BASE_ITEMS[item].name, count }));
const oldRecipes = [
  [[5, 20]],
  [[6, 20], [8, 2]],
  [[7, 20], [8, 2]],
  [[5, 20], [6, 20], [7, 20], [8, 6]],
];

export const UPDATES = [{
  version: '0.2.0',
  date: '2026-11-13',
  title: 'ファッション枠アップデート',
  summary: 'ファッションの完成品7種と新素材16種を追加しました。全102種の商品で商売を楽しめます。',
  new_items: BASE_ITEMS.slice(80, 103).map((it) => ({ item: it.no, name: it.name, price: it.price, type: it.type })),
  gathering: [9, 12].flatMap((no) => BASE_ITEMS[no].uses.filter((u) => u.needexp !== null).map((u) => ({
    name: u.name!, map: { item: no, name: BASE_ITEMS[no].name },
    needexp: u.needexp!, time: u.time, exptime: u.exptime, exp: u.exp,
    products: u.get.map((l) => ({ item: l.item_no, name: BASE_ITEMS[l.item_no].name, get: l.count, proba: l.proba })),
  }))),
  mastery: '地図ごとに熟練が必要です。必要熟練200・400・600は、画面とAPIの表示では20%・40%・60%に当たります。探索1セットで熟練が10（1%）増えます。以前からの行き先は熟練に関係なく利用できます。',
  recipe_changes: BASE_ITEMS[66].uses.slice(0, 4).map((u, index) => ({
    item: u.get[0].item_no, name: BASE_ITEMS[u.get[0].item_no].name,
    before: materials(oldRecipes[index]),
    after: materials(u.use.filter((l) => l.proba > 0).map((l) => [l.item_no, l.count])),
  })),
  recipe_reason: '従来のレシピでは材料費が標準価格を大きく上回り、作るほど赤字になっていたため、材料構成を見直しました。価格・生産個数・成功率と、消費しない工具の条件は変更していません。',
  balance: '新規品の生産量は街の1日の需要程度に抑え、既存の最上位品を超える儲けにはしていません。素材を集め、加工し、ファッション品に仕上げる商売の選択肢が増えます。',
}];

export const materialText = (rows: { name: string; count: number }[]): string =>
  rows.map((r) => `${r.name}×${r.count}`).join('、');

export function updatesText(): string {
  return UPDATES.map((u) => [
    `# v${u.version} ${u.date} ${u.title}`, u.summary,
    '\n新規アイテム（標準価格）',
    ...u.new_items.map((it) => `${it.item} ${it.name} ${it.price}円`),
    '\n新規採取', u.mastery,
    ...u.gathering.map((g) => `${g.name} / ${g.map.name} / 必要熟練${g.needexp} (${g.needexp / 10}%)`),
    '\n装飾品の材料変更（1セット）', u.recipe_reason,
    ...u.recipe_changes.map((r) => `${r.name}: ${materialText(r.before)} → ${materialText(r.after)}`),
    '\n数値の考え方', u.balance,
  ].join('\n')).join('\n\n') + '\n';
}
