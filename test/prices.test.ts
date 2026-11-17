// 値動きの記録 (0.6.0): 今期の最安・最高、決算ごとの記録、/market の前期比、/market/history、digest の値動き
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { PRICE_HISTORY_KEEP, type PeriodPriceRow } from '../src/engine/prices.js';
import { sha256, Store } from '../src/store.js';

async function start(clock: () => number): Promise<{ base: string; server: Server; store: Store; app: App }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(11), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, store, app };
}

type Prices = {
  market: number; shelf_lo: number; shelf_hi: number; shops: number;
  this_period: { since: number; market_lo: number; market_hi: number; whole_lo: number; whole_hi: number };
  history: PeriodPriceRow[];
};

test('値動き: 期中の最安・最高を行動のたびに更新し、決算で1期1行を残す', async () => {
  let now = 1_800_000_000;
  const { base, server, app } = await start(() => now);
  try {
    const reg = (await (await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'a', shopname: 'A商店' }) })).json()) as { token: string };
    const auth = { authorization: 'Bearer ' + reg.token };
    const act = (actions: unknown[]) => fetch(base + '/api/v1/actions?format=json', { method: 'POST', headers: auth, body: JSON.stringify({ actions }) });
    now += 2 * 3600;
    const market = (await (await fetch(base + '/api/v1/market?format=json', { headers: auth })).json()) as { items: { item: number; stock: number; price: number; std: number }[] };
    const pick = market.items.find((x) => x.stock >= 20)!;
    assert.ok(pick);
    let r = await act([{ type: 'buy', item: pick.item, count: 20 }, { type: 'shelf', slot: 1, item: pick.item, percent: 200 }]);
    assert.equal(r.status, 200);
    // 値段を下げる → 相場の最安・最高が両方記録される (高くしておき、決算まで売り切れないように)
    r = await act([{ type: 'shelf', slot: 1, item: pick.item, percent: 180 }]);
    let d = (await (await fetch(base + `/api/v1/items/${pick.item}?format=json`, { headers: auth })).json()) as { prices: Prices };
    const p1 = d.prices;
    assert.equal(p1.shops, 1);
    assert.equal(p1.shelf_lo, p1.shelf_hi);
    assert.ok(p1.this_period.market_hi > p1.this_period.market_lo, JSON.stringify(p1.this_period));
    assert.equal(p1.this_period.market_lo, p1.market);
    assert.ok(p1.this_period.whole_lo > 0 && p1.this_period.whole_hi >= p1.this_period.whole_lo);
    assert.deepEqual(p1.history, []);
    let text = await (await fetch(base + `/api/v1/items/${pick.item}`, { headers: auth })).text();
    assert.match(text, /# 値動き 今: 標準\d+ 相場\d+\(棚\d+・1店・/);
    assert.match(text, /決算ごとの記録はまだありません/);

    // 決算をまたぐ
    // (2時間+30時間で、決算の時刻しだいで1回か2回またぐ)
    now += 30 * 3600;
    await fetch(base + '/api/v1/digest', { headers: auth });
    d = (await (await fetch(base + `/api/v1/items/${pick.item}?format=json`)).json()) as { prices: Prices };
    const periods = d.prices.history.length;
    assert.ok(periods >= 1 && periods <= 2, String(periods));
    if (periods === 2) assert.ok(d.prices.history[0].at > d.prices.history[1].at, '新しい順');
    const h = d.prices.history[0];
    assert.equal(h.item, pick.item);
    assert.ok(h.market_hi >= h.market_lo && h.market_lo > 0, JSON.stringify(h));
    assert.ok(h.sold >= 0 && h.std > 0);
    // 決算で今期の記録は空になる (次の観測から始まる)
    assert.ok(d.prices.this_period.since >= h.at);

    // 前期比が /market に出る
    const m2 = (await (await fetch(base + '/api/v1/market?format=json', { headers: auth })).json()) as { items: { item: number; price_prev: number; price_change: number | null; std_base: number }[] };
    const row = m2.items.find((x) => x.item === pick.item);
    if (row) {
      assert.equal(row.price_prev, h.whole);
      assert.ok(row.std_base > 0);
    }
    text = await (await fetch(base + '/api/v1/market', { headers: auth })).text();
    assert.match(text, /前期比\(単価\/相場\)/);

    // 値段を大きく変えると、digest に値動きが出る
    assert.ok(d.prices.history[0].market > 0, '決算のとき並んでいた');
    app.world.shops[0].item[pick.item - 1] = 10; // 決算のあと売り切れていても並べ直せるように
    r = await act([{ type: 'shelf', slot: 1, item: pick.item, percent: 80 }]);
    const dg = await (await fetch(base + '/api/v1/digest', { headers: auth })).text();
    assert.match(dg, /値動き\(前の決算から\) .*相場-\d+%/);

    // まとめて読む
    r = await fetch(base + `/api/v1/market/history?item=${pick.item},1&n=3&format=json`, { headers: auth });
    assert.equal(r.status, 200);
    const mh = (await r.json()) as { items: { item: number; prices: Prices }[] };
    assert.equal(mh.items.length, 2);
    assert.equal(mh.items[0].prices.history.length, periods);
    r = await fetch(base + '/api/v1/market/history', { headers: auth });
    assert.equal(r.status, 400);
    r = await fetch(base + '/api/v1/market/history?item=99999', { headers: auth });
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});

test('値動きの記録は新しいほうから30期だけ残す', () => {
  const store = new Store(':memory:');
  const row = (at: number, item: number): PeriodPriceRow => ({ at, item, market: 1, market_lo: 1, market_hi: 1, shelf_lo: 1, shelf_hi: 1, shops: 1, whole: 1, whole_lo: 1, whole_hi: 1, whole_stock: 1, sold: 0, std: 1, balance: 100 });
  for (let i = 1; i <= PRICE_HISTORY_KEEP + 5; i++) store.addPriceRows([row(i * 100, 1), row(i * 100, 2)], PRICE_HISTORY_KEEP);
  const h = store.priceHistory(1, 100);
  assert.equal(h.length, PRICE_HISTORY_KEEP);
  assert.equal(h[0].at, (PRICE_HISTORY_KEEP + 5) * 100);
  assert.equal(store.lastPeriodPrices().size, 2);
});
