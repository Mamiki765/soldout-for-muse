import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { setViewerKey } from '../src/api/viewer.js';
import { BASE_ITEMS } from '../src/data/catalog.js';
import { APP_VERSION, UPDATE_NOTICE, UPDATES, type FashionUpdate } from '../src/updates.js';
import { sha256, Store } from '../src/store.js';

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
    assert.equal(data.version,'1.8.2');
    assert.equal(data.updates[0].title,'アイテムの説明の書き足し');
    data.updates.shift();
    assert.equal(data.updates[0].title,'街の職業の分布と転職の説明');
    data.updates.shift();
    assert.equal(data.updates[0].title,'商店街の酒場');
    data.updates.shift();
    assert.equal(data.updates[0].title,'道具の3職と買い取り募集');
    data.updates.shift();
    assert.equal(data.updates[0].title,'店主アンケート');
    data.updates.shift();
    assert.equal(data.updates[0].title,'石炭と寒波');
    assert.deepEqual((data.updates[0] as { new_items: { item: number }[] }).new_items.map((it) => it.item),[139,140,141]);
    assert.equal(data.updates[1].title,'1.4.0 より前の働きを職・商人ポイントに');
    assert.equal(data.updates[2].title,'職レベルとお手伝い妖精');
    assert.equal(data.updates[3].title,'13職・取引時間・乳搾りの熟練');
    assert.equal(data.updates[4].title,'街の地図を動かしやすく');
    assert.equal(data.updates[5].title,'街の地図と住所');
    assert.deepEqual((data.updates[5] as { new_items: { item: number }[] }).new_items.map((it) => it.item),[133,134]);
    assert.deepEqual(data.updates[6], {
      version: '1.1.3', date: '2026-11-22', title: '街暦',
      summary: '街暦を表示しました。', notice: '街暦を表示しました。', notes: [],
    });
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
    assert.match(text,/^# v1\.8\.2 2026-11-27 アイテムの説明の書き足し\n/);
    assert.match(text,/\n# v1\.8\.1 2026-11-27 街の職業の分布と転職の説明\n/);
    assert.match(text,/\n# v1\.8\.0 2026-11-27 商店街の酒場\n/);
    assert.match(text,/\n# v1\.7\.0 2026-11-26 道具の3職と買い取り募集\n/);
    assert.match(text,/\n# v1\.6\.0 2026-11-26 店主アンケート\n/);
    assert.match(text,/\n# v1\.4\.1 2026-11-24 1\.4\.0 より前の働きを職・商人ポイントに\n/);
    assert.match(text,/\n# v1\.4\.0 2026-11-23 職レベルとお手伝い妖精\n/);
    assert.match(text,/\n# v1\.3\.0 2026-11-23 13職・取引時間・乳搾りの熟練\n/);
    assert.match(text,/\n# v1\.2\.1 2026-11-22 街の地図を動かしやすく\n/);
    assert.match(text,/\n# v1\.2\.0 2026-11-22 街の地図と住所\n/);
    assert.match(text,/\n# v1\.1\.3 2026-11-22 街暦\n街暦を表示しました。\n/);
    assert.match(text,/^# v1\.1\.2 2026-11-21 改装中 \(休業\) に入る前に確認/m);
    assert.match(text,/^# v1\.1\.1 2026-11-21 干し草を与えて搾るときも牛の寿命が減る/m);
    assert.match(text,/^# v1\.1\.0 2026-11-21 本・地図・牛・桶に耐久、改装中 \(休業\)、市場を街の広さに比例/m);
    assert.match(text,/^# v1\.0\.2 2026-11-21 市場の値段を街の広さに合わせる/m);
    assert.match(text,/^# v1\.0\.1 2026-11-21 イベントの見直しと香水・エリクシルの客/m);
    assert.match(text,/^# v1\.0\.0 2026-11-19 職業バランスの見直しと新商品16種/m);
    assert.match(text,/^# v0\.6\.2 2026-11-19 Museでもわかる！導入法/m);
    assert.match(text,/^# v0\.6\.1 2026-11-18 番犬 \(peek\) でも更新に気づける/m);
    assert.match(text,/^# v0\.6\.0 2026-11-18 値動き/m);
    assert.match(text,/^# v0\.5\.1 2026-11-17 キットとフォントがそろいました/m);
    assert.match(text,/^# v0\.4\.1 2026-11-16 禁断の書を手放せるように/m);
    assert.match(text,/^# v0\.4\.0 2026-11-16 手引き \(はじめかた\) とヒント/m);
    assert.match(text,/^# v0\.3\.3 2026-11-15 募集の自動再掲・維持費の内訳・固めプリン・乳製品の熟練/m);
    assert.match(text,/^# v0\.3\.2 2026-11-15 見張り \(peek\) と起こす設定/m);
    assert.match(text,/^# v0\.3\.1 2026-11-15 説明とエラー文をわかりやすく/m);
    assert.match(text,/^# v0\.3\.0 2026-11-14 香りと乳菓の新商品・行動の書き方をわかりやすく/m);
    assert.match(text,/^# v0\.2\.1 2026-11-13 混み合ったときの返事を改善/m);
    assert.match(text,/Retry-After/);
    assert.deepEqual(update.jobs.map((j) => j.job),['山師','武器屋','薬屋','道具屋']);
    res = await fetch(base+'/updates');
    assert.equal(res.status,200);
    let html = await res.text();
    assert.match(html, /<h3>v1\.1\.3 — 街暦 \(2026-11-22\)<\/h3><p>街暦を表示しました。<\/p>\s*<\/article>/);
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
    // 開店したての店は今の説明書から始めるので、digest に未読更新は出ない (既読の出し分けは updates-read.test.ts)
    res = await fetch(base+'/api/v1/digest',{headers:auth});
    const digest = await res.text();
    assert.ok(!digest.includes('未読更新'),digest);
    // 手引き・ヒントの行 (各1行まで) を除けば3行まで
    assert.ok(digest.trimEnd().split('\n').filter((l) => !/^(手引き|ヒント|街|街の職業) |^アンケート受付中/.test(l)).length <= 3);
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
    assert.equal(store.readLogs(shop_id,{limit:100}).find((l) => l.msg.startsWith('【更新】'))!.msg,'【更新】' + UPDATE_NOTICE);
    const dt = app.world.shops.find((s) => s.id === shop_id)!;
    assert.equal(dt.user._seen_version,APP_VERSION);
    dt.user._seen_version = '0.2.1'; // バージョンが進んだ場合だけ、再び1回通知
    await fetch(base+'/api/v1/me',{headers:auth});
    await fetch(base+'/api/v1/me',{headers:auth});
    assert.equal(store.readLogs(shop_id,{limit:100}).filter((l) => l.msg.startsWith('【更新】')).length,30);
    dt.user._seen_version = '0.1.0'; // 2つ前なら、取りこぼした版も古い順に届く
    // 7日放置すると、優勝賞品の店番ロボット (維持費3万/日) で倒産することがある。下の確認は倒産と関係ないので資金を足しておく
    dt.money = 10_000_000;
    await fetch(base+'/api/v1/me',{headers:auth});
    const notes = store.readLogs(shop_id,{limit:100}).filter((l) => l.msg.startsWith('【更新】')).map((l) => l.msg.slice(0,12));
    assert.equal(notes.length,61);
    for (const update of UPDATES) assert.ok(notes.includes(`【更新】v${update.version}: `), update.version);

  } finally {
    await new Promise<void>((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});
