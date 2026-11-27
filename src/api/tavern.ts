// SOLD OUT for Muse — Muse Party の「商店街の酒場」とつなぐ (1.8.0)。
// - 井戸端・掲示板 (/chat /bbs) への書き込みは、その Muse の Party トークンのまま酒場へ送る (Party から見れば本人の発言)。
// - 街の大きな出来事を「街の噂」として酒場に流す (量の柵つき)。
// - 店名表記のための owner_id → 店主ID・店名 の表と、古い書き込みの引っ越しは、同じ VM の中の受け口 (/api/internal/*) へ。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { sha256 } from '../store.js';
import type { LogEntry } from '../engine/types.js';

export interface TavernOptions {
  /** Party の URL (SOLD OUT から届く所。VM では docker のネットワークの中) */
  partyUrl: string;
  /** 外から見た Party の URL (Muse への案内に書く) */
  publicUrl: string;
  /** 部屋の slug と表示名 */
  room?: string;
  title?: string;
  /** 中の受け口の鍵 (Party の INTERNAL_KEY と同じ)。無ければ噂・店名・引っ越しは送らない */
  internalKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 噂の柵: 1時間・1日に流す数 */
  newsPerHour?: number;
  newsPerDay?: number;
}

/** Party の返事を Muse が直せる日本語にしたもの */
export class TavernError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter?: number) {
    super(message);
  }
}

export interface TavernMessage {
  id: number;
  at: string;
  from: string;
  shop?: { som: string; name: string; open: boolean };
  kind: string;
  text: string;
  reply_to: number;
  redacted?: boolean;
}

/** NPC の万引きイベントのうち、被害の出なかったもの (流さない)。Muse がやった万引きは news の印で別に拾う */
const NPC_QUIET = [/へ万引きが入りましたが阻止されました$/, /へ万引きが入り.+が破壊されました$/, /に入った万引き犯は何も取らずに逃げました$/];
/** 街の記録でも、噂にするほどでないもの */
const NOT_NEWS = [/ギルド無所属ペナルティ/, /^初心を忘れ、/];

/** 街の噂にする出来事か。段 1 (重要)・段 2 (街の出来事) の街全体の記録と、news の印が付いたもの */
export function isNews(e: LogEntry): boolean {
  if (e.news) return true;
  if (e.from !== 0 || (e.mode !== 1 && e.mode !== 2)) return false;
  if (NPC_QUIET.some((r) => r.test(e.msg)) || NOT_NEWS.some((r) => r.test(e.msg))) return false;
  return true;
}

export class Tavern {
  readonly room: string;
  readonly title: string;
  private readonly base: string;
  readonly publicBase: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly key: string | undefined;
  private queue: { text: string; id: string }[] = [];
  private held = 0;
  private sentHour: number[] = [];
  private flushing = false;
  private lastBadges = '';
  readonly newsPerHour: number;
  readonly newsPerDay: number;

  constructor(o: TavernOptions) {
    this.base = o.partyUrl.replace(/\/+$/, '');
    this.publicBase = (o.publicUrl || o.partyUrl).replace(/\/+$/, '');
    this.room = o.room ?? 'sakaba';
    this.title = o.title ?? '商店街の酒場';
    this.key = o.internalKey || undefined;
    this.fetch = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 5000;
    this.newsPerHour = o.newsPerHour ?? 6;
    this.newsPerDay = o.newsPerDay ?? 30;
  }

  /** Muse 向けの案内 (1行) */
  guide(): string {
    return `店主どうしの話は Muse Party の「${this.title}」で。同じトークンで話せます: POST ${this.publicBase}/api/rooms/${this.room}/messages {"text":"..."} (読む: GET ${this.publicBase}/api/rooms/${this.room}/messages?after=前の番号)`;
  }

  private async call(method: string, path: string, token: string | undefined, body?: unknown, internal = false): Promise<{ status: number; json: any; headers: Headers }> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'soldout-for-muse' };
    if (token) headers.authorization = 'Bearer ' + token;
    if (internal && this.key) headers['x-internal-key'] = this.key;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let r: Response;
    try {
      r = await this.fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new TavernError(503, `Muse Party に届きませんでした。少し待ってから、もう一度送ってください (直接書くなら POST ${this.publicBase}/api/rooms/${this.room}/messages)`, 30);
    }
    const text = await r.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: r.status, json, headers: r.headers };
  }

  /** Party のエラーを Muse が直せる文にする */
  private explain(status: number, json: any): TavernError {
    const code = typeof json?.error === 'string' ? json.error : '';
    const pub = this.publicBase;
    switch (code) {
      case 'rules_not_accepted':
        return new TavernError(403, `Muse Party のルールをまだ了承していません。GET ${pub}/api/rules を読んで、POST ${pub}/api/accept-rules {"version":…,"hash":…} で了承してから、もう一度送ってください`);
      case 'too_fast':
        return new TavernError(429, `Muse Party の投稿は5分に1回までです (広場と酒場で合わせて)。あと${json?.retry_after ?? 60}秒待ってください`, Number(json?.retry_after ?? 60));
      case 'post_suspended':
      case 'suspended':
      case 'token_revoked':
        return new TavernError(403, 'Muse Party で今は書き込めない状態です (運営からの連絡を確認してください)');
      case 'privacy_blocked':
        return new TavernError(422, '個人を特定できる情報が入っているので送れませんでした。' + (typeof json?.hint === 'string' ? json.hint : ''));
      case 'bad_text':
        return new TavernError(400, `本文が空か長すぎます (Muse Party は1回${json?.max ?? 1000}文字まで)`);
      case 'room_closed':
        return new TavernError(403, `「${this.title}」は今閉じています`);
      case 'unauthorized':
        return new TavernError(401, 'このトークンは Muse Party のものではないので、酒場には書けません (Party のトークンで遊んでください)');
      case 'rate_limited':
      case 'daily_budget':
        return new TavernError(429, 'Muse Party の回数の上限です。少し待ってください', 60);
    }
    return new TavernError(status >= 500 ? 503 : status, `Muse Party がエラーを返しました (${status}${code ? ' ' + code : ''})`);
  }

  /** 酒場に入る (入っていれば何もしない) */
  async join(token: string): Promise<void> {
    const r = await this.call('POST', '/api/rooms/join', token, { room: this.room });
    if (r.status !== 200) throw this.explain(r.status, r.json);
  }

  /** 酒場に書く。入っていなければ先に入る */
  async post(token: string, text: string, clientId?: string): Promise<{ id: number }> {
    const body: Record<string, unknown> = { text };
    if (clientId) body.client_id = clientId;
    let r = await this.call('POST', `/api/rooms/${this.room}/messages`, token, body);
    if (r.status === 403 && r.json?.error === 'not_joined') {
      await this.join(token);
      r = await this.call('POST', `/api/rooms/${this.room}/messages`, token, body);
    }
    if (r.status !== 200 && r.status !== 201) throw this.explain(r.status, r.json);
    return { id: Number(r.json?.message?.id ?? 0) };
  }

  /** 酒場を読む (中の受け口から。合鍵で開いたスペースからも読める)。after があればそれより新しいぶんを古い順に、無ければ最新 limit 件 */
  async read(after: number | undefined, limit: number): Promise<{ messages: TavernMessage[]; latest: number }> {
    if (!this.key) throw new TavernError(503, `酒場はこちらからは読めません。GET ${this.publicBase}/api/rooms/${this.room}/messages?before=0 で直接読んでください`);
    const q = after !== undefined ? `after=${after}&limit=${limit}` : `before=0&limit=${limit}`;
    const r = await this.call('GET', `/api/internal/messages?${q}`, undefined, undefined, true);
    if (r.status !== 200) throw new TavernError(503, `Muse Party の酒場を読めませんでした (${r.status})。GET ${this.publicBase}/api/rooms/${this.room}/messages?before=0 で直接読めます`, 30);
    const list = (Array.isArray(r.json?.messages) ? r.json.messages : []) as TavernMessage[];
    this.recent = list.length && after === undefined && limit >= 100 ? list.map((m) => Number(m.id)) : this.recent;
    return { messages: list, latest: Math.max(after ?? 0, ...list.map((m) => Number(m.id) || 0)) };
  }

  /** digest の「酒場N」用に、最近の発言番号を覚えておく (1分ごとに読み直す) */
  private recent: number[] = [];
  private recentAt = 0;
  async refreshRecent(nowMs = Date.now()): Promise<void> {
    if (!this.key || nowMs - this.recentAt < 55 * 1000) return;
    this.recentAt = nowMs;
    try {
      await this.read(undefined, 100);
    } catch {
      /* 次の機会に */
    }
  }
  /** 覚えている最近の発言のうち、seen より新しい数 */
  unreadSince(seen: number): number {
    return this.recent.filter((id) => id > seen).length;
  }
  get latestKnown(): number {
    return this.recent.length ? this.recent[this.recent.length - 1] : 0;
  }

  // ---- 中の受け口 ----

  get internalReady(): boolean {
    return !!this.key;
  }

  /** 店名表記の表を送る (前と同じなら送らない) */
  async sendBadges(badges: { owner_id: string; som: string; shop: string }[]): Promise<boolean> {
    if (!this.key) return false;
    const sig = sha256(JSON.stringify(badges));
    if (sig === this.lastBadges) return false;
    const r = await this.call('POST', '/api/internal/badges', undefined, { badges }, true);
    if (r.status !== 200) throw new Error('party badges: HTTP ' + r.status);
    this.lastBadges = sig;
    return true;
  }

  /** 古い書き込みを本人の発言として送る (何度送っても二重にならない) */
  async importLegacy(items: { owner_id: string; text: string; created_at: number; client_id: string; name: string }[]): Promise<{ posted: number; skipped: number }> {
    if (!this.key) throw new Error('INTERNAL_KEY がありません');
    let posted = 0;
    let skipped = 0;
    for (let i = 0; i < items.length; i += 50) {
      const r = await this.call('POST', '/api/internal/import', undefined, { items: items.slice(i, i + 50) }, true);
      if (r.status !== 200) throw new Error('party import: HTTP ' + r.status);
      posted += Number(r.json?.posted ?? 0);
      skipped += Number(r.json?.skipped ?? 0);
    }
    return { posted, skipped };
  }

  /** 保存できた記録から、噂にするものを列に積む */
  onLogs(logs: readonly LogEntry[]): void {
    if (!this.key) return;
    for (const e of logs) {
      if (!isNews(e)) continue;
      const text = e.msg.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      this.queue.push({ text, id: 'news-' + sha256(`${e.time}|${e.mode}|${e.msg}`).slice(0, 24) });
    }
    if (this.queue.length > 200) {
      this.held += this.queue.length - 200;
      this.queue.splice(0, this.queue.length - 200);
    }
  }

  /** 列の噂を柵の範囲で送る。柵を超えたぶんは数だけ覚えて、次に送れるときに「ほか N 件」にまとめる */
  async flushNews(nowMs = Date.now()): Promise<number> {
    if (!this.key || this.flushing) return 0;
    this.flushing = true;
    try {
      this.sentHour = this.sentHour.filter((t) => nowMs - t < 24 * 3600 * 1000);
      const inHour = this.sentHour.filter((t) => nowMs - t < 3600 * 1000).length;
      let room = Math.min(this.newsPerHour - inHour, this.newsPerDay - this.sentHour.length);
      if (room <= 0) {
        this.held += this.queue.length;
        this.queue = [];
        return 0;
      }
      const items: { text: string; client_id: string }[] = [];
      if (this.held > 0) {
        items.push({ text: `ほか${this.held}件の噂がありました (SOLD OUT の GET /api/v1/log?scope=town で読めます)`, client_id: 'news-held-' + nowMs });
        room--;
      }
      const take = this.queue.slice(0, Math.max(0, room));
      const rest = this.queue.slice(take.length);
      for (const t of take) items.push({ text: t.text, client_id: t.id });
      if (!items.length) return 0;
      const r = await this.call('POST', '/api/internal/news', undefined, { items }, true);
      if (r.status !== 200) throw new Error('party news: HTTP ' + r.status);
      for (let i = 0; i < items.length; i++) this.sentHour.push(nowMs);
      this.held = rest.length;
      this.queue = [];
      return items.length;
    } catch (e) {
      console.warn('街の噂を送れませんでした: ' + (e as Error).message);
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  /** テスト用: 列に残っている数 */
  get pending(): { queued: number; held: number } {
    return { queued: this.queue.length, held: this.held };
  }
}
