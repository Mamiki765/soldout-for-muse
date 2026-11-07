# $Id: inc-html-shop.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax);

if($Q{ds}!=0)
{
	my($id,$idx)=CheckUserID($Q{ds});
	($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)=
		(0,$idx,$idx,0,0,0)
}
else
{
	($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)=
		GetPage($Q{pg},$SHOP_PAGE_ROWS,$DTusercount);
}

$disp.="●他店";
$disp.="<HR SIZE=\"1\">";

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);
$disp.=$pagecontrol."<HR SIZE=\"1\">" if $pagecontrol ne '';

foreach my $cnt ($pagestart .. $pageend)
{
	my $DT=$DT[$cnt];
	next if !$DT->{status};
	
	$disp.="RANK ".($cnt+1)." ";
	$disp.="<BR>" if $MOBILE;
	$disp.=GetTagImgGuild($DT->{guild})." ".$DT->{shopname}."<BR>";
	$disp.="一言:$DT->{comment}<BR>" if $DT->{comment};
	
	$disp.=$TB;
	foreach my $idx (0..$DT->{showcasecount}-1)
	{
		my $itemno=$DT->{showcase}[$idx];
		if($itemno)
		{
			my $ITEM=$ITEM[$itemno];
			my $nobuy=CheckItemFlag($itemno,'nobuy');
			$stock=$DT->{item}[$itemno-1];
			$disp.=$TR.$TD;
			$disp.="<A HREF=\"buy.cgi?buy=$DT->{id}!$idx!$itemno&bk=p!$page&$USERPASSURL\">" if $stock && !$GUEST_USER && !$nobuy;
			$disp.=GetTagImgItemType($itemno).$ITEM->{name};
			$disp.='(購入不可)' if $nobuy;
			$disp.="</A>" if $stock && !$GUEST_USER && !$nobuy;
			$disp.=$TD."\@\\".$DT->{price}[$idx];
			my $msg=$stock ? "残".$stock.$ITEM->{scale} : "SOLD OUT";
			$disp.=$TD.$msg;
			$disp.=$TD.($DT->{itemtoday}{$itemno}+0).$ITEM->{scale}."売上";
			$disp.=$TRE;
		}
	}
	$disp.=$TBE;
	$disp.="<HR SIZE=1>";
}

$disp.=$pagecontrol;

1;
