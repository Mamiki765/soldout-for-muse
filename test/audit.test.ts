// 2026-11-15 の main 監査で見つかった不具合の回帰テスト (A02 A04 A06 A07 A08 A10 A11 A12 A13, B02)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG, type GameConfig } from '../src/config.js';
import { CATALOG, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { App } from '../src/api/app.js';
import { itemDetailData } from '../src/api/views.js';
import { deposit, maxDeposit, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld, type LogEntry } from '../src/engine/types.js';
import { peekData, periodAfter, periodEstimate } from '../src/engine/watch.js';
import { sha256, Store } from '../src/store.js';

const T0 = 1_800_000_000;
let nameNo = 0;

async function start(clock: () => number, config?: Partial<GameConfig>): Promise<{ base: string; server: Server; store: Store; app: App }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock, helpText: 'HELP', config });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, store, app };
}

async function register(base: string, shopname: string): Promise<{ token: string; shopId: number; auth: Record<string, string> }> {
  const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'm' + (++nameNo), shopname }) });
  assert.equal(r.status, 201, await r.clone().text());
  const d = (await r.json()) as { token: string; shop_id: number };
  return { token: d.token, shopId: d.shop_id, auth: { authorization: 'Bearer ' + d.token } };
}

test('A11: GET の JSON の棚番号 (slot) は 1 始まりで、そのまま shelf に渡せる', async () => {
  let now = T0;
  const { base, server } = await start(() => now);
  try {
    const { auth } = await register(base, 'たな商店');
    let r = await fetch(base + '/api/v1/me?format=json', { headers: auth });
    const me = (await r.json()) as { shelves: { slot: number }[] };
    assert.equal(me.shelves[0].slot, 1);
    now += 2 * 3600; // 開店直後の市場は空なので入荷させる
    r = await fetch(base + '/api/v1/market?format=json', { headers: auth });
    const market = (await r.json()) as { items: { item: number; stock: number }[] };
    const yakusou = market.items.find((x) => x.stock >= 1)!.item;
    r = await fetch(base + '/api/v1/actions?format=json', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actions: [{ type: 'buy', item: yakusou, count: 1 }, { type: 'shelf', slot: me.shelves[0].slot, item: yakusou, percent: 100 }] }),
    });
    const res = (await r.json()) as { results: { ok: boolean }[]; digest: { shelves: { slot: number; item: number }[] } };
    assert.ok(res.results.every((x) => x.ok), JSON.stringify(res.results));
    assert.deepEqual(res.digest.shelves[0], { ...res.digest.shelves[0], slot: 1, item: yakusou });
    r = await fetch(base + '/api/v1/digest', { headers: auth });
    assert.match(await r.text(), /棚 1:\S+@/);
  } finally {
    server.close();
  }
});

test('A12: 最大引き出し額は、今の持ち時間で本当に払える額', () => {
  const cfg = { ...DEFAULT_CONFIG, couponTime: 0 };
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, cfg, seededRng(1), T0);
  const dt = openShop(g, { name: 'a', shopname: 'あ商店' });
  dt.moneystock = 1_000_000;
  dt.money = 0;
  // 持ち時間がちょうど基本料金だけ (0.3.3 までは 100万円を返していた)
  dt.time = T0 - CATALOG.timeSendMoney;
  let max = maxDeposit(g, dt);
  assert.ok(max > 0);
  assert.ok(g.timeDeal(max) <= g.usableTime(dt));
  assert.ok(g.timeDeal(max + 1) > g.usableTime(dt));
  deposit(g, dt, max);
  assert.equal(dt.money, max);

  // 基本料金に届かなければ 0
  dt.time = T0 - CATALOG.timeSendMoney + 1;
  assert.equal(maxDeposit(g, dt), 0);

  // 時間がたっぷりあれば、資金の上限までの全部
  dt.time = T0 - cfg.maxStockTime;
  dt.money = g.maxMoney - 10;
  assert.equal(maxDeposit(g, dt), 10);
});

test('A13: 使う品そのものを持っていなければ usable は false', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const dt = openShop(g, { name: 'a', shopname: 'あ商店' });
  const book = itemNoByName('資金調達の方法');
  dt.item[book - 1] = 0;
  const d = itemDetailData(g, book, dt);
  assert.ok(d.uses.length > 0);
  for (const u of d.uses) {
    assert.equal(u.usable, false);
    assert.match(String((u as { why?: string }).why), /持っていません/);
  }
});

test('A06: 最近仕入れた品の維持費も、倒産の見込みに入る', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const dt = openShop(g0, { name: 'a', shopname: 'あ商店' });
  const next = periodAfter(g0, T0);
  const asOf = next - 300;
  world.lasttime = asOf;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), asOf);
  dt.money = 1;
  dt.moneystock = 0;
  dt.costtoday = 0;
  dt.showcasecount = 1;
  dt.item[itemNoByName('鋼鉄の鎧') - 1] = 300;
  const est = periodEstimate(g, dt);
  assert.ok(est.cost_projected > 0, JSON.stringify(est));
  assert.ok(est.short > 0);
  assert.ok(peekData(g, dt).alerts.some((a) => a.type === 'bankrupt_risk'));
});

test('A08: 決算の時刻を過ぎて未反映なら pending、倒産の鍵は過ぎたほうの決算', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const dt = openShop(g0, { name: 'a', shopname: 'あ商店' });
  const next = periodAfter(g0, T0);
  world.lasttime = next - 300;
  dt.showcasecount = 8;
  dt.money = 1000;
  dt.moneystock = 0;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), next + 1);
  const d = peekData(g, dt);
  assert.equal(d.facts.period.pending, true);
  assert.equal(d.facts.period.next_period, next);
  const a = d.alerts.find((x) => x.type === 'bankrupt_risk');
  assert.ok(a);
  assert.equal(a.key, `bankrupt:${next}:pending`);
  assert.match(a.msg, /まだ反映されていません/);
});

test('A02: 決算の時刻を過ぎた最初のアクセスでは、5分たっていなくても決算を先に済ませる', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now);
  try {
    const { auth, shopId } = await register(base, 'ぜい商店');
    const next = periodAfter(new Game(app.world, app.config, seededRng(1), now), now);
    now = next - 100;
    await fetch(base + '/api/v1/items');
    assert.equal(app.world.lasttime, next - 100);
    const shop = app.world.shops.find((s) => s.id === shopId)!;
    shop.money = 0;
    shop.moneystock = 2_000_000;
    now = next + 1;
    const r = await fetch(base + '/api/v1/actions?format=json', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'withdraw', amount: 1_000_000 }) });
    assert.equal(r.status, 200);
    // 引き出しの前に決算が済んでいる: 前の期の税は入金庫 200万に掛かる
    assert.equal(app.world.lasttime, next + 1);
    const after = app.world.shops.find((s) => s.id === shopId)!;
    assert.ok(after.taxyesterday > 0, `税 ${after.taxyesterday}`);
  } finally {
    server.close();
  }
});

test('A04: 不在閉店した店のトークンでは管理 API を使えず、トークンも片付く', async () => {
  let now = T0;
  const { base, server, store } = await start(() => now);
  try {
    const { token, shopId, auth } = await register(base, 'かんり商店');
    store.setSetting('admin_shops', String(shopId));
    let r = await fetch(base + '/api/v1/admin/stats', { headers: auth });
    assert.equal(r.status, 200);
    // 誰も行動しないまま不在閉店の期限を過ぎ、観戦などのアクセスで街の計算が走る
    now += DEFAULT_CONFIG.expireTime + DEFAULT_CONFIG.expireMaxTime + 3600;
    await fetch(base + '/api/v1/items');
    assert.equal(store.shopIdByToken(token), undefined, 'トークンが残っている');
    assert.equal(store.getSetting('admin_shops') ?? '', '');
    r = await fetch(base + '/api/v1/admin/stats', { headers: auth });
    assert.equal(r.status, 403);
  } finally {
    server.close();
  }
});

test('A07: scope や limit で返さなかった出来事は既読にならない', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now);
  try {
    const { auth, shopId } = await register(base, 'みどく商店');
    // 今ある記録を全部読んでおく
    while ((await (await fetch(base + '/api/v1/log?format=json', { headers: auth })).json() as unknown[]).length);
    const logs: LogEntry[] = [
      { time: now, mode: 0, from: shopId, to: 0, msg: '自分1' },
      { time: now, mode: 2, from: 0, to: 0, msg: '街1' },
      { time: now, mode: 2, from: 0, to: 0, msg: '街2' },
    ];
    app.store.saveWorld(app.world, logs, now, 86400 * 2);
    let r = await fetch(base + '/api/v1/log?scope=town&limit=1&format=json', { headers: auth });
    let got = (await r.json()) as { msg: string }[];
    assert.deepEqual(got.map((l) => l.msg), ['街1'], '古いほうから');
    assert.equal(r.headers.get('x-unread-left'), '1', '街の残り');
    r = await fetch(base + '/api/v1/digest?format=json', { headers: auth });
    const d = (await r.json()) as { new: { mine: number; town: number } };
    assert.equal(d.new.mine, 1);
    assert.equal(d.new.town, 1);
    r = await fetch(base + '/api/v1/log?scope=me&format=json', { headers: auth });
    got = (await r.json()) as { msg: string }[];
    assert.deepEqual(got.map((l) => l.msg), ['自分1']);
    r = await fetch(base + '/api/v1/log?format=json', { headers: auth });
    got = (await r.json()) as { msg: string }[];
    assert.deepEqual(got.map((l) => l.msg), ['街2']);
    r = await fetch(base + '/api/v1/log?format=json', { headers: auth });
    assert.deepEqual(await r.json(), []);
  } finally {
    server.close();
  }
});

test('A07: 掲示板も、件数で返さなかった書き込みは既読にならない', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now);
  try {
    const { auth } = await register(base, 'けいじ商店');
    for (let i = 1; i <= 3; i++) app.store.addPost({ board: 'chat', time: now, shop_id: 999, shopname: 'よそ', msg: 'こんにちは' + i }, 20);
    let r = await fetch(base + '/api/v1/chat?limit=2&format=json', { headers: auth });
    let got = (await r.json()) as { msg: string }[];
    assert.deepEqual(got.map((p) => p.msg), ['こんにちは2', 'こんにちは1']);
    r = await fetch(base + '/api/v1/chat?format=json', { headers: auth });
    got = (await r.json()) as { msg: string }[];
    assert.deepEqual(got.map((p) => p.msg), ['こんにちは3']);
  } finally {
    server.close();
  }
});

test('A10: 取り下げの記録が多くても、24時間以内の募集の終了は全部 peek に出る', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now, {});
  try {
    const { auth, shopId } = await register(base, 'ぼしゅう商店');
    await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'alerts', mode: 'power' }) });
    const logs: LogEntry[] = [];
    for (let i = 1; i <= 25; i++) logs.push({ time: now - 3600, mode: 0, from: shopId, to: 0, msg: `募集#${i} 薬草を集め終わりました (届いた1/1個を倉庫へ、返金￥0)` });
    for (let i = 26; i <= 31; i++) logs.push({ time: now - 60, mode: 0, from: shopId, to: 0, msg: `募集#${i}を取り下げました` });
    app.store.saveWorld(app.world, logs, now, 86400 * 2);
    const r = await fetch(base + '/api/v1/peek?format=json', { headers: auth });
    const d = (await r.json()) as { alerts: { type: string }[] };
    assert.equal(d.alerts.filter((a) => a.type === 'order_closed').length, 25);
  } finally {
    server.close();
  }
});

test('A01: 保存に失敗したら、メモリの街も保存してある街に戻る', async () => {
  let now = T0;
  const { base, server, app, store } = await start(() => now);
  try {
    await register(base, 'ほぞん商店');
    const before = app.world.lasttime;
    now += 301;
    const orig = store.saveWorld.bind(store);
    store.saveWorld = () => {
      throw new Error('disk full');
    };
    let r = await fetch(base + '/api/v1/items');
    assert.equal(r.status, 500);
    assert.equal(app.world.lasttime, before, 'メモリの街が進んだまま');
    store.saveWorld = orig;
    r = await fetch(base + '/api/v1/items');
    assert.equal(r.status, 200);
    assert.equal(store.loadWorld(0).lasttime, now);
  } finally {
    server.close();
  }
});

test('A03: トークンの保存に失敗したら、店も残らない。管理 API でトークンを出し直せる', async () => {
  let now = T0;
  const { base, server, app, store } = await start(() => now);
  try {
    const orig = store.addToken.bind(store);
    store.addToken = () => {
      throw new Error('locked');
    };
    let r = await fetch(base + '/api/v1/register', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'm', shopname: 'のこらない商店' }) });
    assert.equal(r.status, 500);
    assert.equal(app.world.shops.length, 0);
    assert.equal(store.loadWorld(0).shops.length, 0);
    store.addToken = orig;
    const { token, shopId, auth } = await register(base, 'のこらない商店');

    // 出し直し: 管理用トークンで
    store.setSetting('admin_token_hash', sha256('sa_admin'));
    r = await fetch(base + '/api/v1/admin/token?format=json', { method: 'POST', headers: { authorization: 'Bearer sa_admin' }, body: JSON.stringify({ shop: shopId }) });
    assert.equal(r.status, 200);
    const d = (await r.json()) as { token: string };
    assert.notEqual(d.token, token);
    r = await fetch(base + '/api/v1/digest', { headers: auth });
    assert.equal(r.status, 401, '前のトークンは止まる');
    r = await fetch(base + '/api/v1/digest', { headers: { authorization: 'Bearer ' + d.token } });
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
});

test('A05: 同じ request_id の送り直しは、済んだ行動をもう一度しない', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now);
  try {
    const { auth, shopId } = await register(base, 'にじゅう商店');
    now += 2 * 3600;
    const market = (await (await fetch(base + '/api/v1/market?format=json', { headers: auth })).json()) as { items: { item: number; stock: number }[] };
    const item = market.items.find((x) => x.stock >= 5)!.item;
    const send = (body: unknown) => fetch(base + '/api/v1/actions?format=json', { method: 'POST', headers: auth, body: JSON.stringify(body) });
    const shop = () => app.world.shops.find((s) => s.id === shopId)!;
    let r = await send({ request_id: 'r1', type: 'buy', item, count: 1 });
    assert.equal(shop().item[item - 1], 1);
    const money = shop().money;
    r = await send({ request_id: 'r1', type: 'buy', item, count: 1 });
    const d = (await r.json()) as { results: { ok: boolean }[]; replayed: number };
    assert.equal(d.replayed, 1);
    assert.ok(d.results[0].ok);
    assert.equal(shop().item[item - 1], 1, '二重に買っていない');
    assert.equal(shop().money, money);
    // 中身が違えば 409
    r = await send({ request_id: 'r1', type: 'buy', item, count: 2 });
    assert.equal(r.status, 409);
    // request_id なしは今までどおり毎回
    await send({ type: 'buy', item, count: 1 });
    await send({ type: 'buy', item, count: 1 });
    assert.equal(shop().item[item - 1], 3);
    // まとめて送った途中まで済んでいたら、続きから
    r = await send({ request_id: 'r2', actions: [{ type: 'buy', item, count: 1 }, { type: 'buy', item, count: 1 }] });
    assert.equal(shop().item[item - 1], 5);
    r = await send({ request_id: 'r2', actions: [{ type: 'buy', item, count: 1 }, { type: 'buy', item, count: 1 }] });
    assert.equal(shop().item[item - 1], 5);
  } finally {
    server.close();
  }
});

test('admin: 管理者として許可した店の peek にだけ、目安箱の案と開店の知らせが出る', async () => {
  let now = T0;
  const { base, server, store } = await start(() => now);
  try {
    const admin = await register(base, 'みはり商店');
    const other = await register(base, 'ふつう商店');
    store.setSetting('admin_shops', String(admin.shopId));
    await fetch(base + '/api/v1/suggest', { method: 'POST', headers: other.auth, body: JSON.stringify({ category: 'bug', text: '棚が変です' }) });
    let r = await fetch(base + '/api/v1/peek?format=json', { headers: admin.auth });
    let d = (await r.json()) as { alerts: { type: string; level: string; msg: string }[] };
    const adm = d.alerts.filter((a) => a.type === 'admin');
    assert.ok(adm.some((a) => /目安箱に未対応の案1件/.test(a.msg) && a.level === 'high'), JSON.stringify(adm));
    assert.ok(adm.some((a) => /ふつう商店が新装開店しました/.test(a.msg)), JSON.stringify(adm));
    r = await fetch(base + '/api/v1/peek?format=json', { headers: other.auth });
    d = (await r.json()) as typeof d;
    assert.ok(!d.alerts.some((a) => a.type === 'admin'));
  } finally {
    server.close();
  }
});
