# $Id: inc-html-moneystock.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="●入金処理<HR>";

if($Q{conf}ne'' && $errormsg eq '' && $money>0 && $money<=$DT->{moneystock})
{
	$disp.="入金額：\\".$money."<br>消費時間 ".GetTime2HMS(GetTimeDeal($money))."<br>";
	$disp.=<<"HTML";
	<FORM ACTION="moneystock.cgi" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=money VALUE="$money">
	<INPUT TYPE=SUBMIT NAME=ok VALUE="入金受理">
	<INPUT TYPE=SUBMIT VALUE="取り消し">
	</FORM>
HTML
}
else
{
	my $maxmoney=$DT->{moneystock};
	my $usetime=GetTimeDeal($maxmoney)-$TIME_SEND_MONEY;
	my $stocktime=GetStockTime($DT->{time})-$TIME_SEND_MONEY;
	$maxmoney=0 if $stocktime<0;
	$maxmoney=int($maxmoney/$usetime*$stocktime) if $usetime>0 && $stocktime>0 && $stocktime<$usetime;

	$disp.=<<"HTML";
	<FORM ACTION="moneystock.cgi" $METHOD>
	$USERPASSFORM$errormsg
	入金庫から引き出す金額
	<INPUT TYPE=TEXT NAME=money SIZE=10 VALUE="$money">
	<INPUT TYPE=HIDDEN NAME=conf VALUE="conf">
	<INPUT TYPE=SUBMIT VALUE="金額決定">
	</FORM>
	<FORM ACTION="moneystock.cgi" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=money VALUE="$maxmoney">
	<INPUT TYPE=HIDDEN NAME=conf VALUE="conf">
	<INPUT TYPE=SUBMIT VALUE="最大額指定">
	</FORM>
HTML
	$disp.="(消費時間:".GetTime2HMS($TIME_SEND_MONEY)."＋\\$TIME_SEND_MONEY_PLUSにつき".GetTime2HMS($TIME_SEND_MONEY).")";
}
1;
