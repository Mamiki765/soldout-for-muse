# $Id: inc-html-box-tradein.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="●貿易(輸入手続き)<HR>";

CheckTradeProcess();

my %itemcode2idx=();
foreach(0..$MAX_ITEM){$itemcode2idx{$ITEM[$_]->{code}}=$_;}
my($hostcode,$boxno,$itemcode,$itemcnt,$price)=split(/!/,$Q{tradein});
my $itemno=$itemcode2idx{$itemcode};

if($Q{ng} eq '')
{
	$disp.=<<"HTML";
	輸入手続き確認<hr>
	商品名：$ITEM[$itemno]->{name}<br>
	数量：$itemcnt$ITEM[$itemno]->{scale}<br>
	代金額：\\$price<br>
	消費時間：${\GetTime2HMS(GetTimeDeal($price,$itemno,$itemcnt))}<br>
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=tradein VALUE="$Q{tradein}">
	<INPUT TYPE=SUBMIT NAME=ok VALUE="手続き実行">
	<INPUT TYPE=SUBMIT NAME=ng VALUE="中止">
	</FORM>
	※代金前払いで、時間も手続きと同時に消費されます。取引に失敗した場合は全額/全時間戻ってきます。
HTML
}
else
{
	$disp.="輸入手続きを中止しました";
}
1;
