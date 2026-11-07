# $Id: inc-html-shop-master.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $DTS=GetWholeStore();

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{pg},$LIST_PAGE_ROWS,$DTS->{showcasecount});


$disp.="●市場<HR>";

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);
$disp.=$pagecontrol;

my $itemno;
my $ITEM;
$disp.=$TB;
foreach my $i ($pagestart..$pageend)
{
	$itemno=$DTS->{showcase}[$i];
	$ITEM=$ITEM[$itemno];
	next if !$itemno || !$ITEM->{code};
	
	$disp.=$TR.$TD;
	$disp.="<A HREF=\"buy.cgi?buy=0!$i!$itemno&bk=m!$page&$USERPASSURL\">" if !$GUEST_USER;
	$disp.=GetTagImgItemType($itemno).$ITEM->{name};
	$disp.="</A>" if !$GUEST_USER;
	$disp.=$TD."\@\\".$DTS->{price}[$i].$TD."残".$DTS->{item}[$itemno-1].$ITEM->{scale};
	$disp.=$TD.$DT->{item}[$itemno-1].$ITEM->{scale}."所持" if $DT->{item}[$itemno-1];
	$disp.=$TRE;
}
$disp.=$TBE;

$disp.=$pagecontrol;

1;
