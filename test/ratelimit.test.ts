// 上限と待ち方: Retry-After、登録はトークンごと、招待コードの失敗と Party への確認は全体で数える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { sha256, Store } from '../src/store.js';

test('上限に当たったら待つ秒数を返し、ほかの Muse を巻き込まない', async () => {
  let partyCalls = 0;
  let partyDown = false;
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  const app = new App({
    store, ratePerMinute: 5, registerPerMinute: 2, partyChecksPerMinute: 3, inviteFailPerMinute: 2,
    partyVerifier: async (t) => {
      partyCalls++;
      if (partyDown) throw new Error('down');
      return t.startsWith('pt-') ? { ownerId: 'o-' + t, name: t } : undefined;
    },
  });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string) =>
    fetch(base + path, { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) });
  try {
    // 1体が登録を連打しても、その子の枠だけが減る
    let r = await post('/api/v1/register', { shopname: 'ミュート商店' }, 'pt-mute');
    assert.equal(r.status, 201);
    assert.equal((await post('/api/v1/register', { shopname: 'ミュート商店' }, 'pt-mute')).status, 200);
    r = await post('/api/v1/register?format=json', { shopname: 'ミュート商店' }, 'pt-mute');
    assert.equal(r.status, 429);
    const wait = Number(r.headers.get('retry-after'));
    assert.ok(wait >= 1 && wait <= 30, String(wait));
    const j = (await r.json()) as { retry_after: number; error: string };
    assert.equal(j.retry_after, wait);
    assert.match(j.error, /秒後にもう一度どうぞ/);
    assert.equal((await post('/api/v1/register', { shopname: 'ラピス堂' }, 'pt-lapis')).status, 201, 'ほかの Muse は登録できる');

    // 招待コードの失敗は全体で数える。正しいコードの人は通る
    assert.equal((await post('/api/v1/register', { invite: 'x', name: 'a', shopname: '試験商店' })).status, 403);
    assert.equal((await post('/api/v1/register', { invite: 'y', name: 'a', shopname: '試験商店' })).status, 403);
    r = await post('/api/v1/register', { invite: 'inv', name: 'a', shopname: '試験商店' });
    assert.equal(r.status, 429, '失敗が上限に達したら、しばらく受け付けない');
    assert.ok(Number(r.headers.get('retry-after')) >= 1);

    // 毎回違うトークンでも、Party への確認は全体の上限で止まる
    const before = partyCalls;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await fetch(base + '/api/v1/digest', { headers: { authorization: 'Bearer bad-' + i } })).status);
    assert.ok(partyCalls - before <= 3, `party calls ${partyCalls - before}`);
    assert.ok(codes.includes(429), codes.join(','));
    // 覚えているトークンは確認なしで遊べる
    assert.equal((await fetch(base + '/api/v1/digest', { headers: { authorization: 'Bearer pt-lapis' } })).status, 200);

    // ふつうの上限も待つ秒数つき
    let last = 200;
    for (let i = 0; i < 6 && last !== 429; i++) last = (await fetch(base + '/api/v1/digest', { headers: { authorization: 'Bearer pt-lapis' } })).status;
    assert.equal(last, 429);

    // Party が不調なら 503 と Retry-After。しばらくは聞きに行かない
    partyDown = true;
    const app2 = new App({ store: new Store(':memory:'), partyVerifier: async () => { partyCalls++; throw new Error('down'); } });
    const s2 = createServer((req, res) => void app2.handle(req, res));
    await new Promise<void>((ok) => s2.listen(0, '127.0.0.1', ok));
    const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const n0 = partyCalls;
      r = await fetch(b2 + '/api/v1/digest', { headers: { authorization: 'Bearer pt-a' } });
      assert.equal(r.status, 503);
      assert.equal(r.headers.get('retry-after'), '30');
      await fetch(b2 + '/api/v1/digest', { headers: { authorization: 'Bearer pt-b' } });
      assert.equal(partyCalls - n0, 1, '不調のあいだは問い合わせを控える');
    } finally {
      s2.close();
    }
  } finally {
    server.close();
  }
});
