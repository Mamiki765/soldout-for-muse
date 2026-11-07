# $Id: inc-html-ranking.cgi 96 2004-03-12 12:25:28Z mu $

my ($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{pg},($MYNAME eq 'index.cgi' ?$TOP_RANKING_PAGE_ROWS:$RANKING_PAGE_ROWS),$DTusercount);

$disp.="●ランキング<HR>";
$disp.="人口:".int($DTpeople/10)."<BR>";

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);
$disp.=$pagecontrol."<BR>";

$disp.=$TB;

if(!$MOBILE)
{
	$disp.=$TR;
	$disp.=$TDNW."順位<BR><SMALL>(前期比)</SMALL><br>点数";
	$disp.=$TDNW.$SHOP_ICON_HEADER if $SHOP_ICON_HEADER && !$MOBILE;
	$disp.=$TDNW."店名<BR>人気";
	$disp.=$TDNW."今期売上";
	$disp.=$TDNW."資金<BR>前期売上";
	$disp.=$TDNW."前期<BR>維持費<BR>税金";
	$disp.=$TD."取扱商品　一押商品<BR>【熟練度合計】【創業】 コメント";
	$disp.=$TRE;
}
else
{
	$tdh_rk="RANK:";
	$tdh_pt="点数:";
	$tdh_nm="店名:";
	$tdh_pp="人気:";
	$tdh_mo="資金:";
	$tdh_ts="本売:";
	$tdh_ys="昨売:";
	$tdh_cs="維持:";
	$tdh_sc="一押:";
	$tdh_cm="一言:";
	$tdh_tx="昨税:";
	$tdh_ex="熟練:";
	$tdh_fd="創業:";
}

foreach my $idx ($pagestart..$pageend)
{
	my $DT=$DT[$idx];
	
	my $rankupdown="";
	if($DT->{rankingyesterday})
	{
		$rankupdown=$DT->{rankingyesterday}-$idx-1;
		$rankupdown=$rankupdown==0 ? "→": $rankupdown<0 ? "↓".(-$rankupdown) : "↑".$rankupdown;
		$rankupdown="<small>($rankupdown)</small>";
	}
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
	my $itemno=$DT->{showcase}[0];
	$salelist.=" ".$ITEM[$itemno]->{name}." \\".$DT->{price}[0] if $itemno;
	
	my $expsum=0;
	foreach(values(%{$DT->{exp}})){$expsum+=$_;}
	$expsum="【".int($expsum/10)."%】";
	
	my $job=$JOBTYPE{$DT->{job}};
	$job="【$job】" if $job;
	
	$disp.=$TR;
	$disp.=$TDNW.$tdh_rk."<b>".($idx+1)."</b>".$rankupdown."<br>";
	$disp.=    $tdh_pt.$DT->{point};
	$disp.=$TD.GetTagImgShopIcon($DT->{icon}) if $SHOP_ICON_HEADER && !$MOBILE;
	$disp.=$TD.$tdh_nm;
	$disp.=    "<a href=\"shop.cgi?ds=$DT->{id}&$USERPASSURL\">" if !$GUEST_USER;
	$disp.=    GetTagImgGuild($DT->{guild}).$itempro.$job.$DT->{shopname}."[".$DT->{name}."]";
	$disp.=    "</a>" if !$GUEST_USER;
	$disp.=GetTopCountImage($DT->{rankingcount}+0) if $DT->{rankingcount};
	$disp.="<BR>";
	$disp.=    $tdh_pp.GetRankMessage($DT->{rank});
	$disp.=$TDNW.$tdh_ts."\\".$DT->{saletoday};
	$disp.=$TDNW.$tdh_mo.GetMoneyMessage($DT->{money})."<BR>";
	$disp.=    $tdh_ys."\\".$DT->{saleyesterday};
	$disp.=$TDNW.$tdh_cs."\\".($DT->{costyesterday}+0)."<br>";
	$disp.=    $tdh_tx."\\".($DT->{taxyesterday}+0);
	
	$disp.=$TD;
	
	$disp.=$tdh_sc.$salelist;
	
	$disp.="<BR>";
	
	$disp.=$tdh_ex.$expsum;
	$disp.=$tdh_fd."【".GetTime2HMS($NOW_TIME-$DT->{foundation})."】";
	$disp.=$tdh_cm.$DT->{comment} if $DT->{comment};
	$disp.=$TRE;
}
$disp.=$TBE;

$disp.=$pagecontrol;
1;
