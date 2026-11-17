# SOLD OUT ミューズ街 — 出店許可証メーカー (Python + Pillow)
# 使い方:
#   python make_license.py --card draft.json --photo 絵.png [--frame frames/frame-license-03.json]
#                          [--font 好きなフォント.ttf] [--fit cover|contain] [--out license.webp]
# draft.json は GET /api/v1/profile/card/draft の返事をそのまま保存したもの。
import argparse, json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
INK = (40, 24, 12, 255)
PAPER = (244, 228, 196, 255)


def aka_line(a):
    """通り名1件を1行に。label があれば「where　label：name」、なければ「where　id　name」"""
    if a.get('label') and a.get('name'):
        return f"{a['where']}　{a['label']}：{a['name']}"
    return '　'.join(x for x in (a.get('where'), a.get('id'), a.get('name')) if x)


def values(card):
    return {
        'license_no': card.get('license_no') or '',
        'owner_name': card.get('owner_name') or '',
        'shopname': card.get('shopname') or '（閉店中）',
        'job': card.get('job') or '',
        'licensed_on': (card.get('licensed_on') or '').replace('-', '.'),
        'aka': [aka_line(a) for a in card.get('aka') or []],
    }


def fit_font(draw, text, font_path, size, max_w):
    f = ImageFont.truetype(font_path, size)
    while size > 10 and draw.textlength(text, font=f) > max_w:
        size -= 1
        f = ImageFont.truetype(font_path, size)
    return f


def place_photo(base, photo, box, mode):
    x, y, w, h = box['x'], box['y'], box['w'], box['h']
    pw, ph = photo.size
    if mode == 'contain':
        s = min(w / pw, h / ph)
        bg = Image.new('RGBA', (w, h), PAPER)
        p = photo.resize((round(pw * s), round(ph * s)), Image.LANCZOS)
        bg.alpha_composite(p, ((w - p.width) // 2, (h - p.height) // 2))
        base.alpha_composite(bg, (x, y))
    else:  # cover: 窓いっぱいに。はみ出しは左右(または上下)を中央で切る
        s = max(w / pw, h / ph)
        p = photo.resize((round(pw * s), round(ph * s)), Image.LANCZOS)
        left, top = (p.width - w) // 2, (p.height - h) // 2
        base.alpha_composite(p.crop((left, top, left + w, top + h)), (x, y))


def make(card, photo_path, frame_json, font_path, fit, out):
    fj = json.load(open(frame_json, encoding='utf-8'))
    fdir = os.path.dirname(os.path.abspath(frame_json))
    frame = Image.open(os.path.join(fdir, fj['file'])).convert('RGBA')
    W, H = fj['size']
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    place_photo(canvas, Image.open(photo_path).convert('RGBA'), fj['photo'], fit)
    canvas.alpha_composite(frame)  # 枠を写真の上に重ねる (窓の角は枠の絵で隠れる)
    d = ImageDraw.Draw(canvas)
    v = values(card)
    off = fj.get('value_x_offset', fj['label_w'])
    k = fj['label_w'] / 180
    pad = round(18 * k)
    for r in fj['rows']:
        x0, max_w = r['x'] + off + pad, r['w'] - off - pad * 2
        if r['field'] == 'aka':
            lines = v['aka'][: r.get('max_lines', 1)]
            if not lines:
                continue
            lh = min(r['h'] / max(len(lines), 1), 72 * k)
            for i, t in enumerate(lines):
                f = fit_font(d, t, font_path, round(lh * 0.62), max_w)
                d.text((x0, r['y'] + lh * (i + 0.5) + (r['h'] - lh * len(lines)) / 2), t, font=f, fill=INK, anchor='lm')
            continue
        t = v[r['field']]
        if not t:
            continue
        f = fit_font(d, t, font_path, round(r['h'] * 0.56), max_w)
        d.text((x0, r['y'] + r['h'] / 2), t, font=f, fill=INK, anchor='lm')
    canvas.save(out, quality=85, method=6)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='出店許可証メーカー')
    ap.add_argument('--card', required=True, help='GET /api/v1/profile/card/draft の返事 (JSON)')
    ap.add_argument('--photo', required=True, help='窓に入れる絵 (3:4 の縦長、768x1024 くらいがちょうどよい)')
    ap.add_argument('--frame', default=os.path.join(HERE, 'frames', 'frame-license-03.json'))
    ap.add_argument('--font', default=os.path.join(HERE, 'fonts', 'ShipporiMinchoB1-ExtraBold.ttf'), help='値を書く書体 (既定はしっぽり明朝 B1)')
    ap.add_argument('--fit', choices=['cover', 'contain'], default='cover', help='cover=窓いっぱい(はみ出しは切る) / contain=切らずに収める')
    ap.add_argument('--out', default='license.webp')
    a = ap.parse_args()
    card = json.load(open(a.card, encoding='utf-8'))
    card = card.get('card', card)
    print(make(card, a.photo, a.frame, a.font, a.fit, a.out))
