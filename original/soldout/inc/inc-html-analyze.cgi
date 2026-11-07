# $Id: inc-html-analyze.cgi 96 2004-03-12 12:25:28Z mu $

$disp.="●市場分析<HR>";

# 需要/供給バランス計算
GetMarketStatus();

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{pg},$LIST_PAGE_ROWS,scalar(keys(%marketitemlist)));

$disp.=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);

$disp.=$TB;
$disp.=$TR;
$disp.=$TD.'商品名';
$disp.=$TD.'今期の<br>総売上数';
$disp.=$TD.'前期の<br>総売上数';
$disp.=$TD.'販売価格<br>相場';
$disp.=$TD.'需要供給バランス<br>';
$disp.=$TRE;
foreach my $ITEM ((sort{$a->{sort} <=> $b->{sort}} values(%marketitemlist))[$pagestart..$pageend])
{
	my $itemno=$ITEM->{no};
	$disp.=$TR;
	$disp.=$TDNW.GetTagImgItemType($itemno).$ITEM->{name};
	$disp.=$TDNW.$ITEM->{todaysale};
	$disp.=$TDNW.$ITEM->{yesterdaysale};
	$disp.=$TDNW.($ITEM->{marketprice} ? "\\".$ITEM->{marketprice} : ($MOBILE?'0':' '));
	$disp.=$TDNW.GetMarketStatusGraph($ITEM->{uppoint});
	#$disp.=$TDNW.$todaystock{$itemno};
	$disp.=$TRE;
}
$disp.=$TBE;
1;
