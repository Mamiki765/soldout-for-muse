import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { setViewerKey } from '../src/api/viewer.js';
import { Store } from '../src/store.js';

for (const basePath of ['', '/soldout']) {
  test(`共通導入ページの合言葉・再訪・Party キーでの開店 (${basePath || '/'})`, async () => {
    const store = new Store(':memory:');
    const app = new App({
      store, basePath, publicUrl: 'https://party.example' + basePath, partyPublicUrl: 'https://party.example',
      partyVerifier: async (key) => key === 'mct_test_komugi' ? { ownerId: 'owner-komugi', name: 'こむぎ' } : undefined,
    });
    const server = createServer((req, res) => void app.handle(req, res));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}${basePath}`;
    const start = root + '/start';
    const invite = 'mip_test_shared';
    try {
      store.setSetting('party_join_invite', invite);
      let r = await fetch(start);
      assert.equal(r.status, 503);
      assert.ok(!(await r.text()).includes(invite));
      setViewerKey(app, 'test-pass');
      for (const path of [start + '?password=test-pass&k=test-pass', start + '/']) {
        r = await fetch(path);
        const locked = await r.text();
        assert.match(locked, /Museでもわかる！導入法/);
        assert.equal(new URL(locked.match(/<form method="post" action="([^"]+)"/)![1], path).href, start);
        assert.ok(!locked.includes(invite));
        assert.ok(!locked.includes('test-pass'));
        assert.equal(r.headers.get('set-cookie'), null);
      }
      const unlock = (password: string) => fetch(start, { method: 'POST', body: new URLSearchParams({ password }) });
      r = await unlock('wrong');
      assert.equal(r.status, 401);
      assert.ok(!(await r.text()).includes(invite));
      r = await unlock('test-pass');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control')!, /no-store/);
      const cookie = r.headers.get('set-cookie')!;
      assert.ok(cookie.includes(`Path=${basePath}/;`));
      assert.match(cookie, /Max-Age=2592000/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      const headers = { cookie: cookie.split(';')[0] };
      const guide = await r.text();
      assert.ok(guide.includes(invite));
      assert.match(guide, /href="https:\/\/party\.example\/join"/);
      assert.match(guide, /Secure Vault/);
      assert.ok(guide.includes(`POST https://party.example${basePath}/api/v1/register`));
      assert.ok(guide.includes(`GET https://party.example${basePath}/api/v1/digest`));
      assert.equal(await (await fetch(start, { headers })).text(), guide);
      r = await fetch(root + '/', { headers });
      assert.equal(r.status, 200, '街の見学にも同じ合言葉を使う');
      assert.match(await r.text(), /href="\.\/start"/);

      const key = { authorization: 'Bearer mct_test_komugi' };
      const body = guide.match(/<code class="value">(\{"shopname":[^<]+\})<\/code>/)![1];
      for (const status of [201, 200]) {
        r = await fetch(root + '/api/v1/register', { method: 'POST', body, headers: key });
        assert.equal(r.status, status);
      }
      assert.match(await (await fetch(root + '/api/v1/digest', { headers: key })).text(), /^こむぎ商店/);
      // 案内にある2種類の見張りを、同じ cursor で実際に読み比べる。
      const peek = new URL(root + '/api/v1/peek?format=json');
      r = await fetch(peek, { headers: key });
      peek.searchParams.set('seen', r.headers.get('x-cursor')!);
      r = await fetch(peek, { headers: key });
      assert.equal(r.status, 204);
      assert.equal((await r.arrayBuffer()).byteLength, 0);
      const cursor = r.headers.get('x-cursor')!;
      const query = guide.match(/\/peek\?(format=json&amp;facts=1[^<]+)<\/code>/)![1].replaceAll('&amp;', '&');
      peek.search = query;
      peek.searchParams.set('seen', cursor);
      r = await fetch(peek, { headers: key });
      assert.equal(r.status, 200);
      const snapshot = await r.json() as { new: unknown[]; facts: { shelves: { slot: number }[]; period: { short: number } } };
      assert.deepEqual(snapshot.new, []);
      assert.equal(snapshot.facts.shelves[0].slot, 1);
      assert.equal(typeof snapshot.facts.period.short, 'number');
      store.setSetting('party_join_invite', 'mip_rotated');
      assert.match(await (await fetch(start, { headers })).text(), /mip_rotated/);
      setViewerKey(app, 'new-pass');
      assert.ok(!(await (await fetch(start, { headers })).text()).includes('mip_rotated'));
      store.setSetting('party_join_invite', undefined);
      r = await unlock('new-pass');
      assert.equal(r.status, 503);
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
      store.close();
    }
  });
}
