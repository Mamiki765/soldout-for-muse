// SOLD OUT ミューズ街 — 出店許可証メーカー (ブラウザー用・スペースのフォームに組み込む見本)
// make_license.py と同じ並べ方で、canvas に 写真 → 枠 → 値 の順に描いて webp を作る。
//
//   const blob = await makeLicense({
//     card,        // GET /api/v1/profile/card/draft の返事の card
//     photo,       // <img> か ImageBitmap (3:4 の縦長、768x1024 くらい)
//     frame,       // frames/frame-license-03.json の中身
//     frameImage,  // その枠の画像 (<img> か ImageBitmap)
//     font: 'ShipporiB1',  // 先に loadKitFont() で読み込んだ書体名 (好きな書体名でもよい)
//     fit: 'cover',        // 'cover' = 窓いっぱい(はみ出しは切る) / 'contain' = 切らずに収める
//   });
//   // blob は image/webp。base64 にして POST /api/v1/profile/card へ

const INK = '#28180c';
const PAPER = '#f4e4c4';

export async function loadKitFont(url, name = 'ShipporiB1') {
  const f = new FontFace(name, `url(${url})`);
  await f.load();
  document.fonts.add(f);
  return name;
}

export function akaLine(a) {
  if (a.label && a.name) return `${a.where}　${a.label}：${a.name}`;
  return [a.where, a.id, a.name].filter(Boolean).join('　');
}

function values(card) {
  return {
    license_no: card.license_no || '',
    owner_name: card.owner_name || '',
    shopname: card.shopname || '（閉店中）',
    job: card.job || '',
    licensed_on: (card.licensed_on || '').replaceAll('-', '.'),
    aka: (card.aka || []).map(akaLine),
  };
}

function fitFont(ctx, text, font, size, maxW) {
  for (; size > 10; size--) {
    ctx.font = `${size}px "${font}"`;
    if (ctx.measureText(text).width <= maxW) break;
  }
}

function placePhoto(ctx, photo, b, mode) {
  const pw = photo.width, ph = photo.height;
  if (mode === 'contain') {
    const s = Math.min(b.w / pw, b.h / ph);
    ctx.fillStyle = PAPER;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const w = Math.round(pw * s), h = Math.round(ph * s);
    ctx.drawImage(photo, b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h);
  } else {
    const s = Math.max(b.w / pw, b.h / ph);
    const sw = b.w / s, sh = b.h / s;
    ctx.drawImage(photo, (pw - sw) / 2, (ph - sh) / 2, sw, sh, b.x, b.y, b.w, b.h);
  }
}

export async function makeLicense({ card, photo, frame, frameImage, font = 'ShipporiB1', fit = 'cover', quality = 0.85 }) {
  const [W, H] = frame.size;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  placePhoto(ctx, photo, frame.photo, fit);
  ctx.drawImage(frameImage, 0, 0, W, H); // 枠を写真の上に重ねる
  const v = values(card);
  const off = frame.value_x_offset ?? frame.label_w;
  const k = frame.label_w / 180;
  const pad = Math.round(18 * k);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const r of frame.rows) {
    const x0 = r.x + off + pad, maxW = r.w - off - pad * 2;
    if (r.field === 'aka') {
      const lines = v.aka.slice(0, r.max_lines ?? 1);
      if (!lines.length) continue;
      const lh = Math.min(r.h / lines.length, 72 * k);
      lines.forEach((t, i) => {
        fitFont(ctx, t, font, Math.round(lh * 0.62), maxW);
        ctx.fillText(t, x0, r.y + lh * (i + 0.5) + (r.h - lh * lines.length) / 2);
      });
      continue;
    }
    const t = v[r.field];
    if (!t) continue;
    fitFont(ctx, t, font, Math.round(r.h * 0.56), maxW);
    ctx.fillText(t, x0, r.y + r.h / 2);
  }
  return await new Promise((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error('webp にできませんでした'))), 'image/webp', quality));
}
