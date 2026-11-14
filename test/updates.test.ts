import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { setViewerKey } from '../src/api/viewer.js';
import { BASE_ITEMS } from '../src/data/catalog.js';
import { APP_VERSION, UPDATES, type FashionUpdate } from '../src/updates.js';
import { sha256, Store } from '../src/store.js';
import { seededRng } from '../src/engine/rng.js';

for (const basePath of ['', '/soldout']) test(`更新履歴HTML・JSON・digest・通知 (${basePath || '/'})`, async () => {
  const store = new Store(':memory:');
  store.setSetting('invite_hash',sha256('inv'));
  let app = new App({ store,basePath,clock:()=>1_800_000_000 });
  const server = createServer((req,res) => void app.handle(req,res));
  await new Promise<void>((r) => server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${basePath}`;
  try {
    // 既存のAPIと同じテキスト既定・JSON選択。履歴は認証なしで取得できる。
    let res = await fetch(base+'/api/v1/updates?format=json');
    assert.equal(res.status,200);
    const data = await res.json() as { version: string; updates: typeof UPDATES };
    assert.equal(data.version,'0.3.0');
    assert.equal(data.updates[0].version,'0.3.0');
    const update = data.updates.find((u) => u.version === '0.2.0') as FashionUpdate;
    assert.equal(update.date,'2026-11-13');
    assert.equal(update.new_items.length,23);
    for (const item of update.new_items) assert.deepEqual([item.name,item.price],[BASE_ITEMS[item.item].name,BASE_ITEMS[item.item].price]);
    assert.deepEqual(update.gathering.map((g) => g.needexp),[200,400,600,200,400]);
    assert.equal(update.recipe_changes.length,4);
    assert.deepEqual(update.recipe_changes[0].before,[{item:5,name:'鉄塊',count:20}]);
    assert.deepEqual(update.recipe_changes[0].after,[{item:5,name:'鉄塊',count:6},{item:88,name:'鉄鉱石',count:20},{item:92,name:'砂鉄',count:5}]);
    res = await fetch(base+'/api/v1/updates');
    assert.match(res.headers.get('content-type')!,/text\/plain/);
    const text = await res.text();
    assert.match(text,/鉄塊×20 → 鉄塊×6、鉄鉱石×20、砂鉄×5/);
    assert.match(text,/道具屋: 中間素材5種とファッション7種の製作に職業ボーナス/);
    assert.match(text,/^# v0\.3\.0 2026-11-14 行動の書き方をわかりやすく/);
    assert.match(text,/^# v0\.2\.1 2026-11-13 混み合ったときの返事を改善/m);
    assert.match(text,/Retry-After/);
    assert.deepEqual(update.jobs.map((j) => j.job),['山師','武器屋','薬屋','道具屋']);
    res = await fetch(base+'/updates');
    assert.equal(res.status,200);
    let html = await res.text();
    for (const it of update.new_items) {
      assert.ok(html.includes(it.name));
      assert.ok(html.includes(it.price.toLocaleString('ja-JP')+'円'));
    }
    assert.ok(html.includes('作るほど赤字'));
    assert.ok(html.includes('街の1日の需要'));
    for (const j of update.jobs) assert.ok(html.includes(j.job) && html.includes(j.text));
    assert.ok(html.includes('職業ボーナス'));
    assert.match(html,/href="[^"]*\/updates"/);

    // 履歴も観戦画面と同じ合言葉を使い、basePathを維持する。
    setViewerKey({store},'vk');
    assert.equal((await fetch(base+'/updates')).status,401);
    res = await fetch(base+'/updates?k=vk');
    assert.equal(res.status,200);
    html = await res.text();
    assert.ok(html.includes(`href="${basePath}/updates"`));
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(base+'/updates',{headers:{cookie}})).status,200);

    res = await fetch(base+'/api/v1/register?format=json',{method:'POST',body:JSON.stringify({invite:'inv',name:'test',shopname:'試験商店'})});
    const {token,shop_id} = await res.json() as {token:string;shop_id:number};
    const auth = {authorization:'Bearer '+token};
    res = await fetch(base+'/api/v1/digest',{headers:auth});
    const digest = await res.text();
    assert.equal(digest.split('\n').filter((l) => l.startsWith('v0.3.0 更新あり')).length,1);
    assert.ok(digest.endsWith('v0.3.0 更新あり /updates\n'));
    assert.ok(digest.trimEnd().split('\n').length <= 4);
    res = await fetch(base+'/api/v1/digest?format=json',{headers:auth});
    assert.equal((await res.json() as {version:string}).version,APP_VERSION);

    // 店舗ごとの通知を既存の未読ログで一度だけ届け、再起動後も再通知しない。
    res = await fetch(base+'/api/v1/log?format=json',{headers:auth});
    const logs = await res.json() as {msg:string;from:number}[];
    assert.equal(logs.filter((l) => l.msg.startsWith('【更新】')).length,1);
    assert.equal(logs.find((l) => l.msg.startsWith('【更新】'))!.from,shop_id);
    res = await fetch(base+'/api/v1/log?format=json',{headers:auth});
    assert.deepEqual(await res.json(),[]);
    app = new App({store,basePath,clock:()=>1_800_000_000});
    await fetch(base+'/api/v1/me',{headers:auth});
    assert.equal(store.readLogs(shop_id,{limit:100}).filter((l) => l.msg.startsWith('【更新】')).length,1);
    assert.equal(store.readLogs(shop_id,{limit:100}).find((l) => l.msg.startsWith('【更新】'))!.msg,'【更新】v0.3.0: 金庫からの引き出しは withdraw でも通り、棚の数は shelves で直接指定できます。コツ集 /api/v1/tips も置きました (読むかは自由)。詳細は /updates');
    const dt = app.world.shops.find((s) => s.id === shop_id)!;
    assert.equal(dt.user._seen_version,'0.3.0');
    dt.user._seen_version = '0.2.1'; // バージョンが進んだ場合だけ、再び1回通知
    await fetch(base+'/api/v1/me',{headers:auth});
    await fetch(base+'/api/v1/me',{headers:auth});
    assert.equal(store.readLogs(shop_id,{limit:100}).filter((l) => l.msg.startsWith('【更新】')).length,2);
    dt.user._seen_version = '0.1.0'; // 2つ前なら、取りこぼした版も古い順に届く
    // 7日放置すると、優勝賞品の店番ロボット (維持費3万/日) で倒産することがある。下の確認は倒産と関係ないので資金を足しておく
    dt.money = 10_000_000;
    await fetch(base+'/api/v1/me',{headers:auth});
    const notes = store.readLogs(shop_id,{limit:100}).filter((l) => l.msg.startsWith('【更新】')).map((l) => l.msg.slice(0,12));
    assert.equal(notes.length,5);
    assert.ok(notes.includes('【更新】v0.2.0: ') && notes.includes('【更新】v0.2.1: ') && notes.includes('【更新】v0.3.0: '));

    // digest の短い案内はデプロイ (この版の初回起動) から7日間だけ。再起動しても起点は変わらない。
    const since = 1_800_000_000;
    assert.equal(store.getSetting('update_since:0.3.0'),String(since));
    for (const [now,shown] of [[since+7*86400-1,true],[since+7*86400,false]] as const) {
      // 乱数を固定して毎回同じ結果にする
      app = new App({store,basePath,clock:()=>now,rng:seededRng(1)});
      assert.equal(app.updateSince,since);
      const text = await (await fetch(base+'/api/v1/digest',{headers:auth})).text();
      assert.equal(text.includes('v0.3.0 更新あり /updates'),shown,text);
    }
  } finally {
    await new Promise<void>((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});
