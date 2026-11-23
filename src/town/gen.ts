// SOLD OUT for Muse — 街の地図の生成 (public/town/town-gen.js) をサーバーで使う (1.2.0)。
// 生成はブラウザの観戦画面とサーバーで同じファイルを使う (同じ種・同じ地区数なら同じ区画になる)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

/** 区画 (town-gen.js の lot) */
export interface Lot {
  id: number;
  district: string;
  row: number;
  col: number;
  kind: 'shop' | 'public';
  publicKind?: string;
  publicName?: string;
  street: string;
  number: number;
  front: 'down' | 'up';
  state: 'vacant' | 'occupied' | 'held' | 'public';
  holder: string | null;
  size: 'S' | 'M' | 'L';
  reserved: string | null;
  holdUntil?: number;
  links?: { left: number | null; right: number | null; front: number | null; landmark: { lot: number; name: string; steps: number; sameStreet: boolean } | null };
}

export interface District {
  id: string;
  index: number;
  no: number;
  name: string;
  gx: number;
  gy: number;
  center: 'west' | 'east' | false;
  lots: Lot[];
  alleys: { id: string; name: string }[];
}

export interface TownShop {
  som: string;
  lot: number | null;
  size: string;
  [k: string]: unknown;
}

export interface Town {
  opts: Record<string, unknown>;
  districts: District[];
  lots: Map<number, Lot>;
  shops: Map<string, TownShop>;
  rand: () => number;
}

export interface HomeInput {
  som: string;
  lot: number;
  state: 'occupied' | 'held';
  shelves: number;
  roof: number | null;
  door: number | null;
  resting?: boolean;
  hold_until?: number | null;
  [k: string]: unknown;
}

export interface AddressForms {
  long: string;
  short: string;
  heading: string;
  data: { district: number; block: number; lot: number };
}

/** town-gen.js が出すもののうち、サーバーで使うもの */
export interface TownGen {
  ROOFS: { name: string; hex: string }[];
  DOORS: { name: string; hex: string }[];
  createTown(opts: Record<string, unknown>): Town;
  openDistrict(town: Town): District;
  restoreTown(opts: Record<string, unknown>, districts: number, homes: HomeInput[]): Town;
  placeInitial(town: Town, shops: { som: string; size: string; wishes: string[] }[], blocks: Set<string>): Town;
  addShop(town: Town, shop: { som: string; size: string; wishes: string[] }, blocks: Set<string>): Lot;
  conflicts(town: Town, lot: Lot, som: string, blocks: Set<string>): boolean;
  vacantLots(town: Town): Lot[];
  shopLots(town: Town): Lot[];
  addressForms(town: Town, lot: Lot): AddressForms;
  lotByAddress(town: Town, text: string): Lot | null;
  homeColors(som: string, roof: number | null, door: number | null): { roof: number; door: number };
  sizeOfShelves(n: number): 'S' | 'M' | 'L';
  districtLabel(d: District): string;
  chunkId(town: Town, gx: number, gy: number): string;
  chunkAt(town: Town, gx: number, gy: number, opt?: Record<string, unknown>): Record<string, unknown>;
  /** 地区を描くのに要るチャンク (地区と、東・南の外側の大通りを持つまわり) */
  /** 描く範囲 (チップ単位)。西・北は自分の大通りから、東・南は外側の大通りの端まで */
  bounds(town: Town, districts?: District[]): { x: number; y: number; w: number; h: number };
  chunksFor(town: Town, districts: District[], opt?: Record<string, unknown>): Record<string, unknown>[];
}

/** 生成のファイル。リポジトリの public/town/town-gen.js (dist/src/town から3つ上) */
export const TOWN_GEN_PATH = fileURLToPath(new URL('../../../public/town/town-gen.js', import.meta.url));

let cached: TownGen | undefined;

/** 生成を読み込む (1回だけ)。ブラウザ用のファイルを、そのまま隔離した場で動かす */
export function townGen(path = TOWN_GEN_PATH): TownGen {
  if (cached) return cached;
  const scope: Record<string, unknown> = {};
  runInNewContext(readFileSync(path, 'utf8'), scope, { filename: 'town-gen.js' });
  cached = scope.TownGen as TownGen;
  if (!cached) throw new Error('town-gen.js を読み込めませんでした');
  return cached;
}
