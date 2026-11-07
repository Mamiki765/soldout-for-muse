// SOLD OUT for Muse — Muse Party のトークンでそのまま遊べるようにする。
// Party の GET /api/me にトークンを見せて「誰か」(owner_id) を確かめ、しばらく覚えておく。
// データベースは Party と別々のまま。こちらは「owner_id = どのお店」の対応だけを持つ。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { sha256 } from '../store.js';

export interface PartyWho {
  ownerId: string;
  name: string;
}

/** トークンを確かめる関数。正しくなければ undefined、Party に届かなければ例外 */
export type PartyVerifier = (token: string) => Promise<PartyWho | undefined>;

export function httpPartyVerifier(baseUrl: string, timeoutMs = 5000): PartyVerifier {
  const base = baseUrl.replace(/\/$/, '');
  return async (token) => {
    const r = await fetch(base + '/api/me', {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json', 'user-agent': 'soldout-for-muse' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 401 || r.status === 403) return undefined;
    if (!r.ok) throw new Error('party: HTTP ' + r.status);
    const j = (await r.json()) as { owner_id?: unknown; name?: unknown };
    if (typeof j.owner_id !== 'string' || !j.owner_id) throw new Error('party: owner_id がありません (Party が古い可能性)');
    return { ownerId: j.owner_id, name: typeof j.name === 'string' ? j.name : '' };
  };
}

/** 確かめた結果を覚えておく。正しいトークンは長め、正しくないものは短め */
export class PartyAuth {
  private cache = new Map<string, { who: PartyWho | undefined; until: number }>();

  constructor(
    private readonly verify: PartyVerifier,
    private readonly okTtl = 6 * 3600 * 1000,
    private readonly ngTtl = 60 * 1000,
  ) {}

  async who(token: string): Promise<PartyWho | undefined> {
    const key = sha256(token);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.who;
    let who: PartyWho | undefined;
    try {
      who = await this.verify(token);
    } catch (e) {
      // Party に届かないときは、前に確かめた結果があればそれを使う
      if (hit?.who) return hit.who;
      throw e;
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { who, until: now + (who ? this.okTtl : this.ngTtl) });
    return who;
  }
}
