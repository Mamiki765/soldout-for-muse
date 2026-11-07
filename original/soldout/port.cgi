#! /usr/local/bin/perl
# $Id: port.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
OutError('使用不可です') if !$USE_PORT;

GetQuery();
$NOMENU=1;
$disp.="SOLD OUT 関連の外部サイトです。携帯端末での閲覧は不可です。<BR><BR>";
#$disp.="<a href=\"http://urakanda.virtualave.net/\">月光江戸村 (オークション)</a><BR>";

#
# 外部メニューを有効にするには、_config.cgi の設定が必要です。
#
# $disp へHTMLを追加すると、独自の外部メニューが構築できます。
# この外部メニューからのリンクであれば、セッション情報等が外部サイトへ漏れません。
#

OutHTML('外部',$disp);

exit;
