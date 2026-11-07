# $Id: inc-html-owner.cgi 96 2004-03-12 12:25:28Z mu $

$disp.="●店舗情報<HR>";
$disp.='未入店自動閉店期限:'.GetTime2FormatTime($DT->{lastlogin}+$EXPIRE_TIME+GetExpireTimeExtend($DT)).'<br>';
my $tm=$NOW_TIME-$DT->{time};
if($tm<0)
{
	$tm=-$tm;
	$tm='行動可能まであと '.GetTime2HMS($tm);
}else{
	if($tm>$MAX_STOCK_TIME){$tm=$MAX_STOCK_TIME;}
	$tm=GetTime2HMS($tm);
}
my $rankmsg=GetRankMessage($DT->{rank});
my($tax,$taxrate)=GetTaxToday($DT);
if($taxrate)
{
	$taxrate="税率:$taxrate\%";
}else{
	$taxrate="免税";
}

my $expsum=0;
foreach(values(%{$DT->{exp}})){$expsum+=$_;}
$expsum=int($expsum/10)."%";
my $job=$JOBTYPE{$DT->{job}}; $job||='不定';

if(!$MOBILE)
{
	$disp.=$TB;
	$disp.=$TR.$TD."名前".$TD.$DT->{name}.$TD."店名".$TD.GetTagImgGuild($DT->{guild}).$DT->{shopname}.$TRE;
	$disp.=$TR.$TD."RANK".$TD.($id2idx{$DT->{id}}+1).$TD."TOP".$TD.($DT->{rankingcount}+0)."回 ".GetTopCountImage($DT->{rankingcount}+0).$TRE;
	$disp.=$TR.$TD."人気".$TD.$rankmsg.$TD."資金/入金庫".$TD."\\".$DT->{money}."/\\".$DT->{moneystock}.$TRE;
	$disp.=$TR.$TD."今期売上".$TD."\\".$DT->{saletoday}.$TD."前期売上".$TD."\\".$DT->{saleyesterday}.$TRE;
	$disp.=$TR.$TD."今期支払".$TD."\\".$DT->{paytoday}.$TD."前期支払".$TD."\\".$DT->{payyesterday}.$TRE;
	$disp.=$TR.$TD."持ち時間".$TD.$tm.$TD."点数".$TD.$DT->{point}.$TRE;
	$disp.=$TR.$TD."今期維持費<BR><SMALL>(決算時徴収)</SMALL>".$TD."\\".int($DT->{costtoday})."+\\".$SHOWCASE_COST[$DT->{showcasecount}-1];
	$disp.=    $TD."前期維持費".$TD."\\".$DT->{costyesterday}.$TRE;
	$disp.=$TR.$TD."今期税金<BR><SMALL>(決算時徴収)</SMALL>".$TD."\\".$tax."<br><small>$taxrate</small>".$TD."前期税金".$TD."\\".($DT->{taxyesterday}+0).$TRE;
	$disp.=$TR.$TD."支払済売却税".$TD."\\".($DT->{taxtoday}+0).$TD."基本売却税率".$TD.GetUserTaxRate($DT).'%'.$TRE;
	$disp.=$TR.$TD."熟練度合計".$TD.$expsum;
	$disp.=    $GUILD{$DT->{guild}} ? $TD."ギルド会費 <SMALL>売上の".($GUILD{$DT->{guild}}->[$GUILDIDX_feerate]/10)."%<br>(決算時徴収)</SMALL>".$TD.'\\'.int($DT->{saletoday}*$GUILD{$DT->{guild}}->[$GUILDIDX_feerate]/1000) : $TD."　".$TD."　";
	$disp.=  $TRE;
	$disp.=$TR.$TD.'創業'.$TD.GetTime2HMS($NOW_TIME-$DT->{foundation}).$TD.'職業'.$TD.$job.$TRE;
	$disp.=$TBE;
}
else
{
	$disp.="名前:".$DT->{name}."<BR>";
	$disp.="店名:".GetTagImgGuild($DT->{guild}).$DT->{shopname}."<BR>";
	$disp.="RANK:".($id2idx{$DT->{id}}+1)."<BR>";
	$disp.="TOP :".($DT->{rankingcount}+0)."回<BR>";
	$disp.="人気:".$rankmsg."<BR>";
	$disp.="資金:"."\\".$DT->{money}."<BR>";
	$disp.="入金:"."\\".$DT->{moneystock}."<BR>";
	$disp.="今売:"."\\".$DT->{saletoday}."<BR>";
	$disp.="会費:"."\\".int($DT->{saletoday}*$GUILD{$DT->{guild}}->[$GUILDIDX_feerate]/1000)."<BR>" if $DT->{guild} ne '';
	$disp.="前売:"."\\".$DT->{saleyesterday}."<BR>";
	$disp.="今払:"."\\".$DT->{paytoday}."<BR>";
	$disp.="前払:"."\\".$DT->{payyesterday}."<BR>";
	$disp.="今維:"."\\".int($DT->{costtoday})."+\\".$SHOWCASE_COST[$DT->{showcasecount}-1]."<BR>";
	$disp.="前維:"."\\".$DT->{costyesterday}."<BR>";
	$disp.="済税:"."\\".($DT->{taxtoday}+0)."<BR>";
	$disp.="今税:"."\\".$tax."(".$taxrate.")<BR>";
	$disp.="前税:"."\\".($DT->{taxyesterday}+0)."<BR>";
	$disp.="時間:".$tm."<BR>";
	$disp.="点数:".$DT->{point}."<BR>";
	$disp.="熟練:".$expsum."<BR>";
	$disp.="創業:".GetTime2HMS($NOW_TIME-$DT->{foundation})."<BR>";
	$disp.="職業:".$job."<BR>";
}

1;
