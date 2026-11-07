#! /usr/local/bin/perl
# $Id: buy.cgi 96 2004-03-12 12:25:28Z mu $

$NOMENU=1;
require './_base.cgi';

GetQuery();

DataRead();
CheckUserPass();

($id,$showcase,$mstno)=split('!',$Q{buy},3);
$id=int($id+0);
$showcase=int($showcase+0);

if($id==0)
{
	# 市場
	$DTS=GetWholeStore();
}
else
{
	# 一般店
	$DTS=$DT[(CheckUserID($id))[1]];
}

$showcase=CheckShowCaseNumber($DTS,$showcase);
($itemno,$price,$stock)=CheckShowCaseItem($DTS,$showcase);

OutError("陳列棚には何もありません") if !$itemno || !$stock;
OutError("陳列が変化したようです") if $itemno!=$mstno;
OutError('この商品は購入不可です') if $id && CheckItemFlag($itemno,'nobuy');

RequireFile('inc-html-ownerinfo.cgi');
RequireFile('inc-html-buy.cgi');

OutHTML(($id==0?'市場':$DTS->{shopname}).'より仕入',$disp);

exit;
