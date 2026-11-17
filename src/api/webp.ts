// SOLD OUT for Muse — 上がってきた webp の検品。中身を作り直さず、形 (RIFF/WEBP)・大きさ・動かないことを確かめ、
// 撮影情報などの付属データ (EXIF・XMP) だけ外して返す。ネイティブの画像ライブラリを使わない (VM を軽く保つ)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

export interface WebpInfo {
  width: number;
  height: number;
  /** EXIF・XMP を外したあとのファイル */
  data: Buffer;
}

export class WebpError extends Error {}

interface Chunk {
  id: string;
  data: Buffer;
}

function chunks(buf: Buffer): Chunk[] {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new WebpError('webp ではありません (RIFF/WEBP で始まっていない)');
  }
  const riffSize = buf.readUInt32LE(4);
  if (riffSize + 8 > buf.length || riffSize < 4) throw new WebpError('webp が途中で切れています');
  const end = 8 + riffSize;
  const out: Chunk[] = [];
  let p = 12;
  while (p + 8 <= end) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (p + 8 + size > end) throw new WebpError('webp の中身が壊れています');
    out.push({ id, data: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  if (!out.length) throw new WebpError('webp の中身がありません');
  return out;
}

function sizeOf(c: Chunk[]): { width: number; height: number } {
  const first = c[0];
  if (first.id === 'VP8X') {
    if (first.data.length < 10) throw new WebpError('webp の中身が壊れています');
    if (first.data[0] & 0x02 || c.some((x) => x.id === 'ANIM' || x.id === 'ANMF')) throw new WebpError('動く webp は使えません');
    return { width: 1 + first.data.readUIntLE(4, 3), height: 1 + first.data.readUIntLE(7, 3) };
  }
  if (first.id === 'VP8 ') {
    const d = first.data;
    if (d.length < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new WebpError('webp の中身が壊れています');
    return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff };
  }
  if (first.id === 'VP8L') {
    const d = first.data;
    if (d.length < 5 || d[0] !== 0x2f) throw new WebpError('webp の中身が壊れています');
    const bits = d.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new WebpError('webp の中身が読めません');
}

/** 検品して、EXIF・XMP を外したファイルを返す */
export function inspectWebp(buf: Buffer): WebpInfo {
  const c = chunks(buf);
  const { width, height } = sizeOf(c);
  if (!c.some((x) => x.id === 'VP8 ' || x.id === 'VP8L')) throw new WebpError('webp に絵が入っていません');
  const keep = c.filter((x) => x.id !== 'EXIF' && x.id !== 'XMP ');
  if (keep.length === c.length) return { width, height, data: buf.subarray(0, 8 + buf.readUInt32LE(4)) };
  const parts: Buffer[] = [];
  for (const x of keep) {
    let data = x.data;
    if (x.id === 'VP8X') {
      data = Buffer.from(data);
      data[0] &= ~(0x08 | 0x04); // EXIF・XMP の印を外す
    }
    const head = Buffer.alloc(8);
    head.write(x.id, 0, 'ascii');
    head.writeUInt32LE(data.length, 4);
    parts.push(head, data);
    if (data.length & 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'ascii');
  return { width, height, data: Buffer.concat([riff, body]) };
}
