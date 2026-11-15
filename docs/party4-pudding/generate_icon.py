#!/usr/bin/env python3
"""SOLD OUT for Muse: 固めプリン (item 114) の 16x16 RGBA アイコン。

Python 3 + Pillow。docs/v030-icons/generate_icons.py と同じ作法:
1文字=1ピクセル、'.' は透明、13px 以内の絵を 16x16 の中央に置く、アルファは 0/255 のみ。
既存の砂糖 (103) の灰青、乳製品 (107/110/111) の黄・茶系の色を使う。AI 画像は使っていない。
使い方: python generate_icon.py --out ../../public/images   (preview.png はこのフォルダに出る)
"""
from pathlib import Path
import argparse
from PIL import Image

# C=苦めのカラメル (濃い焦げ茶) K=カラメル Y=固めのカスタード L=光の当たる左側 O=右の陰 P=皿 D=皿の影
PALETTE = dict(C='#501900', K='#966200', Y='#FFD48E', L='#FFF7D4', O='#DC9200', P='#CEDEEA', D='#868E9E')
ROWS = '''
...CCCCCCC...
..CKKKKKKKC..
..CKLKKKKKC..
..CYCKKKCYC..
..LYCYYYCYO..
..LYYYYYCYO..
..LYYYYYYYO..
.LYYYYYYYYYO.
.LYYYYYYYYYO.
.LYYYYYYYYYO.
PPPPPPPPPPPPD
.DDDDDDDDDDD.
'''.strip('\n').splitlines()


def draw() -> Image.Image:
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(ROWS):
        for x, key in enumerate(row):
            if key != '.':
                im.putpixel((x, y), (*bytes.fromhex(PALETTE[key][1:]), 255))
    motif = im.crop(im.getbbox())
    out = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    out.paste(motif, ((16 - motif.width) // 2, (16 - motif.height) // 2))
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True, help='item-no-114.png を書くフォルダ')
    args = p.parse_args()
    here = Path(__file__).resolve().parent
    im = draw()
    path = args.out / 'item-no-114.png'
    im.save(path, optimize=False)
    with Image.open(path) as saved:
        saved.load()
        assert saved.mode == 'RGBA' and saved.size == (16, 16)
        assert set(saved.getchannel('A').tobytes()) == {0, 255}
    # 並べて見る用: 牛乳・ヨーグルト・チーズ・砂糖・クリーム・ジェラート・チーズケーキ・固めプリン (最近傍8倍)
    images = args.out
    nums = [26, 35, 36, 103, 107, 110, 111, 114]
    preview = Image.new('RGBA', (len(nums) * 136, 136), (238, 236, 230, 255))
    for k, n in enumerate(nums):
        with Image.open(images / f'item-no-{n}.png') as src:
            big = src.convert('RGBA').resize((128, 128), Image.Resampling.NEAREST)
        preview.paste(big, (k * 136 + 4, 4), big)
    preview.save(here / 'preview.png')
    print('PASS: item-no-114.png 16x16 RGBA, alpha {0,255}')


if __name__ == '__main__':
    main()
