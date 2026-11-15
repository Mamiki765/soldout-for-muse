// 見張り (peek) のテスト: 読むだけで時間を進めないこと・アラートの判定・seen で 204・設定
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_ITEM } from "../src/data/catalog.js";
import { App } from '../src/api/app.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { peekData, periodAfter, periodEstimate } from '../src/engine/watch.js';
import { sha256, Store } from '../src/store.js';

async function start(clock: () => number): Promise<{ base: string; server: Server; store: Store }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, store };
}

type Peek = {
  as_of: number;
  age: number;
  cursor: string;
  next_timed: number | null;
  alerts: { type: string; level: string; key: string; msg: string }[];
  new: { type: string }[];
  setting: { mode: string; enabled: string[] };
  facts: { period: { next_period: number }; closing_at: number };
};

test('peek は読むだけ: 時間を進めず、as_of と古さを返し、seen で 204', async () => {
  let now = 1_800_000_000;
  const { base, server, store } = await start(() => now);
  try {
    let r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) });
    const { token } = (await r.json()) as { token: string };
    const auth = { authorization: 'Bearer ' + token };

    // 開店直後の棚は空 → 省トークン既定でも1番棚のアラート
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    assert.equal(r.status, 200);
    let d = (await r.json()) as Peek;
    assert.equal(d.setting.mode, 'save');
    assert.ok(d.alerts.some((a) => a.type === 'shelf1_low' && a.level === 'high'), JSON.stringify(d.alerts));
    assert.equal(r.headers.get('x-as-of'), String(d.as_of));
    const asOf = d.as_of;
    const lastBefore = store.loadWorld(0).lasttime;

    // 2時間たっても peek だけなら時間計算は進まない (as_of・保存した世界の lasttime が変わらない)
    now += 2 * 3600;
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.equal(d.as_of, asOf);
    assert.equal(d.age, 2 * 3600);
    assert.equal(store.loadWorld(0).lasttime, lastBefore);

    // 前回の cursor を seen に渡すと、新しいアラートが無ければ 204 (ヘッダーに as_of と cursor)
    r = await fetch(base + '/api/v1/peek?seen=' + d.cursor, { headers: auth });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('x-as-of'), String(asOf));
    assert.equal(r.headers.get('x-cursor'), d.cursor);

    // facts は facts=1 のときだけ。イベントの終わる時刻は出さない
    r = await fetch(base + '/api/v1/peek?format=json', { headers: auth });
    assert.equal('facts' in ((await r.json()) as object), false);

    // テキストは1行目に as_of、アラートは NEW/OLD で
    r = await fetch(base + '/api/v1/peek?full=1&seen=' + d.cursor, { headers: auth });
    const text = await r.text();
    assert.match(text.split('\n')[0], /^as_of \d+ age \d+s cursor /);
    assert.match(text, /^OLD high shelf1_low /m);

    // digest を読めば時間が進み、as_of が新しくなる
    await fetch(base + '/api/v1/digest', { headers: auth });
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.equal(d.as_of, now);
    assert.equal(d.age, 0);

    // 決算の2時間前に入ると period_soon (時刻で鳴るものは next_timed で前もって分かる)
    assert.ok(d.next_timed && d.next_timed > now);
    now = d.facts.period.next_period - 3600;
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.ok(d.alerts.some((a) => a.type === 'period_soon'), JSON.stringify(d.alerts));

    // 最後の行動から日数がたつと不在閉店の予告 (見るだけでは延びない)
    now = d.facts.closing_at - 86400;
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.ok(d.alerts.some((a) => a.type === 'closing_soon' && a.level === 'critical'), JSON.stringify(d.alerts));
    const closeAt = d.facts.closing_at;
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.equal(d.facts.closing_at, closeAt);
  } finally {
    server.close();
  }
});

test('見張りの設定: mode と on/off、知らない種類は NG', async () => {
  const now = 1_800_000_000;
  const { base, server } = await start(() => now);
  try {
    let r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) });
    const { token } = (await r.json()) as { token: string };
    const auth = { authorization: 'Bearer ' + token };
    const act = async (a: unknown) => (await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify(a) })).text();

    assert.match(await act({ type: 'alerts', mode: 'off' }), /^OK alerts: 見張りの設定: off .*有効: なし/);
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    let d = (await r.json()) as Peek;
    assert.equal(d.alerts.length, 0);
    assert.equal(d.next_timed, null);

    assert.match(await act({ type: 'alerts', mode: 'normal', off: ['time_full'] }), /^OK alerts: 見張りの設定: normal -time_full/);
    r = await fetch(base + '/api/v1/peek?format=json&facts=1', { headers: auth });
    d = (await r.json()) as Peek;
    assert.ok(d.setting.enabled.includes('soldout_soon'));
    assert.ok(!d.setting.enabled.includes('time_full'));

    // on に入れたものは off から外れる
    assert.match(await act({ type: 'alerts', on: 'time_full,wanted' }), /normal \+time_full,wanted/);
    assert.match(await act({ type: 'alerts', on: ['nope'] }), /^NG alerts: 知らないアラートです: nope/);
    assert.match(await act({ type: 'alerts', mode: 'loud' }), /^NG alerts: mode は/);
  } finally {
    server.close();
  }
});

test('倒産の見込み: 決算で払えなければ bankrupt_risk と digest の注意', () => {
  const T = 1_800_000_000;
  const world = newWorld(T, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T);
  const dt = openShop(g0, { name: 'a', shopname: 'あ商店' });
  // 棚8個 (1期100万) なのに手元が少ない
  dt.showcasecount = 8;
  dt.money = 1000;
  dt.moneystock = 0;
  world.lasttime = T;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T);
  const est = periodEstimate(g, dt);
  assert.equal(est.showcase_cost, 1_000_000);
  assert.ok(est.short > 0);
  assert.equal(est.next_period, periodAfter(g, T));
  const d = peekData(g, dt);
  assert.ok(d.alerts.some((a) => a.type === 'bankrupt_risk'));

  // 入金庫の税: 300万なら 200万×12%
  dt.moneystock = 3_000_000;
  dt.money = 2_000_000;
  const est2 = periodEstimate(g, dt);
  assert.equal(est2.tax, 240_000);
  assert.equal(est2.short, 0);
});
