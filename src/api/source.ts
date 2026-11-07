// SOLD OUT for Muse — ソースの配布 (GPL のソース提供を、このサーバー自身から行う)。
// GitHub などの外部サイトに頼らず、遊んでいる Muse・観戦している人がその場で読めるようにする。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';

/** 配らないもの (生成物・依存・保存データ) */
const SKIP = new Set(['node_modules', 'dist', 'data', '.git', 'coverage']);
const SKIP_RE = /\.sqlite(-wal|-shm)?$|^\.env/;

export interface SourceFile {
  path: string;
  size: number;
}

export class SourceTree {
  readonly dir: string;
  private files: SourceFile[] | undefined;
  private tarball: Buffer | undefined;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** 全ファイル (相対パス、/ 区切り) */
  list(): SourceFile[] {
    if (this.files) return this.files;
    const out: SourceFile[] = [];
    const walk = (rel: string): void => {
      const abs = join(this.dir, rel);
      for (const name of readdirSync(abs).sort()) {
        if (SKIP.has(name) || SKIP_RE.test(name)) continue;
        const r = rel ? rel + '/' + name : name;
        const st = statSync(join(this.dir, r));
        if (st.isDirectory()) walk(r);
        else if (st.isFile()) out.push({ path: r, size: st.size });
      }
    };
    walk('');
    this.files = out;
    return out;
  }

  /** パスを正規化する。配布対象の外なら undefined */
  resolve(p: string): { kind: 'file'; file: SourceFile } | { kind: 'dir'; path: string; entries: { name: string; dir: boolean; size: number }[] } | undefined {
    const norm = posix.normalize('/' + decodeURIComponent(p)).replace(/^\/+|\/+$/g, '');
    if (norm.split('/').some((s) => s === '..')) return undefined;
    const files = this.list();
    const f = files.find((x) => x.path === norm);
    if (f) return { kind: 'file', file: f };
    const prefix = norm ? norm + '/' : '';
    const entries = new Map<string, { name: string; dir: boolean; size: number }>();
    for (const x of files) {
      if (!x.path.startsWith(prefix)) continue;
      const rest = x.path.slice(prefix.length);
      const i = rest.indexOf('/');
      if (i < 0) entries.set(rest, { name: rest, dir: false, size: x.size });
      else if (!entries.has(rest.slice(0, i))) entries.set(rest.slice(0, i), { name: rest.slice(0, i), dir: true, size: 0 });
    }
    if (!entries.size) return undefined;
    const list = [...entries.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return { kind: 'dir', path: norm, entries: list };
  }

  read(file: SourceFile): Buffer {
    return readFileSync(join(this.dir, file.path));
  }

  /** 中身が文字かどうか (先頭に NUL があればバイナリ) */
  static isText(b: Buffer): boolean {
    return !b.subarray(0, 8192).includes(0);
  }

  /** 一式を tar.gz にする (初回だけ作ってメモリに置く) */
  tarGz(): Buffer {
    if (this.tarball) return this.tarball;
    const parts: Buffer[] = [];
    const mtime = Math.floor(Date.now() / 1000);
    for (const f of this.list()) {
      const name = 'soldout-for-muse/' + f.path;
      if (Buffer.byteLength(name) > 255) continue;
      const data = this.read(f);
      parts.push(tarHeader(name, data.length, mtime), data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    parts.push(Buffer.alloc(1024));
    this.tarball = gzipSync(Buffer.concat(parts), { level: 9 });
    return this.tarball;
  }
}

/** ustar 形式のヘッダー (512 バイト) */
function tarHeader(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf('/', 154);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  const put = (s: string, off: number, len: number) => h.write(s, off, len, 'utf8');
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(base, 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(mtime, 12), 136, 12);
  put('        ', 148, 8);
  put('0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

/** API 向けのテキスト: ディレクトリなら一覧、ファイルなら中身 */
export function sourceText(tree: SourceTree, p: string): { status: number; text: string } {
  const r = tree.resolve(p);
  if (!r) return { status: 404, text: 'NG ありません\n' };
  if (r.kind === 'dir') {
    const head = `# /${r.path} (ファイルは GET /api/v1/source/<パス> で読めます。一式は /source.tar.gz)\n`;
    return { status: 200, text: head + r.entries.map((e) => (e.dir ? e.name + '/' : `${e.name} ${e.size}`)).join('\n') + '\n' };
  }
  const b = tree.read(r.file);
  if (!SourceTree.isText(b)) return { status: 200, text: `${r.file.path} はバイナリ (${b.length} バイト) です\n` };
  return { status: 200, text: b.toString('utf8') };
}
