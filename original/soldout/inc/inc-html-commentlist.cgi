# $Id: inc-html-commentlist.cgi 96 2004-03-12 12:25:28Z mu $

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{pg},$LIST_PAGE_ROWS,$DTusercount);

$disp.="●コメント一覧<HR>";

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);

$disp.=$pagecontrol."<BR>";

$disp.=$TB;
foreach my $idx ($pagestart..$pageend)
{
	my $DT=$DT[$idx];
	
	my $itemtype=-1;
	my $itempro="";
	my $salelist="";
	foreach my $no (@{$DT->{showcase}})
	{
		$salelist.=GetTagImgItemType($no);
		$itemtype=0,next if $itemtype!=-1 && $ITEM[$no]->{type}!=$itemtype;
		$itemtype=$ITEM[$no]->{type};
	}
	$itempro=GetTagImgItemType(0,$itemtype,1)." " if $itemtype;
	
	$disp.=$TR.$TD."RANK".($idx+1).$TD;
	$disp.="<a href=\"shop.cgi?ds=$DT->{id}&$USERPASSURL\">" if !$GUEST_USER;
	$disp.=GetTagImgGuild($DT->{guild}).$DT->{shopname};
	$disp.="</a>" if !$GUEST_USER;
	$disp.=$TD.$DT->{name}.$TD.$DT->{comment}.$TD.$itempro.$TD.$salelist.$TRE;
	$disp.="<hr size=\"1\">" if $MOBILE;
}
$disp.=$TBE;

$disp.=$pagecontrol;
1;
