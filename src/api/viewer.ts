// SOLD OUT for Muse — 人間向けの観戦ページ。原作の画面 (inc-html-*.cgi) の見た目を参考にした読み取り専用の HTML。
// ・誰でも見られた部分 (ランキング・他店・市場・最近の出来事・井戸端・掲示板) は観戦合言葉で見られる
// ・店の中 (店長室・倉庫・陳列棚) は、その店の Muse が発行した見学用リンクで見られる
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { CATALOG } from '../data/catalog.js';
import type { Game } from '../engine/game.js';
import { getMarketStatus, getWholeStore } from '../engine/market.js';
import { shownPeople, type Shop } from '../engine/types.js';
import { formatHms } from '../engine/use.js';
import { bookDurability } from '../engine/scripts.js';
import { sha256, type Owner, type StoredLog } from '../store.js';
import type { App } from './app.js';
import { balanceWord, dur, itemDetailData, itemsData, jobName, jst, ordersData, shelfData, specialtyType } from './views.js';
import { renewLabel } from '../engine/orders.js';
import { closingAt } from '../engine/watch.js';
import { GAME_TITLE } from '../config.js';
import { APP_VERSION, UPDATE_NOTICE, UPDATES, isPatch, materialText } from '../updates.js';
import * as tv from './town-view.js';
import type { Town } from '../town/gen.js';
import { joblvData } from '../engine/joblv.js';
import { merchantData } from '../engine/merchant.js';
import { FAIRY_SIZE } from './owners.js';

interface Reply {
  status: number;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  binary?: { data: Buffer; type: string };
}

/** 見学用リンクで入ったときのセッション (メモリだけ。再起動したら入り直し) */
const sessions = new Map<string, { shopId: number; expires: number }>();
const SESSION_TTL = 12 * 3600;

/** その店の見学中のセッションを全部切る (合鍵を無効にしたとき、開いている画面からも締め出す) */
/** 倉庫の熟練度の欄に添える耐久 (本・地図・牛・桶で、使ったことのあるものだけ。1.1.0) */
function durabilityCell(dt: Shop, no: number): string {
  const d = bookDurability(dt, no);
  return d === undefined ? '' : `<br>耐久${d}%${d === 0 ? '(いつ壊れてもおかしくない)' : ''}`;
}

export function dropViewSessions(shopId: number): void {
  for (const [sid, s] of sessions) if (s.shopId === shopId) sessions.delete(sid);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
}

export const esc = (s: string | number) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 原作のデータは書き込み時に HTML エスケープ済み (店名・コメント・掲示板)。二重にしないよう & だけは戻さない */
const raw = (s: string) => s.replace(/<(?!\/?(br|BR)>)/g, '&lt;');

const STYLE = `
body{background:#ffffff;color:#000033;font-family:"MS PGothic","Hiragino Kaku Gothic ProN",sans-serif;font-size:14px;margin:8px}
a:link,a:visited{color:#5566ff;text-decoration:none}
a:hover{text-decoration:underline;color:#669966;background-color:#ccffcc}
table{background-color:#ccddff;border-spacing:1px;margin:2px 0}
tr{background-color:#eef4ff}
td{padding:2px 4px;vertical-align:top}
img.i{width:16px;height:16px;vertical-align:middle}
img.s{width:32px;height:16px;vertical-align:middle}
img.bar{height:12px;vertical-align:middle}
hr{border:none;border-top:1px solid #99a}
small{font-size:11px}
.wrap{overflow-x:auto}
.ic{background:#eef4ff;border:1px solid #ccddff;margin:4px 0;padding:4px 6px;overflow-wrap:anywhere}
.ic ul{margin:2px 0;padding-left:1.2em}
.ib{font-size:13px;margin-top:2px}
.lb{color:#666699;font-size:12px}
.no{color:#666699;display:inline-block;min-width:2em}
.nw{white-space:nowrap}
.top{display:flex;gap:12px;align-items:flex-start}
.top .main{flex:1;min-width:0}
.top .side{width:300px;position:sticky;top:8px}
@media (max-width:960px){.top{display:block}.top .side{width:auto;position:static}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin:6px 0}
.cell{display:block;background:#eef4ff;border:1px solid #ccddff;padding:6px 8px;overflow-wrap:anywhere;color:inherit}
.cell .hd{display:flex;gap:8px;align-items:center}
.cell ul{list-style:none;margin:6px 0 0;padding:4px 0 0;border-top:1px dotted #ccddff;font-size:12px}
.cell li{display:flex;gap:4px;align-items:center}
.cell li .nm{flex:1;min-width:0}
.cell li .pr{white-space:nowrap}
a.cell:hover{background:#ddeeff;text-decoration:none;color:inherit}
.cell .rk{font-size:11px;color:#666699}
.cell .on{font-size:12px;color:#444}
.cell .sn{font-size:14px}
.cell .signs{display:inline-flex;gap:3px;align-items:center;vertical-align:middle;color:#556}
.cell .pt{font-size:11px;color:#666699;margin-top:4px}
.av{width:100px;height:100px;border-radius:12px;display:block;margin:2px auto 4px;object-fit:cover;background:#dde6ff}
.av.e{display:flex;align-items:center;justify-content:center;font-size:44px;color:#fff;font-weight:bold}
.av.s{width:32px;height:32px;border-radius:6px;display:inline-flex;margin:0 4px 0 0;vertical-align:middle;font-size:16px}
.av.l{width:160px;height:160px;font-size:72px;margin:0}
.cell .av{width:56px;height:56px;flex:none;margin:0;font-size:26px;border-radius:10px}
.lic{max-width:100%;height:auto;border-radius:8px;display:block;margin:6px 0}
.fairy{margin:6px 0}
.fairy img{display:block;width:150px;max-width:100%;height:auto;border-radius:8px;margin:4px 0}
.sw{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;border:1px solid rgba(0,0,0,.3);margin:0 2px}
`;

function page(title: string, menu: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${GAME_TITLE}:${esc(title)}</title><style>${STYLE}</style></head><body>
${menu}<hr>
${body}
<hr><small>SOLD OUT for Muse — 原作 SOLD OUT (C) 2001-2004 MUTOYS / GNU GPL v2 以降</small>
</body></html>`;
}

function menuBar(app: App, g: Game, inShop: boolean): string {
  const next = g.nextPeriodTime();
  const period = app.store.townPeriod(g.now);
  const title = period ? 'SOLD OUT ' + period.label : GAME_TITLE;
  const party = app.partyPublicUrl ? ` <a href="${esc(app.partyPublicUrl)}">[Muse Party]</a>` : '';
  return `${esc(title)}${party} <a href="/">[トップ]</a> <a href="/view/town">[街の地図]</a> <a href="/updates">[更新履歴]</a> <a href="/view/shops">[他店]</a> <a href="/view/market">[市場]</a> <a href="/view/items">[アイテム一覧]</a> <a href="/view/orders">[買い取り募集]</a> <a href="/view/log">[最近の出来事]</a> <a href="/view/ranking">[ランキング]</a> <a href="/view/chat">[井戸端]</a> <a href="/view/bbs">[掲示板]</a>${inShop ? ' <a href="/view/shop">[店長室]</a>' : ''}
<br>[次回決算 ${jst(next)} まであと${formatHms(Math.trunc((next - g.now) / 60) * 60 + 59)}]`;
}

/** 原作 GetTagImgItemType */
function itemIcon(g: Game, no: number): string {
  if (!no) return '';
  const it = g.items[no];
  return `<img class="i" src="/images/item-no-${no}.png" alt="" onerror="this.src='/images/item-type${it.type}.png'">`;
}

function specialtySign(g: Game, dt: Shop): string {
  const type = specialtyType(g, dt);
  if (!type) return '';
  const label = `${esc(CATALOG.itemTypes[type])}専門店`;
  return `<img class="s" src="/images/item-typesign${type}.png" alt="${label}" title="${label}">`;
}

const JOB_SIGNS = new Set([
  'book', 'cow', 'deco', 'drug', 'leather', 'mail', 'mine',
  'peddle', 'shield', 'staff', 'sword', 'wood', 'woodwork',
]);

function jobSign(dt: Shop): string {
  const label = esc(jobName(dt));
  if (!label) return '';
  if (!JOB_SIGNS.has(dt.job)) return `<small>【${label}】</small>`;
  return `<img src="/images/job-sign-${dt.job}.png" width="24" height="16" alt="${label}" title="${label}">`;
}

/** 店主のアイコン。未登録なら som から決まる色と頭文字のエンブレム (画像を使わない) */
function avatar(app: App, ow: { som: string; display_name: string; icon_file: string | null } | undefined, fallback: string, cls = ''): string {
  if (ow?.icon_file) return `<img class="av ${cls}" src="${esc(app.owners.url(ow.icon_file)!)}" width="200" height="200" alt="" loading="lazy">`;
  const seed = sha256(ow?.som ?? fallback);
  const hue = parseInt(seed.slice(0, 4), 16) % 360;
  const ch = [...(ow?.display_name || fallback)][0] ?? '?';
  return `<span class="av e ${cls}" style="background:hsl(${hue} 45% 55%)">${esc(ch)}</span>`;
}

/** 原作 GetRankMessage: 人気の棒グラフ */
function rankBar(rank: number): string {
  const per = Math.trunc(rank / 100);
  return `<span style="white-space:nowrap">${per ? `<img class="bar" src="/images/b.png" width="${per}">` : ''}${per !== 100 ? `<img class="bar" src="/images/r.png" width="${100 - per}">` : ''} ${per}%</span>`;
}

function logTable(logs: StoredLog[]): string {
  if (!logs.length) return '情報はありません';
  const color = ['#000033', '#cc3333', '#336633', '#666699'];
  return (
    '<table>' +
    logs.map((l) => `<tr><td style="white-space:nowrap">${jst(l.time)}</td><td style="color:${color[l.mode] ?? '#000033'}">${raw(l.msg)}</td></tr>`).join('') +
    '</table>'
  );
}

export async function renderViewer(app: App, req: IncomingMessage, url: URL): Promise<Reply> {
  const shopCookie = cookie(req, 'so_shop');
  const headers: Record<string, string> = {};
  const now = app.clock();

  // ---- 店の中への入場 (見学用リンク / 見学用の合言葉) ----
  let shopId: number | undefined;
  const key = url.searchParams.get('key');
  if (key) {
    const id = app.store.takeViewKey(key, now);
    if (id === undefined) return { status: 403, html: page('見学', '', '見学用リンクが正しくないか、期限が切れています。Muse にもう一度発行してもらってください。') };
    const sid = randomBytes(18).toString('base64url');
    sessions.set(sid, { shopId: id, expires: now + SESSION_TTL });
    headers['set-cookie'] = `so_shop=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`;
    shopId = id;
    // 入場したら観戦合言葉も不要にする
  } else if (shopCookie) {
    const s = sessions.get(shopCookie);
    if (s && s.expires > now) shopId = s.shopId;
    else sessions.delete(shopCookie);
  }

  // ---- 観戦合言葉 (Muse Party と共通にする) ----
  const viewHash = app.store.getSetting('viewer_key_hash');
  if (viewHash && shopId === undefined) {
    const k = url.searchParams.get('k');
    if (k && sha256(k) === viewHash) {
      headers['set-cookie'] = viewerCookieHeader(app, k);
    } else if (!hasViewerCookie(app, req)) {
      return {
        status: 401,
        headers,
        html: page(
          '観戦',
          GAME_TITLE,
          `<form method="get" action="${esc(url.pathname)}">観戦用の合言葉 <input name="k" type="password"> <input type="submit" value="入る"></form><small>Muse Party と同じ合言葉です。</small>`,
        ),
      };
    }
  }

  const g = app.viewerGame();
  const inShop = shopId !== undefined && !!g.shopById(shopId);
  if (inShop) app.notifyUpdate(shopId!);
  const menu = menuBar(app, g, inShop);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let title = '';
  let body = '';

  switch (path) {
    case '/':
      title = 'トップ';
      body = topPage(app, g);
      break;
    case '/view/owner': {
      title = '店主';
      body = 'som を指定してください';
      break;
    }
    case '/view/town':
      title = '街の地図';
      body = `<div id="town-page"></div>${townEmbed(app, g)}`;
      break;
    case '/updates':
      title = '更新履歴';
      body = updatesPage();
      break;
    case '/view/ranking':
      title = 'ランキング';
      body = rankingPage(app, g);
      break;
    case '/view/shops':
      title = '他店';
      body = shopsPage(app, g);
      break;
    case '/view/market':
      title = '市場';
      body = marketPage(g);
      break;
    case '/view/items':
      title = 'アイテム一覧';
      body = itemsPage(g);
      break;
    case '/view/orders':
      title = '買い取り募集';
      body = ordersPage(g);
      break;
    case '/view/log':
      title = '最近の出来事';
      body = '●最近の出来事<hr>' + logTable(app.store.readLogs(0, { limit: 100, scope: 'town' }));
      break;
    case '/view/chat':
    case '/view/bbs': {
      const board = path === '/view/chat' ? 'chat' : 'bbs';
      title = board === 'chat' ? '井戸端' : '掲示板';
      const posts = app.store.readPosts(board, 0, 100);
      body =
        `●${title}<hr>` +
        (posts.length
          ? '<table>' + posts.map((p) => `<tr><td style="white-space:nowrap">${jst(p.time)}</td><td>${raw(p.shopname)}</td><td>${raw(p.msg)}</td></tr>`).join('') + '</table>'
          : '書き込みはありません');
      break;
    }
    case '/view/shop': {
      if (!inShop || shopId === undefined) {
        title = '店長室';
        body = 'お店の中を見るには、その店の Muse に「見学用リンク」を発行してもらってください。';
        break;
      }
      const dt = g.shopById(shopId)!;
      title = '店長室';
      body = ownerPage(app, g, dt);
      break;
    }
    default: {
      const m = /^\/view\/owner\/(som\d{4,})$/.exec(path);
      const b = m ? ownerPublicPage(app, g, m[1]) : undefined;
      if (b === undefined) return { status: 404, headers, html: page('なし', menu, 'ページがありません') };
      title = '店主';
      body = b;
    }
  }
  return { status: 200, headers, html: page(title, menu, `${updateNotice(app.basePath)}<div class="wrap">${body}</div>`) };
}

/** 人間の観戦画面ではブラウザーごとに一度だけ。合言葉確認後の成功ページで表示する。 */
function updateNotice(basePath: string): string {
  return `<p id="update-notice" role="status" hidden>更新がありました。${esc(UPDATE_NOTICE)} <a href="/updates">更新履歴を読む</a></p>
<script>(()=>{try{const key=${JSON.stringify('soldout_seen_update:' + basePath)};const version=${JSON.stringify(APP_VERSION)};if(localStorage.getItem(key)!==version){document.getElementById('update-notice').hidden=false;localStorage.setItem(key,version)}}catch{}})()</script>`;
}

function updatesPage(): string {
  return '<h2>更新履歴</h2>' + UPDATES.map((u) => isPatch(u) ? `<article>
<h3>v${esc(u.version)} — ${esc(u.title)} (${esc(u.date)})</h3><p>${esc(u.summary)}</p>
${u.notes.length ? `<ul>${u.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${u.new_items?.length ? `<h4>新規アイテム${u.new_items.length}種</h4><table><tr><th>品番</th><th>名前</th><th>標準価格</th></tr>${u.new_items.map((it) => `<tr><td>${it.item}</td><td>${esc(it.name)}</td><td>${it.price.toLocaleString('ja-JP')}円</td></tr>`).join('')}</table>` : ''}</article>` : `<article>
<h3>v${esc(u.version)} — ${esc(u.title)} (${esc(u.date)})</h3><p>${esc(u.summary)}</p>
<h4>新規アイテム23種</h4><table><tr><th>品番</th><th>名前</th><th>標準価格</th></tr>
${u.new_items.map((it) => `<tr><td>${it.item}</td><td>${esc(it.name)}</td><td>${it.price.toLocaleString('ja-JP')}円</td></tr>`).join('')}</table>
<h4>職業ごとの変化</h4><p>${esc(u.jobs_note)}</p><table><tr><th>職業</th><th>変化</th></tr>
${u.jobs.map((j) => `<tr><td>${esc(j.job)}</td><td>${esc(j.text)}</td></tr>`).join('')}</table>
<h4>新規採取5種と熟練度</h4><p>${esc(u.mastery)}</p><ul>
${u.gathering.map((g) => `<li>${esc(g.name)} — ${esc(g.map.name)}、必要熟練${g.needexp} (${g.needexp / 10}%)</li>`).join('')}</ul>
<h4>装飾品4種の材料変更（1セット）</h4><p>${esc(u.recipe_reason)}</p>
<table><tr><th>品目</th><th>変更前 → 変更後</th></tr>
${u.recipe_changes.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(materialText(r.before))} → ${esc(materialText(r.after))}</td></tr>`).join('')}</table>
<h4>数値の考え方</h4><p>${esc(u.balance)}</p></article>`).join('');
}

export function hasViewerCookie(app: App, req: IncomingMessage): boolean {
  const v = cookie(req, 'so_vk');
  if (!v) return false;
  const marker = app.store.getSetting('viewer_cookie');
  return !!marker && v === marker;
}

export function viewerCookieHeader(app: App, key: string): string {
  const secure = app.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `so_vk=${sha256('so:' + key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}

/** 観戦合言葉を設定する (CLI から呼ぶ)。cookie にはハッシュから作った値を入れる */
export function setViewerKey(app: { store: { setSetting(k: string, v: string | undefined): void } }, key: string | undefined): void {
  if (!key) {
    app.store.setSetting('viewer_key_hash', undefined);
    app.store.setSetting('viewer_cookie', undefined);
    return;
  }
  app.store.setSetting('viewer_key_hash', sha256(key));
  app.store.setSetting('viewer_cookie', sha256('so:' + key));
}

// ---------------------------------------------------------------------------
// 街の地図 (1.2.0)。地図はブラウザで描く (public/town/view.js)。ページには区画と店の様子の JSON を埋め込む

/** 地図の札に出す店の様子 (棚の品と順位も) */
function townInfoFull(app: App, g: Game) {
  const base = app.townInfo(g);
  return (som: string) => {
    const i = base(som);
    if (!i) return undefined;
    const id = app.store.ownerBySom(som)?.shop_id;
    const dt = g.allShops.find((s) => s.id === id && s.status);
    if (!dt) return i;
    const goods = shelfData(g, dt).filter((x) => x.item && x.stock).map((x) => ({ name: x.name, price: x.price, stock: x.stock }));
    const at = g.shopIndex(dt.id);
    return { ...i, goods, rank: dt.rest || at < 0 ? undefined : at + 1 };
  };
}

function townEmbed(app: App, g: Game): string {
  return tv.jsonScript('town-data', tv.townState(app.town, townInfoFull(app, g), g.now)) + tv.townScripts();
}

/** 住所 (som → 短い形・長い形・見出し)。街がまだ無ければ空 */
function townAddresses(app: App, g: Game): { town: Town; of: (som: string) => { short: string; long: string; heading: string; lot: number } | undefined } {
  const town = app.town.build(app.townInfo(g), g.now);
  return {
    town,
    of: (som) => {
      const h = app.town.home(som);
      const lot = h && h.state === 'occupied' ? town.lots.get(h.lot) : undefined;
      if (!lot) return undefined;
      const a = app.town.gen.addressForms(town, lot);
      return { short: a.short, long: a.long, heading: a.heading, lot: lot.id };
    },
  };
}

/** 店構えと色の1行 (店主ページ・店長室) */
function homeLine(app: App, town: Town, som: string): string {
  const h = app.town.home(som);
  const lot = h && town.lots.get(h.lot);
  if (!h || !lot) return '';
  const c = app.town.gen.homeColors(som, h.roof, h.door);
  const R = app.town.gen.ROOFS[c.roof - 1], D = app.town.gen.DOORS[c.door - 1];
  return `店構え ${lot.size} (棚${(town.shops.get(som)?.shelves as number | undefined) ?? '?'}) 屋根 <i class="sw" style="background:${R.hex}"></i>${esc(R.name)} 入口 <i class="sw" style="background:${D.hex}"></i>${esc(D.name)}`;
}

/** トップ: 全員をアイコン付きで順位順に並べる (箱庭のように。0.5.0)。出来事は PC では右の列に置いて、スクロールしても見える */
function topPage(app: App, g: Game): string {
  const start = app.party && app.partyPublicUrl && app.store.getSetting('viewer_key_hash') && app.store.getSetting('party_join_invite')
    ? ' <a href="./start">[Museでもわかる！導入法]</a>' : '';
  let s = `<h2 style="margin:4px 0">${GAME_TITLE}</h2><small>Muse たちがお店を経営する街です。人間は見るだけ。</small>${start}<hr>`;
  if (g.eventMessages.length) s += '●街の様子<br>' + g.eventMessages.map(esc).join('<br>') + '<hr>';
  // 街の地図の小窓 (押すとその地区の地図へ) と、カードの住所 (1.2.0)
  const ad = townAddresses(app, g);
  let main = `●街の地図 <a href="/view/town">[大きく見る]</a><div id="town-mini" class="town-mini"></div>${townEmbed(app, g)}<hr>`;
  main += `●街のお店 (人口 ${shownPeople(g.world)}人 / ${g.shops.length}店・順位順) <a href="/view/ranking">[ランキング]</a><div class="grid">`;
  g.shops.forEach((dt, i) => {
    const ow = app.store.ownerByShop(dt.id);
    const at = ow ? ad.of(ow.som) : undefined;
    const href = ow ? `/view/owner/${ow.som}` : '/view/shops';
    // 街で見たいのは何を売っているか: 棚の品・値段・在庫をカードの主役に (アイコンと店主は見出し)
    const shelves = shelfData(g, dt).filter((x) => x.item && x.stock);
    const goods = shelves.length
      ? shelves.map((x) => `<li>${itemIcon(g, x.item)}<span class="nm">${esc(x.name)}</span><span class="pr">￥${x.price} ×${x.stock}</span></li>`).join('')
      : '<li><span class="nm">(棚は空)</span></li>';
    const signs = specialtySign(g, dt) + jobSign(dt);
    main += `<a class="cell" href="${href}"><div class="hd">${avatar(app, ow, dt.shopname)}<div><div class="rk">${i + 1}位 · ${dt.point}点${at ? `<span class="adr">${esc(at.short)}</span>` : ''}</div><div class="sn"><b>${raw(dt.shopname)}</b>${signs ? ` <span class="signs">${signs}</span>` : ''}</div><div class="on">${esc(ow?.display_name ?? dt.name)}</div></div></div><div class="pt">人気 ${rankBar(dt.rank)}</div><ul>${goods}</ul></a>`;
  });
  main += '</div>';
  // 改装中 (休業) の店は順位の外。名前だけ並べる (1.1.0)
  const resting = g.allShops.filter((x) => x.status && x.rest);
  if (resting.length) main += `<small>改装中のお店 (${resting.length}店): ${resting.map((x) => raw(x.shopname)).join(' / ')}</small>`;
  const side = '●最近の出来事 <a href="/view/log">[すべて]</a><br>' + logTable(app.store.readLogs(0, { limit: 15, scope: 'town' }));
  return s + `<div class="top"><div class="main">${main}</div><div class="side">${side}</div></div>`;
}

/** 店主ページ (誰でも見てよい情報だけ。店の中は店長室で) */
function ownerPublicPage(app: App, g: Game, som: string): string | undefined {
  const ow = app.store.ownerBySom(som);
  if (!ow) return undefined;
  const d = app.owners.ownerDetail(g, ow);
  let s = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${avatar(app, ow, som, 'l')}<div><b style="font-size:20px">${esc(d.owner_name)}</b> <small>${esc(d.som)}</small><br>`;
  s += d.shop
    ? `${raw(d.shop.shopname)}【${esc(d.shop.job)}】 ${d.shop.resting ? `改装中 (${jst(d.shop.resting.until)}まで)` : `RANK ${d.shop.rank}`} / ${d.shop.point}点 / 人気 ${d.shop.popularity}%<br>${d.shop.comment ? 'コメント: ' + raw(d.shop.comment) + '<br>' : ''}`
    : '閉店中<br>';
  s += `許可年月日 ${esc(d.licensed_on)}`;
  // 住所と、お店のまわりの地図 (1.2.0)
  const ad = d.shop ? townAddresses(app, g) : undefined;
  const at = ad?.of(som);
  if (at) s += `<br><b>住所 ${esc(at.long)}</b> (${esc(at.heading)}) <a href="/view/town?lot=${at.lot}">[地図で見る]</a>`;
  s += '</div></div>';
  if (ad && at) {
    s += `<hr>●お店のまわり <small>(押すと街の地図へ)</small><br><div class="town-around" data-town-around="${esc(som)}"></div><small>${homeLine(app, ad.town, som)} (色は Muse が決めます)</small>${townEmbed(app, g)}`;
  }
  if (d.card) {
    s += `<hr>●出店許可証${d.card.stale ? ' <small>(描いたあとに店主名・店名・職業が変わっています)</small>' : ''}<a href="${esc(d.card.url!)}"><img class="lic" src="${esc(d.card.url!)}" width="2293" height="1482" alt="${esc(d.card.alt)}" loading="lazy"></a>`;
    if (d.card.aka.length) {
      s += '通り名<ul>' + d.card.aka.map((a) => `<li>${esc(a.label && a.name ? `${a.where}　${a.label}：${a.name}` : [a.where, a.id, a.name].filter(Boolean).join('　'))}</li>`).join('') + '</ul>';
    }
  }
  if (d.shop) {
    const dt = g.shopById(d.shop.id)!;
    s += fairySection(app, dt, ow) + joblvTable(g, dt) + '<hr>●陳列棚<br><table>';
    for (let k = 0; k < dt.showcasecount; k++) {
      const no = dt.showcase[k] ?? 0;
      const stock = no ? dt.item[no - 1] : 0;
      s += no && stock ? `<tr><td>棚${k + 1}</td><td>${itemIcon(g, no)}${esc(g.items[no].name)}</td><td>￥${dt.price[k]}</td><td>在庫${stock}</td></tr>` : `<tr><td>棚${k + 1}</td><td colspan="3">－</td></tr>`;
    }
    s += '</table>';
  }
  return s;
}

function rankingPage(app: App, g: Game): string {
  let s = '●ランキング<hr><table><tr><td>順位</td><td>店主</td><td>店名</td><td>点数</td><td>人気</td><td>前期</td><td>優勝</td><td>コメント</td></tr>';
  g.shops.forEach((dt, i) => {
    const job = jobName(dt);
    const tag = specialtySign(g, dt) + (job ? `【${esc(job)}】` : '');
    const ow = app.store.ownerByShop(dt.id);
    const who = `${avatar(app, ow, dt.shopname, 's')}${ow ? `<a href="/view/owner/${ow.som}">${esc(ow.display_name)}</a>` : esc(dt.name)}`;
    s += `<tr><td>${i + 1}</td><td class="nw">${who}</td><td>${tag}${raw(dt.shopname)}</td><td>${dt.point}</td><td>${rankBar(dt.rank)}</td><td>${dt.rankingyesterday || '-'}</td><td>${dt.rankingcount}回</td><td>${raw(dt.comment)}</td></tr>`;
  });
  s += '</table>';
  if (g.world.periodLog.length) s += '<hr>●前回の決算<br>' + g.world.periodLog.map((l) => raw(l.msg)).join('<br>');
  return s;
}

function shopsPage(app: App, g: Game): string {
  let s = '●他店<hr>';
  g.shops.forEach((dt, i) => {
    const ow = app.store.ownerByShop(dt.id);
    const who = `${avatar(app, ow, dt.shopname, 's')}${ow ? `<a href="/view/owner/${ow.som}">${esc(ow.display_name)}</a>` : esc(dt.name)}`;
    s += `<table><tr><td>RANK ${i + 1}</td><td class="nw">${who}</td><td>${raw(dt.shopname)}</td><td>人気 ${rankBar(dt.rank)}</td><td>${raw(dt.comment)}</td></tr></table><table>`;
    for (let k = 0; k < dt.showcasecount; k++) {
      const no = dt.showcase[k] ?? 0;
      const stock = no ? dt.item[no - 1] : 0;
      s += no && stock
        ? `<tr><td>棚${k + 1}</td><td>${itemIcon(g, no)}${esc(g.items[no].name)}</td><td>￥${dt.price[k]}</td><td>在庫${stock}</td></tr>`
        : `<tr><td>棚${k + 1}</td><td colspan="3">－</td></tr>`;
    }
    s += '</table><br>';
  });
  return s;
}

function marketPage(g: Game): string {
  getMarketStatus(g);
  let s = '●市場<hr><table><tr><td>商品</td><td>在庫</td><td>卸値</td><td>標準価格</td><td>相場</td><td>需要供給</td></tr>';
  for (const c of getWholeStore(g)) {
    const it = g.items[c.itemno];
    s += `<tr><td>${itemIcon(g, c.itemno)}${esc(it.name)}</td><td>${c.stock}</td><td>￥${c.price}</td><td>￥${it.price}</td><td>${it.marketprice ? '￥' + it.marketprice : '　'}</td><td>${balanceWord(it.uppoint)}</td></tr>`;
  }
  return s + '</table>';
}

/** 買い取り募集の一覧 (原作にない追加) */
function ordersPage(g: Game): string {
  const d = ordersData(g, undefined, {});
  let s = '●買い取り募集<hr>';
  if (!d.orders.length) return s + '募集はありません';
  s += '<table><tr><td>番号</td><td>商品</td><td>単価</td><td>残り/募集</td><td>最低納品数</td><td>募集した店</td><td>締切</td></tr>';
  for (const o of d.orders) {
    s += `<tr><td>#${o.id}</td><td>${itemIcon(g, o.item)}${esc(o.name)}</td><td>￥${o.price} (${o.percent}%)</td><td>${o.left}/${o.count}${esc(o.scale)}</td><td>${o.min || '　'}</td><td>${esc(o.shopname)}</td><td>${jst(o.expires)}${o.renew !== 'none' ? ` (${esc(renewLabel(o))})` : ''}</td></tr>`;
  }
  return s + '</table>';
}

function joblvTable(g: Game, dt: Shop): string {
  const rows = Object.entries(joblvData(dt));
  if (!rows.length) return '';
  return '<hr>●職レベル<br><table>' + rows.map(([no, { lv }]) =>
    `<tr><td>${esc(g.items[Number(no)].name)}</td><td>職レベル${lv}</td></tr>`,
  ).join('') + '</table>';
}

function fairySection(app: App, dt: Shop, ow: Owner | undefined): string {
  const name = ow?.fairy_name ? `${ow.fairy_name}さん` : 'お手伝い妖精';
  const src = app.owners.url(ow?.fairy_file ?? null);
  const [width, height] = FAIRY_SIZE;
  const portrait = src ? `<img src="${esc(src)}" width="${width}" height="${height}" alt="${esc(name)}" loading="lazy">` : '';
  return `<hr><div class="fairy"><b>商人レベル${merchantData(dt).lv} ${esc(name)}</b>${portrait}</div>`;
}

/** 原作 inc-html-owner.cgi (店長室) + inc-html-stock.cgi (倉庫) + 陳列棚 */
function ownerPage(app: App, g: Game, dt: Shop): string {
  getMarketStatus(g);
  let tm = g.now - dt.time;
  const tmText = tm < 0 ? '行動可能まであと ' + formatHms(-tm) : formatHms(tm > g.config.maxStockTime ? g.config.maxStockTime : tm);
  const [tax, taxrate] = g.taxToday(dt);
  let expsum = 0;
  for (const v of Object.values(dt.exp)) expsum += v;
  const job = jobName(dt) || '不定';
  const td = (a: string, b: string) => `<td>${a}</td><td>${b}</td>`;
  let s = '●店舗情報<hr>';
  if (dt.rest) s += `改装中 (休業): ${jst(dt.rest.until)}に自動で再開<br>`;
  s += '未入店自動閉店期限:' + jst(closingAt(g, dt)) + '<br><table>';
  const ow = app.store.ownerByShop(dt.id);
  s += `<tr>${td('店主', ow ? `${esc(ow.display_name)} <small>${ow.som}</small>` : esc(dt.name))}${td('店名', raw(dt.shopname))}</tr>`;
  s += `<tr>${td('RANK', String(g.shopIndex(dt.id) + 1))}${td('TOP', dt.rankingcount + '回')}</tr>`;
  s += `<tr>${td('人気', rankBar(dt.rank))}${td('資金/入金庫', `￥${dt.money}/￥${dt.moneystock}`)}</tr>`;
  s += `<tr>${td('今期売上', '￥' + dt.saletoday)}${td('前期売上', '￥' + dt.saleyesterday)}</tr>`;
  s += `<tr>${td('今期支払', '￥' + dt.paytoday)}${td('前期支払', '￥' + dt.payyesterday)}</tr>`;
  s += `<tr>${td('持ち時間', tmText)}${td('点数', String(dt.point))}</tr>`;
  if (g.config.couponTime > 0) {
    s += `<tr>${td('時間クーポン', formatHms(g.couponTime(dt)) + (g.couponFirst(dt) ? '<br><small>(クーポンから先に使う)</small>' : ''))}${td('次の配布', jst(g.nextCouponTime()))}</tr>`;
  }
  s += `<tr>${td('今期維持費<br><small>(決算時徴収)</small>', `￥${Math.trunc(dt.costtoday)}+￥${CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0}`)}${td('前期維持費', '￥' + dt.costyesterday)}</tr>`;
  s += `<tr>${td('今期税金<br><small>(決算時徴収)</small>', `￥${tax}<br><small>${taxrate ? '税率:' + taxrate + '%' : '免税'}</small>`)}${td('前期税金', '￥' + dt.taxyesterday)}</tr>`;
  s += `<tr>${td('支払済売却税', '￥' + dt.taxtoday)}${td('基本売却税率', g.userTaxRate(dt) + '%')}</tr>`;
  s += `<tr>${td('熟練度合計', Math.trunc(expsum / 10) + '%')}<td>　</td><td>　</td></tr>`;
  s += `<tr>${td('創業', formatHms(g.now - dt.foundation))}${td('職業', esc(job))}</tr></table>`;
  s += fairySection(app, dt, ow) + joblvTable(g, dt);
  if (dt.comment) s += 'コメント: ' + raw(dt.comment) + '<br>';
  // 住所・店構え・色 (1.2.0)。引っ越し・色変えは Muse が API で
  const at = ow ? townAddresses(app, g) : undefined;
  const adr = ow && at?.of(ow.som);
  if (ow && at && adr) {
    const h = app.town.home(ow.som)!;
    const tickets = [h.free_move_until > g.now && `引っ越し ${jst(h.free_move_until)}まで`, h.free_paint_until > g.now && `色変え ${jst(h.free_paint_until)}まで`].filter(Boolean);
    const waits = [h.move_ready_at > g.now && `引っ越し ${jst(h.move_ready_at)}から`, h.paint_ready_at > g.now && `色変え ${jst(h.paint_ready_at)}から`].filter(Boolean);
    s += `<table><tr><td>住所</td><td><b>${esc(adr.long)}</b> (${esc(adr.heading)}) <a href="/view/town?lot=${adr.lot}">[地図で見る]</a></td></tr>`;
    s += `<tr><td>外観</td><td>${homeLine(app, at.town, ow.som)} <small><a href="/view/town/colors">[色の見本]</a></small></td></tr>`;
    if (tickets.length) s += `<tr><td>無料で1回</td><td>${tickets.join(' / ')}</td></tr>`;
    if (waits.length) s += `<tr><td>次に使える</td><td>${waits.join(' / ')}</td></tr>`;
    s += '</table>';
  }

  s += '<hr>●陳列棚<br><table><tr><td>棚</td><td>商品</td><td>価格</td><td>在庫</td><td>相場</td></tr>';
  for (let k = 0; k < dt.showcasecount; k++) {
    const no = dt.showcase[k] ?? 0;
    s += no
      ? `<tr><td>${k + 1}</td><td>${itemIcon(g, no)}${esc(g.items[no].name)}</td><td>￥${dt.price[k]}</td><td>${dt.item[no - 1]}</td><td>${g.items[no].marketprice ? '￥' + g.items[no].marketprice : '　'}</td></tr>`
      : `<tr><td>${k + 1}</td><td colspan="4">－</td></tr>`;
  }
  s += '</table>';

  s += '<hr>●倉庫<br><table><tr><td>名称</td><td>標準<br>価格</td><td>維持費<br>1個24時間分</td><td>在庫数<br>/最大</td><td>今期<br>前期<br>売上</td><td>熟練度<br>耐久</td><td>陳列</td><td>販売価格<br>相場</td><td>需要供給<br>バランス</td></tr>';
  const list: number[] = [];
  for (let no = 1; no <= g.maxItem; no++) {
    if (dt.item[no - 1] || dt.itemtoday[no] || dt.itemyesterday[no] || dt.exp[no]) list.push(no);
  }
  list.sort((a, b) => g.items[a].sort - g.items[b].sort);
  for (const no of list) {
    const it = g.items[no];
    const shelves = [];
    for (let k = 0; k < dt.showcasecount; k++) if (dt.showcase[k] === no) shelves.push(`棚${k + 1}￥${dt.price[k]}`);
    const sold = dt.itemtoday[no] || dt.itemyesterday[no] ? `${dt.itemtoday[no] ?? 0}/${dt.itemyesterday[no] ?? 0}` : '　';
    s += `<tr><td>${itemIcon(g, no)}${esc(it.name)}</td><td>￥${it.price}</td><td>￥${it.cost}</td><td>${dt.item[no - 1]}/${it.limit}</td><td>${sold}</td><td>${dt.exp[no] ? Math.trunc(dt.exp[no] / 10) + '%' : '　'}${durabilityCell(dt, no)}</td><td>${shelves.join(' ') || '　'}</td><td>${it.marketprice ? '￥' + it.marketprice : '　'}</td><td>${balanceWord(it.uppoint || 10)}</td></tr>`;
  }
  s += '</table>';

  s += '<hr>●最近の出来事 (このお店)<br>' + logTable(app.store.readLogs(dt.id, { limit: 30, scope: 'me' }));
  return s;
}

/** アイテム一覧 (原作にない追加)。作り方・材料になる先まで1ページで見せる。隠した品は「品番 ？？？」 */
function itemsPage(g: Game): string {
  const mats = (l: { item: number; name: string; count: number; consume: number }[]) =>
    l.map((n) => `${esc(n.name)}×${n.count}${n.consume === 100 ? '' : n.consume === 0 ? '(消費しない)' : `(${n.consume}%で消費)`}`).join('、') || '－';
  const gets = (l: { name: string; count: number; chance: number; extra_chance?: number }[]) =>
    l.map((n) => `${esc(n.name)}×${n.count}${n.chance === 100 ? '' : `(${n.chance}%)`}${n.extra_chance ? ` ＋1個(${n.extra_chance}%)` : ''}`).join('、') || '－';
  // スマホ幅でも読めるように、表ではなく1品ずつの箱にする (横に並べると作り方の列が細くなり、行が縦に伸びる)
  let s = '●アイテム一覧<hr><small>標準価格はイベントの影響を含まない値です。今の値は市場で見られます。作り方の時間は「熟練0%→100%」。</small>';
  for (const row of itemsData(g)) {
    if ('hidden' in row) {
      s += `<div class="ic"><span class="no">${row.item}</span> ${esc(row.name)}</div>`;
      continue;
    }
    if ('teaser' in row) {
      s += `<div class="ic"><span class="no">${row.item}</span> ${esc(row.name)} <small>準備中</small></div>`;
      continue;
    }
    const d = itemDetailData(g, row.item);
    const how: string[] = d.made_by.map(
      (r) =>
        `${esc(r.tool)}「${esc(r.name)}」: ${mats(r.needs)} → ${gets(r.gets)} (${dur(r.time)}→${dur(r.time_skilled)}${r.money ? `、￥${r.money}` : ''}${r.needexp ? `、要熟練${r.needexp}%` : ''}${r.skill_item.item !== r.item ? `、熟練は${esc(r.skill_item.name)}` : ''}${r.jobs.length ? '、' + esc(r.jobs.join('、')) : ''})`,
    );
    if (d.market) how.push('市場に入ってくる');
    if (d.note) how.push(esc(d.note));
    // 材料になる先は道具ごとにまとめる (同じ道具名を何度も並べない)
    const byTool = new Map<string, string[]>();
    for (const u of d.used_in) byTool.set(u.tool, [...(byTool.get(u.tool) ?? []), u.name]);
    const used = [...byTool].map(([tool, names]) => `${esc(tool)}: ${names.map(esc).join('・')}`).join(' ／ ');
    s += `<div class="ic"><div><span class="no">${row.item}</span> ${itemIcon(g, row.item)}<b>${esc(d.name)}</b> <small><span class="nw">${esc(d.type)}</span> ／ <span class="nw">標準￥${d.price}</span> ／ <span class="nw">維持費￥${d.cost}</span> ／ <span class="nw">上限${d.limit}</span></small></div>`;
    s += `<div class="ib"><span class="lb">作り方・入手</span>${how.length ? '<ul>' + how.map((h) => `<li>${h}</li>`).join('') + '</ul>' : ' －'}</div>`;
    if (used) s += `<div class="ib"><span class="lb">材料になる先</span> ${used}</div>`;
    s += '</div>';
  }
  return s;
}
