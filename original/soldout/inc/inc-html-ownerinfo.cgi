# $Id: inc-html-ownerinfo.cgi 96 2004-03-12 12:25:28Z mu $

if(!$GUEST_USER)
{
	my $tm=$NOW_TIME-$DT->{time};
	if($tm<0)
	{
		$tm=-$tm;
		$tm='行動可能まであと '.GetTime2HMS($tm);
	}
	else
	{
		$tm=$MAX_STOCK_TIME if $tm>$MAX_STOCK_TIME;
		$tm=GetTime2HMS($tm);
	}
	my $rankmsg=GetRankMessage($DT->{rank});
	
	$disp.=<<STR;
	●店舗情報<BR>
	$TB$TR
	$TD
	RANK ${\($id2idx{$DT->{id}}+1)}$TDE
	$TD店名:$DT->{shopname}$TDE
	$TD資金:\\$DT->{money}$TDE
	$TD入金庫:\\$DT->{moneystock}$TDE
	$TD時間:$tm$TDE
	$TRE$TBE
	<HR SIZE=1>
STR
}
1;
