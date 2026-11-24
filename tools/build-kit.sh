#!/bin/sh
# SOLD OUT for Muse — 許可証キットの zip を作って、画像の箱 (ASSETS_ROOT/kit) に置く。
# フォント (しっぽり明朝 B1 ExtraBold、SIL OFL 1.1) は重いのでリポジトリに入れず、ここで取ってくる。
# 使い方 (VM で): ASSETS_ROOT=/srv/bot-assets/soldout sh tools/build-kit.sh
# This program is free software under the GNU GPL v2 or later. See LICENSE.
set -eu
cd "$(dirname "$0")/.."
ASSETS_ROOT="${ASSETS_ROOT:?ASSETS_ROOT (画像の箱のフォルダ) を指定してください}"
VERSION=1.5.0
FONT_BASE=https://raw.githubusercontent.com/google/fonts/main/ofl/shipporiminchob1
OUT="$ASSETS_ROOT/kit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/soldout-kit/fonts" "$WORK/soldout-kit/frames" "$OUT/frames"
curl -fsSL -o "$WORK/soldout-kit/fonts/ShipporiMinchoB1-ExtraBold.ttf" "$FONT_BASE/ShipporiMinchoB1-ExtraBold.ttf"
curl -fsSL -o "$WORK/soldout-kit/fonts/OFL-ShipporiMinchoB1.txt" "$FONT_BASE/OFL.txt"
cp kit/README.md kit/UI-GUIDE.md kit/space-sample.html kit/make_license.py kit/license.js "$WORK/soldout-kit/"
cp kit/frames/* "$WORK/soldout-kit/frames/"
# アイテムのアイコン (16×16。item-no-品番.png、無い品は item-type分類.png)
mkdir -p "$WORK/soldout-kit/items" && cp public/images/item-*.png "$WORK/soldout-kit/items/"
# 街の地図 (1.4.0 の見本): 絵と、観戦画面と同じ組み立て・描画のスクリプトと、スペースで描く見本
mkdir -p "$WORK/soldout-kit/town"
cp kit/town/README.md kit/town/town-sample.html kit/town/pan-zoom.js kit/town/tileset-v1.js kit/town/tileset-v1.json kit/town/*.png public/town/town-gen.js public/town/tiles.js "$WORK/soldout-kit/town/"
(cd "$WORK" && zip -qr "soldout-kit-$VERSION.zip" soldout-kit)

# 配る場所: zip と、ばらの枠・スクリプト・フォント (スペースのブラウザから直接読めるように)
cp "$WORK/soldout-kit-$VERSION.zip" "$OUT/"
cp kit/frames/* "$OUT/frames/"
cp kit/README.md kit/UI-GUIDE.md kit/make_license.py kit/license.js "$WORK/soldout-kit/fonts/"* "$OUT/"   # 見本の HTML は zip の中だけ (assets から HTML は配らない)
# 街の絵とスクリプトもばらで (スペースから直接読めるように。HTML は zip の中だけ)
mkdir -p "$OUT/town" && cp kit/town/pan-zoom.js kit/town/tileset-v1.js kit/town/tileset-v1.json kit/town/*.png public/town/town-gen.js public/town/tiles.js "$OUT/town/"
ls -la "$OUT" "$OUT/frames" "$OUT/town"
