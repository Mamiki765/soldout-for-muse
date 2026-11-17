// SOLD OUT for Muse — Muse Party のトークンでそのまま遊べるようにする。
// Party の GET /api/me にトークンを見せて「誰か」(owner_id) を確かめ、しばらく覚えておく。
// データベースは Party と別々のまま。こちらは「owner_id = どのお店」の対応だけを持つ。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { sha256 } from '../store.js';

export interface PartyWho {
  ownerId: string;
  name: string;
}

/** Party がこのトークンの人を止めている (一時停止・失効)。トークン自体は本物 */
export class PartyBlocked extends Error {
  constructor(readonly reason: string) {
    super('party: ' + reason);
  }
}

/** トークンを確かめる関数。正しくなければ undefined、止められていれば PartyBlocked、Party に届かなければ例外 */
export type PartyVerifier = (token: string) => Promise<PartyWho | undefined>;

export function httpPartyVerifier(baseUrl: string, timeoutMs = 5000): PartyVerifier {
  const base = baseUrl.replace(/\/$/, '');
  return async (token) => {
    const r = await fetch(base + '/api/me', {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json', 'user-agent': 'soldout-for-muse' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 401) return undefined;
    if (r.status === 403) {
      // Party の 403 は JSON の {"error": "suspended" | "token_revoked"}。JSON でない 403 (Cloudflare の遮断など) は
      // 「トークンが違う」と取り違えないよう、届かなかった扱いにする
      const j = (await r.json().catch(() => undefined)) as { error?: unknown } | undefined;
      if (typeof j?.error === 'string') throw new PartyBlocked(j.error);
      throw new Error('party: HTTP 403 (JSON でない返事)');
    }
    if (!r.ok) throw new Error('party: HTTP ' + r.status);
    const j = (await r.json()) as { owner_id?: unknown; name?: unknown };
    if (typeof j.owner_id !== 'string' || !j.owner_id) throw new Error('party: owner_id がありません (Party が古い可能性)');
    return { ownerId: j.owner_id, name: typeof j.name === 'string' ? j.name : '' };
  };
}

/**
 * 確かめた結果を覚えておく。正しいトークンは長め、正しくないものは短め。
 * Party に確かめられない (落ちている・混んでいる) 間は、前に確かめた結果で通す。ただし最後に確かめてから staleMs (24時間) まで。
 * 管理 API (strict) は期限の切れた結果では通さない (停止・失効が反映されないまま管理できないように。監査 B01)
 */
export class PartyAuth {
  private cache = new Map<string, { who: PartyWho | undefined; until: number; checkedAt: number }>();
  /** Party に届かなかったら、この時刻まで聞きに行かない (不調のあいだ毎回待たせない・追い打ちしない) */
  private downUntil = 0;

  constructor(
    private readonly verify: PartyVerifier,
    private readonly okTtl = 6 * 3600 * 1000,
    private readonly ngTtl = 60 * 1000,
    /** 聞きに行く直前に呼ぶ (全体の回数を数える。上限なら例外を投げる) */
    private readonly beforeFetch?: () => void,
    private readonly downMs = 20 * 1000,
    private readonly staleMs = 24 * 3600 * 1000,
  ) {}

  /** 覚えている確認結果を捨てる (次は Party に聞き直す。名前をすぐ写したいとき) */
  forget(token: string): void {
    this.cache.delete(sha256(token));
  }

  async who(token: string, strict = false, clock: () => number = Date.now): Promise<PartyWho | undefined> {
    const key = sha256(token);
    const now = clock();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.who;
    // 確かめられないときに使ってよい、前の結果
    const fallback = !strict && hit?.who && now - hit.checkedAt < this.staleMs ? hit.who : undefined;
    if (now < this.downUntil) {
      if (fallback) return fallback;
      throw new Error('party: しばらく問い合わせを控えています');
    }
    try {
      this.beforeFetch?.();
    } catch (e) {
      // 確認が混んでいるときも、前に確かめた結果があればそれで通す
      if (fallback) return fallback;
      throw e;
    }
    let who: PartyWho | undefined;
    try {
      who = await this.verify(token);
    } catch (e) {
      if (e instanceof PartyBlocked) {
        this.cache.delete(key);
        throw e;
      }
      this.downUntil = clock() + this.downMs;
      // Party に届かないときは、前に確かめた結果があればそれを使う
      if (fallback) return fallback;
      throw e;
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { who, until: now + (who ? this.okTtl : this.ngTtl), checkedAt: now });
    return who;
  }
}
