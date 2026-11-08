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
import { newToken, sha256, Store, SUGGESTION_CATEGORY, SUGGESTION_STATUS } from '../store.js';
import * as v from './views.js';
import { renderViewer } from './viewer.js';
import { SourceTree, sourceText } from './source.js';
import { PartyAuth, type PartyVerifier, type PartyWho } from './party.js';

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
  /** 配布するソースのフォルダ (リポジトリの中身) */
  sourceDir?: string;
  /** Muse Party のトークンを確かめる関数 (PARTY_URL から作る)。無ければ Party のトークンは使えない */
  partyVerifier?: PartyVerifier;
  /** 観戦画面から飛ぶ Muse Party の URL */
  partyPublicUrl?: string;
  /**
   * 別のサイトの下で動かすときの頭 (例 "/soldout")。
   * Muse の金庫は登録したドメインにだけトークンを差し込むので、Party と同じドメインの下に置けるようにする。
   */
  basePath?: string;
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
const SEEN_SUGGEST = '_api_seen_suggest';
/** 目安箱: 1店あたり 24 時間に出せる案の数と、1件の長さ (文字) */
const SUGGEST_PER_DAY = 5;
const SUGGEST_MAX_CHARS = 800;

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
  readonly source: SourceTree | undefined;
  readonly party: PartyAuth | undefined;
  readonly partyPublicUrl: string;
  readonly basePath: string;
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
    this.source = o.sourceDir ? new SourceTree(o.sourceDir) : undefined;
    this.party = o.partyVerifier ? new PartyAuth(o.partyVerifier) : undefined;
    this.partyPublicUrl = (o.partyPublicUrl ?? '').replace(/\/$/, '');
    this.basePath = (o.basePath ?? '').replace(/\/+$/, '');
    if (this.basePath && !this.basePath.startsWith('/')) this.basePath = '/' + this.basePath;
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
    this.store.unlinkPartyShop(shopId);
  }

  // ---------------------------------------------------------------------------
  // HTTP

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let reply: Reply;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (this.basePath) {
      if (url.pathname === this.basePath) {
        res.writeHead(301, { location: this.basePath + '/' + url.search });
        res.end();
        return;
      }
      // 頭付きでも頭なしでも受け付ける (サブドメインからの直接アクセスもそのまま動く)
      if (url.pathname.startsWith(this.basePath + '/')) url.pathname = url.pathname.slice(this.basePath.length);
    }
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
      const h = { 'content-type': r.binary.type, 'cache-control': 'public, max-age=86400', ...(r.headers ?? {}) };
      res.writeHead(r.status, h);
      res.end(r.binary.data);
      return;
    }
    if (r.html !== undefined) {
      body = this.basePath ? withBase(r.html, this.basePath) : r.html;
      type = 'text/html; charset=utf-8';
    } else if (wantJson && r.json !== undefined) {
      body = JSON.stringify(r.json);
      type = 'application/json; charset=utf-8';
    } else {
      body = r.text ?? '';
      type = 'text/plain; charset=utf-8';
    }
    const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', ...(r.headers ?? {}) };
    if (this.basePath && headers.location?.startsWith('/')) headers.location = this.basePath + headers.location;
    if (this.basePath && headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].replace('Path=/;', `Path=${this.basePath}/;`);
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

  private bearer(req: IncomingMessage): string | undefined {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    return m?.[1];
  }

  /** Party のトークンなら持ち主を確かめる。Party と組んでいない・SOLD OUT のトークンなら undefined */
  private async partyWho(token: string): Promise<PartyWho | undefined> {
    if (!this.party || token.startsWith('so_')) return undefined;
    try {
      return await this.party.who(token);
    } catch (e) {
      console.error(e);
      throw new HttpError(503, 'Muse Party に確認できませんでした。少したってから試してください');
    }
  }

  private async auth(req: IncomingMessage): Promise<number> {
    const token = this.bearer(req);
    if (!token) throw new HttpError(401, 'Authorization: Bearer <トークン> が必要です');
    // 確かめに行く前に数える (Party に問い合わせが殺到しないように)
    this.rateLimit('t:' + sha256(token).slice(0, 16));
    let shopId = this.store.shopIdByToken(token);
    if (shopId === undefined) {
      const who = await this.partyWho(token);
      if (!who) throw new HttpError(401, 'トークンが正しくありません');
      shopId = this.store.shopIdByPartyOwner(who.ownerId);
      if (shopId === undefined) {
        throw new HttpError(404, 'まだお店がありません。POST /api/v1/register に {"shopname":"お店の名前"} を送ると開店できます (招待コードは不要です)');
      }
    }
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
    if (method === 'GET' && (path === '/' || path.startsWith('/view') || path.startsWith('/images/') || path === '/source' || path.startsWith('/source'))) {
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

    if (p.startsWith('/admin/')) return this.admin(req, method, p.slice('/admin'.length), q);
    // 保管庫の接続確認などが「自分は誰か」を聞いたとき、管理用トークンにも 200 で答える
    if (method === 'GET' && p === '/me' && this.isAdminToken(this.bearer(req))) {
      return { status: 200, text: 'role admin (管理用トークン)\n', json: { role: 'admin' } };
    }

    const shopId = await this.auth(req);

    if (method === 'GET') {
      const { g } = this.game();
      const dt = this.me(g, shopId);
      if (p === '/source' || p.startsWith('/source/')) {
        if (!this.source) throw new HttpError(404, 'ありません');
        const r = sourceText(this.source, p.slice('/source'.length));
        return { status: r.status, text: r.text, json: { text: r.text } };
      }
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
        case '/suggest': {
          const list = this.store.suggestionsOf(dt.id, clampNum(q.get('limit'), 1, 50, 10));
          const latest = Math.max(0, ...list.map((s) => s.updated_at));
          if (latest > Number(dt.user[SEEN_SUGGEST] ?? 0)) {
            dt.user[SEEN_SUGGEST] = String(latest);
            this.store.saveWorld(this.world, [], this.clock(), this.config.logExpireTime * 2);
          }
          return { status: 200, text: v.suggestionsText(list), json: list };
        }
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
        case '/suggest':
          return this.suggest(shopId, body);
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
    const bearer = this.bearer(req);
    const who = bearer ? await this.partyWho(bearer) : undefined;
    if (bearer && this.party && !bearer.startsWith('so_') && !who) throw new HttpError(401, 'Muse Party のトークンが正しくありません');
    if (who) return this.registerParty(who, body);
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

  /** Muse Party の人の開店。招待コードは要らず、トークンも Party のものをそのまま使う */
  private registerParty(who: PartyWho, body: Record<string, unknown>): Reply {
    const had = this.store.shopIdByPartyOwner(who.ownerId);
    if (had !== undefined && this.world.shops.some((s) => s.id === had && s.status)) {
      throw new HttpError(409, 'すでにお店があります (1人1店です。別人格でも同じです)');
    }
    if (had !== undefined) this.store.unlinkPartyShop(had);
    const { g } = this.game();
    const name = String(body.name ?? '') || who.ownerId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    const shop = act.openShop(g, { name, shopname: String(body.shopname ?? '') });
    this.save(g);
    this.store.linkPartyOwner(who.ownerId, shop.id, g.now);
    const text =
      `OK ${shop.shopname} を開店しました (店id ${shop.id})\n` +
      'Muse Party のトークンをそのまま Authorization: Bearer に入れて遊べます。\n' +
      'まず GET /api/v1/help を読んでください。\n';
    return { status: 201, text, json: { ok: true, shop_id: shop.id, name: shop.name, shopname: shop.shopname, token: 'party' } };
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
      newReplies: this.store.countSuggestionUpdates(dt.id, Number(dt.user[SEEN_SUGGEST] ?? 0)),
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
  // 目安箱 (Muse からの改善案)

  private suggest(shopId: number, body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw new GameError('案の中身がありません');
    if ([...text].length > SUGGEST_MAX_CHARS) throw new GameError(`案は${SUGGEST_MAX_CHARS}文字までです (今${[...text].length}文字)`);
    if (this.store.countSuggestionsSince(dt.id, g.now - 86400) >= SUGGEST_PER_DAY) {
      throw new GameError(`目安箱に入れられるのは24時間に${SUGGEST_PER_DAY}件までです`);
    }
    const raw = String(body.category ?? 'other');
    // 日本語の名前でも受け付ける
    const category = (SUGGESTION_CATEGORY as readonly string[]).includes(raw)
      ? raw
      : Object.entries(v.CATEGORY_JA).find(([, ja]) => ja === raw)?.[0];
    if (!category) throw new GameError('category は feature(追加実装) / bug(不具合) / balance(調整) / other(その他) のどれかです');
    const id = this.store.addSuggestion(dt.id, dt.shopname, category, text, g.now);
    return { status: 201, text: `OK 目安箱に入れました (#${id})。返事は GET /api/v1/suggest で見られます\n`, json: { ok: true, id } };
  }

  // ---------------------------------------------------------------------------
  // 管理用 (管理用トークン sa_... を持つ人だけ。ミュート用)

  /** 管理用トークン (sa_) が正しいか */
  private isAdminToken(token: string | undefined): boolean {
    const hash = this.store.getSetting('admin_token_hash');
    return !!token && !!hash && token.startsWith('sa_') && sha256(token) === hash;
  }

  /** 管理者として許可した店 (admin-grant)。その店のトークン (Party のトークンも) で管理 API が使える */
  adminShops(): number[] {
    return (this.store.getSetting('admin_shops') ?? '').split(',').filter(Boolean).map(Number);
  }

  private async adminAuth(req: IncomingMessage): Promise<void> {
    const token = this.bearer(req);
    this.rateLimit('a:' + sha256(token ?? '').slice(0, 16));
    if (this.isAdminToken(token)) return;
    if (!token) throw new HttpError(403, '管理用のトークンが必要です');
    const shopId = await this.auth(req).catch(() => undefined);
    if (shopId === undefined || !this.adminShops().includes(shopId)) throw new HttpError(403, '管理者として許可されていません');
  }

  private async admin(req: IncomingMessage, method: string, p: string, q: URLSearchParams): Promise<Reply> {
    await this.adminAuth(req);
    if (method === 'GET' && p === '/suggestions') {
      const list = this.store.listSuggestions({ status: q.get('status') ?? 'open', category: q.get('category') ?? undefined, since: Number(q.get('since') ?? 0) || 0, limit: clampNum(q.get('limit'), 1, 200, 50) });
      return { status: 200, text: v.suggestionsText(list, true), json: list };
    }
    const sm = /^\/suggestions\/(\d+)$/.exec(p);
    if (method === 'POST' && sm) {
      const body = await this.body(req);
      const s = this.store.getSuggestion(Number(sm[1]));
      if (!s) throw new HttpError(404, 'その案はありません');
      const status = String(body.status ?? s.status);
      if (!(SUGGESTION_STATUS as readonly string[]).includes(status)) throw new HttpError(400, 'status は ' + SUGGESTION_STATUS.join(' / ') + ' のどれかです');
      const reply = body.reply === undefined ? s.reply : String(body.reply).slice(0, 800);
      this.store.updateSuggestion(s.id, status, reply, this.clock());
      return { status: 200, text: `OK #${s.id} を ${status} にしました\n`, json: { ok: true } };
    }
    if (method === 'POST' && p === '/notice') {
      const body = await this.body(req);
      const text = String(body.text ?? '').replace(/[\r\n]+/g, ' ').trim();
      if (!text || [...text].length > 200) throw new HttpError(400, 'お知らせは1〜200文字です');
      const { g } = this.game();
      g.writeLog(1, 0, 0, '【お知らせ】' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      this.save(g);
      return { status: 200, text: 'OK 街の出来事にお知らせを出しました\n', json: { ok: true } };
    }
    if (method === 'POST' && p === '/invite') {
      const body = await this.body(req);
      const code = body.code === null || body.code === '' ? undefined : String(body.code ?? '');
      if (code !== undefined && code.length < 8) throw new HttpError(400, '招待コードは8文字以上にしてください (null で登録停止)');
      this.store.setSetting('invite_hash', code ? sha256(code) : undefined);
      return { status: 200, text: code ? 'OK 招待コードを変えました\n' : 'OK 招待コードでの登録を止めました\n', json: { ok: true } };
    }
    if (method === 'GET' && p === '/stats') {
      const { g } = this.game();
      const counts = this.store.countSuggestionsByStatus();
      const top = g.shops.slice(0, 5).map((s, i) => `${i + 1}位 ${s.shopname} 点${s.point}`);
      const d = {
        shops: g.shops.length,
        max_shops: this.config.maxUser,
        people: this.world.people,
        events: g.eventMessages,
        next_period: g.nextPeriodTime(),
        last_turn: this.world.lasttime,
        suggestions: counts,
        party: !!this.party,
        invite: !!this.store.getSetting('invite_hash'),
      };
      const text =
        `店${d.shops}/${d.max_shops} 人口${d.people} 次の決算${v.jst(d.next_period)} 最後の計算${v.jst(d.last_turn)}\n` +
        `目安箱 ${Object.entries(counts).map(([k, n]) => `${k}${n}`).join(' ') || 'なし'} | Party連携${d.party ? 'あり' : 'なし'} 招待コード${d.invite ? 'あり' : 'なし'}\n` +
        (d.events.length ? 'イベント ' + d.events.join('/') + '\n' : '') +
        (top.length ? top.join(' / ') + '\n' : '');
      return { status: 200, text, json: { ...d, top: g.shops.slice(0, 5).map((s) => ({ id: s.id, shop: s.shopname, point: s.point })) } };
    }
    throw new HttpError(404, 'ありません');
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
      : `OK 見学用リンクを作りました (30分のあいだ何度でも開けます。ずっと使える合鍵は {"fixed":true})\n${url}\n`;
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

/** HTML の中の「/ で始まるリンク」に頭を付ける (href / src / action / 画像の差し替え) */
export function withBase(html: string, base: string): string {
  return html.replace(/\b(href|src|action)="\/(?!\/)/g, `$1="${base}/`).replace(/this\.src='\/(?!\/)/g, `this.src='${base}/`);
}
