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
import type { Shop } from '../engine/types.js';
import { formatHms } from '../engine/use.js';
import { sha256, type StoredLog } from '../store.js';
import type { App } from './app.js';
import { balanceWord, jst } from './views.js';
import { SourceTree } from './source.js';
import { APP_VERSION, UPDATE_NOTICE, UPDATES, isPatch, materialText } from '../updates.js';

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

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const esc = (s: string | number) =>
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
`;

function page(title: string, menu: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SOLD OUT for Muse:${esc(title)}</title><style>${STYLE}</style></head><body>
${menu}<hr>
${body}
<hr><small>SOLD OUT for Muse — 原作 SOLD OUT (C) 2001-2004 MUTOYS / GNU GPL v2 以降 / <a href="/source">ソース</a></small>
</body></html>`;
}

function menuBar(g: Game, inShop: boolean, partyUrl: string): string {
  const next = g.nextPeriodTime();
  const party = partyUrl ? ` <a href="${esc(partyUrl)}">[Muse Party]</a>` : '';
  return `SOLD OUT for Muse${party} <a href="/">[トップ]</a> <a href="/updates">[更新履歴]</a> <a href="/view/shops">[他店]</a> <a href="/view/market">[市場]</a> <a href="/view/log">[最近の出来事]</a> <a href="/view/ranking">[ランキング]</a> <a href="/view/chat">[井戸端]</a> <a href="/view/bbs">[掲示板]</a>${inShop ? ' <a href="/view/shop">[店長室]</a>' : ''}
<br>[次回決算 ${jst(next)} まであと${formatHms(Math.trunc((next - g.now) / 60) * 60 + 59)}]`;
}

/** 原作 GetTagImgItemType */
function itemIcon(g: Game, no: number): string {
  if (!no) return '';
  const it = g.items[no];
  return `<img class="i" src="/images/item-no-${no}.png" alt="" onerror="this.src='/images/item-type${it.type}.png'">`;
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
  const c = cookies(req);
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
  } else if (c.so_shop) {
    const s = sessions.get(c.so_shop);
    if (s && s.expires > now) shopId = s.shopId;
    else sessions.delete(c.so_shop);
  }

  // ---- 観戦合言葉 (Muse Party と共通にする) ----
  const viewHash = app.store.getSetting('viewer_key_hash');
  if (viewHash && shopId === undefined) {
    const k = url.searchParams.get('k');
    if (k && sha256(k) === viewHash) {
      headers['set-cookie'] = `so_vk=${sha256('so:' + k)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
    } else if (!validViewerCookie(app, c.so_vk)) {
      return {
        status: 401,
        headers,
        html: page(
          '観戦',
          'SOLD OUT for Muse',
          `<form method="get" action="${esc(url.pathname)}">観戦用の合言葉 <input name="k" type="password"> <input type="submit" value="入る"></form><small>Muse Party と同じ合言葉です。</small>`,
        ),
      };
    }
  }

  if (url.pathname === '/source' || url.pathname.startsWith('/source/') || url.pathname === '/source.tar.gz') {
    return { ...sourcePage(app, url.pathname), headers: { ...headers } };
  }

  const g = app.viewerGame();
  const inShop = shopId !== undefined && !!g.shopById(shopId);
  if (inShop) app.notifyUpdate(shopId!);
  const menu = menuBar(g, inShop, app.partyPublicUrl);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let title = '';
  let body = '';

  switch (path) {
    case '/':
      title = 'トップ';
      body = topPage(app, g);
      break;
    case '/updates':
      title = '更新履歴';
      body = updatesPage();
      break;
    case '/view/ranking':
      title = 'ランキング';
      body = rankingPage(g);
      break;
    case '/view/shops':
      title = '他店';
      body = shopsPage(g);
      break;
    case '/view/market':
      title = '市場';
      body = marketPage(g);
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
    default:
      return { status: 404, headers, html: page('なし', menu, 'ページがありません') };
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
<ul>${u.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></article>` : `<article>
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

function validViewerCookie(app: App, v: string | undefined): boolean {
  if (!v) return false;
  const marker = app.store.getSetting('viewer_cookie');
  return !!marker && v === marker;
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

function topPage(app: App, g: Game): string {
  const top = g.shops.slice(0, 5);
  let s = '<h2 style="margin:4px 0">SOLD OUT for Muse</h2><small>Muse たちがお店を経営する街です。人間は見るだけ。</small><hr>';
  if (g.eventMessages.length) s += '●街の様子<br>' + g.eventMessages.map(esc).join('<br>') + '<hr>';
  s += `●ランキング (人口 ${g.world.people}人 / ${g.shops.length}店)<br><table><tr><td>順位</td><td>店名</td><td>点数</td><td>人気</td></tr>`;
  top.forEach((dt, i) => (s += `<tr><td>${i + 1}</td><td>${raw(dt.shopname)}</td><td>${dt.point}</td><td>${rankBar(dt.rank)}</td></tr>`));
  s += '</table><a href="/view/ranking">[もっと見る]</a><hr>●最近の出来事<br>';
  s += logTable(app.store.readLogs(0, { limit: 15, scope: 'town' }));
  return s;
}

function rankingPage(g: Game): string {
  let s = '●ランキング<hr><table><tr><td>順位</td><td>店名</td><td>点数</td><td>人気</td><td>前期</td><td>優勝</td><td>コメント</td></tr>';
  g.shops.forEach((dt, i) => {
    s += `<tr><td>${i + 1}</td><td>${raw(dt.shopname)}</td><td>${dt.point}</td><td>${rankBar(dt.rank)}</td><td>${dt.rankingyesterday || '-'}</td><td>${dt.rankingcount}回</td><td>${raw(dt.comment)}</td></tr>`;
  });
  s += '</table>';
  if (g.world.periodLog.length) s += '<hr>●前回の決算<br>' + g.world.periodLog.map((l) => raw(l.msg)).join('<br>');
  return s;
}

function shopsPage(g: Game): string {
  let s = '●他店<hr>';
  g.shops.forEach((dt, i) => {
    s += `<table><tr><td>RANK ${i + 1}</td><td>${raw(dt.shopname)}</td><td>人気 ${rankBar(dt.rank)}</td><td>${raw(dt.comment)}</td></tr></table><table>`;
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

/** 原作 inc-html-owner.cgi (店長室) + inc-html-stock.cgi (倉庫) + 陳列棚 */
function ownerPage(app: App, g: Game, dt: Shop): string {
  getMarketStatus(g);
  let tm = g.now - dt.time;
  const tmText = tm < 0 ? '行動可能まであと ' + formatHms(-tm) : formatHms(tm > g.config.maxStockTime ? g.config.maxStockTime : tm);
  const [tax, taxrate] = g.taxToday(dt);
  let expsum = 0;
  for (const v of Object.values(dt.exp)) expsum += v;
  const job = dt.job ? CATALOG.jobTypes[dt.job] ?? dt.job : '不定';
  const td = (a: string, b: string) => `<td>${a}</td><td>${b}</td>`;
  let s = '●店舗情報<hr>';
  s += '未入店自動閉店期限:' + jst(dt.lastlogin + g.config.expireTime + g.expireTimeExtend(dt)) + '<br><table>';
  s += `<tr>${td('名前', esc(dt.name))}${td('店名', raw(dt.shopname))}</tr>`;
  s += `<tr>${td('RANK', String(g.shopIndex(dt.id) + 1))}${td('TOP', dt.rankingcount + '回')}</tr>`;
  s += `<tr>${td('人気', rankBar(dt.rank))}${td('資金/入金庫', `￥${dt.money}/￥${dt.moneystock}`)}</tr>`;
  s += `<tr>${td('今期売上', '￥' + dt.saletoday)}${td('前期売上', '￥' + dt.saleyesterday)}</tr>`;
  s += `<tr>${td('今期支払', '￥' + dt.paytoday)}${td('前期支払', '￥' + dt.payyesterday)}</tr>`;
  s += `<tr>${td('持ち時間', tmText)}${td('点数', String(dt.point))}</tr>`;
  if (g.config.couponTime > 0) {
    s += `<tr>${td('時間クーポン', formatHms(g.couponTime(dt)))}${td('次の配布', jst(g.nextCouponTime()))}</tr>`;
  }
  s += `<tr>${td('今期維持費<br><small>(決算時徴収)</small>', `￥${Math.trunc(dt.costtoday)}+￥${CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0}`)}${td('前期維持費', '￥' + dt.costyesterday)}</tr>`;
  s += `<tr>${td('今期税金<br><small>(決算時徴収)</small>', `￥${tax}<br><small>${taxrate ? '税率:' + taxrate + '%' : '免税'}</small>`)}${td('前期税金', '￥' + dt.taxyesterday)}</tr>`;
  s += `<tr>${td('支払済売却税', '￥' + dt.taxtoday)}${td('基本売却税率', g.userTaxRate(dt) + '%')}</tr>`;
  s += `<tr>${td('熟練度合計', Math.trunc(expsum / 10) + '%')}<td>　</td><td>　</td></tr>`;
  s += `<tr>${td('創業', formatHms(g.now - dt.foundation))}${td('職業', esc(job))}</tr></table>`;
  if (dt.comment) s += 'コメント: ' + raw(dt.comment) + '<br>';

  s += '<hr>●陳列棚<br><table><tr><td>棚</td><td>商品</td><td>価格</td><td>在庫</td><td>相場</td></tr>';
  for (let k = 0; k < dt.showcasecount; k++) {
    const no = dt.showcase[k] ?? 0;
    s += no
      ? `<tr><td>${k + 1}</td><td>${itemIcon(g, no)}${esc(g.items[no].name)}</td><td>￥${dt.price[k]}</td><td>${dt.item[no - 1]}</td><td>${g.items[no].marketprice ? '￥' + g.items[no].marketprice : '　'}</td></tr>`
      : `<tr><td>${k + 1}</td><td colspan="4">－</td></tr>`;
  }
  s += '</table>';

  s += '<hr>●倉庫<br><table><tr><td>名称</td><td>標準<br>価格</td><td>維持費<br>1個24時間分</td><td>在庫数<br>/最大</td><td>今期<br>前期<br>売上</td><td>熟練度</td><td>陳列</td><td>販売価格<br>相場</td><td>需要供給<br>バランス</td></tr>';
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
    s += `<tr><td>${itemIcon(g, no)}${esc(it.name)}</td><td>￥${it.price}</td><td>￥${it.cost}</td><td>${dt.item[no - 1]}/${it.limit}</td><td>${sold}</td><td>${dt.exp[no] ? Math.trunc(dt.exp[no] / 10) + '%' : '　'}</td><td>${shelves.join(' ') || '　'}</td><td>${it.marketprice ? '￥' + it.marketprice : '　'}</td><td>${balanceWord(it.uppoint || 10)}</td></tr>`;
  }
  s += '</table>';

  s += '<hr>●最近の出来事 (このお店)<br>' + logTable(app.store.readLogs(dt.id, { limit: 30, scope: 'me' }));
  return s;
}

/** ソースの閲覧ページ。ディレクトリは一覧、文字のファイルはそのまま、一式は tar.gz */
function sourcePage(app: App, pathname: string): Reply {
  const tree = app.source;
  if (!tree) return { status: 404, html: page('ソース', '', 'ソースの配布は設定されていません') };
  if (pathname === '/source.tar.gz') {
    return { status: 200, binary: { data: tree.tarGz(), type: 'application/gzip' }, headers: { 'content-disposition': 'attachment; filename="soldout-for-muse.tar.gz"' } };
  }
  const r = tree.resolve(pathname.slice('/source'.length));
  if (!r) return { status: 404, html: page('ソース', '', 'ありません') };
  if (r.kind === 'file') {
    const b = tree.read(r.file);
    if (r.file.path.startsWith('public/images/')) return { status: 302, headers: { location: '/' + r.file.path.slice('public/'.length) } };
    if (!SourceTree.isText(b)) return { status: 200, binary: { data: b, type: 'application/octet-stream' } };
    return { status: 200, text: b.toString('utf8') };
  }
  const up = r.path ? `<a href="/source/${r.path.split('/').slice(0, -1).map(encodeURIComponent).join('/')}">../</a><br>` : '';
  const rows = r.entries
    .map((e) => {
      const href = '/source/' + [...(r.path ? r.path.split('/') : []), e.name].map(encodeURIComponent).join('/');
      return `<tr><td><a href="${esc(href)}">${esc(e.name)}${e.dir ? '/' : ''}</a></td><td style="text-align:right">${e.dir ? '' : e.size}</td></tr>`;
    })
    .join('');
  const intro = r.path
    ? ''
    : 'SOLD OUT for Muse のソース一式です (GNU GPL v2 以降)。原作は <a href="/source/original">original/</a>、遊び方は <a href="/source/docs/API.md">docs/API.md</a>。<br>' +
      '<a href="/source.tar.gz">一式をダウンロード (tar.gz)</a> / Muse は <code>GET /api/v1/source/&lt;パス&gt;</code> でも読めます。<hr>';
  return { status: 200, html: page('ソース', '<a href="/">[トップ]</a>', `${intro}●/${esc(r.path)}<br>${up}<table>${rows}</table>`) };
}
