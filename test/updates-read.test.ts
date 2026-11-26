// 更新の未読管理のテスト: digest の「未読更新」は認証して /api/v1/updates を最新版まで読むまで出つづけ、読んだら消える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { APP_VERSION, UPDATES } from '../src/updates.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';

const prev = UPDATES[1].version;

test('digest の未読更新: 読むまで残り、認証して読んだ店だけ消える', async () => {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  let now = 1_800_000_000;
  let app = new App({ store, clock: () => now, rng: seededRng(1) });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const open = async (name: string, shopname: string) => {
    const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name, shopname }) });
    const { token, shop_id } = (await r.json()) as { token: string; shop_id: number };
    return { auth: { authorization: 'Bearer ' + token }, id: shop_id };
  };
  const shop = (id: number) => app.world.shops.find((s) => s.id === id)!;
  const digest = async (auth: Record<string, string>) => (await fetch(base + '/api/v1/digest', { headers: auth })).text();
  try {
    const a = await open('alice', '試験商店');
    const b = await open('bob', '見本商店');
    // 開店したての店は既読から始まる
    assert.equal(shop(a.id).user._updates_read, APP_VERSION);
    assert.ok(!(await digest(a.auth)).includes('未読更新'));

    // この仕組みより前からある店 (既読の記録なし) は、最新版の短い1行が digest の最後に出る
    delete shop(a.id).user._updates_read;
    delete shop(b.id).user._updates_read;
    let d = await digest(a.auth);
    const line = `未読更新 v${APP_VERSION} /api/v1/updates`;
    assert.ok(d.endsWith(line + '\n'), d);
    assert.equal(d.split('\n').filter((l) => l.includes('未読更新')).length, 1);
    // 手引き・ヒント (各1行まで) を除けば4行まで
    assert.ok(d.trimEnd().split('\n').filter((l) => !/^(手引き|ヒント|街) |^アンケート受付中/.test(l)).length <= 4);
    assert.ok(d.split('\n').filter((l) => /^(手引き|ヒント) /.test(l)).length <= 2);
    const j = (await (await fetch(base + '/api/v1/digest?format=json', { headers: a.auth })).json()) as { update: string };
    assert.equal(j.update, line);
    // 行動の返事に付く digest にも出る
    const act = await (await fetch(base + '/api/v1/actions', { method: 'POST', headers: a.auth, body: JSON.stringify({ type: 'comment', text: 'こんにちは' }) })).text();
    assert.ok(act.includes(line), act);
    // 店ごとの通知 (_seen_version) を出しても既読にはならない
    assert.equal(shop(a.id).user._seen_version, APP_VERSION);
    assert.equal(shop(a.id).user._updates_read, undefined);

    // 7日たっても読むまで消えない (前の「デプロイから7日だけ」には頼らない)
    now += 30 * 86400;
    shop(a.id).money = shop(b.id).money = 100_000_000;
    shop(a.id).lastlogin = shop(b.id).lastlogin = now;
    assert.ok((await digest(a.auth)).includes(line));

    // 見張り (peek) にも未読の更新を知らせる (0.6.1。版ごとに同じ key)。既読は変えない
    const peek = async (auth: Record<string, string>, q = '') => (await (await fetch(base + '/api/v1/peek?format=json&full=1' + q, { headers: auth })).json()) as { alerts: { type: string; level: string; key: string; msg: string }[] };
    let up = (await peek(a.auth)).alerts.find((x) => x.type === 'update');
    assert.ok(up, '既定 (節約) でも出る');
    assert.equal(up.key, `update:${APP_VERSION}`);
    assert.equal(up.level, 'mid');
    assert.ok(up.msg.startsWith(line), up.msg);
    assert.equal(shop(a.id).user._updates_read, undefined);
    // off にすれば出ない、"off":["update"] でも外せる
    shop(a.id).user._alerts = JSON.stringify({ mode: 'save', off: ['update'] });
    assert.ok(!(await peek(a.auth)).alerts.some((x) => x.type === 'update'));
    delete shop(a.id).user._alerts;

    // 認証なしの取得は今までどおり読めるが、誰の既読も変えない
    let r = await fetch(base + '/api/v1/updates');
    assert.equal(r.status, 200);
    let text = await r.text();
    assert.ok(text.startsWith(`# v${APP_VERSION} `));
    assert.ok(!text.includes('既読'));
    r = await fetch(base + '/api/v1/updates?format=json');
    assert.equal(((await r.json()) as { read?: string }).read, undefined);
    // 正しくないトークンでも 200 で読めて、既読は変わらない
    r = await fetch(base + '/api/v1/updates', { headers: { authorization: 'Bearer so_wrong' } });
    assert.equal(r.status, 200);
    assert.ok(!(await r.text()).includes('既読'));
    assert.equal(shop(a.id).user._updates_read, undefined);
    assert.equal(shop(b.id).user._updates_read, undefined);
    // 最新版を含まない取得 (since=最新) では既読にしない
    r = await fetch(base + `/api/v1/updates?since=${APP_VERSION}`, { headers: a.auth });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /より新しい更新はありません/);
    assert.equal(shop(a.id).user._updates_read, undefined);
    assert.equal((await fetch(base + '/api/v1/updates?since=abc')).status, 400);

    // 認証して読むと、その店だけ既読になり、digest から消える (ほかの店には影響しない)
    r = await fetch(base + '/api/v1/updates', { headers: a.auth });
    text = await r.text();
    assert.ok(text.trimEnd().endsWith(`(このお店は v${APP_VERSION} まで既読になりました。digest の「未読更新」は次から出ません)`), text);
    assert.equal(shop(a.id).user._updates_read, APP_VERSION);
    assert.ok(!(await digest(a.auth)).includes('未読更新'));
    assert.ok((await digest(b.auth)).includes(line));
    assert.ok(!(await peek(a.auth)).alerts.some((x) => x.type === 'update'), '読んだら peek からも消える');
    assert.ok((await peek(b.auth)).alerts.some((x) => x.type === 'update'));
    // 既読の記録は再起動しても残る
    app = new App({ store, clock: () => now, rng: seededRng(1) });
    assert.ok(!(await digest(a.auth)).includes('未読更新'));
    assert.ok((await digest(b.auth)).includes(line));

    // 新しい版が出た (= 前に読んだ版が古い) なら、また未読になり、読んだ版より新しいぶんだけ取れる URL が付く
    shop(a.id).user._updates_read = prev;
    d = await digest(a.auth);
    const sinceLine = `未読更新 v${APP_VERSION} /api/v1/updates?since=${prev}`;
    assert.ok(d.endsWith(sinceLine + '\n'), d);
    r = await fetch(base + `/api/v1/updates?since=${prev}&format=json`, { headers: a.auth });
    const body = (await r.json()) as { version: string; updates: { version: string }[]; read: string };
    assert.deepEqual(body.updates.map((u) => u.version), [APP_VERSION]);
    assert.equal(body.read, APP_VERSION);
    assert.ok(!(await digest(a.auth)).includes('未読更新'));
    // 読み直しても既読のまま (返事には既読の行が付く)
    r = await fetch(base + '/api/v1/updates', { headers: a.auth });
    assert.match(await r.text(), /既読になりました/);
    assert.equal(shop(a.id).user._updates_read, APP_VERSION);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    store.close();
  }
});
