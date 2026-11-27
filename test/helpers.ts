// SOLD OUT for Muse — テストの共通の下ごしらえ (サーバーを立てる・開店する)。
// ファイル名が *.test.ts でないので、これ自体はテストとして走らない。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App, type AppOptions } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';

export const INVITE = 'muse-invite';

export interface StartOptions extends Partial<Omit<AppOptions, 'store' | 'rng'>> {
  /** 乱数の種 (既定 7) */
  seed?: number;
  /** 招待コード (既定 muse-invite) */
  invite?: string;
  store?: Store;
  /** App を作る前に store に手を入れる (管理トークン・見学用の鍵など) */
  prepare?: (store: Store) => void;
}

export interface Started {
  base: string;
  server: Server;
  app: App;
  store: Store;
}

/**
 * メモリの上の街でサーバーを立てる。既定は公開URL https://so.example・画像とソースはこのリポジトリ・help は 'HELP'。
 * 終わったら server.close() を呼ぶ
 */
export async function startServer(o: StartOptions = {}): Promise<Started> {
  const { seed = 7, invite = INVITE, store = new Store(':memory:'), prepare, ...rest } = o;
  store.setSetting('invite_hash', sha256(invite));
  prepare?.(store);
  const app = new App({
    publicUrl: 'https://so.example',
    imagesDir: resolve('public/images'),
    sourceDir: resolve('.'),
    helpText: 'HELP',
    ...rest,
    store,
    rng: seededRng(seed),
  });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, app, store };
}

/** 招待コードで開店して、トークンと Authorization ヘッダーを返す */
export async function registerShop(base: string, shopname: string, name = 'mute', invite = INVITE): Promise<{ token: string; shopId: number; auth: Record<string, string> }> {
  const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite, name, shopname }) });
  if (r.status !== 201) throw new Error(`開店できません ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { token: string; shop_id: number };
  return { token: j.token, shopId: j.shop_id, auth: { authorization: 'Bearer ' + j.token } };
}
