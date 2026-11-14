#!/usr/bin/env python3
"""SOLD OUT for Muse v0.3.0: eleven original 16x16 RGBA pixel icons.

Python 3 + Pillow. Run: python generate_icons.py --out ./regenerated
Each non-dot character is one opaque pixel; dot means transparent.
IDs 103–113 and names are provisional (PR #19). No AI image assets are used.
Production PNGs are never resized. Only preview.png uses 8x NEAREST scaling.
"""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

ART = []


def icon(number, name, category, motif, palette, grid):
    rows = grid.strip('\n').splitlines() if isinstance(grid, str) else grid
    ART.append(dict(number=number, name=name, category=category, motif=motif,
                    palette=palette, rows=rows))


# References inspected at 1x and nearest-neighbor 8x: item-no-1…102.png.
# Most useful: 1 (herb), 13/15/16/20/21/23/66 (books), 26/35/36 (dairy),
# 30…34 (bottles), 80/89/91/96/98/102 (newer material palette/scale).
# Reuse existing greys, greens, golds and pinks. Keep 3–5 material colors,
# 4–6 finished/book colors, binary alpha, integer geometry, upper-left light.

icon(103, '砂糖', '素材・中間素材', '白い結晶ののぞく小さな砂糖の山',
     dict(D='#868E9E', M='#CEDEEA', L='#E6EEFF', H='#FFFFFF'), '''
......LL.....
.....LHL.....
...L.LHLM....
..LHLLHLMM...
.LLHLLLMLMM..
.LHLMLMLLLMM.
LLHLMLLLMLMMD
LMLLLMLMLMMMD
.MMMMMMMMMMD.
..DDDDDDDDD..
''')

icon(104, '香辛料', '素材・中間素材', '赤茶のさや2本と短い巻き樹皮片',
     dict(D='#501900', O='#730000', M='#B93D00', L='#DC9200', A='#966200'), '''
..L......L...
.LMO....LMO..
.MMO...LMOO..
.MOO..LMOOD..
.MO..LMOOD...
..D..MOOD....
.....OOD.....
...LLLA......
..LAAMAA.....
..LADAMAD....
...DAAMMAD...
....DDDDD....
''')

icon(105, '霊草', '素材・中間素材', '淡青緑の葉が株立ちする霊草・白い光2px',
     dict(D='#005032', O='#00734A', M='#8EFFD4', L='#D4FFF0', H='#FFFFFF'), '''
......L......
..H..LMD.....
.....LMMD....
.....LMMD.H..
.L...LMD...L.
.LMD..MD..LMD
..LMMDMD.LMMD
...LMMMDLMMD.
....LMMOMMD..
.....LOMMD...
....LOOMOD...
.....DDDD....
''')

icon(106, '香油', '素材・中間素材', '濃茶の栓の小さな角瓶・琥珀金の油',
     dict(D='#503200', O='#966200', M='#DC9200', L='#FFD48E', H='#FFFFFF'), '''
....OOD......
....LMD......
....LOD......
...LHLMOD....
..LHLLMMOD...
..LLLMMMOD...
..LLMMMMOD...
..LMMMMOOD...
..LMMOOOOD...
...DDDDDD....
''')

icon(107, 'ミノクリーム', '素材・中間素材', '器に盛った渦巻きクリーム・上へ細くなる盛り',
     dict(D='#736242', O='#B99A62', M='#F2DCA0', L='#FFF7D4', H='#FFFFFF'), '''
......L......
.....LHL.....
.....LMML....
....LHHHML...
...LHHMMMML..
...LMMLLLLL..
..LHHHHHHML..
.LLLLLLLLLLL.
.LOOOOOOOOOD.
..OMOOOOOOD..
...ODDDDDD...
''')

icon(108, '香水', '完成品（薬）', '幅広で平たい淡紫ピンクの瓶・横に出る金の噴霧口',
     dict(D='#503250', O='#966200', M='#B98EB9', L='#E6B1D4', H='#FFFFFF', A='#FFD48E'), '''
.....AAAO....
.....OAAOOO..
......AO.....
...LLLLLLL...
..LHLLLLLLMD.
.LHLLLLLLLMMD
.LMLLLLLLMMMD
.LMLLLLMMMMMD
..DMMMMMMMDD.
''')

icon(109, 'エリクシル', '完成品（薬）', '細長い緑の飾り瓶・金の口と肩飾り・白い光2px',
     dict(D='#005032', O='#00734A', M='#00B97A', L='#B1FFE2', H='#FFFFFF', A='#DC9200'), '''
.....AAA.....
.....LAD.....
.....LMD.....
...A.LMD.A...
...ALLMMAD...
...LHLMMMD...
....LHMMD....
....LMMMD....
....LMMMD....
....LMMMD....
...ALLMMAD...
....LMOOD....
.....DDD.....
''')

icon(110, 'ミノ・ジェラート', '完成品（薬）', '低いカップ・白と淡ピンクの二段スクープ',
     dict(D='#736242', O='#B99A62', M='#F2DCA0', L='#FFF7D4', H='#FFFFFF', A='#FFB1C7'), '''
....LLLL.....
...LHHHML....
..LHHHMMMD...
..LHHHMMMD...
...LMMMML....
..AAALLLL....
.LAAAAMLAAA..
.LAAAAMMLAAD.
..DOOOOOOOD..
...OOOOOOD...
....DDDDD....
''')

icon(111, 'ロイヤルチーズケーキ', '完成品（薬）', '焼き色・クリーム層・土台のケーキ一切れ、赤い実1粒と金の光1px',
     dict(D='#734A00', O='#DC9200', M='#FFD48E', L='#FFF7D4', H='#FFFFFF', A='#DC0049'), '''
........A....
..M...LOO....
....LOOOOOD..
..LOOOOOOOOD.
.LLLLLLLLLLD.
.LHLLLLLLLLD.
.LLLLLLLLLLD.
.OOOOOOOOOOD.
..DDDDDDDDD..
''')


def book(emblem):
    """13px book: colored spine/cover, dark right/bottom, one white page edge."""
    grid = [['.' for _ in range(13)] for _ in range(13)]
    for y in range(1, 12):
        for x in range(1, 11):
            grid[y][x] = 'M' if x == 1 else 'O'
        grid[y][0], grid[y][11], grid[y][12] = 'D', 'D', 'H'
    for x in range(1, 12):
        grid[0][x] = 'M' if x < 10 else 'D'
    for x in range(1, 13):
        grid[12][x] = 'D'
    for y, row in enumerate(emblem.strip('\n').splitlines()):
        for x, key in enumerate(row):
            if key != '.':
                grid[y+3][x+3] = key
    return [''.join(row) for row in grid]


icon(112, '調香の手引き', '本', '深紫の表紙・金色の平たい香水瓶紋章・白い小口',
     dict(D='#321950', O='#500073', M='#734A96', A='#DC9200', L='#FFD48E', H='#F2F2F2'), book('''
..LLL..
..AAL..
...L...
.LLLLL.
LLLLLLL
LAAAAAL
.AAAAA.
'''))

icon(113, '乳菓のレシピ', '本', 'クリーム色の表紙・茶色と白のケーキ紋章・赤い実1粒',
     dict(D='#736242', O='#F2DCA0', M='#FFF7D4', A='#B97A00', L='#DC0049', H='#F2F2F2'), book('''
....L..
...AA..
..AAAA.
.AAAAAA
HHHHHHA
HHHHHHA
AAAAAAA
'''))


def flat(im):
    return list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate(out):
    out.mkdir(parents=True, exist_ok=True)
    assert [it['number'] for it in ART] == list(range(103, 114))
    entries = []
    for it in ART:
        rows, palette = it['rows'], it['palette']
        width, height = max(map(len, rows)), len(rows)
        assert width <= 13 and height <= 13, (it['number'], width, height)
        im = Image.new('RGBA', (16,16), (0,0,0,0))
        for y, row in enumerate(rows):
            for x, key in enumerate(row):
                if key != '.':
                    im.putpixel((x,y), (*bytes.fromhex(palette[key][1:]),255))
        motif = im.crop(im.getbbox())
        im = Image.new('RGBA', (16,16), (0,0,0,0))
        im.paste(motif, ((16-motif.width)//2, (16-motif.height)//2))
        filename = f"item-no-{it['number']}.png"
        path = out/filename
        im.save(path, optimize=False)
        with Image.open(path) as saved:
            saved.load()
            assert saved.format == 'PNG' and saved.mode == 'RGBA' and saved.size == (16,16)
            assert saved.tobytes() == im.tobytes()
            assert set(flat(saved.getchannel('A'))) == {0,255}
            colors = sorted({'#%02X%02X%02X'%c[:3] for c in flat(saved) if c[3]})
            assert set(colors) == set(palette.values()), (it['number'], 'unused palette entries')
            assert 3 <= len(colors) <= (5 if it['number'] <= 107 else 6)
            assert all(c == (0,0,0,0) for c in flat(saved) if c[3] == 0)
            bbox = saved.getbbox()
            assert abs(bbox[0]+bbox[2]-16) <= 1 and abs(bbox[1]+bbox[3]-16) <= 1
        entries.append(dict(number=it['number'], provisional_number=True, name=it['name'],
                            category=it['category'], motif=it['motif'], file=filename,
                            colors_hex=colors, size=[16,16], mode='RGBA',
                            alpha_values=[0,255], occupied_bbox_xyxy=list(bbox), sha256=sha256(path)))

    # Preview is assembled from REOPENED production PNGs. Checkerboard is not
    # part of the production icons. Each 16px icon becomes exactly 128px.
    cols, cw, ch = 6, 152, 168
    preview = Image.new('RGB', (cols*cw,2*ch), '#EEECE6')
    d = ImageDraw.Draw(preview)
    for k, it in enumerate(entries):
        x,y = k%cols*cw+12, k//cols*ch+24
        for cy in range(0,128,8):
            for cx in range(0,128,8):
                d.rectangle((x+cx,y+cy,x+cx+7,y+cy+7),fill='#F7F7F2' if (cx//8+cy//8)%2==0 else '#DEDCD4')
        with Image.open(out/it['file']) as saved:
            enlarged = saved.resize((128,128), Image.Resampling.NEAREST)
            preview.paste(enlarged,(x,y),enlarged)
        d.text((x,y-17),str(it['number']),font=ImageFont.load_default(),fill='#323232')
    preview.save(out/'preview.png')
    mapping = dict(title='SOLD OUT for Muse v0.3.0 新規アイコン11種',
                   number_status='103〜113はPR #19の仮番号です。名称も設計段階の仮名です。',
                   authoring='Python + Pillow; explicit integer pixel maps; no AI image assets',
                   canvas=[16,16], lighting='左上', background='完全透過。床影・枠・台座なし。',
                   reference='PR #19 head 6608cf5cb816e5ba4d435f227edd27e03e368c40: public/images/item-no-1.png through item-no-102.png. Inspected at 1x and nearest-neighbor 8x.',
                   preview='番号順・横6列、各アイコンを最近傍8倍の128×128pxに拡大。背景チェックはプレビュー専用。',
                   regenerate='python generate_icons.py --out ./regenerated', icons=entries)
    (out/'mapping.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    md = ['# SOLD OUT for Muse v0.3.0 新規アイコン11種','',
          '**103〜113はPR #19の仮番号です。名称も設計段階の仮名です。**','',
          '全11枚: 16×16px / RGBA PNG / 背景完全透過 / 左上光源 / 1px単位の描画。',
          '素材・中間素材は3〜5色、完成品・本は4〜6色。アルファは0/255のみ、アンチエイリアスなし。','',
          '| 仮番号 | 名前 | モチーフ | 使用色HEX（透明色を除く） |','| --- | --- | --- | --- |']
    md += [f"| {it['number']} | {it['name']} | {it['motif']} | {', '.join(it['colors_hex'])} |" for it in entries]
    md += ['', '## 参照・見分け','',
           'PR #19の既存1〜102番すべてを等倍・最近傍8倍で確認。実際の場所は `public/images/`。既存ファイルは改変していません。',
           '特に薬草1、本13/15/16/20/21/23/66、乳製品26/35/36、瓶30〜34、素材80/89/91/96/98/102を参照しました。',
           '- 霊草: 淡青緑・株立ち・白い光2px。既存の濃緑の薬草と区別。',
           '- 瓶: 香油は小さな琥珀金の角瓶、香水は横長の平たい瓶と噴霧口、エリクシルは細長い緑の飾り瓶。',
           '- 乳製品: クリームは渦巻き、ジェラートは白と淡ピンクの二段スクープ、チーズケーキは焼き面とクリームの層。',
           '- 本: 調香は深紫と金の瓶、乳菓はクリーム色と茶・赤のケーキ紋章。','',
           '## 再生成','', '```sh','python -m pip install Pillow','python generate_icons.py --out ./regenerated','```','',
           'スクリプト内の1文字が1ピクセル、`.` は透明です。本の地は整数座標で描画しています。',
           '保存後のPNGを読み直して、寸法・RGBA・アルファ・色数・元ピクセルとの一致を検証します。',
           '`mapping.json` に占有範囲と各PNGのSHA-256を記録しています。',
           '`preview.png` は各16pxアイコンを最近傍法で8倍にした番号順の一覧です。','',
           'リポジトリではPNG11枚を `public/images/` に配置し、対応表・一覧・このスクリプトは `docs/v030-icons/` に配置します。',
           'ゲームのコード・データ・既存アイコン・本番環境は変更対象外です。','']
    (out/'mapping.md').write_text('\n'.join(md),encoding='utf-8')
    print('PASS: 11/11 saved icons — 16x16 RGBA PNG, alpha {0,255}, centered, palette limits, lossless reopen.')
    for it in entries:
        print(it['number'],it['name'],len(it['colors_hex']),'colors',it['occupied_bbox_xyxy'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parent)
    generate(parser.parse_args().out)
