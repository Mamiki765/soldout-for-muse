// v0.3.0 の新商品・採取・イベント全件の生成値と実動作を検査する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, EVENTS, MAX_ITEM, type EventParam } from '../src/data/catalog.js';
import { openShop, enterShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

type Product = {
  book: number; product: number; needexp?: number; time: number; exptime: number;
  exp: number; get: number; proba: number; job: string; lostbook?: number | null;
  tools?: (number | number[])[]; materials?: number[][];
};
type Gathering = {
  book: number; name: string; needexp: number; job: string;
  money: number; lostbook: number; products: number[][];
};
type EventSpec = {
  code: string; group: string; startproba: number; auto_start: boolean;
  basetime: number; plustime: number; info: string | null;
  startmsg: string | null; endmsg: string | null; params: EventParam[];
};
const v030 = JSON.parse(readFileSync('tools/v030.json', 'utf8')) as {
  items: { no: number; name: string; code: string; type: number; price: number;
    cost: number; popular: number; limit: number; plus: number }[];
  production: Product[];
  gathering: Gathering[];
  events: EventSpec[];
  event_changes: { code: string; set?: Record<string, unknown>; add_params?: EventParam[] }[];
};
const triples = (lines: { item_no: number; count: number; proba: number }[]) =>
  lines.map((l) => [l.item_no, l.count, l.proba]);
const T0 = 1_800_000_000;

test('v0.3.0: 品103〜113の設定、16x16アイコン11枚、入手経路に欠落がない', () => {
  assert.equal(MAX_ITEM, 113);
  assert.deepEqual(v030.items.map((it) => it.no), Array.from({ length: 11 }, (_, i) => i + 103));
  assert.equal(v030.production.length, 8);
  assert.equal(v030.gathering.length, 3);
  const produced = new Set<number>();
  for (const p of v030.production) produced.add(p.product);
  for (const g of v030.gathering) for (const line of g.products) produced.add(line[0]);
  for (const spec of v030.items) {
    const it = BASE_ITEMS[spec.no];
    assert.ok(it, '商品がありません: ' + spec.no);
    for (const k of ['name','code','type','price','cost','popular','limit','plus'] as const) {
      assert.equal(it[k], spec[k], '商品 ' + spec.no + ' の ' + k);
    }
    assert.ok(produced.has(spec.no), '入手経路がありません: ' + spec.no);
    const png = readFileSync('public/images/item-no-' + spec.no + '.png');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '画像形式: ' + spec.no);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [16, 16], '画像サイズ: ' + spec.no);
  }
});

test('v0.3.0: 新しい製作8件の材料・道具・熟練・時間・摩耗・職業ボーナスを照合', () => {
  for (const p of v030.production) {
    const u = BASE_ITEMS[p.book].uses.find((x) => x.get.some((l) => l.item_no === p.product));
    assert.ok(u, '製作レシピ欠落: ' + p.product);
    assert.equal(u.needexp, p.needexp ?? null);
    assert.deepEqual([u.time,u.exptime,u.exp,u.money], [p.time,p.exptime,p.exp,0]);
    assert.deepEqual(triples(u.get), [[p.product,p.get,p.proba]]);
    const tools = (p.tools ?? []).map((t) => Array.isArray(t) ? [t[0],t[1],0] : [t,1,0]);
    assert.deepEqual(triples(u.use), [...tools,...(p.materials ?? []).map(([no,count]) => [no,count,1000])]);
    assert.deepEqual(u.jobs, [{ job:p.job,key:'times',op:'/',value:2 }]);
    assert.equal(u.func, p.lostbook == null ? null : 'lostbook');
    assert.equal(u.params[0], p.lostbook == null ? null : String(p.lostbook));
  }
});

test('v0.3.0: 港町・隊商だけ15%、元の剣市と霊草の谷は10%、費用は明示設定', () => {
  const old = BASE_ITEMS[14].uses[0];
  assert.deepEqual([old.money,old.func,old.params[0]], [5000,'lostbook','100']);
  assert.equal(old.func_before, '_local_b1');
  const expectWear: Record<string,number> = { '港町で買い付け':150,'隊商と取引する':150,'霊草の谷を探す':100 };
  for (const spec of v030.gathering) {
    const u = BASE_ITEMS[spec.book].uses.find((x) => x.name === spec.name);
    assert.ok(u, '行き先欠落: ' + spec.name);
    assert.deepEqual([spec.money,spec.lostbook], [0,expectWear[spec.name]], spec.name);
    assert.deepEqual([u.money,u.func,u.params[0]], [spec.money,'lostbook',String(spec.lostbook)], spec.name);
    assert.deepEqual([u.needexp,u.time,u.exptime,u.exp], [spec.needexp,10800,5400,10]);
    assert.deepEqual(triples(u.get), spec.products);
    assert.deepEqual(u.jobs, [{ job:spec.job,key:'times',op:'/',value:2 }]);
    assert.equal(u.func_before, null, '原作の収穫2倍処理を継承しない: ' + spec.name);
    assert.equal(u.local_func_before, null);
  }
});

test('v0.3.0: 追加11 USEをゲーム上で1セットずつ実行できる', () => {
  const recipes = [
    ...v030.production.map((p) => ({ book:p.book, job:p.job,
      use:BASE_ITEMS[p.book].uses.find((u) => u.get.some((l) => l.item_no === p.product))! })),
    ...v030.gathering.map((p) => ({ book:p.book, job:p.job,
      use:BASE_ITEMS[p.book].uses.find((u) => u.name === p.name)! })),
  ];
  for (const p of recipes) {
    assert.ok(p.use, '行動の定義がありません');
    const world = newWorld(T0,MAX_ITEM);
    const g = new Game(world,DEFAULT_CONFIG,{ next:() => 0.2 },T0);
    const dt = openShop(g,{ name:'tester',shopname:'試験商店' });
    dt.job = p.job;
    dt.money = 1_000_000;
    dt.time = T0 - 48 * 3600;
    dt.exp[p.book] = 1000;
    dt.item[p.book - 1] = 1;
    for (const line of p.use.use) {
      dt.item[line.item_no - 1] = Math.max(dt.item[line.item_no - 1],line.count);
    }
    enterShop(g,dt,true);
    const before = dt.time;
    const action = useItemAction(g,dt,p.book,p.use.no,{ count:1 });
    assert.equal(action.result.count,1, '実行不可: ' + p.use.name);
    assert.equal(dt.time-before,p.use.exptime/2, '職業ボーナス: ' + p.use.name);
    for (const line of p.use.get) {
      assert.equal(dt.item[line.item_no - 1],line.count, '産出: ' + p.use.name);
    }
  }
});

test('v0.3.0: 新イベント7件と既存改修9件の対象・発生条件・参照先を照合', () => {
  assert.equal(v030.events.length,7);
  assert.equal(v030.event_changes.length,9);
  for (const spec of v030.events) {
    const event = EVENTS.get(spec.code);
    assert.ok(event, '追加イベント欠落: ' + spec.code);
    for (const k of ['code','group','startproba','auto_start','basetime','plustime','info','startmsg','endmsg'] as const) {
      assert.equal(event[k],spec[k], spec.code + '/' + k);
    }
    assert.deepEqual(event.params,spec.params, spec.code + ' の対象と効果');
  }
  for (const change of v030.event_changes) {
    const event = EVENTS.get(change.code);
    assert.ok(event, '変更イベント欠落: ' + change.code);
    for (const [k,v] of Object.entries(change.set ?? {})) {
      assert.deepEqual((event as unknown as Record<string,unknown>)[k],v, change.code + '/' + k);
    }
    for (const added of change.add_params ?? []) {
      assert.ok(event.params.some((p) => p.item_no===added.item_no && p.key===added.key
        && p.op===added.op && p.value===added.value), change.code + ' の商品 ' + added.item_no);
    }
  }
  for (const event of EVENTS.values()) {
    for (const p of event.params) {
      assert.ok(BASE_ITEMS[p.item_no], event.code + ' の参照先: ' + p.item_no);
      assert.ok(Number.isFinite(p.value), event.code + ' の値: ' + p.item_no);
      if (p.op === '/') assert.notEqual(p.value,0,event.code + ' のゼロ除算');
    }
  }
  assert.equal(EVENTS.get('kill-acce')?.auto_start,false);
  assert.equal(EVENTS.get('kill-acce')?.startproba,-1);
  assert.equal(EVENTS.get('priceup-tetu')?.group,EVENTS.get('plusup-tetu')?.group);
  assert.equal(EVENTS.get('priceup-misuriru')?.group,EVENTS.get('plusup-misuriru')?.group);
  assert.equal(EVENTS.get('priceup-oriharukon')?.group,EVENTS.get('plusup-oriharukon')?.group);
});

test('v0.3.0: ポーション・乳製品・香水・読書・交易船のイベント効果は実ゲームの商品に届く', () => {
  const world = newWorld(T0,MAX_ITEM);
  for (const id of ['boom-posyon','boom-milk','boom-fashion','boom-book','plusup-import']) {
    world.events[id] = T0+3600;
  }
  const g = new Game(world,DEFAULT_CONFIG,{ next:() => 0.2 },T0);
  assert.equal(g.items[109].popular,BASE_ITEMS[109].popular / 1.5, 'エリクシルの需要');
  assert.equal(g.items[109].point,BASE_ITEMS[109].point * 2, 'エリクシルの人気上昇係数');
  assert.equal(g.items[108].popular,BASE_ITEMS[108].popular / 1.5, '香水の需要');
  for (const no of [107,110,111]) {
    assert.equal(g.items[no].popular,BASE_ITEMS[no].popular / 1.5, '乳製品需要 ' + no);
    assert.equal(g.items[no].point,BASE_ITEMS[no].point * 2, '乳製品point ' + no);
  }
  for (const no of [112,113]) assert.equal(g.items[no].popular,BASE_ITEMS[no].popular / 1.5);
  for (const no of [103,104]) assert.equal(g.items[no].plus,600,'交易船の供給 ' + no);
});
