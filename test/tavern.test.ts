// SOLD OUT for Muse — 1.8.0 商店街の酒場 (Muse Party の部屋) とのつなぎ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { Tavern, isNews } from '../src/api/tavern.js';
import { sha256, Store } from '../src/store.js';
import type { LogEntry } from '../src/engine/types.js';

type Call = { method: string; path: string; auth: string | null; key: string | null; body: any };

/** 偽の Party。呼ばれた中身を覚えて、決めた返事を返す */
function fakeParty(handler: (c: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const h = new Headers(init?.headers);
    const c: Call = { method: init?.method ?? 'GET', path: u.pathname + u.search, auth: h.get('authorization'), key: h.get('x-internal-key'), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const log = (mode: number, msg: string, extra: Partial<LogEntry> = {}): LogEntry => ({ time: 1, mode, from: 0, to: 0, msg, ...extra });

test('1.8.0 街の噂: 大きな出来事と Muse の万引きだけを流し、NPC の空振り・小さな記録・個人の記録は流さない', () => {
  assert.ok(isNews(log(2, 'あいな商店が総額￥600000の万引き被害に遭いました')));
  assert.ok(isNews(log(2, '新たに鉄鉱脈が見つかりました')));
  assert.ok(isNews(log(1, '「今期の優勝店はあいな商店さんでした。おめでとうございます。」')));
  assert.ok(!isNews(log(2, 'あいな商店へ万引きが入りましたが阻止されました')), 'NPC の阻止');
  assert.ok(!isNews(log(2, 'あいな商店へ万引きが入り店番ロボットが破壊されました')), 'NPC の破壊');
  assert.ok(!isNews(log(2, 'あいな商店に入った万引き犯は何も取らずに逃げました')), 'NPC の空振り');
  assert.ok(isNews(log(2, 'あいな商店に入った万引き犯は何も取らずに逃げました', { news: true })), 'Muse の万引きの空振りは流す');
  assert.ok(isNews(log(3, 'Aが Bへ万引きに入りましたが失敗しました', { news: true })), 'Muse の万引きの失敗 (段3) も流す');
  assert.ok(!isNews(log(3, 'あいな商店の陳列棚が5個になりました')), '段3 は流さない');
  assert.ok(!isNews(log(2, 'あいな商店がギルド無所属ペナルティを受けました。-\\100')));
  assert.ok(!isNews(log(1, 'タイムシガレットをお届けしました', { from: 3 })), '店ごとの記録は流さない');
});

test('1.8.0 街の噂: 1時間6件まで。あふれた分は次に「ほか N 件」にまとめ、同じ出来事は同じ client_id', async () => {
  const p = fakeParty(() => ({ status: 200, json: { ok: true } }));
  const t = new Tavern({ partyUrl: 'http://party', publicUrl: 'https://party.example', internalKey: 'k', fetchImpl: p.fetchImpl });
  t.onLogs(Array.from({ length: 9 }, (_, i) => log(2, `噂${i}`, { time: 100 + i })));
  const now = 1_800_000_000_000;
  assert.equal(await t.flushNews(now), 6);
  const first = p.calls[0];
  assert.equal(first.path, '/api/internal/news');
  assert.equal(first.key, 'k');
  assert.equal(first.body.items.length, 6);
  assert.match(first.body.items[0].client_id, /^news-[0-9a-f]{24}$/);
  assert.deepEqual(t.pending, { queued: 0, held: 3 });
  assert.equal(await t.flushNews(now + 60_000), 0, '同じ1時間はもう送らない');
  assert.equal(await t.flushNews(now + 3600_000 + 1), 1, '次の1時間で「ほか」の1件');
  assert.match(p.calls[1].body.items[0].text, /^ほか3件の噂がありました/);
  // 鍵が無ければ何も積まない
  const none = new Tavern({ partyUrl: 'http://party', publicUrl: '', fetchImpl: p.fetchImpl });
  none.onLogs([log(2, 'x')]);
  assert.deepEqual(none.pending, { queued: 0, held: 0 });
});

async function withApp(handler: (c: Call) => { status: number; json?: unknown }, fn: (o: { base: string; app: App; store: Store; calls: Call[] }) => Promise<void>) {
  const store = new Store(':memory:');
  const p = fakeParty(handler);
  const tavern = new Tavern({ partyUrl: 'http://party', publicUrl: 'https://party.example', internalKey: 'k', fetchImpl: p.fetchImpl });
  const app = new App({
    store, clock: () => 1_800_000_000, tavern,
    partyVerifier: async (key) => (key === 'mct_a' ? { ownerId: 'owner-a', name: 'あい' } : key === 'mct_b' ? { ownerId: 'owner-b', name: 'びい' } : undefined),
  });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn({ base, app, store, calls: p.calls });
  } finally {
    server.close();
  }
}

const post = (base: string, path: string, token: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });

test('1.8.0 開店で酒場に入り、POST /chat・/bbs は本人のトークンのまま酒場へ (入っていなければ入ってから)', async () => {
  let joined = false;
  await withApp((c) => {
    if (c.path === '/api/rooms/join') {
      joined = true;
      return { status: 200, json: { ok: true } };
    }
    if (c.path === '/api/rooms/sakaba/messages') {
      if (c.body.text === '速すぎ') return { status: 429, json: { error: 'too_fast', retry_after: 120 } };
      if (c.body.text === 'まだ') return { status: 403, json: { error: 'rules_not_accepted' } };
      if (!joined) return { status: 403, json: { error: 'not_joined' } };
      return { status: 201, json: { message: { id: 77 } } };
    }
    return { status: 404, json: { error: 'not_found' } };
  }, async ({ base, calls }) => {
    let r = await post(base, '/api/v1/register', 'mct_a', { shopname: 'アイナ商店' });
    assert.equal(r.status, 201);
    const reg = await r.json() as { tavern?: { room: string } };
    assert.equal(reg.tavern?.room, 'sakaba');
    await new Promise((ok) => setTimeout(ok, 20));
    const j = calls.find((c) => c.path === '/api/rooms/join');
    assert.equal(j?.auth, 'Bearer mct_a', '本人のトークンで入る');
    assert.equal(j?.key, null, '本人のふるまいには中の鍵を付けない');

    joined = false;
    r = await post(base, '/api/v1/bbs', 'mct_a', { text: '鉄鉱石を募集します。'.repeat(20) });
    assert.equal(r.status, 200, '前の140字の縛りはない');
    const ok = await r.json() as { id: number; post: string };
    assert.equal(ok.id, 77);
    assert.equal(ok.post, 'https://party.example/api/rooms/sakaba/messages');
    assert.ok(calls.filter((c) => c.path === '/api/rooms/join').length >= 2, 'not_joined なら入ってから送り直す');

    r = await post(base, '/api/v1/chat', 'mct_a', { text: '速すぎ' });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '120');
    assert.match((await r.json() as { error: string }).error, /5分に1回/);
    r = await post(base, '/api/v1/chat', 'mct_a', { text: 'まだ' });
    assert.equal(r.status, 403);
    assert.match((await r.json() as { error: string }).error, /accept-rules/);
  });
});

test('1.8.0 GET /chat は酒場を読み、未読の位置を進める。?legacy=1 で前の書き込み', async () => {
  const msgs = [
    { id: 10, at: '2026-11-27T01:00:00Z', from: 'あい', shop: { som: 'som0001', name: 'あいな商店', open: true }, kind: '', text: 'こんにちは', reply_to: 0 },
    { id: 12, at: '2026-11-27T01:05:00Z', from: '街の噂', kind: 'news', text: '新たに鉄鉱脈が見つかりました', reply_to: 0 },
  ];
  await withApp((c) => {
    if (c.path === '/api/rooms/join') return { status: 200, json: { ok: true } };
    if (c.path.startsWith('/api/internal/messages')) {
      const after = Number(new URL('http://x' + c.path).searchParams.get('after') ?? -1);
      return { status: 200, json: { messages: after >= 0 ? msgs.filter((m) => m.id > after) : msgs, latest: 12 } };
    }
    return { status: 404 };
  }, async ({ base, store, calls }) => {
    await post(base, '/api/v1/register', 'mct_a', { shopname: 'アイナ商店' });
    store.addPost({ board: 'bbs', time: 1_799_999_000, shop_id: 1, shopname: 'アイナ商店', msg: '前の書き込み' }, 100);
    // ?all=1 は眺めるだけ。未読の位置は動かさない
    let r = await fetch(base + '/api/v1/chat?all=1', { headers: { authorization: 'Bearer mct_a' } });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/v1/chat', { headers: { authorization: 'Bearer mct_a' } });
    let text = await r.text();
    assert.match(text, /【商店街の酒場】/);
    assert.match(text, /#10 .*あい［あいな商店 som0001］: こんにちは/);
    assert.match(text, /街の噂: 新たに鉄鉱脈が見つかりました/);
    assert.ok(calls.some((c) => c.path === '/api/internal/messages?before=0&limit=30' && c.key === 'k'));
    r = await fetch(base + '/api/v1/chat', { headers: { authorization: 'Bearer mct_a' } });
    assert.match(await r.text(), /新しい発言はありません/);
    assert.ok(calls.some((c) => c.path === '/api/internal/messages?after=12&limit=30'), '2回目は前に読んだ所から');
    r = await fetch(base + '/api/v1/bbs?legacy=1&all=1', { headers: { authorization: 'Bearer mct_a' } });
    text = await r.text();
    assert.match(text, /前の書き込み/);
  });
});

test('1.8.0 引っ越し: 残っている書き込みを本人 (Party の owner_id) の発言として一度だけ送り、店名表記の表も送る', async () => {
  await withApp((c) => {
    if (c.path === '/api/rooms/join') return { status: 200, json: { ok: true } };
    if (c.path === '/api/internal/import') return { status: 200, json: { ok: true, posted: c.body.items.length, skipped: 0 } };
    if (c.path === '/api/internal/badges') return { status: 200, json: { ok: true } };
    return { status: 404 };
  }, async ({ base, app, store, calls }) => {
    const reg = await (await post(base, '/api/v1/register', 'mct_a', { shopname: 'アイナ商店' })).json() as { shop_id: number };
    store.addPost({ board: 'chat', time: 100, shop_id: reg.shop_id, shopname: 'アイナ商店', msg: 'A &amp; B &lt;3' }, 20);
    store.addPost({ board: 'bbs', time: 50, shop_id: 99, shopname: '消えた店', msg: 'さようなら' }, 100);
    const r = await app.importLegacyBoards();
    assert.deepEqual(r, { posted: 2, skipped: 0 });
    const items = calls.find((c) => c.path === '/api/internal/import')!.body.items;
    assert.deepEqual(items.map((i: any) => [i.owner_id, i.text, i.client_id, i.name]), [
      ['', 'さようなら', 'so-bbs-2', '消えた店'],
      ['owner-a', 'A & B <3', 'so-chat-1', 'アイナ商店'],
    ], '古い順・本文は元の文字に戻す');
    assert.equal(await app.importLegacyBoards(), null, '二度目は送らない');

    const badges = app.tavernBadges();
    assert.deepEqual(badges, [{ owner_id: 'owner-a', som: badges[0].som, shop: 'アイナ商店' }]);
    assert.match(badges[0].som, /^som\d{4}$/);
  });
});

test('1.8.0 /town/map に区の一覧 (中央=0 が先頭、番号順)', async () => {
  await withApp(() => ({ status: 200, json: { ok: true } }), async ({ base }) => {
    await post(base, '/api/v1/register', 'mct_a', { shopname: 'アイナ商店' });
    const r = await fetch(base + '/api/v1/town/map?format=json', { headers: { authorization: 'Bearer mct_a' } });
    assert.equal(r.status, 200);
    const d = await r.json() as { all_districts: { no: number; name: string | null }[] };
    assert.equal(d.all_districts[0].no, 0);
    assert.ok(d.all_districts.length >= 2, '中央＋1区以上');
    const nos = d.all_districts.map((x) => x.no);
    assert.deepEqual(nos, [...nos].sort((a, b) => a - b));
  });
});

test('1.8.0 街の噂: 送っている間に積まれた噂は消えず、届かなければ列に戻る', async () => {
  let release!: () => void;
  let status = 200;
  const sent: any[] = [];
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init!.body)));
    await new Promise<void>((r) => { release = r; });
    return new Response('{}', { status });
  }) as typeof fetch;
  const t = new Tavern({ partyUrl: 'http://party', publicUrl: '', internalKey: 'k', fetchImpl, newsPerHour: 100, newsPerDay: 100 });
  const now = 1_800_000_000_000;
  t.onLogs([log(2, '噂A', { time: 1 })]);
  let p = t.flushNews(now);
  await new Promise((r) => setImmediate(r));
  t.onLogs([log(2, '噂B', { time: 2 })]);
  release();
  assert.equal(await p, 1);
  assert.deepEqual(t.pending, { queued: 1, held: 0 }, '噂B は残る');
  status = 500;
  p = t.flushNews(now + 1);
  await new Promise((r) => setImmediate(r));
  t.onLogs([log(2, '噂C', { time: 3 })]);
  release();
  assert.equal(await p, 0);
  assert.deepEqual(t.pending, { queued: 2, held: 0 }, '届かなかった噂B と、そのあいだの噂C');
  assert.equal(sent[1].items[0].text, '噂B');
});

test('1.8.0 Party に参加していない店 (so_ トークン) は古い板に書けず、酒場への行き方を返す', async () => {
  await withApp(() => ({ status: 404 }), async ({ base, store }) => {
    store.setSetting('invite_hash', sha256('inv'));
    const rr = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name: 'test', shopname: '試験商店' }) });
    const reg = await rr.json() as { token: string };
    assert.ok(reg.token, JSON.stringify(reg));
    assert.match(reg.token, /^so_/);
    const r = await post(base, '/api/v1/chat', reg.token, { msg: 'こんにちは' });
    assert.equal(r.status, 403);
    assert.match(await r.text(), /商店街の酒場.*POST https:\/\/party\.example\/api\/rooms\/sakaba\/messages/s);
    assert.equal(store.readPosts('chat', 0, 10).length, 0, '誰にも読まれない板には残さない');
  });
});
