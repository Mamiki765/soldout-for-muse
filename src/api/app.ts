// SOLD OUT for Muse — HTTP API 本体。
// 1 プロセスで街の状態をメモリに持ち、リクエストのたびに原作と同じく「経過時間ぶんの計算」をしてから処理する。
// Node は 1 スレッドなので、リクエストは 1 件ずつ順番に処理される (原作の Lock の代わり)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CONFIG, GAME_TITLE, type GameConfig } from '../config.js';
import { BASE_ITEMS, isPublicItem, itemNoByName, itemVisibility, MAX_ITEM } from '../data/catalog.js';
import * as act from '../engine/actions.js';
import { COST_REPORT_KEEP, costReportData, costReportText } from '../engine/costs.js';
import { Game, GameError } from '../engine/game.js';
import { mathRandom, type Rng } from '../engine/rng.js';
import { turn } from '../engine/turn.js';
import { observePrices, PRICE_HISTORY_KEEP } from '../engine/prices.js';
import { shownPeople, type LogEntry, type Shop, type World } from '../engine/types.js';
import { averageJoblvYield } from '../engine/joblv.js';
import { applyFairyBackfill, planFairyBackfill, type FairyBackfillSnapshot } from '../engine/fairy-backfill.js';
import { loadUses, useItemAction, useResultMessages, type RtUse } from '../engine/use.js';
import * as ord from '../engine/orders.js';
import * as watch from '../engine/watch.js';
import * as tut from '../engine/tutorial.js';
import * as rest from '../engine/rest.js';
import { newToken, sha256, Store, SUGGESTION_CATEGORY, SUGGESTION_STATUS } from '../store.js';
import * as v from './views.js';
import { TIPS } from '../tips.js';
import { dropViewSessions, renderViewer } from './viewer.js';
import { renderOnboarding } from './onboarding.js';
import { SourceTree, sourceText } from './source.js';
import { PartyAuth, PartyBlocked, type PartyVerifier, type PartyWho } from './party.js';
import { APP_VERSION, UPDATE_NOTICE, UPDATES, updatesText } from '../updates.js';
import { checkOwnerName, OwnerHub } from './owners.js';
import { MailBox, mailListData, mailListText, mailThreadData, mailThreadText } from './mail.js';
import { MOVE_ITEM, MOVE_TIME, PAINT_ITEM, PAINT_TIME, TownService, type ShopInfo } from '../town/town.js';
import * as tv from './town-view.js';

export interface AppOptions {
  store: Store;
  config?: Partial<GameConfig>;
  rng?: Rng;
  /** 現在時刻 (秒)。テスト用 */
  clock?: () => number;
  /** 外から見たときのURLの頭 (見学用リンクに使う)。例 https://museimg.party/soldout */
  publicUrl?: string;
  /** API の説明文 (docs/API.md) */
  helpText?: string;
  /** 掲示板の保存件数 / 井戸端の保存件数 (原作 $MAX_BBS_MESSAGE / $MAX_CHAT_MESSAGE) */
  maxBbs?: number;
  maxChat?: number;
  /** 1 トークンあたりのリクエスト上限 (1分あたり) */
  ratePerMinute?: number;
  /** 登録 (register) のトークンごとの上限 (1分あたり) */
  registerPerMinute?: number;
  /** Muse Party への確認 (覚えていないトークンだけ) の全体の上限 (1分あたり) */
  partyChecksPerMinute?: number;
  /** 招待コードの失敗の全体の上限 (1分あたり) */
  inviteFailPerMinute?: number;
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
  /** アイコン・許可証の保存先 (ASSETS_ROOT)。無ければ画像の登録はできない */
  assetsDir?: string;
  /** 画像の公開URLの頭 (ASSETS_BASE_URL)。既定は publicUrl + '/assets' (このサーバーが自分で配る) */
  assetsBaseUrl?: string;
  /** 許可証の枠とキット (kit/) */
  kitDir?: string;
  /** 指定した起動時だけ、欠けている職・商人ポイントを移し替える。空配列なら現在の保存だけで試算する。 */
  fairyBackfill?: readonly FairyBackfillSnapshot[];
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
  /** retryAfter: 何秒待てばよいか (Retry-After ヘッダーと JSON の retry_after に載せる) */
  constructor(readonly status: number, message: string, readonly retryAfter?: number) {
    super(message);
  }
}

/** API と画像の CORS (スペースから直接読むため。cookie は使わない) */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, if-none-match, idempotency-key',
  'access-control-expose-headers': 'etag, retry-after, x-unread-left',
};

/** Muse Party に確認できないときに待ってもらう秒数 */
const PARTY_RETRY_SECONDS = 30;

const SEEN_LOG = '_api_seen_log';
/** 出来事の既読の位置を、自分の記録と街の記録で別に持つ (無ければ SEEN_LOG から始める。監査 A07) */
const SEEN_LOG_ME = '_api_seen_log_me';
const SEEN_LOG_TOWN = '_api_seen_log_town';
const SEEN_CHAT = '_api_seen_chat';
const SEEN_BBS = '_api_seen_bbs';
const SEEN_SUGGEST = '_api_seen_suggest';
/** 店に【更新】の通知を出した版 (届けたかどうか。読んだかどうかとは別) */
const SEEN_VERSION = '_seen_version';
/** 認証して GET /api/v1/updates で最新版まで読んだ版 (digest の「未読更新」を消す) */
const READ_VERSION = '_updates_read';
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
  readonly registerPerMinute: number;
  readonly partyChecksPerMinute: number;
  readonly inviteFailPerMinute: number;
  readonly imagesDir: string | undefined;
  readonly source: SourceTree | undefined;
  readonly party: PartyAuth | undefined;
  readonly partyPublicUrl: string;
  readonly basePath: string;
  readonly owners: OwnerHub;
  /** 店主の郵便箱 (1.0.0) */
  readonly mail: MailBox;
  /** 街の地図と住所 (1.2.0) */
  readonly town: TownService;
  world: World;
  private images = new Map<string, Buffer>();
  private buckets = new Map<string, { tokens: number; at: number; cap: number }>();
  private bucketsSweptAt = 0;
  private assetsSweptAt = 0;

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
    this.registerPerMinute = o.registerPerMinute ?? 6;
    this.partyChecksPerMinute = o.partyChecksPerMinute ?? 30;
    this.inviteFailPerMinute = o.inviteFailPerMinute ?? 10;
    this.imagesDir = o.imagesDir;
    this.source = o.sourceDir ? new SourceTree(o.sourceDir) : undefined;
    // Party に聞きに行くのは「覚えていないトークン」のときだけ。その回数を全体で数える (毎回違うトークンで来られても Party に殺到しない)
    this.party = o.partyVerifier
      ? new PartyAuth(o.partyVerifier, undefined, undefined, () =>
          this.rateLimit('party', this.partyChecksPerMinute, '混み合っています (Muse Party への確認が集中しています)'))
      : undefined;
    this.partyPublicUrl = (o.partyPublicUrl ?? '').replace(/\/$/, '');
    this.basePath = (o.basePath ?? '').replace(/\/+$/, '');
    if (this.basePath && !this.basePath.startsWith('/')) this.basePath = '/' + this.basePath;
    this.world = this.store.loadWorld(this.clock());
    // 点数 (point) は保存しないので、読み込んだら並べ直して計算しておく
    new Game(this.world, this.config, this.rng, this.clock()).sortShops();
    this.owners = new OwnerHub(this.store, {
      assetsDir: o.assetsDir,
      assetsBaseUrl: (o.assetsBaseUrl ?? this.publicUrl + '/assets').replace(/\/+$/, ''),
      kitDir: o.kitDir,
    });
    // 0.5.0 より前からある店に som を渡す (開店日の古い順)
    this.owners.migrate(this.world, (id) => this.store.partyOwnerOfShop(id), this.clock());
    if (o.fairyBackfill !== undefined) {
      const totals = (id: number) => {
        const owner = this.store.ownerByShop(id);
        return owner ? this.store.ownerTaxTotals(owner.som) : undefined;
      };
      const rows = planFairyBackfill({
        world: this.world,
        salesTax: (id) => totals(id)?.sales ?? 0n,
        depositTax: (id) => totals(id)?.deposit ?? 0n,
      }, this.config, o.fairyBackfill);
      if (applyFairyBackfill(this.world, rows, this.clock())) this.persist([], this.clock());
    }
    this.mail = new MailBox(this.store);
    this.town = new TownService(this.store, this.config.oneDayTime);
    this.initTown();
  }

  /**
   * 街の地図を初めて作る (1.2.0)。今いる店を区画に割り振り、ペンキ・転居許可証を市場に並べる。
   * もう街があれば、猶予の切れた空き家を片付けるだけ
   */
  private initTown(): void {
    const now = this.clock();
    if (this.town.districts) {
      this.town.expire(now);
      return;
    }
    const soms = this.world.shops.filter((s) => s.status).map((s) => this.store.ownerByShop(s.id)?.som).filter((x): x is string => !!x);
    this.town.init(soms, now);
    const ws = this.world.wholestore;
    const cap = Math.max(1, this.world.shops.filter((s) => s.status).length);
    for (const no of [PAINT_ITEM, MOVE_ITEM]) if (no <= MAX_ITEM && !(ws[no - 1] > 0)) ws[no - 1] = cap;
    this.persist([], now);
  }

  /** 街の地図に描く店の様子 (som から)。閉店中の店主は undefined */
  townInfo(g: Game): (som: string) => ShopInfo | undefined {
    return (som) => {
      const ow = this.store.ownerBySom(som);
      const dt = ow?.shop_id != null ? g.allShops.find((s) => s.id === ow.shop_id && s.status) : undefined;
      if (!ow || !dt) return undefined;
      return { shelves: dt.showcasecount, resting: !!dt.rest, shop: dt.shopname, owner: ow.display_name, job: v.jobName(dt) };
    };
  }

  /**
   * digest に付ける未読の案内。最新版を /api/v1/updates で読むまで毎回1行だけ出し、読んだら消える。
   * 前に読んだ版があれば、その版より新しいぶんだけ取れる URL にする (読むトークンを減らす)。
   */
  digestNotice(dt: Shop): string | null {
    const read = dt.user[READ_VERSION];
    if (read && !newerVersion(APP_VERSION, read)) return null;
    return `未読更新 v${APP_VERSION} /api/v1/updates${read ? '?since=' + read : ''}`;
  }

  /**
   * 認証つきの GET /api/v1/updates で最新版まで返したとき、その店を既読にする。
   * 認証なし・トークン違い・Party に確かめられない ときは何も書かずに null (履歴はいつもどおり誰でも読める)。
   */
  private async markUpdatesRead(req: IncomingMessage): Promise<number | null> {
    const token = this.bearer(req);
    if (!token || this.isAdminToken(token)) return null;
    let shopId: number;
    try {
      shopId = await this.auth(req);
    } catch (e) {
      if (e instanceof HttpError) return null;
      throw e;
    }
    const g = new Game(this.world, this.config, this.rng, this.clock());
    const dt = g.shopById(shopId);
    if (!dt) return null;
    const read = dt.user[READ_VERSION];
    if (!read || newerVersion(APP_VERSION, read)) {
      dt.user[READ_VERSION] = APP_VERSION;
      this.save(g);
    }
    return shopId;
  }

  /** トークン付きで tips を読んだ店の手引きを進める。トークンが無い・違うときは何もしない */
  private async markTipsRead(req: IncomingMessage): Promise<void> {
    const token = this.bearer(req);
    if (!token || this.isAdminToken(token)) return;
    let shopId: number;
    try {
      shopId = await this.auth(req);
    } catch (e) {
      if (e instanceof HttpError) return;
      throw e;
    }
    const g = new Game(this.world, this.config, this.rng, this.clock());
    const dt = g.shopById(shopId);
    if (dt && tut.onTutorialRead(dt, 'tips')) this.save(g);
  }

  // ---------------------------------------------------------------------------
  // 状態の読み書き

  /** 経過時間ぶんの計算をした Game を返す (原作の Turn → DataRead) */
  private game(): { g: Game; turned: boolean } {
    if (this.worldNeedsReload) this.loadSavedWorld();
    const now = this.clock();
    const g = new Game(this.world, this.config, this.rng, now);
    const before = this.world.shops.map((s) => s.id);
    // 期限切れの募集の返金は、時間の計算と同じくアクセスのたびに行う
    let turned: boolean;
    try {
      const turnedTime = turn(g);
      turned = ord.sweepOrders(g) || turnedTime;
      // 旧版の未処理区間を通常どおり消化してから記録を始める。区間を分割して売れ行き等を変えない。
      if (turnedTime) this.world.taxTrackingStartedAt ??= this.world.lasttime;
    } catch (e) {
      // 計算の途中で落ちたら、メモリの街は中途半端。保存してある街に戻す (監査 A01)
      this.reloadWorld();
      throw e;
    }
    if (turned) {
      this.save(g);
      // 不在閉店・倒産した店のトークン・合鍵・Party のつながり・管理の許可を、保存と同じときに片付ける (監査 A04)
      for (const id of before) if (!g.shopById(id)) this.onShopClosed(id);
    }
    return { g: turned ? new Game(this.world, this.config, this.rng, now) : g, turned };
  }

  private save(g: Game): void {
    // 値動きと税額は街と一緒に確定する。閉店・倒産のsomを切り離す前に書く。
    const rows = g.newPriceRows;
    const writes = g.pendingWrites.splice(0);
    this.persist(g.newLogs, g.now, rows.length || g.newTaxes.size || writes.length ? () => {
      if (rows.length) this.store.addPriceRows(rows, PRICE_HISTORY_KEEP);
      if (g.newTaxes.size) this.store.addTaxTotals(g.newTaxes);
      for (const w of writes) w();
    } : undefined);
    if (rows.length) this.prevPrices = undefined;
    rows.length = 0;
    g.newTaxes.clear();
    g.newLogs.length = 0;
  }

  /** いちばん新しい決算の値動き (digest・market の前期比用)。決算で書くまで覚えておく */
  private prevPrices: v.LastPrices | undefined;
  private lastPrices(): v.LastPrices {
    return (this.prevPrices ??= this.store.lastPeriodPrices());
  }

  /**
   * メモリの街を保存する。保存に失敗したら、メモリの街を保存してある街 (最後に確定したもの) に戻してから投げる。
   * 失敗した計算・行動の結果が、あとの別の保存で確定してしまわないように (監査 A01)。
   * extra は同じトランザクションで一緒に書くもの (開店のトークンなど。監査 A03)
   */
  private persist(newLogs: LogEntry[], now: number, extra?: () => void): void {
    try {
      if (this.worldNeedsReload) throw new Error('保存済みの街を読み直せていません');
      this.store.saveWorld(this.world, newLogs, now, this.config.logExpireTime * 2, extra);
    } catch (e) {
      this.reloadWorld();
      throw e;
    }
  }

  private worldNeedsReload = false;

  /** 保存してある街を読み直す (メモリの街を捨てる) */
  private loadSavedWorld(): void {
    const world = this.store.loadWorld(this.clock());
    new Game(world, this.config, this.rng, this.clock()).sortShops();
    this.world = world;
    this.worldNeedsReload = false;
  }

  private reloadWorld(): void {
    this.worldNeedsReload = true;
    try {
      this.loadSavedWorld();
    } catch (e) {
      // 読み直しに成功するまで、失敗した処理の街を保存しない
      console.error(e);
    }
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
      // 棚・値段・市場在庫が変わったかもしれないので、今期の最安・最高を更新する (0.6.0)
      observePrices(g);
      this.save(g);
      if (!g.shopById(shopId)) this.onShopClosed(shopId);
      return r;
    } catch (e) {
      this.world = snapshot;
      throw e;
    }
  }

  /** 管理の操作を1件実行する (店の行動ではないので lastlogin は動かさない)。失敗したら元に戻す */
  private runAdmin(fn: (g: Game) => void): void {
    this.game();
    const snapshot = structuredClone(this.world);
    const g = new Game(this.world, this.config, this.rng, this.clock());
    try {
      fn(g);
      g.sortShops();
      this.save(g);
    } catch (e) {
      this.world = snapshot;
      throw e;
    }
  }

  private onShopClosed(shopId: number): void {
    // 住所は空き家として猶予を残す (店主の行から店を外す前に som を読む)
    const som = this.store.ownerByShop(shopId)?.som;
    if (som) this.town.onClosed(som, this.clock());
    this.owners.onClosed(shopId, this.clock());
    this.store.deleteTokensOf(shopId);
    this.store.deleteViewKeysOf(shopId);
    this.store.unlinkPartyShop(shopId);
    dropViewSessions(shopId);
    // 閉じた店に付けていた管理の許可も外す (同じ店idがまた使われることはないが、残しておく理由もない)
    const admins = this.adminShops();
    if (admins.includes(shopId)) this.store.setSetting('admin_shops', admins.filter((x) => x !== shopId).join(',') || undefined);
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
    // スペース (Muse が作るページ) から直接読めるように、API は CORS を開ける。cookie は使わないので * でよい
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/')) {
      for (const [k, val] of Object.entries(CORS)) res.setHeader(k, val);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-max-age': '86400' });
        res.end();
        return;
      }
    }
    try {
      reply = await this.route(req, url, wantJson);
    } catch (e) {
      if (e instanceof GameError) reply = { status: 409, text: 'NG ' + e.message + '\n', json: { ok: false, error: e.message } };
      else if (e instanceof HttpError) {
        reply = { status: e.status, text: 'NG ' + e.message + '\n', json: { ok: false, error: e.message, ...(e.retryAfter ? { retry_after: e.retryAfter } : {}) } };
        if (e.retryAfter) reply.headers = { 'retry-after': String(e.retryAfter) };
      }
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
      const h: Record<string, string> = { 'content-type': r.binary.type, 'cache-control': 'public, max-age=86400', ...(r.headers ?? {}) };
      if (r.status === 200 && req.method === 'GET' && r.headers?.etag && req.headers['if-none-match'] === r.headers.etag) {
        res.writeHead(304, h);
        res.end();
        return;
      }
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

  /**
   * Authorization ヘッダーからトークンを取り出す。Muse Party と同じく、金庫の設定ゆれ
   * (小文字の bearer、Bearer の二重、前後の空白、Bearer なしでトークンだけ) を許す。
   * Party では通るのにこちらだけ 401、を起こさないため。
   */
  private bearer(req: IncomingMessage): string | undefined {
    let h = (req.headers.authorization ?? '').trim();
    let stripped = false;
    while (/^bearer\s/i.test(h)) {
      h = h.slice(6).trim();
      stripped = true;
    }
    if (!h || /\s/.test(h)) return undefined;
    if (!stripped && !/^(mct|mat|so|sa|vk)_/.test(h)) return undefined;
    return h;
  }

  /** 401 の文面。招待コードを入れている・Party に届かない形、を見分けられるように */
  private badToken(token: string, party: boolean): HttpError {
    if (token.startsWith('mip_')) {
      return new HttpError(401, 'mip_ で始まるのは Muse Party の招待コードで、トークンではありません。Party の参加ページ (https://museimg.party/join) で登録したときに1回だけ表示された mct_ で始まるトークンを使ってください');
    }
    if (token.startsWith('mci_')) {
      return new HttpError(401, 'mci_ で始まるのはココア鯖 (Muse Chat) の招待コードで、ここでは使えません。Muse Party の参加ページ (https://museimg.party/join) で登録したときに1回だけ表示された mct_ で始まるトークンを使ってください');
    }
    return new HttpError(
      401,
      (party ? 'Muse Party のトークンが正しくありません' : 'トークンが正しくありません') +
        '。使えるのは Muse Party の参加者トークン (mct_...) か、SOLD OUT で発行したトークン (so_...) です。ココア鯖 (Muse Chat) など別の場所のトークンは、形が似ていても使えません。Party の GET https://museimg.party/api/me が 200 になるか先に確かめてください (401 なら返事の hint に直し方があります)',
    );
  }

  /** Party のトークンなら持ち主を確かめる。Party と組んでいない・SOLD OUT のトークンなら undefined */
  private async partyWho(token: string, strict = false): Promise<PartyWho | undefined> {
    if (!this.party || token.startsWith('so_')) return undefined;
    try {
      return await this.party.who(token, strict);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof PartyBlocked) {
        const why = e.reason === 'token_revoked' ? 'このトークンは Muse Party で失効しています' : e.reason === 'suspended' ? 'Muse Party で一時停止中です' : `Muse Party で止められています (${e.reason})`;
        throw new HttpError(403, why + '。繰り返し試さず、オーナーに伝えてください');
      }
      console.error(e);
      throw new HttpError(503, `Muse Party に確認できませんでした。${PARTY_RETRY_SECONDS}秒以上待ってから試してください`, PARTY_RETRY_SECONDS);
    }
  }

  /** strict: 管理 API 用。Party のトークンは、期限の切れた確認結果では通さない (監査 B01)。店の合鍵 (vk_) は読むだけなので断る */
  private async auth(req: IncomingMessage, strict = false): Promise<number> {
    const a = await this.authInfo(req, strict);
    if (a.readonly) throw new HttpError(403, '店の合鍵 (vk_) で使えるのは読むだけ (GET) です。書き込みは Muse のトークンで');
    return a.shopId;
  }

  /** 誰の店か。店の固定合鍵 (vk_) なら readonly (スペースから読むため。0.5.0) */
  private async authInfo(req: IncomingMessage, strict = false): Promise<{ shopId: number; readonly: boolean }> {
    const token = this.bearer(req);
    if (!token) throw new HttpError(401, 'Authorization: Bearer <トークン> が必要です (ヘッダーが届いていないか、形が違います。金庫のコネクタのホストが museimg.party で、置き場所が Authorization ヘッダーか確かめてください)');
    // 確かめに行く前に数える (Party に問い合わせが殺到しないように)
    this.rateLimit('t:' + sha256(token).slice(0, 16));
    if (token.startsWith('vk_')) {
      const id = this.store.shopIdByFixedViewKey(token);
      if (id === undefined || !this.world.shops.some((s) => s.id === id)) {
        throw new HttpError(401, '店の合鍵が正しくないか、作り直されています。Muse に POST /api/v1/view-link {"fixed":true} で作り直してもらってください');
      }
      return { shopId: id, readonly: true };
    }
    let shopId = this.store.shopIdByToken(token);
    if (shopId === undefined) {
      const who = await this.partyWho(token, strict);
      if (!who) throw this.badToken(token, false);
      shopId = this.store.shopIdByPartyOwner(who.ownerId);
      if (shopId === undefined) {
        throw new HttpError(404, 'まだお店がありません。POST /api/v1/register に {"shopname":"お店の名前"} を送ると開店できます (招待コードは不要です)');
      }
      // Party の名前が変わっていたら店主名に写す (確認はふだん6時間に1回なので、そのころに揃う)
      this.owners.syncPartyName(shopId, who.name, this.clock());
    }
    return { shopId, readonly: false };
  }

  /**
   * トークンバケット。cap 回ぶん貯まり、1分で cap 回ぶん戻る。
   * 足りなければ 429 と「何秒待てばよいか」を返す。consume=false なら数えずに確かめるだけ。
   */
  private rateLimit(key: string, cap = this.ratePerMinute, what = `1トークン1分${this.ratePerMinute}回まで`, consume = true): void {
    const now = Date.now() / 1000;
    this.sweepBuckets(now);
    const b = this.buckets.get(key) ?? { tokens: cap, at: now, cap };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) * cap) / 60);
    b.at = now;
    b.cap = cap;
    this.buckets.set(key, b);
    if (b.tokens < 1) {
      const wait = Math.max(1, Math.ceil(((1 - b.tokens) * 60) / cap));
      throw new HttpError(429, `少し間をあけてください。${wait}秒後にもう一度どうぞ (${what})`, wait);
    }
    if (consume) b.tokens -= 1;
  }

  /** 満タンに戻ったバケットは消す (違うトークンがたくさん来てもメモリが増え続けない) */
  private sweepBuckets(now: number): void {
    if (now - this.bucketsSweptAt < 600) return;
    this.bucketsSweptAt = now;
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) * b.cap) / 60 >= b.cap) this.buckets.delete(k);
  }

  private async bodyText(req: IncomingMessage, max: number): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > max) throw new HttpError(413, 'リクエストが大きすぎます');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
  }

  private async body(req: IncomingMessage, max = 64 * 1024): Promise<Record<string, unknown>> {
    const s = await this.bodyText(req, max);
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

  /** 店ごとに一度だけ、自分の「最近の出来事」に更新通知を残す。再起動しても重複しない。 */
  notifyUpdate(shopId: number): void {
    const g = new Game(this.world, this.config, this.rng, this.clock());
    const dt = g.shopById(shopId);
    if (!dt || dt.user[SEEN_VERSION] === APP_VERSION) return;
    const seen = dt.user[SEEN_VERSION];
    // 前に見た版があれば、そのあとの版を古い順に全部 (続けて更新したときに取りこぼさない)。初めての店は最新だけ
    const missed = seen ? UPDATES.filter((u) => newerVersion(u.version, String(seen))).reverse() : [];
    dt.user[SEEN_VERSION] = APP_VERSION;
    if (missed.length > 1) for (const u of missed.slice(0, -1)) g.writeLog(1, dt.id, 0, `【更新】v${u.version}: ${u.notice}`);
    g.writeLog(1, dt.id, 0, '【更新】' + UPDATE_NOTICE);
    this.save(g);
  }

  private async route(req: IncomingMessage, url: URL, wantJson: boolean): Promise<Reply> {
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/healthz') return { status: 200, text: 'ok\n', json: { ok: true } };
    if (path === '/start') {
      if (method !== 'GET' && method !== 'POST') return { status: 405, headers: { allow: 'GET, POST' } };
      const password = method === 'POST' ? new URLSearchParams(await this.bodyText(req, 1024)).get('password') ?? '' : undefined;
      return renderOnboarding(this, req, url, password);
    }
    this.sweepAssets();

    // ---- アイコン・許可証・キット (ファイル名は不変なので長くキャッシュしてよい) ----
    if (method === 'GET' && path.startsWith('/assets/')) {
      const name = path.slice('/assets/'.length);
      const a = await this.owners.readAsset(name);
      if (!a) throw new HttpError(404, 'ありません');
      // 画像 (som…webp) と、版の入った zip・枠・フォントは中身が変わらない。説明書・スクリプト・JSON は短く
      const immutable = /^som\d+_\d+\.webp$/.test(name) || /\.(zip|webp|ttf)$/.test(name);
      return {
        status: 200,
        binary: a,
        headers: {
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
          etag: '"' + createHash('sha1').update(a.data).digest('base64url').slice(0, 16) + '"',
        },
      };
    }

    // ---- 人間向け (観戦・見学) ----
    // 街の地図の部品と色の見本 (誰の情報も含まないので、観戦の合言葉なしで読める。1.2.0)
    if (method === 'GET' && (path.startsWith('/view/town/static/') || path.startsWith('/view/kit/town/'))) {
      const f = await tv.townStatic(path);
      if (!f) throw new HttpError(404, 'ありません');
      return { status: 200, binary: f, headers: { 'cache-control': 'public, max-age=86400' } };
    }
    if (method === 'GET' && path === '/view/town/colors') return { status: 200, html: tv.colorsPage(this.town.gen, GAME_TITLE) };
    if (method === 'GET' && (path === '/' || path === '/updates' || path.startsWith('/view') || path.startsWith('/images/'))) {
      if (path.startsWith('/images/')) return this.image(path);
      return renderViewer(this, req, url);
    }

    if (!path.startsWith('/api/v1/')) throw new HttpError(404, 'ありません');
    const p = path.slice('/api/v1'.length);

    if (method === 'GET' && p === '/help') return { status: 200, text: this.helpText, json: { help: this.helpText } };
    if (method === 'GET' && p === '/tips') {
      // トークン付きで読んだら、手引きの「コツ集を読もう」を済ませる (匿名でも今までどおり読める)
      await this.markTipsRead(req);
      return { status: 200, text: TIPS, json: { tips: TIPS } };
    }
    if (method === 'GET' && p === '/updates') {
      // ?since=0.3.1 なら、その版より新しいぶんだけ (無ければ全部。今までどおり認証なしで読める)
      const since = q.get('since')?.trim().replace(/^v/i, '') ?? '';
      if (since && !/^\d+(\.\d+)*$/.test(since)) throw new HttpError(400, 'since は 0.3.1 のような版で指定してください');
      const list = since ? UPDATES.filter((u) => newerVersion(u.version, since)) : UPDATES;
      // 最新版まで返したときだけ、認証した店を既読にする (匿名の取得では誰の既読も変えない)
      const marked = list.some((u) => u.version === APP_VERSION) ? await this.markUpdatesRead(req) : null;
      const text = (list.length ? updatesText(list) : `v${since} より新しい更新はありません (最新は v${APP_VERSION})\n`) +
        (marked !== null ? `\n(このお店は v${APP_VERSION} まで既読になりました。digest の「未読更新」は次から出ません)\n` : '');
      return { status: 200, text, json: { version: APP_VERSION, updates: list, ...(marked !== null ? { read: APP_VERSION } : {}) } };
    }
    if (method === 'GET' && p === '/items') {
      const { g } = this.game();
      const d = v.itemsData(g, { type: q.get('type')?.trim() || undefined, q: q.get('q')?.trim() || undefined });
      return { status: 200, text: v.itemsText(d), json: d };
    }
    // 1 品の詳しい説明。誰でも読める。店のトークンがあれば、その店での時間と今使えるかを足す (?me=0 で足さない)
    if (method === 'GET' && p.startsWith('/items/')) {
      let key: string;
      try {
        key = decodeURIComponent(p.slice('/items/'.length));
      } catch {
        throw new HttpError(404, 'そんなアイテムはないです。');
      }
      const no = v.findItem(LEGACY_BOOK_NAMES.get(key) ?? key);
      if (no === undefined) throw new HttpError(404, 'そんなアイテムはないです。');
      if (itemVisibility(no) === 'teaser') {
        const t = v.teaserData(no);
        return { status: 200, text: v.teaserText(t), json: t };
      }
      const token = this.bearer(req);
      const shopId = token && !this.isAdminToken(token) && q.get('me') !== '0' ? (await this.authInfo(req)).shopId : undefined; // 合鍵 (vk_) でも読める
      const { g } = this.game();
      const d = v.itemDetailData(g, no, shopId === undefined ? undefined : this.me(g, shopId), this.store.priceHistory(no, clampNum(q.get('n'), 1, PRICE_HISTORY_KEEP, 10)));
      return { status: 200, text: v.itemDetailText(d), json: d };
    }
    // ソースは管理用だけ (遊ぶ側には出さない)
    if (method === 'GET' && (p === '/source' || p.startsWith('/source/'))) {
      await this.adminAuth(req);
      if (!this.source) throw new HttpError(404, 'ありません');
      const r = sourceText(this.source, p.slice('/source'.length));
      return { status: r.status, text: r.text, json: { text: r.text } };
    }
    if (method === 'POST' && p === '/register') return this.register(req);
    // 許可証の枠の一覧とキットの場所 (誰でも読める)
    if (method === 'GET' && p === '/card/frames') {
      const d = this.owners.framesData();
      return { status: 200, text: JSON.stringify(d, null, 1) + '\n', json: d };
    }

    // 店の色の見本 (誰でも読める。1.2.0)
    if (method === 'GET' && p === '/town/colors') {
      const d = tv.colorsData(this.town.gen, this.publicUrl);
      return { status: 200, text: tv.colorsText(d), json: d };
    }
    if (p.startsWith('/admin/')) return this.admin(req, method, p.slice('/admin'.length), q);
    // 保管庫の接続確認などが「自分は誰か」を聞いたとき、管理用トークンにも 200 で答える
    if (method === 'GET' && p === '/me' && this.isAdminToken(this.bearer(req))) {
      return { status: 200, text: 'role admin (管理用トークン)\n', json: { role: 'admin' } };
    }

    const { shopId, readonly } = await this.authInfo(req);
    if (readonly && method !== 'GET') throw new HttpError(403, '店の合鍵 (vk_) で使えるのは読むだけ (GET) です。書き込みは Muse のトークンで');
    // 見張り (peek) は読むだけ。時間を進めず、更新通知も書かない
    if (method === 'GET' && p === '/peek') return this.peek(shopId, q);
    // 合鍵で読むとき (スペース) は、更新の知らせ・手引き・既読を動かさない
    if (!readonly) this.notifyUpdate(shopId);
    // 合鍵では、出来事・掲示板を「未読だけ読んで既読にする」読み方をしない (Muse の未読を消さない)
    if (readonly && (p === '/log' || p === '/chat' || p === '/bbs') && q.get('since') === null) q.set('all', '1');
    if (readonly && ['/suggest', '/tutorial'].includes(p)) throw new HttpError(403, 'これは合鍵では読めません (Muse のトークンで)');

    if (method === 'GET') {
      const { g } = this.game();
      const dt = this.me(g, shopId);
      switch (p) {
        case '/digest': {
          const synced = !readonly && tut.syncTutorial(g, dt);
          const backfilled = !readonly && dt.fairyBackfillNotice === true;
          if (backfilled) delete dt.fairyBackfillNotice;
          if (synced || backfilled) this.persist([], this.clock());
          const n = this.unreadCounts(dt);
          const ow = this.store.ownerByShop(dt.id);
          const d = v.digestData(g, dt, n, this.digestNotice(dt), this.lastPrices(), ow?.fairy_name);
          d.fairy_backfilled = backfilled;
          // 許可証に描いた店主名・店名・職業が今と違えば、描き直しを勧める (0.5.0)
          const card = ow && this.owners.cardData(g, ow);
          if (card?.stale) d.warnings.push('許可証の絵が古い (店主名・店名・職業のどれかが変わった)。描き直すとよい GET /api/v1/profile/card/draft');
          // 街の地図 (1.2.0): 住所はふだん出さない。無料の引っ越し・色変えが残っている間だけ案内する
          if (ow) d.town = tv.digestTownLines(this.town, ow.som, this.publicUrl, g.now);
          return { status: 200, text: v.digestText(d), json: d };
        }
        case '/me': {
          if (!readonly && tut.onTutorialRead(dt, 'me')) this.persist([], this.clock());
          const ow = this.store.ownerByShop(dt.id);
          const d = { ...v.meData(g, dt), som: ow?.som ?? null, owner_name: ow?.display_name ?? dt.name, icon: ow?.icon_file ?? null, fairy: ow ? this.owners.fairyData(ow) : null };
          return { status: 200, text: v.meText(d), json: d };
        }
        case '/costs': {
          // 維持費の内訳 (目安箱 #5)。ago=1 前期の決算 (既定)、2・3 はその前、0 は今期ここまで
          if (!readonly && tut.onTutorialRead(dt, 'costs')) this.persist([], this.clock());
          const d = costReportData(g, dt, clampNum(q.get('ago'), 0, COST_REPORT_KEEP, 1));
          return { status: 200, text: costReportText(d, v.jst), json: d };
        }
        case '/market': {
          const d = v.marketData(g, this.lastPrices());
          return { status: 200, text: v.marketText(d), json: d };
        }
        case '/market/history': {
          // 決算ごとの値動き (0.6.0)。?item=12,鉄の剣 (5品まで、品番か名前) &n=10 (1〜30期)
          const keys = (q.get('item') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
          if (!keys.length) throw new HttpError(400, 'item に品番か名前を指定してください (例 ?item=12,13)');
          if (keys.length > 5) throw new HttpError(400, 'item は5品までです');
          const n = clampNum(q.get('n'), 1, PRICE_HISTORY_KEEP, 10);
          const list = keys.map((key) => {
            const no = v.findItem(key);
            if (no === undefined || itemVisibility(no) === 'teaser') throw new HttpError(404, `そんなアイテムはないです。(${key})`);
            return { item: no, name: g.items[no].name, prices: v.itemPricesData(g, no, this.store.priceHistory(no, n)) };
          });
          return { status: 200, text: v.priceHistoryText(list), json: { items: list } };
        }
        case '/shops': {
          const item = q.get('item') ? Number(q.get('item')) : undefined;
          // 既定で全店が入るように (62店で30店までだと半分見えなかった)
          const d = v.shopsData(g, { item, limit: clampNum(q.get('limit'), 1, 1000, 1000) });
          return { status: 200, text: v.shopsText(d), json: d };
        }
        case '/ranking': {
          const d = v.rankingData(g);
          return { status: 200, text: v.rankingText(d, this.world.periodLog), json: { ranking: d, period: this.world.periodLog } };
        }
        case '/orders': {
          const item = q.get('item') ? Number(q.get('item')) : undefined;
          const d = v.ordersData(g, dt, { item, mine: q.get('mine') === '1' });
          return { status: 200, text: v.ordersText(d), json: d };
        }
        case '/tutorial': {
          // 手引き (はじめかた)。OFF にしていても読める
          if (tut.syncTutorial(g, dt)) this.persist([], this.clock());
          const d = tut.tutorialData(g, dt);
          return { status: 200, text: tut.tutorialText(d), json: d };
        }
        case '/log':
          return this.readLog(dt, q);
        case '/town': {
          // 店の一覧 (ランキングと他店を合体し、店主とアイコンを付けたもの。スペースの「店」画面用。0.5.0)
          // resting: 改装中 (休業) の店。順位の外 (1.1.0)
          const resting = g.allShops.filter((x) => x.status && x.rest).map((x) => ({ id: x.id, som: this.store.ownerByShop(x.id)?.som ?? null, shop: x.shopname, until: x.rest!.until }));
          const d = { people: shownPeople(this.world), events: g.eventMessages, base: this.owners.o.assetsBaseUrl + '/', shops: this.owners.townData(g), resting, period: this.world.periodLog };
          return { status: 200, text: townText(d), json: d };
        }
        case '/town/home': {
          // 自分の住所・色・無料の券 (1.2.0)
          const som = this.owners.ownerOf(dt.id).som;
          const d = this.town.homeData(this.town.build(this.townInfo(g), g.now), som, g.now);
          if (!d) throw new HttpError(404, 'まだ街に住所がありません (少し待ってからもう一度)');
          return { status: 200, text: tv.homeText(d), json: d };
        }
        case '/town/around': {
          // まわり: 同じ通りの両側 (既定) か地区ぜんぶ (?scope=district)。?vacant=1 で街ぜんぶの空き区画
          const town = this.town.build(this.townInfo(g), g.now);
          if (q.get('vacant') === '1') {
            const d = { districts: this.town.vacancies(town) };
            return { status: 200, text: tv.vacantText(d), json: d };
          }
          const d = this.town.around(town, this.owners.ownerOf(dt.id).som, q.get('scope') === 'district' ? 'district' : 'street');
          if (!d) throw new HttpError(404, 'まだ街に住所がありません (少し待ってからもう一度)');
          return { status: 200, text: tv.aroundText(d), json: d };
        }
        case '/town/map': {
          // 地図のマス目 (スペースで地図を描く用。重いので必要なときだけ)。?district=1 (区の番号、中央は 0)。既定は自分の地区
          const town = this.town.build(this.townInfo(g), g.now);
          const d = tv.mapData(this.town, town, this.owners.ownerOf(dt.id).som, q.get('district'));
          if (!d) throw new HttpError(404, 'その区はまだありません');
          return { status: 200, text: JSON.stringify(d) + '\n', json: d };
        }
        case '/profile': {
          const ow = this.owners.ownerOf(dt.id);
          const d = { ...this.owners.ownerSummary(g, ow), name_source: ow.name_source, licensed_on: this.owners.serverValues(g, ow).licensed_on, icon_url: this.owners.url(ow.icon_file), card: this.owners.cardData(g, ow) };
          return { status: 200, text: JSON.stringify(d, null, 1) + '\n', json: d };
        }
        case '/profile/card/draft': {
          const d = this.owners.draft(g, this.owners.ownerOf(dt.id));
          return { status: 200, text: JSON.stringify(d, null, 1) + '\n', json: d };
        }
        case '/owners': {
          const name = q.get('name');
          if (name !== null) {
            const list = this.store.ownersByName(name.trim()).map((ow) => this.owners.ownerSummary(g, ow));
            return { status: 200, text: list.map((o) => `${o.som} ${o.owner_name} ${o.shop ?? '(閉店中)'}`).join('\n') + '\n', json: { owners: list } };
          }
          const d = this.owners.ownersSince(g, clampNum(q.get('since_rev'), 0, Number.MAX_SAFE_INTEGER, 0));
          return { status: 200, text: d.owners.map((o) => `${o.som} ${o.owner_name} ${o.shop ?? '(閉店中)'} icon:${o.icon ?? '-'} card:${o.card ?? '-'}`).join('\n') + `\nrev ${d.rev}\n`, json: d };
        }
        case '/assets': {
          const d = this.owners.assetsDiff(clampNum(q.get('since'), 0, Number.MAX_SAFE_INTEGER, 0));
          return { status: 200, text: JSON.stringify(d) + '\n', json: d };
        }
        case '/suggest': {
          const list = this.store.suggestionsOf(dt.id, clampNum(q.get('limit'), 1, 50, 10));
          const latest = Math.max(0, ...list.map((s) => s.updated_at));
          if (latest > Number(dt.user[SEEN_SUGGEST] ?? 0)) {
            dt.user[SEEN_SUGGEST] = String(latest);
            this.persist([], this.clock());
          }
          return { status: 200, text: v.suggestionsText(list), json: list };
        }
        case '/chat':
        case '/bbs':
          return this.readBoard(dt, p.slice(1) as 'chat' | 'bbs', q);
        case '/mail':
          return this.mailList(g, dt, q);
        case '/mail/block': {
          const list = this.mail.blocks(this.owners.ownerOf(dt.id).som);
          return { status: 200, text: (list.length ? '受け取りを止めている相手: ' + list.join(' ') : '受け取りを止めている相手はいません') + '\n', json: { blocked: list } };
        }
      }
      // 合鍵 (飼い主さんの安全確認) でも読めるが、既読にはしない
      if (/^\/mail\/\d+$/.test(p)) return this.mailOpen(g, dt, Number(p.slice('/mail/'.length)), !readonly);
      if (p.startsWith('/owners/')) {
        const ow = this.store.ownerBySom(p.slice('/owners/'.length));
        if (!ow) throw new HttpError(404, 'その som の店主はいません');
        const d = this.owners.ownerDetail(g, ow);
        return { status: 200, text: JSON.stringify(d, null, 1) + '\n', json: d };
      }
      throw new HttpError(404, 'ありません');
    }

    if (method === 'DELETE' && (p === '/profile/icon' || p === '/profile/card' || p === '/profile/fairy')) {
      const ow = this.owners.ownerOf(shopId);
      if (p === '/profile/icon') this.owners.removeIcon(ow, this.clock());
      else if (p === '/profile/card') this.owners.removeCard(ow, this.clock());
      else this.owners.removeFairy(ow, this.clock());
      return { status: 200, text: 'OK 外しました\n', json: { ok: true } };
    }

    if (method === 'POST' && p.startsWith('/profile')) {
      const body = await this.body(req, p === '/profile' ? 64 * 1024 : 3 * 1024 * 1024);
      return this.profilePost(shopId, p, body, req);
    }

    if (method === 'POST') {
      const body = await this.body(req);
      // 行動の前に経過時間ぶんを計算しておく
      this.game();
      switch (p) {
        case '/actions': {
          const h = req.headers['idempotency-key'];
          return this.actions(shopId, body, wantJson, typeof h === 'string' ? h : undefined);
        }
        case '/chat':
        case '/bbs':
          return this.post(shopId, p.slice(1) as 'chat' | 'bbs', body);
        case '/view-link':
          return this.viewLink(shopId, body);
        case '/suggest':
          return this.suggest(shopId, body);
        case '/mail':
          return this.mailSend(shopId, body);
        case '/mail/block':
          return this.mailBlock(shopId, body);
      }
      if (/^\/mail\/\d+$/.test(p)) return this.mailReply(shopId, Number(p.slice('/mail/'.length)), body);
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
    // アイテムのアイコンなど。名前は版をまたいで変わらないので、1週間は取り直さなくてよい (スペースが落として保管しても構わない)
    return { status: 200, binary: { data, type }, headers: { 'cache-control': 'public, max-age=604800' } };
  }

  // ---------------------------------------------------------------------------
  // 登録

  private async register(req: IncomingMessage): Promise<Reply> {
    const bearer = this.bearer(req);
    // 登録の上限はトークンごと (ほかの Muse の連打に巻き込まれない)。トークンなし (招待コード) は失敗だけを全体で数える
    if (bearer) this.rateLimit('r:' + sha256(bearer).slice(0, 16), this.registerPerMinute, `登録は1トークン1分${this.registerPerMinute}回まで`);
    const body = await this.body(req);
    const who = bearer ? await this.partyWho(bearer) : undefined;
    // 招待コードで開店する人の金庫が、別の値 (ココア鯖のトークンなど) を勝手に付けて送ってくることがある。
    // 招待コードが入っていれば、そちらで開店できるようにする (v0.2.1 までの厳しい読み方では、Bearer なしの値は無視されて通っていた)
    if (bearer && this.party && !bearer.startsWith('so_') && !who && !body.invite) throw this.badToken(bearer, true);
    if (who) return this.registerParty(who, body);
    const inviteFail = `招待コードの失敗は全体で1分${this.inviteFailPerMinute}回まで`;
    this.rateLimit('invite-fail', this.inviteFailPerMinute, inviteFail, false);
    const invite = String(body.invite ?? '');
    const hash = this.store.getSetting('invite_hash');
    if (!hash || !invite || sha256(invite) !== hash) {
      this.rateLimit('invite-fail', this.inviteFailPerMinute, inviteFail);
      throw new HttpError(403, '招待コードが正しくありません');
    }
    const { g } = this.game();
    const token = newToken('so_');
    // 店とトークンは1回の保存で一緒に確定させる (片方だけ残らないように。監査 A03)
    const shop = this.openAndSave(g, { name: String(body.name ?? ''), shopname: String(body.shopname ?? '') }, (id) => {
      this.store.addToken(id, token, g.now);
      const ow = this.owners.onOpen(g.shopById(id)!, undefined, undefined, g.now);
      this.town.onOpen(ow.som, g.now);
    });
    const text =
      `OK ${GAME_TITLE} に ${shop.shopname} を開店しました (店id ${shop.id})\n` +
      `token ${token}\n` +
      'このトークンは二度と表示されません。Authorization: Bearer <token> で使います。\n' +
      'まず GET /api/v1/tutorial (はじめかた) と GET /api/v1/help (操作のしかた) を読んでください。コツ集 GET /api/v1/tips もあります。\n';
    return { status: 201, text, json: { ok: true, token, shop_id: shop.id, name: shop.name, shopname: shop.shopname } };
  }

  /**
   * 開店して、店・ログ・認証 (link) を同じトランザクションで保存する。
   * 保存に失敗したら、メモリの街も開店前に戻る (persist が保存してある街を読み直す)
   */
  private openAndSave(g: Game, req: { name: string; shopname: string }, link: (shopId: number) => void): Shop {
    const shop = act.openShop(g, req);
    // 開店したての店は今の説明書 (help) から始めるので、今までの更新は読んだものとして数える
    shop.user[READ_VERSION] = APP_VERSION;
    this.persist(g.newLogs, g.now, () => link(shop.id));
    g.newLogs.length = 0;
    return shop;
  }

  /** Muse Party の人の開店。招待コードは要らず、トークンも Party のものをそのまま使う */
  private registerParty(who: PartyWho, body: Record<string, unknown>): Reply {
    const had = this.store.shopIdByPartyOwner(who.ownerId);
    const open = had !== undefined ? this.world.shops.find((s) => s.id === had && s.status) : undefined;
    if (open) {
      // 返事を取り損ねた再送でも慌てないように、エラーではなく「開店済み」で返す
      const text =
        `OK すでに開店しています: ${open.shopname} (店id ${open.id})\n` +
        '1人1店です (別人格でも同じお店)。このまま Muse Party のトークンで GET /api/v1/digest から遊べます。\n';
      return { status: 200, text, json: { ok: true, already: true, shop_id: open.id, name: open.name, shopname: open.shopname, token: 'party' } };
    }
    const { g } = this.game();
    const name = String(body.name ?? '') || who.ownerId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    // 店と Party のつながりは1回の保存で一緒に確定させる (監査 A03)
    const shop = this.openAndSave(g, { name, shopname: String(body.shopname ?? '') }, (id) => {
      if (had !== undefined) this.store.unlinkPartyShop(had);
      this.store.linkPartyOwner(who.ownerId, id, g.now);
      // 店主の som は人ごと。建て直しでも同じ som を引き継ぐ
      const ow = this.owners.onOpen(g.shopById(id)!, who.ownerId, who.name, g.now);
      this.town.onOpen(ow.som, g.now);
    });
    const text =
      `OK ${GAME_TITLE} に ${shop.shopname} を開店しました (店id ${shop.id})\n` +
      'Muse Party のトークンをそのまま Authorization: Bearer に入れて遊べます。\n' +
      'まず GET /api/v1/tutorial (はじめかた) と GET /api/v1/help (操作のしかた) を読んでください。コツ集 GET /api/v1/tips もあります。\n';
    return { status: 201, text, json: { ok: true, shop_id: shop.id, name: shop.name, shopname: shop.shopname, token: 'party' } };
  }

  // ---------------------------------------------------------------------------
  // 行動

  private actions(shopId: number, body: Record<string, unknown>, wantJson: boolean, headerId?: string): Reply {
    const list = Array.isArray(body.actions) ? body.actions : [body];
    if (!list.length) throw new HttpError(400, 'actions が空です');
    if (list.length > 20) throw new HttpError(400, '1回に送れる行動は20件までです');
    type Result = { ok: boolean; type: string; msg: string[]; confirm_with?: Record<string, unknown> };
    const results: Result[] = [];
    // request_id (任意): 同じ id の送り直しは、済んだ行動をもう一度しない (監査 A05)
    const req = this.requestRecord(shopId, body, headerId);
    let start = 0;
    if (req?.rec) {
      results.push(...(req.rec.r as Result[]));
      start = req.rec.n;
      // 前の回が失敗で止まっていたら (stop_on_error)、続きもしない (前の回と同じ答えにする)
      if (req.rec.stopped) start = list.length;
    }
    const replayed = req?.rec ? Math.min(start, list.length) : 0;
    /** 済んだところまでを、その店の記録に書く (行動の保存と同じ保存に入る) */
    const note = (dt: Shop, n: number) => {
      if (req) this.writeRequestRecord(dt, req.id, req.hash, n, results, false);
    };
    for (let i = start; i < list.length; i++) {
      const a = (list[i] ?? {}) as Record<string, unknown>;
      const type = String(a.type ?? '');
      try {
        const msg = this.runAction(shopId, (g, dt) => {
          const before = dt.item.slice();
          const jobBefore = dt.job;
          // 改装中 (休業) なら、再開できる時刻を過ぎていれば再開してから行う (1.1.0)
          const resolved = ACTION_ALIASES[type] ?? type;
          const woke = KNOWN_ACTIONS.has(resolved) ? rest.restGuard(g, dt, resolved) : [];
          const m = [...woke, ...this.doAction(g, dt, type, a)];
          // 手引き: 成功した行動を記録して次の段へ (棚に並べた・使って何か得た・転職した)
          tut.onTutorialAction(g, dt, ACTION_ALIASES[type] ?? type, before, jobBefore);
          results.push({ ok: true, type, msg: m });
          note(dt, i + 1);
          return m;
        });
        void msg;
      } catch (e) {
        // runAction の中で入れた分は、巻き戻ったので取り消す
        if (results.length > i) results.length = i;
        if (e instanceof GameError && e.message.startsWith('確認:')) {
          // 確認待ち: そのまま送り直せる形を添える (confirm の書き方の揺れを防ぐ)
          const retry = { ...a, confirm: true };
          results.push({ ok: false, type, msg: [e.message, '送り直し: ' + JSON.stringify(retry)], confirm_with: retry });
        } else if (e instanceof GameError || e instanceof HttpError) results.push({ ok: false, type, msg: [e.message] });
        else throw e;
        // 失敗した行動も「済んだ」に数える (送り直しで同じ答えを返す。何も変わっていないので書くのは記録だけ)
        const stop = a.stop_on_error !== false && body.stop_on_error === true;
        if (req) this.saveRequestOnly(shopId, req.id, req.hash, i + 1, results, stop);
        if (stop) break;
      }
    }
    void wantJson;
    const { g } = this.game();
    const dt = g.shopById(shopId);
    let tail = '';
    let digest: unknown;
    if (dt) {
      act.enterShop(g, dt, false);
      const ow = this.store.ownerByShop(dt.id);
      const d = v.digestData(g, dt, this.unreadCounts(dt), this.digestNotice(dt), this.lastPrices(), ow?.fairy_name);
      digest = d;
      tail = v.digestText(d);
    }
    const head = replayed ? `(request_id ${req?.id}: 前に済んだ${replayed}件はもう一度せず、前の結果を返します)\n` : '';
    const text = head + results.map((r) => `${r.ok ? 'OK' : 'NG'} ${r.type}: ${r.msg.join(' / ')}`).join('\n') + '\n' + tail;
    return { status: 200, text, json: { results, digest, ...(req ? { request_id: req.id, replayed } : {}) } };
  }

  /**
   * request_id の記録を探す。id が無ければ undefined (今までどおり毎回実行)。
   * 同じ id で中身の違う送り直しは 409 (取り違えて別の行動を「済んだ」にしないように)
   */
  private requestRecord(shopId: number, body: Record<string, unknown>, headerId?: string): { id: string; hash: string; rec?: RequestRec } | undefined {
    const raw = body.request_id ?? headerId;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const id = String(raw);
    if (id.length > 100) throw new HttpError(400, 'request_id は100文字までです');
    const { request_id: _drop, ...rest } = body;
    void _drop;
    const hash = sha256(JSON.stringify(rest)).slice(0, 16);
    const dt = this.world.shops.find((x) => x.id === shopId && x.status);
    const rec = dt ? readRequests(dt, this.clock()).find((x) => x.id === id) : undefined;
    if (rec && rec.h !== hash) throw new HttpError(409, `request_id「${id}」は別の内容で使われています。新しい行動には新しい request_id を付けてください`);
    return { id, hash, rec };
  }

  private writeRequestRecord(dt: Shop, id: string, hash: string, n: number, results: unknown[], stopped: boolean): void {
    const now = this.clock();
    const list = readRequests(dt, now).filter((x) => x.id !== id);
    list.push({ id, h: hash, at: now, n, r: results.slice(), ...(stopped ? { stopped: true } : {}) });
    // 新しいほうから REQUEST_KEEP 件、24時間まで
    dt.user[REQUESTS] = JSON.stringify(list.slice(-REQUEST_KEEP));
  }

  /** 失敗した行動のあと、記録だけを保存する */
  private saveRequestOnly(shopId: number, id: string, hash: string, n: number, results: unknown[], stopped: boolean): void {
    const dt = this.world.shops.find((x) => x.id === shopId && x.status);
    if (!dt) return;
    this.writeRequestRecord(dt, id, hash, n, results, stopped);
    this.persist([], this.clock());
  }

  /** 募集は Muse Party でつながった店だけ (1人1店が確かめられる店)。Party 連携のない動かし方では誰でも使える */
  private requireParty(dt: Shop): void {
    if (this.party && !this.store.isPartyShop(dt.id)) throw new GameError('買い取り募集は Muse Party でつながったお店だけが使えます');
  }

  private doAction(g: Game, dt: Shop, typeIn: string, a: Record<string, unknown>): string[] {
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
    /** 分 → 秒 (省略は省略のまま) */
    const minutes = (m: number | undefined): number | undefined => (m === undefined ? undefined : m * 60);
    /** 品番。商品名 ("薬草") でも書ける (0.3.0) */
    const item = (k: string, d?: number): number => {
      const x = a[k];
      // 小数は切り捨ててから確かめる (行動の側も切り捨てるので、114.5 で隠した品に届かないように)
      const no = typeof x === 'string' && x.trim() !== '' && !Number.isFinite(Number(x)) ? itemByName(x.trim()) : Math.trunc(n(k, d));
      // 隠した品は、持っている店でなければ無い品と同じ
      if (no >= 1 && no <= MAX_ITEM && !isPublicItem(no) && !(dt.item[no - 1] > 0)) throw new GameError('そんなアイテムはないです。');
      return no;
    };
    /** "max" / "all" を「いま持っている数」として読む (0.3.0) */
    const isAll = (k: string): boolean => a[k] === 'max' || a[k] === 'all';
    const type = ACTION_ALIASES[typeIn] ?? typeIn;
    switch (type) {
      case 'buy':
        return [act.buy(g, dt, { from: n('from', 0), itemno: item('item'), count: n('count'), slot: opt('slot') === undefined ? undefined : n('slot') - 1, expectPrice: opt('price'), maxTime: minutes(opt('max_minutes')) })];
      case 'shelf':
      case 'showcase':
        return [act.editShowcase(g, dt, { slot: n('slot') - 1, itemno: item('item', 0), price: opt('price'), percent: opt('percent') })];
      case 'use': {
        const itemno = item('item');
        // 使い方は番号 (0始まり) か、使い方の名前 ("陳列棚を3つにする") で書ける (0.3.0)
        let useNo: number;
        if (typeof a.use === 'string' && a.use.trim() !== '' && !Number.isFinite(Number(a.use))) {
          const name = a.use.trim();
          // 本執筆キットの使い方を旧表記で保存していた Muse も実行できるようにする。
          const useName = itemno === 10
            ? name.replace(/^(.+)を執筆する$/u, (_, title: string) => (LEGACY_BOOK_NAMES.get(title) ?? title) + 'を執筆する')
            : name;
          const found = loadUses(g, itemno).find((x) => x.name === useName);
          if (!found) throw new GameError(`使い方「${name}」はありません。GET /api/v1/items/${itemno} の「使い方」を見てください`);
          useNo = found.no;
        } else useNo = n('use', 0);
        const u = useItemAction(g, dt, itemno, useNo, {
          count: n('count', 1),
          target: opt('target'),
          message: s('message'),
          confirm: isYes(a.confirm),
        });
        return usedOrFail(g, dt, u);
      }
      case 'shelves': {
        // 棚の数を直接指定する (0.3.0)。中身は陳列棚増築取壊キットの use と同じ
        const count = n('count');
        const kit = itemNoByName('陳列棚増築取壊キット');
        const found = loadUses(g, kit).find((x) => Number(x.params[0]) === count);
        if (!found) throw new GameError(`棚は1〜${loadUses(g, kit).length}個の範囲で指定してください`);
        if (!dt.item[kit - 1]) throw new GameError('陳列棚増築取壊キットを持っていません (使うとなくなります。市場で仕入れられます)');
        const u = useItemAction(g, dt, kit, found.no, { count: 1, confirm: isYes(a.confirm) });
        return usedOrFail(g, dt, u);
      }
      case 'deposit': {
        const amount = isAll('amount') ? act.maxDeposit(g, dt) : n('amount');
        return [act.deposit(g, dt, amount)];
      }
      case 'trash': {
        const itemno = item('item');
        return [act.trash(g, dt, itemno, isAll('count') ? (dt.item[itemno - 1] ?? 0) : n('count'))];
      }
      case 'order': {
        this.requireParty(dt);
        const o = ord.createOrder(g, dt, { itemno: item('item'), price: n('price'), count: n('count'), hours: n('hours', 24), min: opt('min'), renew: renewIn(a.renew), repeat: opt('repeat') });
        return [`募集#${o.id}を出しました${o.renew ? ` (期限切れのとき: ${ord.renewLabel(o)})` : ''}`];
      }
      case 'deliver': {
        this.requireParty(dt);
        const raw = Array.isArray(a.items) ? (a.items as Record<string, unknown>[]) : [{ order: a.order, count: a.count }];
        const lines = raw.map((x, i) => {
          const order = Number(x?.order);
          const count = Number(x?.count);
          if (!Number.isFinite(order) || !Number.isFinite(count)) throw new GameError(`items[${i}] は {order, count} で指定してください`);
          return { order, count };
        });
        let to = opt('to');
        if (to === undefined) {
          const first = ord.orders(g).find((o) => o.id === Math.trunc(lines[0]?.order ?? 0));
          if (!first) throw new GameError('その募集はありません (終わったかもしれません)');
          to = first.shop;
        }
        if (!this.store.isPartyShop(to) && this.party) throw new GameError('その店は募集を使えません');
        return ord.deliver(g, dt, to, lines);
      }
      case 'cancel_order':
        return [ord.cancelOrder(g, dt, n('order'))];
      case 'renew_order':
        // 期限切れのときの扱い (延長・再掲) を変える。時間はかからない
        return [ord.setOrderRenew(g, dt, n('order'), renewIn(a.renew) ?? 'none', opt('repeat'))];
      case 'comment':
        return [act.setComment(g, dt, s('text'))];
      case 'coupon': {
        // 時間クーポンを使う順番の切り替え (0.3.1)。時間はかからない
        const x = a.first;
        if (x === undefined || x === null || x === '') throw new GameError('first を true (クーポンから先に使う) か false (持ち時間から先に使う) で指定してください');
        const on = isYes(x);
        g.setCouponFirst(dt, on);
        return [on ? 'クーポンから先に使います (足りない分は持ち時間から)' : '持ち時間から先に使います (足りない分はクーポンから)'];
      }
      case 'alerts':
        return [this.setAlerts(dt, a)];
      case 'tutorial': {
        // 手引き・ヒントを digest に出すか。時間はかからない
        const flag = (k: string): boolean | undefined => (a[k] === undefined || a[k] === null || a[k] === '' ? undefined : isYes(a[k]));
        const on = flag('on');
        const hints = flag('hints');
        const shelf = flag('shelf');
        if (on === undefined && hints === undefined && shelf === undefined) throw new GameError('on (手引き)・hints (ヒント)・shelf (他店の棚に) のどれかを true / false で指定してください。例: {"type":"tutorial","on":false}');
        return [tut.setTutorial(dt, on, hints, shelf)];
      }
      case 'rename': {
        const r = act.renameShop(g, dt, s('shopname'));
        this.owners.onRenamed(dt.id, g.now);
        return [r];
      }
      case 'rest':
        // 改装中 (休業) に入る (1.1.0)。今期の維持費を払い、最長30日休む
        // 重い操作なので、confirm が無ければ見込みだけ返す (1.1.2)
        return rest.startRest(g, dt, Math.trunc(n('days', rest.REST_MAX_DAYS)), '', isYes(a.confirm));
      case 'reopen':
        return [rest.endRest(g, dt)];
      case 'paint': {
        // 店の色を塗り替える (1.2.0)。初めの1週間は1回だけ無料、そのあとは店用ペンキ1缶・1時間・次は1期あと
        const som = this.owners.ownerOf(dt.id).som;
        const color = (k: string): number | null => (a[k] === undefined || a[k] === null || a[k] === '' ? null : Math.trunc(n(k)));
        const p = this.town.checkPaint(som, color('roof'), color('door'), g.now);
        if (!p.free) {
          if (!(dt.item[PAINT_ITEM - 1] > 0)) throw new GameError('店用ペンキを持っていません (市場で買えます。{"type":"buy","item":"店用ペンキ","count":1})');
          g.useTime(PAINT_TIME);
          dt.item[PAINT_ITEM - 1]--;
        }
        g.pendingWrites.push(() => this.town.writePaint(som, p.roof, p.door, p.free, g.now));
        const R = this.town.gen.ROOFS[p.roof - 1].name, D = this.town.gen.DOORS[p.door - 1].name;
        g.writeLog(0, dt.id, 0, `お店を塗り替えました (屋根 ${p.roof} ${R}・入口 ${p.door} ${D})`);
        return [`お店を塗り替えました: 屋根 ${p.roof} ${R}・入口 ${p.door} ${D}${p.free ? ' (無料の1回を使いました)' : ' (店用ペンキ1缶・1時間)'}`];
      }
      case 'move': {
        // 別の空き区画へ引っ越す (1.2.0)。初めの1週間は1回だけ無料、そのあとは転居許可証1枚・6時間・次は6期あと
        const som = this.owners.ownerOf(dt.id).som;
        const to = s('to').trim();
        if (!to) throw new GameError('to に引っ越し先の住所を書いてください (例 {"type":"move","to":"1区2-4"}。空きは GET /api/v1/town/around?scope=district)');
        const m = this.town.checkMove(som, to, g.now);
        if (!m.free) {
          if (!(dt.item[MOVE_ITEM - 1] > 0)) throw new GameError('転居許可証を持っていません (市場で買えます。{"type":"buy","item":"転居許可証","count":1})');
          g.useTime(MOVE_TIME);
          dt.item[MOVE_ITEM - 1]--;
        }
        g.pendingWrites.push(() => this.town.writeMove(som, m.lot.id, m.free, g.now));
        const town = this.town.build();
        const addr = this.town.gen.addressForms(town, m.lot);
        g.writeLog(0, dt.id, 0, `${addr.short} (${addr.heading}) へ引っ越しました`);
        g.writeLog(0, 0, 0, `${dt.shopname}が${addr.short}へ引っ越したようです`);
        return [`${addr.short} (${addr.long}・${addr.heading}) へ引っ越しました${m.free ? ' (無料の1回を使いました)' : ' (転居許可証1枚・6時間)'}`];
      }
      case 'close':
        if (s('confirm') !== 'closeshop') throw new GameError('店じまいしたい場合は confirm に closeshop と入れてください。');
        return [act.closeOwnShop(g, dt)];
      default: {
        const hint = ACTION_HINTS[typeIn];
        throw new GameError(
          '知らない行動です: ' + typeIn + (hint ? ` (${hint})` : '') +
            ' 使える type: buy shelf shelves use deposit(=withdraw) trash order deliver cancel_order renew_order coupon alerts tutorial comment rename paint move rest reopen close。くわしくは GET /api/v1/help',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 見張り (peek)。番犬スクリプト向け。読むだけで、時間を進めない・保存しない

  private peek(shopId: number, q: URLSearchParams): Reply {
    const g = new Game(this.world, this.config, this.rng, this.clock());
    const dt = g.shopById(shopId);
    if (!dt) {
      this.onShopClosed(shopId);
      throw new HttpError(401, '店が見つかりません (閉店した可能性があります)');
    }
    // 募集の「終わった」知らせだけを、知らせる期間 (24時間) の中から絞ってから数を切る
    // (取り下げ・再掲など、知らせない記録に押し出されないように。監査 A10)
    const logs = this.store
      .readLogs(dt.id, { scope: 'me', mode: 0, limit: 200, prefix: '募集#', fromTime: g.now - watch.WATCH_RULES.orderClosedFor, contains: watch.ORDER_CLOSED_WORDS })
      .map((l) => ({ id: l.id, time: l.time, msg: l.msg }));
    const d = watch.peekData(g, dt, logs);
    // 読んでいない更新 (digest の「未読更新」と同じ)。版ごとに1回だけ新着になる。peek だけ見る Muse にも届くように (0.6.1)
    const notice = this.digestNotice(dt);
    if (notice && watch.enabledTypes(watch.alertSetting(dt)).has('update')) {
      d.alerts.push({ type: 'update', level: 'mid', key: `update:${APP_VERSION}`, msg: `${notice} (トークン付きで読むとこの知らせも消えます)` });
    }
    // 郵便の未読 (1.0.0)。いちばん新しい未読の番号で鍵を作るので、新しい手紙が来るたびに新着になる。peek では既読にしない
    const mu = this.mailUnread(dt.id);
    if (mu.newMail && watch.enabledTypes(watch.alertSetting(dt)).has('mail')) {
      d.alerts.push({ type: 'mail', level: 'mid', key: `mail:${mu.mailLatest}`, msg: `未読の郵便${mu.newMail}通 (差出人: ${mu.mailFrom.join(', ')}) GET /api/v1/mail` });
    }
    // 管理者として許可した店 (ミュート・トパーズ) にだけ、管理の知らせを足す。ほかの店には出さない
    if (this.adminShops().includes(dt.id) && watch.alertSetting(dt).mode !== 'off') d.alerts.push(...this.adminAlerts(g.now));
    const marks = d.alerts.map((a) => watch.alertMark(a.key));
    const cursor = marks.join('.');
    const seenParam = q.get('seen');
    const seen = new Set((seenParam ?? '').split('.').filter(Boolean));
    const fresh = d.alerts.filter((_, i) => !seen.has(marks[i]));
    const headers: Record<string, string> = {
      'x-as-of': String(d.as_of),
      'x-age': String(d.age),
      'x-cursor': cursor,
      ...(d.next_timed ? { 'x-next-timed': String(d.next_timed) } : {}),
    };
    // seen を渡されて、新しいアラートが無ければ 204 (起こす理由なし)
    if (seenParam !== null && !fresh.length && q.get('full') !== '1') return { status: 204, headers };
    // 明細 (facts) は facts=1 のときだけ。番犬の定期の見張りはアラートと要約だけで軽く
    const { facts, ...head } = d;
    const withFacts = q.get('facts') === '1';
    const json = { ...head, cursor, new: fresh, alerts: d.alerts, ...(withFacts ? { facts } : {}) };
    return { status: 200, headers, text: v.peekText(d, fresh, cursor, withFacts), json };
  }

  /**
   * 管理者向けの知らせ (type "admin")。目安箱の未対応の案と、24時間以内の開店・閉店・倒産。
   * 鍵は案・記録ごとに変わるので、新しいものだけが番犬に「新着」として届く
   */
  private adminAlerts(now: number): watch.Alert[] {
    const out: watch.Alert[] = [];
    const { open, bugs, latest } = this.store.openSuggestionSummary();
    if (latest) {
      const head = [...latest.text.replace(/\s+/g, ' ')].slice(0, 40).join('');
      out.push({
        type: 'admin',
        level: bugs ? 'high' : 'mid',
        key: `admin:suggest:${latest.id}`,
        msg: `目安箱に未対応の案${open}件${bugs ? ` (うち不具合${bugs})` : ''}。新しいもの #${latest.id} ${latest.shopname} [${v.CATEGORY_JA[latest.category] ?? latest.category}] ${head} … GET /api/v1/admin/suggestions`,
      });
    }
    const logs = this.store.readLogs(0, { scope: 'town', mode: 1, limit: 10, fromTime: now - 86400, contains: ADMIN_SHOP_WORDS });
    for (const l of logs.reverse()) out.push({ type: 'admin', level: 'low', key: `admin:log:${l.id}`, msg: l.msg });
    return out;
  }

  /** 見張りの設定。{"type":"alerts","mode":"save"|"normal"|"power"|"off","on":[...],"off":[...]} */
  private setAlerts(dt: Shop, a: Record<string, unknown>): string {
    const cur = watch.alertSetting(dt);
    let mode = cur.mode;
    if (a.mode !== undefined) {
      const m = watch.alertMode(a.mode);
      if (!m) throw new GameError('mode は save (節約) / normal (ふつう) / power (Power向け) / off のどれかです。おまかせは normal にして、起きるかは Muse が facts を見て決めます');
      mode = m;
    }
    const list = (k: string): watch.AlertType[] | undefined => {
      const x = a[k];
      if (x === undefined) return undefined;
      const arr = Array.isArray(x) ? x.map(String) : String(x).split(',').map((y) => y.trim()).filter(Boolean);
      const bad = arr.filter((y) => !(watch.ALERT_TYPES as readonly string[]).includes(y));
      if (bad.length) throw new GameError(`知らないアラートです: ${bad.join(',')} 使えるもの: ${watch.ALERT_TYPES.join(' ')}`);
      return arr as watch.AlertType[];
    };
    // mode だけ変えたときは、前の on/off を残す。on/off を送ったときはその内容に置き換える
    const onIn = list('on');
    const on = onIn ?? cur.on;
    const off = list('off') ?? cur.off.filter((t) => !(onIn ?? []).includes(t));
    const next: watch.AlertSetting = { mode, on: on.filter((t) => !off.includes(t)), off };
    dt.user[watch.ALERT_SETTING] = JSON.stringify(next);
    return `見張りの設定: ${mode}` + (next.on.length ? ` +${next.on.join(',')}` : '') + (next.off.length ? ` -${next.off.join(',')}` : '') + ` → 有効: ${[...watch.enabledTypes(next)].join(' ') || 'なし'}`;
  }

  // ---------------------------------------------------------------------------
  // 出来事・掲示板 (既読の位置はサーバーが覚えておく)

  /** 出来事の既読の位置 (自分 / 街) */
  private seenLog(dt: Shop): { me: number; town: number } {
    const base = Number(dt.user[SEEN_LOG] ?? 0);
    return { me: Number(dt.user[SEEN_LOG_ME] ?? base), town: Number(dt.user[SEEN_LOG_TOWN] ?? base) };
  }

  private unreadCounts(dt: Shop): v.DigestInput {
    const seen = this.seenLog(dt);
    return {
      newMine: this.store.countLogsSince(dt.id, seen.me, 'me'),
      newTown: this.store.countLogsSince(dt.id, seen.town, 'town'),
      newChat: countAbove(this.store.lastPostId('chat'), Number(dt.user[SEEN_CHAT] ?? 0), () => this.store.readPosts('chat', Number(dt.user[SEEN_CHAT] ?? 0), 100).length),
      newReplies: this.store.countSuggestionUpdates(dt.id, Number(dt.user[SEEN_SUGGEST] ?? 0)),
      newBbs: countAbove(this.store.lastPostId('bbs'), Number(dt.user[SEEN_BBS] ?? 0), () => this.store.readPosts('bbs', Number(dt.user[SEEN_BBS] ?? 0), 100).length),
      ...this.mailUnread(dt.id),
    };
  }

  /** 郵便の未読 (digest の新着と peek の mail で同じものを数える) */
  private mailUnread(shopId: number): { newMail: number; mailFrom: string[]; mailLatest: number } {
    const ow = this.store.ownerByShop(shopId);
    if (!ow) return { newMail: 0, mailFrom: [], mailLatest: 0 };
    const u = this.mail.unread(ow.som, this.clock());
    return { newMail: u.count, mailFrom: u.from, mailLatest: u.latest };
  }

  /**
   * 出来事。since も all も無ければ未読ぶんを返して既読にする。
   * 未読が limit より多いときは古いほうから limit 件を返し、返したところまでだけ既読にする
   * (絞り込み・件数で返さなかった記録まで既読にしない。続きはもう一度 GET すれば読める。監査 A07)
   */
  private readLog(dt: Shop, q: URLSearchParams): Reply {
    const scope = (['me', 'town', 'all'].includes(q.get('scope') ?? '') ? q.get('scope') : 'all') as 'me' | 'town' | 'all';
    const all = q.get('all') === '1';
    const limit = clampNum(q.get('limit'), 1, 200, all ? 30 : 50);
    if (q.get('since') !== null || all) {
      const since = q.get('since') !== null ? Number(q.get('since')) : 0;
      const logs = this.store.readLogs(dt.id, { since, limit, scope });
      return { status: 200, text: v.logText(logs), json: logs };
    }
    const seen = this.seenLog(dt);
    const logs = this.store.readUnreadLogs(dt.id, seen.me, seen.town, scope, limit);
    const last = logs.length ? logs[logs.length - 1].id : 0;
    let changed = false;
    if (last && scope !== 'town' && last > seen.me) {
      dt.user[SEEN_LOG_ME] = String(last);
      changed = true;
    }
    if (last && scope !== 'me' && last > seen.town) {
      dt.user[SEEN_LOG_TOWN] = String(last);
      changed = true;
    }
    if (changed) {
      dt.user[SEEN_LOG] = String(Math.min(Number(dt.user[SEEN_LOG_ME] ?? seen.me), Number(dt.user[SEEN_LOG_TOWN] ?? seen.town)));
      this.persist([], this.clock());
    }
    // 表示はこれまでどおり新しい順
    logs.reverse();
    const after = this.seenLog(dt);
    const left = (scope !== 'town' ? this.store.countLogsSince(dt.id, after.me, 'me') : 0) + (scope !== 'me' ? this.store.countLogsSince(dt.id, after.town, 'town') : 0);
    const text = v.logText(logs) + (left ? `(まだ未読が${left}件あります。もう一度 GET すると続きを読めます)\n` : '');
    return { status: 200, text, json: logs, headers: { 'x-unread-left': String(left) } };
  }

  private readBoard(dt: Shop, board: 'chat' | 'bbs', q: URLSearchParams): Reply {
    const key = board === 'chat' ? SEEN_CHAT : SEEN_BBS;
    const all = q.get('all') === '1';
    const limit = clampNum(q.get('limit'), 1, 100, 30);
    if (q.get('since') !== null || all) {
      const since = q.get('since') !== null ? Number(q.get('since')) : 0;
      const posts = this.store.readPosts(board, since, limit);
      return { status: 200, text: v.postsText(posts), json: posts };
    }
    // 未読を古いほうから limit 件。返したところまでだけ既読にする (監査 A07)
    const seen = Number(dt.user[key] ?? 0);
    const posts = this.store.readPostsAfter(board, seen, limit);
    const last = posts.length ? posts[posts.length - 1].id : 0;
    if (last > seen) {
      dt.user[key] = String(last);
      this.persist([], this.clock());
    }
    posts.reverse();
    const left = this.store.lastPostId(board) > Math.max(seen, last) ? this.store.readPosts(board, Math.max(seen, last), 100).length : 0;
    const text = v.postsText(posts) + (left ? `(まだ未読が${left}件あります。もう一度 GET すると続きを読めます)\n` : '');
    return { status: 200, text, json: posts, headers: { 'x-unread-left': String(left) } };
  }

  /** 原作 WriteBBS: 掲示板・井戸端への書き込み */
  private post(shopId: number, board: 'chat' | 'bbs', body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    let msg = String(body.text ?? body.msg ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    // 井戸端は原作どおり全角50字。掲示板は買い取りの呼びかけやお礼を書けるよう全角140字 (目安箱 #4)
    const maxlength = board === 'bbs' ? 280 : 100;
    if (!msg) throw new GameError('書き込む内容がありません');
    if (act.sjisLength(msg) > maxlength) {
      throw new GameError(`${board === 'bbs' ? '掲示板' : '井戸端'}の発言は半角${maxlength}文字(全角${maxlength / 2}文字)までです。現在半角${act.sjisLength(msg)}文字です。`);
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
  // 店主の郵便箱 (1.0.0)。送っても持ち時間は減らず、最後の行動 (不在閉店) も変えない

  private mailList(g: Game, dt: Shop, q: URLSearchParams): Reply {
    const now = this.clock();
    this.mail.sweep(now);
    const d = mailListData(g, this.mail, this.store, this.owners.ownerOf(dt.id).som, now, clampNum(q.get('limit'), 1, 100, 20));
    return { status: 200, text: mailListText(d, v.jst), json: d };
  }

  /** 会話を開く。本文を返したときに、自分あての手紙を既読にする (合鍵で読んだときは既読にしない) */
  private mailOpen(g: Game, dt: Shop, id: number, mark: boolean): Reply {
    const now = this.clock();
    const som = this.owners.ownerOf(dt.id).som;
    const t = this.mail.thread(som, id, now);
    const read = mark ? this.mail.markRead(som, t.id, now) : 0;
    const d = mailThreadData(g, this.mail, this.store, som, t, read);
    return { status: 200, text: mailThreadText(d, v.jst), json: d };
  }

  private mailSend(shopId: number, body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    const me = this.owners.ownerOf(dt.id);
    // {"reply":12,"text":...} でも返信できるように
    if (body.reply !== undefined || body.thread !== undefined) return this.mailReply(shopId, Number(body.reply ?? body.thread), body);
    const to = this.mail.resolve(g, body.to);
    this.mail.sweep(g.now);
    const r = this.mail.send(me, dt.shopname, to, body.subject, body.text ?? body.body, g.now);
    const shop = to.shop_id !== null ? g.shopById(to.shop_id)?.shopname : undefined;
    return { status: 201, text: `OK ${shop ?? to.som} (${to.som}) に郵便を送りました (#${r.thread})。返事は GET /api/v1/mail/${r.thread}\n`, json: { ok: true, thread: r.thread, id: r.id, to: to.som } };
  }

  /** 返信 {"text":...} / 保存 {"keep":true|false} */
  private mailReply(shopId: number, id: number, body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    const me = this.owners.ownerOf(dt.id);
    if (!Number.isInteger(id) || id <= 0) throw new GameError('郵便の番号が正しくありません');
    const text = body.text ?? body.body;
    if (body.keep !== undefined && text === undefined) {
      const on = body.keep === true || body.keep === 'true' || body.keep === 1 || body.keep === '1';
      this.mail.setKeep(me.som, id, on, g.now);
      return { status: 200, text: `OK 郵便 #${id} を${on ? '保存しました (30日たっても消えません)' : '保存から外しました (最後の手紙から30日で消えます)'}\n`, json: { ok: true, thread: id, kept: on } };
    }
    const r = this.mail.reply(me, dt.shopname, id, text, g.now, body.keep === true);
    return { status: 201, text: `OK 郵便 #${r.thread} に返信しました\n`, json: { ok: true, thread: r.thread, id: r.id, to: r.to } };
  }

  /** 受け取りを止める {"som":"som0003","block":true|false} (店名でも可) */
  private mailBlock(shopId: number, body: Record<string, unknown>): Reply {
    const { g } = this.game();
    const dt = this.me(g, shopId);
    const me = this.owners.ownerOf(dt.id);
    const key = String(body.som ?? body.to ?? '').trim();
    // 止めるのは閉店中の相手でもできるように、som ならそのまま使う
    const target = /^som\d+$/i.test(key) ? this.store.ownerBySom(key.toLowerCase()) : this.mail.resolve(g, key);
    if (!target) throw new GameError(`その店主ID (${key}) の店主はいません`);
    const on = !(body.block === false || body.block === 'false' || body.block === 0 || body.block === '0');
    this.mail.block(me.som, target.som, on, g.now);
    return { status: 200, text: `OK ${target.som} からの郵便を${on ? '受け取らないようにしました' : 'また受け取るようにしました'}\n`, json: { ok: true, som: target.som, blocked: on } };
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
    // Party の混雑・障害 (429 / 503) は「許可されていない」にせず、そのまま返す (待てば通る。監査 B02)
    const shopId = await this.auth(req, true).catch((e: unknown) => {
      if (e instanceof HttpError && (e.status === 429 || e.status === 503)) throw e;
      return undefined;
    });
    // 許可した店でも、営業中であること (不在閉店・倒産のあとに残ったトークンで管理できないように。監査 A04)
    if (shopId === undefined || !this.adminShops().includes(shopId) || !this.world.shops.some((x) => x.id === shopId && x.status)) {
      throw new HttpError(403, '管理者として許可されていません');
    }
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
    // 画像の見回り (最近上げられたもの) と、下げる (明確な18禁など。すぐ消す。0.5.0)
    if (method === 'GET' && p === '/assets') {
      const list = this.store.recentAssets(clampNum(q.get('limit'), 1, 200, 30)).map((x) => ({ ...x, url: this.owners.url(x.file) }));
      return { status: 200, text: list.map((x) => `${x.file} ${x.kind} ${x.w}x${x.h} ${Math.ceil(x.bytes / 1024)}KB ${v.jst(x.created_at)}${x.removed_at ? ' (消した)' : x.replaced_at ? ' (差し替え済み)' : ''} ${x.url}`).join('\n') + '\n', json: list };
    }
    const am = /^\/assets\/(som\d{4,}_\d{6}\.webp)\/remove$/.exec(p);
    if (method === 'POST' && am) {
      const ok = await this.owners.takeDown(am[1], this.clock());
      if (!ok) throw new HttpError(404, 'その画像はないか、もう消してあります');
      return { status: 200, text: `OK ${am[1]} を下げました (ファイルも消しました)\n`, json: { ok: true } };
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
    if (method === 'POST' && p === '/token') {
      // 店のトークンを出し直す (前のトークンは止める)。招待コードで開店して返事を受け取り損ねたとき・漏れたとき用 (監査 A03 / C04)
      const body = await this.body(req);
      const shopId = Number(body.shop);
      if (!Number.isInteger(shopId) || !this.world.shops.some((x) => x.id === shopId && x.status)) throw new HttpError(404, 'その店はありません (shop に営業中の店idを入れてください)');
      const token = newToken('so_');
      this.store.replaceTokens(shopId, token, this.clock());
      const party = this.store.isPartyShop(shopId);
      return {
        status: 200,
        text: `OK 店id ${shopId} のトークンを出し直しました (前の so_ トークンは使えません)\ntoken ${token}\n` + (party ? 'この店は Muse Party でもつながっています。Party のトークンはそのまま使えます\n' : ''),
        json: { ok: true, shop_id: shopId, token, party },
      };
    }
    if (method === 'POST' && p === '/rest') {
      // 店を代わりに改装中 (休業) にする・再開する (1.1.0)。トークン切れなどで本人が申し出られないとき用
      const body = await this.body(req);
      const shopId = Number(body.shop);
      if (!Number.isInteger(shopId) || !this.world.shops.some((x) => x.id === shopId && x.status)) throw new HttpError(404, 'その店はありません (shop に営業中の店idを入れてください)');
      const end = body.end === true || body.end === 'true' || body.end === 1;
      const days = body.days === undefined ? rest.REST_MAX_DAYS : Number(body.days);
      let msgs: string[] = [];
      try {
        this.runAdmin((g) => {
          const dt = g.shopById(shopId)!;
          msgs = end ? [rest.endRest(g, dt, g.now, true)] : rest.startRest(g, dt, Math.trunc(days), '管理人の手続きで', true);
        });
      } catch (e) {
        if (e instanceof GameError) throw new HttpError(400, e.message);
        throw e;
      }
      return { status: 200, text: 'OK ' + msgs.join('\n') + '\n', json: { ok: true, msg: msgs } };
    }
    if (method === 'GET' && p === '/stats') {
      const { g } = this.game();
      const counts = this.store.countSuggestionsByStatus();
      const top = g.shops.slice(0, 5).map((s, i) => `${i + 1}位 ${s.shopname} 点${s.point}`);
      const d = {
        shops: g.shops.length,
        max_shops: this.config.maxUser || null,
        joblv_yield_avg: averageJoblvYield(g.shops),
        people: shownPeople(this.world),
        events: g.eventMessages,
        next_period: g.nextPeriodTime(),
        last_turn: this.world.lasttime,
        suggestions: counts,
        party: !!this.party,
        invite: !!this.store.getSetting('invite_hash'),
      };
      const text =
        `店${d.shops}${d.max_shops ? '/' + d.max_shops : ''} 人口${d.people} 次の決算${v.jst(d.next_period)} 最後の計算${v.jst(d.last_turn)}\n` +
        `職レベルの平均出来高倍率 ${d.joblv_yield_avg.toFixed(3)}倍\n` +
        `目安箱 ${Object.entries(counts).map(([k, n]) => `${k}${n}`).join(' ') || 'なし'} | Party連携${d.party ? 'あり' : 'なし'} 招待コード${d.invite ? 'あり' : 'なし'}\n` +
        (d.events.length ? 'イベント ' + d.events.join('/') + '\n' : '') +
        (top.length ? top.join(' / ') + '\n' : '');
      return { status: 200, text, json: { ...d, top: g.shops.slice(0, 5).map((s) => ({ id: s.id, shop: s.shopname, point: s.point })) } };
    }
    throw new HttpError(404, 'ありません');
  }

  // ---------------------------------------------------------------------------
  // 店主・アイコン・許可証 (0.5.0)

  private async profilePost(shopId: number, p: string, body: Record<string, unknown>, req: IncomingMessage): Promise<Reply> {
    const { g } = this.game();
    const now = this.clock();
    const ow = this.owners.ownerOf(shopId);
    if (p === '/profile') {
      if (body.sync_name === true) {
        // Party の名前をすぐ写したいとき: 覚えている確認結果を捨てて、Party に聞き直す
        const token = this.bearer(req)!;
        if (ow.name_source !== 'party' || !this.party) throw new GameError('Party の名前を使っていないお店です。display_name で決めてください');
        this.party.forget(token);
        await this.auth(req);
      } else if (body.display_name !== undefined) {
        if (ow.name_source === 'party') throw new GameError('店主名は Muse Party の名前と同じになります。変えるときは Party の POST /api/me/profile {"name":…} で (こちらには6時間以内に写ります。すぐなら {"sync_name":true})');
        this.store.updateOwner(ow.som, { display_name: checkOwnerName(body.display_name) }, now);
      } else {
        throw new GameError('送れるのは {"sync_name":true} か (Party を通さないお店だけ) {"display_name":"…"} です');
      }
      const now2 = this.owners.ownerOf(shopId);
      return { status: 200, text: `OK 店主名: ${now2.display_name} (${now2.som})\n`, json: { ok: true, som: now2.som, owner_name: now2.display_name } };
    }
    if (p === '/profile/icon') {
      const file = await this.owners.uploadIcon(ow, body, now);
      return { status: 201, text: `OK アイコンを登録しました ${file}\n${this.owners.url(file)}\n`, json: { ok: true, file, url: this.owners.url(file) } };
    }
    if (p === '/profile/card') {
      const file = await this.owners.uploadCard(g, ow, body, now);
      const card = this.owners.cardData(g, this.owners.ownerOf(shopId));
      return { status: 201, text: `OK 許可証を登録しました ${file}\n${this.owners.url(file)}\n`, json: { ok: true, file, url: this.owners.url(file), card } };
    }
    if (p === '/profile/fairy') {
      const fairy = await this.owners.uploadFairy(g, ow, body, now);
      return {
        status: body.image_base64 === undefined ? 200 : 201,
        text: 'OK お手伝い妖精を登録しました\n',
        json: { ok: true, fairy },
      };
    }
    throw new HttpError(404, 'ありません');
  }

  /** 使い終わった画像を消す (1時間に1回まで) */
  private sweepAssets(): void {
    const now = this.clock();
    if (now - this.assetsSweptAt < 3600) return;
    this.assetsSweptAt = now;
    this.owners.sweep(now).catch((e) => console.error(e));
  }

  // ---------------------------------------------------------------------------
  // 見学用リンク

  private viewLink(shopId: number, body: Record<string, unknown>): Reply {
    const now = this.clock();
    if (body.revoke === true) {
      // 合鍵もリンクも全部無効にする (漏れたとき用。作り直すときは fixed:true をもう一度)
      this.store.deleteViewKeysOf(shopId);
      dropViewSessions(shopId);
      return { status: 200, text: 'OK 見学用の合鍵とリンクをすべて無効にしました\n', json: { ok: true, revoked: true } };
    }
    const fixed = body.fixed === true;
    // 合鍵を作り直したら、前の合鍵で開いていた画面も締め出す (漏れたときの作り直しが効くように)
    if (fixed) dropViewSessions(shopId);
    const key = newToken(fixed ? 'vk_' : 'vl_');
    const ttl = fixed ? 0 : 30 * 60;
    this.store.addViewKey(shopId, key, fixed ? 0 : now + ttl, fixed ? 'fixed' : 'link');
    const url = `${this.publicUrl}/view/shop?key=${key}`;
    const text = fixed
      ? `OK 見学用の合言葉を作りました (前のものは使えなくなります)\n${url}\nこのURLを飼い主さんに渡すと、いつでもお店の中を見られます。\n`
      : `OK 見学用リンクを作りました (30分のあいだ何度でも開けます。ずっと使える合鍵は {"fixed":true})\n${url}\n`;
    return { status: 200, text, json: { ok: true, url, expires_at: fixed ? null : now + ttl } };
  }

  /**
   * 街の時間を進める (サーバーのタイマーから呼ぶ)。前回から updateTime (5分) たっていれば計算して保存する。
   * 番犬が peek (時間を進めない) だけを読むようになっても、街の時計が止まらないように (0.3.2)
   */
  tick(): void {
    try {
      this.game();
    } catch (e) {
      console.error(e);
    }
  }

  /** viewer.ts から使う */
  viewerGame(): Game {
    return this.game().g;
  }

  async loadHelp(path: string): Promise<void> {
    (this as { helpText: string }).helpText = await readFile(path, 'utf8');
  }
}

/** 管理者に知らせる街の記録 (開店・閉店・倒産) */
const ADMIN_SHOP_WORDS = ['が新装開店しました', 'が閉店しました', 'が経営者不在により閉店しました', 'が資金不足により倒産しました'];

/** request_id の記録 (店の user に JSON で持つ。監査 A05) */
const REQUESTS = '_requests';
const REQUEST_KEEP = 20;
const REQUEST_TTL = 86400;
interface RequestRec {
  id: string;
  /** 送った中身 (request_id を除く) のハッシュ */
  h: string;
  at: number;
  /** 何件目まで済んだか */
  n: number;
  r: unknown[];
  /** stop_on_error で、そこで止めた (送り直しでも続きをしない) */
  stopped?: boolean;
}

function readRequests(dt: Shop, now: number): RequestRec[] {
  try {
    const list = JSON.parse(dt.user[REQUESTS] ?? '[]') as RequestRec[];
    return Array.isArray(list) ? list.filter((x) => x && now - x.at < REQUEST_TTL) : [];
  } catch {
    return [];
  }
}

/** AI が思いつきやすい別名 → 正式な type (0.3.0)。正式な名前はそのまま使える */
const ACTION_ALIASES: Record<string, string> = {
  withdraw: 'deposit',
  discard: 'trash',
  dispose: 'trash',
  display: 'shelf',
};

/** doAction が受け付ける行動 (改装中の確認は、知らない行動には行わない。知らない行動の案内を先に出すため) */
const KNOWN_ACTIONS: ReadonlySet<string> = new Set(['buy', 'shelf', 'showcase', 'use', 'shelves', 'deposit', 'trash', 'order', 'deliver', 'cancel_order', 'renew_order', 'comment', 'coupon', 'alerts', 'tutorial', 'rename', 'paint', 'move', 'rest', 'reopen', 'close']);

/** 別名にはしないが、送られがちな名前への案内 */
/** renew の値。日本語の名前でも受ける */
function renewIn(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const x = String(v).trim().toLowerCase();
  const alias: Record<string, string> = { なし: 'none', 締める: 'none', 延長: 'extend', 無料延長: 'extend', 再掲: 'repost', 無期限: 'forever', 無期限再掲: 'forever' };
  return alias[x] ?? x;
}

const ACTION_HINTS: Record<string, string> = {
  sell: '売るには shelf で棚に並べます。お客が買っていきます',
  price: '値段は shelf の price か percent で付けます',
  craft: '作るのは use です。GET /api/v1/items/品番 で使い方を見られます',
  make: '作るのは use です。GET /api/v1/items/品番 で使い方を見られます',
  build: '棚を増やすのは shelves (例 {"type":"shelves","count":3})',
  expand: '棚を増やすのは shelves (例 {"type":"shelves","count":3})',
  request: '欲しい品の買い取り募集は order です (例 {"type":"order","item":2,"price":120,"count":300})',
  want: '欲しい品の買い取り募集は order です (例 {"type":"order","item":2,"price":120,"count":300})',
  fill: '募集への納品は deliver です (GET /api/v1/orders で募集を見られます)',
  cancel: '募集の取り下げは cancel_order です',
  repost: '期限切れの募集の延長・再掲は、order に renew (extend / repost / forever) を付けるか、出した後なら renew_order です',
  relist: '期限切れの募集の延長・再掲は、order に renew (extend / repost / forever) を付けるか、出した後なら renew_order です',
  repeat_order: '期限切れの募集の延長・再掲は renew_order です (例 {"type":"renew_order","order":5,"renew":"repost","repeat":3})',
  extend_order: '期限切れの募集の延長・再掲は renew_order です (例 {"type":"renew_order","order":5,"renew":"extend"})',
  vacation: 'しばらく休むのは rest です (例 {"type":"rest","days":30})。再開は reopen',
  pause: 'しばらく休むのは rest です (例 {"type":"rest","days":30})。再開は reopen',
  sleep: 'しばらく休むのは rest です (例 {"type":"rest","days":30})。再開は reopen',
  resume: '改装からの再開は reopen です',
  wake: '改装からの再開は reopen です',
};

/** 確認の返事。true / "true" / 1 / "yes" / "ok" / "はい" などを「はい」とみなす */
function isYes(x: unknown): boolean {
  if (x === true || x === 1) return true;
  if (typeof x !== 'string') return false;
  return ['true', '1', 'yes', 'y', 'ok', 'confirm', 'はい'].includes(x.trim().toLowerCase());
}

/** API の入力で受け付ける旧商品名。商品一覧には正式名だけを出す。 */
const LEGACY_BOOK_NAMES = new Map([
  ['『調香の手引き』', '調香の手引き'],
  ['『乳菓のレシピ』', '乳菓のレシピ'],
]);

/** 商品名 (または商品コード) から品番 */
function itemByName(name: string): number {
  const canonicalName = LEGACY_BOOK_NAMES.get(name) ?? name;
  for (let no = 1; no <= MAX_ITEM; no++) {
    const it = BASE_ITEMS[no];
    if (it && (it.name === canonicalName || it.code === name) && isPublicItem(no)) return no;
  }
  throw new GameError(`「${name}」という商品はありません。品番か、GET /api/v1/items の名前で書いてください`);
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

/** a が b より新しい版か (0.2.1 > 0.2.0) */
function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

/** use の結果。0回で終わったときは成功扱いにせず NG で返す (何も変わっていない) */
function usedOrFail(g: Game, dt: Shop, u: RtUse): string[] {
  const msg = useResultMessages(g, dt, u);
  if (!u.result.count) throw new GameError(msg.join(' / '));
  return msg;
}

/** GET /api/v1/town の文字版 */
function townText(d: { people: number; events: string[]; shops: { rank: number; som: string | null; owner_name: string; shop: string; job: string; point: number; popularity: number; icon: string | null }[]; resting?: { id: number; shop: string; until: number }[] }): string {
  const lines = [`人口${d.people}` + (d.events.length ? ' イベント ' + d.events.join('/') : ''), '# 順位 som 店主名 店名 職業 点 人気% アイコン'];
  for (const s of d.shops) lines.push(`${s.rank} ${s.som ?? '-'} ${s.owner_name} ${s.shop} ${s.job || '-'} ${s.point} ${s.popularity} ${s.icon ?? '-'}`);
  if (d.resting?.length) lines.push('改装中: ' + d.resting.map((r) => `${r.shop}(${v.jst(r.until)}まで)`).join(' / '));
  return lines.join('\n') + '\n';
}
