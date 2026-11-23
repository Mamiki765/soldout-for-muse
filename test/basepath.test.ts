// Party と同じドメインの下 (/soldout/) で動かす
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App, withBase } from '../src/api/app.js';
import { BASE_ITEMS, CATALOG } from '../src/data/catalog.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';
import { setViewerKey } from '../src/api/viewer.js';

test('withBase は / で始まるリンクにだけ頭を付ける', () => {
  assert.equal(
    withBase(`<a href="/view/x">a</a><img src="/images/b.png" onerror="this.src='/images/c.png'"><a href="https://x/">x</a><a href="//cdn/">y</a><form action="/view/shop">`, '/soldout'),
    `<a href="/soldout/view/x">a</a><img src="/soldout/images/b.png" onerror="this.src='/soldout/images/c.png'"><a href="https://x/">x</a><a href="//cdn/">y</a><form action="/soldout/view/shop">`,
  );
});

test('/soldout/ の下で API と観戦画面が動く', async () => {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  setViewerKey({ store }, 'vk');
  const app = new App({ store, rng: seededRng(1), clock: () => 1_800_000_000, basePath: '/soldout', publicUrl: 'https://party.example/soldout', imagesDir: resolve('public/images') });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let r = await fetch(base + '/soldout/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name: 'mute', shopname: 'ミュート商店' }) });
    assert.equal(r.status, 201);
    const { token } = (await r.json()) as { token: string };
    r = await fetch(base + '/soldout/api/v1/digest', { headers: { authorization: 'Bearer ' + token } });
    assert.match(await r.text(), /^ミュート商店/);
    r = await fetch(base + '/soldout', { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/soldout/');
    const shop = app.world.shops[0]!;
    const item = BASE_ITEMS[1]!;
    shop.showcase = [item.no];
    shop.price = [250];
    shop.item[item.no - 1] = 2;
    shop.job = 'sword';
    const specialty = `/soldout/images/item-typesign${item.type}.png`;

    r = await fetch(base + '/soldout/view/ranking?k=vk');
    assert.match(r.headers.get('set-cookie') ?? '', /Path=\/soldout\//);
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    const html = await r.text();
    assert.match(html, /href="\/soldout\/view\/market"/);
    assert.doesNotMatch(html, /href="\/view\//);
    assert.ok(html.includes(`src="${specialty}"`));
    assert.match(html, /【剣屋】ミュート商店/);

    const top = async () => {
      const page = await fetch(base + '/soldout/', { headers: { cookie } });
      assert.equal(page.status, 200);
      return page.text();
    };
    const jobs = BASE_ITEMS[78]!.uses.map((u) => u.params[3])
      .filter((code): code is string => !!code && code !== '_default_');
    for (const code of jobs) {
      shop.job = code;
      const sign = `/soldout/images/job-sign-${code}.png`;
      const page = await top();
      assert.ok(page.includes(`<b>ミュート商店</b> <span class="signs"><img class="s" src="${specialty}"`));
      const label = CATALOG.jobTypes[code];
      assert.ok(page.includes(`src="${sign}" width="24" height="16" alt="${label}" title="${label}"`), code);
      assert.match(page, /￥250 ×2/);
      const image = await fetch(base + sign);
      assert.equal(image.status, 200, sign);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.ok((await image.arrayBuffer()).byteLength > 0, sign);
    }

    // 熟練が並んで親職のままの店は職名を表示し、空き棚がある店は専門店札を出さない。
    shop.job = 'weapon';
    shop.showcasecount = 2;
    shop.showcase.push(0);
    const legacy = await top();
    assert.match(legacy, /<span class="signs"><small>【武器屋】<\/small><\/span>/);
    assert.ok(!legacy.includes(specialty));
    shop.job = '';
    assert.match(await top(), /<div class="sn"><b>ミュート商店<\/b><\/div>/);

    r = await fetch(base + '/soldout/images/item-no-1.png');
    assert.equal(r.status, 200);
    r = await fetch(base + '/soldout/api/v1/view-link?format=json', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
    assert.match(((await r.json()) as { url: string }).url, /^https:\/\/party\.example\/soldout\/view\/shop\?key=/);
  } finally {
    server.close();
  }
});
