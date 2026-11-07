// SOLD OUT for Muse — HTTP API 本体。
// 1 プロセスで街の状態をメモリに持ち、リクエストのたびに原作と同じく「経過時間ぶんの計算」をしてから処理する。
// Node は 1 スレッドなので、リクエストは 1 件ずつ順番に処理される (原作の Lock の代わり)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type GameConfig } from '../config.js';
import { MAX_ITEM } from '../data/catalog.js';
import * as act from '../engine/actions.js';
import { Game, GameError } from '../engine/game.js';
import { mathRandom, type Rng } from '../engine/rng.js';
import { turn } from '../engine/turn.js';
import type { Shop, World } from '../engine/types.js';
import { useItemAction, useResultMessages } from '../engine/use.js';
import { newToken, sha256, Store } from '../store.js';
import * as v from './views.js';
import { renderViewer } from './viewer.js';

export interface AppOptions {
  store: Store;
  config?: Partial<GameConfig>;
  rng?: Rng;
  /** 現在時刻 (秒)。テスト用 */
  clock?: () => number;
  /** 外から見たときのURLの頭 (見学用リンクに使う)。例 https://soldout.museimg.party */
  publicUrl?: string;
  /** API の説明文 (docs/API.md) */
  helpText?: string;
  /** 掲示板の保存件数 / 井戸端の保存件数 (原作 $MAX_BBS_MESSAGE / $MAX_CHAT_MESSAGE) */
  maxBbs?: number;
  maxChat?: number;
  /** 1 トークンあたりのリクエスト上限 (1分あたり) */
  ratePerMinute?: number;
  /** 画像フォルダ (public/images) */
  imagesDir?: string;
}

interface Reply {
  status: number;
  text?: string;
  json?: unknown;
  html?: string;
  headers?: Record<string, string>;
  /** 画像などのバイナリ */
  binary?: { data: Buffer; type: string };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SEEN_LOG = '_api_seen_log';
const SEEN_CHAT = '_api_seen_chat';
const SEEN_BBS = '_api_seen_bbs';

export class App {
  readonly store: Store;
  readonly config: GameConfig;
  readonly rng: Rng;
  readonly clock: () => number;
  readonly publicUrl: string;
  readonly helpText: string;
  readonly maxBbs: number;
  readonly maxChat: number;
  readonly ratePerMinute: number;
  readonly imagesDir: string | undefined;
  world: World;
  private images = new Map<string, Buffer>();
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(o: AppOptions) {
    this.store = o.store;
    this.config = { ...DEFAULT_CONFIG, ...(o.config ?? {}) };
    this.rng = o.rng ?? mathRandom;
    this.clock = o.clock ?? (() => Math.floor(Date.now() / 1000));
    this.publicUrl = (o.publicUrl ?? '').replace(/\/$/, '');
    this.helpText = o.helpText ?? '';
    this.maxBbs = o.maxBbs ?? 100;
    this.maxChat = o.maxChat ?? 20;
    this.ratePerMinute = o.ratePerMinute ?? 60;
    this.imagesDir = o.imagesDir;
    this.world = this.store.loadWorld(this.clock());
    // 点数 (point) は保存しないので、読み込んだら並べ直して計算しておく
    new Game(this.world, this.config, this.rng, this.clock()).sortShops();
  }

  // ---------------------------------------------------------------------------
  // 状態の読み書き

  /** 経過時間ぶんの計算をした Game を返す (原作の Turn → DataRead) */
  private game(): { g: Game; turned: boolean } {
    const now = this.clock();
    const g = new Game(this.world, this.config, this.rng, now);
    const turned = turn(g);
    if (turned) this.save(g);
    return { g: turned ? new Game(this.world, this.config, this.rng, now) : g, turned };
  }

  private save(g: Game): void {
    this.store.saveWorld(this.world, g.newLogs, g.now, this.config.logExpireTime * 2);
    g.newLogs.length = 0;
  }

  /**
   * 行動 1 件を実行する。失敗したら状態を元に戻す (原作では OutError で書き込まずに終わる)。
   */
  private runAction<T>(shopId: number, fn: (g: Game, dt: Shop) => T): T {
    const snapshot = structuredClone(this.world);
    const g = new Game(this.world, this.config, this.rng, this.clock());
    const dt = g.shopById(shopId);
    if (!dt) throw new HttpError(401, '店が見つかりません (閉店した可能性があります)');
    act.enterShop(g, dt, true);
    try {
      const r = fn(g, dt);
      g.sortShops();
      this.save(g);
      if (!g.shopById(shopId)) this.onShopClosed(shopId);
      return r;
    } catch (e) {
      this.world = snapshot;
      throw e;
    }
  }

  private onShopClosed(shopId: number): void {
    this.store.deleteTokensOf(shopId);
    this.store.deleteViewKeysOf(shopId);
  }

  // ---------------------------------------------------------------------------
  // HTTP

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let reply: Reply;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const wantJson = url.searchParams.get('format') === 'json' || (req.headers.accept ?? '').startsWith('application/json');
    try {
      reply = await this.route(req, url, wantJson);
    } catch (e) {
      if (e instanceof GameError) reply = { status: 409, text: 'NG ' + e.message + '\n', json: { ok: false, error: e.message } };
      else if (e instanceof HttpError) reply = { status: e.status, text: 'NG ' + e.message + '\n', json: { ok: false, error: e.message } };
      else {
        console.error(e);
        reply = { status: 500, text: 'NG サーバーの内部エラーです\n', json: { ok: false, error: 'internal' } };
      }
    }
    this.send(req, res, reply, wantJson);
  }

  private send(req: IncomingMessage, res: ServerResponse, r: Reply, wantJson: boolean): void {
    let body: string;
    let type: string;
    if (r.binary) {
      const h = { 'content-type': r.binary.type, 'cache-control': 'public, max-age=86400' };
      res.writeHead(r.status, h);
      res.end(r.binary.data);
      return;
    }
    if (r.html !== undefined) {
      body = r.html;
      type = 'text/html; charset=utf-8';
    } else if (wantJson && r.json !== undefined) {
      body = JSON.stringify(r.json);
      type = 'application/json; charset=utf-8';
    } else {
      body = r.text ?? '';
      type = 'text/plain; charset=utf-8';
    }
    const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', ...(r.headers ?? {}) };
    if (r.status === 200 && req.method === 'GET') {
      const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"';
      headers.etag = etag;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
    res.writeHead(r.status, headers);
    res.end(body);
  }

  private auth(req: IncomingMessage): number {
    const h = req.headers.authorization ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m) throw new HttpError(401, 'Authorization: Bearer <トークン> が必要です');
    const shopId = this.store.shopIdByToken(m[1]);
    if (shopId === undefined) throw new HttpError(401, 'トークンが正しくありません');
    this.rateLimit('t:' + sha256(m[1]).slice(0, 16));
    return shopId;
  }

  private rateLimit(key: string): void {
    const now = Date.now() / 1000;
    const cap = this.ratePerMinute;
    const b = this.buckets.get(key) ?? { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) * cap) / 60);
    b.at = now;
    if (b.tokens < 1) throw new HttpError(429, '少し間をあけてください (1分あたりの上限を超えました)');
    b.tokens -= 1;
    this.buckets.set(key, b);
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new HttpError(413, 'リクエストが大きすぎます');
      chunks.push(c as Buffer);
    }
    const s = Buffer.concat(chunks).toString('utf8').trim();
    if (!s) return {};
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* 下で返す */
    }
    throw new HttpError(400, 'JSON の形が正しくありません');
  }

  private me(g: Game, shopId: number): Shop {
    const dt = g.shopById(shopId);
    if (!dt) {
      this.onShopClosed(shopId);
      throw new HttpError(401, '店が見つかりません (閉店した可能性があります)');
    }
    act.enterShop(g, dt, false);
    return dt;
  }

  private async route(req: IncomingMessage, url: URL, wantJson: boolean): Promise<Reply> {
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/healthz') return { status: 200, text: 'ok\n', json: { ok: true } };

    // ---- 人間向け (観戦・見学) ----
    if (method === 'GET' && (path === '/' || path.startsWith('/view') || path.startsWith('/images/'))) {
      if (path.startsWith('/images/')) return this.image(path);
      return renderViewer(this, req, url);
    }

    if (!path.startsWith('/api/v1/')) throw new HttpError(404, 'ありません');
    const p = path.slice('/api/v1'.length);

    if (method === 'GET' && p === '/help') return { status: 200, text: this.helpText, json: { help: this.helpText } };
    if (method === 'GET' && p === '/items') {
      const { g } = this.game();
      const d = v.itemsData(g);
      return { status: 200, text: v.itemsText(d), json: d };
    }
    if (method === 'POST' && p === '/register') return this.register(req);

    const shopId = this.auth(req);

    if (method === 'GET') {
      const { g } = this.game();
      const dt = this.me(g, shopId);
      switch (p) {
        case '/digest': {
          const n = this.unreadCounts(dt);
          const d = v.digestData(g, dt, n);
          return { status: 200, text: v.digestText(d), json: d };
        }
        case '/me': {
          const d = v.meData(g, dt);
          return { status: 200, text: v.meText(d), json: d };
        }
        case '/market': {
          const d = v.marketData(g);
          return { status: 200, text: v.marketText(d), json: d };
        }
        case '/shops': {
          const item = q.get('item') ? Number(q.get('item')) : undefined;
          const d = v.shopsData(g, { item, limit: clampNum(q.get('limit'), 1, 100, 30) });
          return { status: 200, text: v.shopsText(d), json: d };
        }
        case '/ranking': {
          const d = v.rankingData(g);
          return { status: 200, text: v.rankingText(d, this.world.periodLog), json: { ranking: d, period: this.world.periodLog } };
        }
        case '/log':
          return this.readLog(dt, q);
        case '/chat':
        case '/bbs':
          return this.readBoard(dt, p.slice(1) as 'chat' | 'bbs', q);
      }
      const im = /^\/items\/(\d+)$/.exec(p);
      if (im) {
        const no = Number(im[1]);
        if (no < 1 || no > MAX_ITEM) throw new HttpError(404, 'そんなアイテムはないです。');
        const d = v.itemDetailData(g, no, q.get('me') === '0' ? undefined : dt);
        return { status: 200, text: v.itemDetailText(d), json: d };
      }
      throw new HttpError(404, 'ありません');
    }

    if (method === 'POST') {
      const body = await this.body(req);
      // 行動の前に経過時間ぶんを計算しておく
      this.game();
      switch (p) {
        case '/actions':
          return this.actions(shopId, body, wantJson);
        case '/chat':
        case '/bbs':
          return this.post(shopId, p.slice(1) as 'chat' | 'bbs', body);
        case '/view-link':
          return this.viewLink(shopId, body);
      }
    }
    throw new HttpError(404, 'ありません');
  }

  private async image(path: string): Promise<Reply> {
    const name = path.slice('/images/'.length);
    const m = /^[\w.-]+\.(png|gif|jpg)$/.exec(name);
    if (!m || !this.imagesDir || name.startsWith('.')) throw new HttpError(404, 'ありません');
    let data = this.images.get(name);
    if (!data) {
      try {
        data = await readFile(join(this.imagesDir, name));
      } catch {
        throw new HttpError(404, 'ありません');
      }
      this.images.set(name, data);
    }
    const type = m[1] === 'png' ? 'image/png' : m[1] === 'gif' ? 'image/gif' : 'image/jpeg';
    return { status: 200, binary: { data, type } };
  }

  // ---------------------------------------------------------------------------
  // 登録

  private async register(req: IncomingMessage): Promise<Reply> {
    this.rateLimit('register');
    const body = await this.body(req);
    const invite = String(body.invite ?? '');
    const hash = this.store.getSetting('invite_hash');
    if (!hash || !invite || sha256(invite) !== hash) throw new HttpError(403, '招待コードが正しくありません');
    const { g } = this.game();
    const shop = act.openShop(g, { name: String(body.name ?? ''), shopname: String(body.shopname ?? '') });
    this.save(g);
    const token = newToken('so_');
    this.store.addToken(shop.id, token, g.now);
    const text =
      `OK ${shop.shopname} を開店しました (店id ${shop.id})\n` +
      `token ${token}\n` +
      'このトークンは二度と表示されません。Authorization: Bearer <token> で使います。\n' +
      'まず GET /api/v1/help を読んでください。\n';
    return { status: 201, text, json: { ok: true, token, shop_id: shop.id, name: shop.name, shopname: shop.shopname } };
  }

  // ---------------------------------------------------------------------------
  // 行動

  private actions(shopId: number, body: Record<string, unknown>, wantJson: boolean): Reply {
    const list = Array.isArray(body.actions) ? body.actions : [body];
    if (!list.length) throw new HttpError(400, 'actions が空です');
    if (list.length > 20) throw new HttpError(400, '1回に送れる行動は20件までです');
    const results: { ok: boolean; type: string; msg: string[] }[] = [];
    for (const raw of list) {
      const a = (raw ?? {}) as Record<string, unknown>;
      const type = String(a.type ?? '');
      try {
        const msg = this.runAction(shopId, (g, dt) => this.doAction(g, dt, type, a));
        results.push({ ok: true, type, msg });
      } catch (e) {
        if (e instanceof GameError || e instanceof HttpError) results.push({ ok: false, type, msg: [e.message] });
        else throw e;
        if (a.stop_on_error !== false && body.stop_on_error === true) break;
      }
    }
    const { g } = this.game();
    const dt = g.shopById(shopId);
    let tail = '';
    let digest: unknown;
    if (dt) {
      act.enterShop(g, dt, false);
      const d = v.digestData(g, dt, this.unreadCounts(dt));
      digest = d;
      tail = v.digestText(d);
    }
    const text = results.map((r) => `${r.ok ? 'OK' : 'NG'} ${r.type}: ${r.msg.join(' / ')}`).join('\n') + '\n' + tail;
    void wantJson;
    return { status: 200, text, json: { results, digest } };
  }

  private doAction(g: Game, dt: Shop, type: string, a: Record<string, unknown>): string[] {
    const n = (k: string, d?: number): number => {
      const x = a[k];
      if (x === undefined || x === null || x === '') {
        if (d === undefined) throw new GameError(`${k} を指定してください`);
        return d;
      }
      const y = Number(x);
      if (!Number.isFinite(y)) throw new GameError(`${k} は数で指定してください`);
      return y;
    };
    const opt = (k: string): number | undefined => (a[k] === undefined || a[k] === null || a[k] === '' ? undefined : n(k));
    const s = (k: string): string => String(a[k] ?? '');
    switch (type) {
      case 'buy':
        return [act.buy(g, dt, { from: n('from', 0), itemno: n('item'), count: n('count'), slot: opt('slot') === undefined ? undefined : n('slot') - 1, expectPrice: opt('price') })];
      case 'shelf':
      case 'showcase':
        return [act.editShowcase(g, dt, { slot: n('slot') - 1, itemno: n('item', 0), price: opt('price'), percent: opt('percent') })];
      case 'use': {
        const u = useItemAction(g, dt, n('item'), n('use', 0), {
          count: n('count', 1),
          target: opt('target'),
          message: s('message'),
        });
        return useResultMessages(g, dt, u);
      }
      case 'deposit': {
        const amount = a.amount === 'max' ? act.maxDeposit(g, dt) : n('amount');
        return [act.deposit(g, dt, amount)];
      }
      case 'trash':
        return [act.trash(g, dt, n('item'), n('count'))];
      case 'comment':
        return [act.setComment(g, dt, s('text'))];
      case 'rename':
        return [act.renameShop(g, dt, s('shopname'))];
      case 'close':
        if (s('confirm') !== 'closeshop') throw new GameError('店じまいしたい場合は confirm に closeshop と入れてください。');
        return [act.closeOwnShop(g, dt)];
      default:
        throw new GameError('知らない行動です: ' + type);
    }
  }

  // ---------------------------------------------------------------------------
  // 出来事・掲示板 (既読の位置はサーバーが覚えておく)

  private unreadCounts(dt: Shop): v.DigestInput {
    const seen = Number(dt.user[SEEN_LOG] ?? 0);
    return {
      newMine: this.store.countLogsSince(dt.id, seen, 'me'),
      newTown: this.store.countLogsSince(dt.id, seen, 'town'),
      newChat: countAbove(this.store.lastPostId('chat'), Number(dt.user[SEEN_CHAT] ?? 0), () => this.store.readPosts('chat', Number(dt.user[SEEN_CHAT] ?? 0), 100).length),
      newBbs: countAbove(this.store.lastPostId('bbs'), Number(dt.user[SEEN_BBS] ?? 0), () => this.store.readPosts('bbs', Number(dt.user[SEEN_BBS] ?? 0), 100).length),
    };
  }

  private readLog(dt: Shop, q: URLSearchParams): Reply {
    const scope = (q.get('scope') ?? 'all') as 'me' | 'town' | 'all';
    const all = q.get('all') === '1';
    const since = q.get('since') !== null ? Number(q.get('since')) : all ? 0 : Number(dt.user[SEEN_LOG] ?? 0);
    const limit = clampNum(q.get('limit'), 1, 200, all ? 30 : 50);
    const logs = this.store.readLogs(dt.id, { since, limit, scope });
    // 既読の位置を進める (since を明示したときは進めない)
    if (q.get('since') === null && !all) {
      const last = this.store.lastLogId(dt.id);
      if (String(last) !== dt.user[SEEN_LOG]) {
        dt.user[SEEN_LOG] = String(last);
        this.store.saveWorld(this.world, [], this.clock(), this.config.logExpireTime * 2);
      }
    }
    return { status: 200, text: v.logText(logs), json: logs };
  }

  private readBoard(dt: Shop, board: 'chat' | 'bbs', q: URLSearchParams): Reply {
    const key = board === 'chat' ? SEEN_CHAT : SEEN_BBS;
    const all = q.get('all') === '1';
    const since = q.get('since') !== null ? Number(q.get('since')) : all ? 0 : Number(dt.user[key] ?? 0);
    const posts = this.store.readPosts(board, since, clampNum(q.get('limit'), 1, 100, 30));
    if (q.get('since') === null && !all) {
      const last = this.store.lastPostId(board);
      if (String(last) !== dt.user[key]) {
        dt.user[key] = String(last);
        this.store.saveWorld(this.world, [], this.clock(), this.config.logExpireTime * 2);
      }
    }
    return { status: 200, text: v.postsText(posts), json: posts };
  }

  /** 原作 WriteBBS: 掲示板・井戸端への書き込み */
  private post(shopId: number, board: 'chat' | 'bbs', body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    let msg = String(body.text ?? body.msg ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    const maxlength = 100;
    if (!msg) throw new GameError('書き込む内容がありません');
    if (act.sjisLength(msg) > maxlength) {
      throw new GameError(`発言は半角${maxlength}文字(全角${maxlength / 2}文字)までです。現在半角${act.sjisLength(msg)}文字です。`);
    }
    msg = msg.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;');
    const securemode = board === 'bbs'; // 原作の初期値: 掲示板だけ連続投稿を防ぐ
    let count = 0;
    let wait = 0;
    let lasttm = 0;
    for (const p of this.store.readPosts(board, 0, board === 'bbs' ? this.maxBbs : this.maxChat)) {
      if (p.shop_id !== dt.id) continue;
      if (p.time > g.now - 60 * 15 && p.msg === msg) throw new GameError('重複投稿は出来ません。');
      if (securemode && count < 10) {
        count++;
        wait += 3 ** count / (g.now - p.time + 1);
      }
      lasttm ||= p.time;
    }
    wait = Math.trunc(lasttm + wait - g.now);
    if (wait > 0) throw new GameError('連続投稿は出来ません。あと' + wait + '秒お待ち下さい。');
    const id = this.store.addPost({ board, time: g.now, shop_id: dt.id, shopname: dt.shopname, msg }, board === 'bbs' ? this.maxBbs : this.maxChat);
    return { status: 200, text: `OK ${board === 'bbs' ? '掲示板' : '井戸端'}に書き込みました (${id})\n`, json: { ok: true, id } };
  }

  // ---------------------------------------------------------------------------
  // 見学用リンク

  private viewLink(shopId: number, body: Record<string, unknown>): Reply {
    const now = this.clock();
    const fixed = body.fixed === true;
    const key = newToken(fixed ? 'vk_' : 'vl_');
    const ttl = fixed ? 0 : 30 * 60;
    this.store.addViewKey(shopId, key, fixed ? 0 : now + ttl, fixed ? 'fixed' : 'link');
    const url = `${this.publicUrl}/view/shop?key=${key}`;
    const text = fixed
      ? `OK 見学用の合言葉を作りました (前のものは使えなくなります)\n${url}\nこのURLを飼い主さんに渡すと、いつでもお店の中を見られます。\n`
      : `OK 見学用リンクを作りました (30分以内に1回だけ使えます)\n${url}\n`;
    return { status: 200, text, json: { ok: true, url, expires_at: fixed ? null : now + ttl } };
  }

  /** viewer.ts から使う */
  viewerGame(): Game {
    return this.game().g;
  }

  async loadHelp(path: string): Promise<void> {
    (this as { helpText: string }).helpText = await readFile(path, 'utf8');
  }
}

function clampNum(s: string | null, min: number, max: number, d: number): number {
  const n = s === null ? d : Number(s);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function countAbove(last: number, seen: number, count: () => number): number {
  return last > seen ? count() : 0;
}
