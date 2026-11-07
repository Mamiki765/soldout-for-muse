# $Id: inc-html-box.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $expiretime=$NOW_TIME-$BOX_STOCK_TIME; #$BOX_STOCK_TIME経過で期限切れ扱い
my $usertaxrate=GetUserTaxRate($DT);
my $sitetaxrate=GetTradeTaxRate();

$disp.="●郵便箱<HR>";

$disp.="読んだらすぐに返答をしましょう。返答しないと相手に迷惑がかかります。<HR>";

$disp.="<DIV ALIGN=right><a href=\"box-edit.cgi?$USERPASSURL&reset=0\"><SMALL>受信数リセット</SMALL></a></DIV>" if $DT->{boxcount}<0;
$disp.="<a href=\"box-edit.cgi?$USERPASSURL&cmd=newmail\">[メッセージ送信]</a><BR>";
$disp.="<a href=\"box-edit.cgi?$USERPASSURL&cmd=newmoney\">[送金]</a><BR>";
$disp.="<a href=\"box-edit.cgi?$USERPASSURL&cmd=newitem\">[商品送付]</a><BR>";

my @BOX=(@INBOX,@OUTBOX,@RETBOX);
chop @BOX;

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{lpg},int($LIST_PAGE_ROWS/2),scalar(@BOX));

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","lpg",$pagemax,$page);
$disp.=$pagecontrol;

$disp.="<BR>";
#$disp.=$TB if !$MOBILE;
$disp.="<HR SIZE=\"1\">";

foreach my $cnt ($pagestart..$pageend)
{
	my $box=$BOX[$cnt];
	my($no,$from,$to,$flag,$modtime,$cmd,$time,$price,$data,$msg)=split(/,/,$box);
	$main::no=$no;

	my($sendrecv,$sname,$name);
	($sendrecvmode,$sname,$name)=(1,GetID2UserName($from)) if $DT->{id}==$to;
	($sendrecvmode,$sname,$name)=(0,GetID2UserName($to  )) if $DT->{id}==$from;
	$name="($name)" if $name ne '';
	my $fmttime=GetTime2FormatTime($time);
	
	my $cmdname=$CMDLIST[$cmd];
	
	my($itemno,$itemcount,$trademode,$hostcode,$boxno,$shopname,$hostname,$shopmsg);
	($itemno,$itemcount)=split(/!/,$data) if $cmd==$CMD_ITEM;
	($itemno,$itemcount,$trademode,$hostcode,$boxno,$shopname,$hostname,$shopmsg)=split(/!/,$data,6),($shopname,$hostname,$shopmsg)=($shopname=~/^(.*)!([^!]*)!([^!]*)$/) if $cmd==$CMD_TRADE;
	my $ITEM=$ITEM[$itemno],my($taxrate,$tax)=GetSaleTax($itemno,$itemcount,$price,$usertaxrate+($cmd==$CMD_TRADE?$sitetaxrate:0)) if $cmd==$CMD_ITEM || $cmd==$CMD_TRADE;
	$shopmsg=EscapeHTML($shopmsg);
	
	my $yesno=$flag & $FLAG_RETURN_YESNO ? "はい" : "いいえ";
	my $workflag_pay =$flag & $FLAG_PAY;
	my $workflag_read=$flag & $FLAG_TO_READ;
	my $workflag_expire=$modtime<$expiretime;
	
	my $returnmail="<a href=\"box-edit.cgi?$USERPASSURL&cmd=newmail&sendmail=".($DT->{id}==$to?$from:$to)."\">メッセージ返信</a>" if $cmd!=$CMD_TRADE;
	
	$disp.=GetTagDelete(($workflag_read?'削除':'強制削除'))."：" if ($workflag_read || $workflag_expire) && $sendrecvmode==0;
	$disp.=$SENDRECV[$sendrecvmode]."：".$fmttime."：".$sname.$name."：".$cmdname."：".$returnmail."<BR>";
	my $ret="";
	if($sendrecvmode==0)
	{
		if($cmd==$CMD_MAIL)
		{
			$ret.="タイトル：".$data."<BR>";
			$ret.="内容：".$msg."<BR>";
			$ret.="情報料：\\".$price."<BR>"   if $price;
			$ret.="受け取り拒否されました<BR>" if $workflag_read && $price && !$workflag_pay;
			$ret.="\\$price入金しました<BR>"   if $price && $workflag_pay;
			$ret.="返事が届いています：返答は「".$yesno."」です" if $workflag_read && (!$price || ($price && $workflag_pay));
		}
		if($cmd==$CMD_MONEY)
		{
			$ret.="タイトル：".$data."<BR>";
			$ret.="内容：".$msg."<BR>";
			$ret.="送金額：\\".$price."<BR>";
			$ret.="\\$price受け取られました<BR>" if $workflag_pay;
			$ret.="受け取りを断られました<BR>"   if !$workflag_pay && $workflag_read;
		}
		if($cmd==$CMD_ITEM)
		{
			$ret.=$ITEM->{name}." ".$itemcount.$ITEM->{scale}."<BR>";
			$ret.="内容：".$msg."<BR>";
			$ret.="代金：\\".$price."　売却税：\\".$tax."　税率：".$taxrate."%<BR>" if $price;
			$ret.="予\想受取時間：".GetTime2HMS(GetTimeDeal($price,$itemno,$itemcount))."<br>";
			$ret.="\\$price入金しました<BR>"       if $price && $workflag_pay;
			$ret.="商品受け取りを断られました<BR>" if $workflag_read && !$workflag_pay;
			$ret.="商品が受け取られました<BR>"     if $workflag_read && $workflag_pay;
		}
		if($cmd==$CMD_TRADE)
		{
			$ret.="<b>".($trademode ? "輸出":"輸入:$shopname:$hostname")."</b><br>";
			$ret.=$ITEM->{name}." ".$itemcount.$ITEM->{scale}."<BR>";
			$ret.="内容：".($trademode ? $msg : $shopmsg)."<BR>";
			$ret.="代金：\\".$price."　売却税：\\".$tax."　税率：".$taxrate."%<BR>" if $price &&  $trademode;
			$ret.="支払済代金：\\".$price."<BR>"                                    if $price && !$trademode;
			$ret.='予想受取時間：'.GetTime2HMS(GetTimeDeal($price,$itemno,$itemcount))."<br>" if  $trademode || !$DT->{user}{"_so_trtm_$no"};
			$ret.='消費済時間：'.  GetTime2HMS($DT->{user}{"_so_trtm_$no"})           ."<br>" if !$trademode &&  $DT->{user}{"_so_trtm_$no"};
			if($trademode) # 0:輸入 1:輸出
			{
				$ret.="商品が売れ、\\$price入金しました<BR>"       if $workflag_pay && $workflag_read;
				$ret.="商品は売れませんでした<BR>"                 if !$workflag_pay && $workflag_read;
			}
			else
			{
				$ret.="商品を受け取りました<BR>"     if $workflag_pay && $workflag_read;
				$ret.="商品を手に入れることが出来ませんでした<BR>" if !$workflag_pay && $workflag_read;
			}
		}
		$ret.="返答待ちです" if !$workflag_read;
	}
	else
	{
		$ret.='<B>保管期限が過ぎましたので削除される可能性があります</B><BR>' if !$workflag_read && $workflag_expire;
		if($cmd==$CMD_MAIL)
		{
			$ret.="タイトル：".$data."<BR>";
			$ret.="内容：".$msg."<BR>"        if $workflag_pay || !$price;
			$ret.="情報料：\\".$price."<BR>"  if $price;
			$ret.="\\$price支払いました<BR>"  if $workflag_pay;
			$ret.="情報提供を断りました<BR>"  if $price && !$workflag_pay && $workflag_read;
			$ret.="返事を送りました：返答は「".$yesno."」です" if $workflag_read && (!$price || ($price && $workflag_pay));
			$ret.="内容を見るには\\$price支払う必要があります"
				."「".GetTagAllow('支払う')."」「".GetTagDeny('見ない')."」" 
				if $price && !$workflag_pay && !$workflag_read;
			$ret.="返答を選択してください「".GetTagAllow('はい')."」「".GetTagDeny('いいえ')."」" 
				if (!$price || ($price && $workflag_pay)) && !$workflag_read;
		}
		if($cmd==$CMD_MONEY)
		{
			$ret.="タイトル：".$data."<BR>";
			$ret.="内容：".$msg."<BR>";
			$ret.="送金額：\\".$price."<BR>";
			$ret.="\\$price受け取りました<BR>"   if $workflag_pay;
			$ret.="送金受け取りを断りました<BR>" if !$workflag_pay && $workflag_read;
			$ret.="送金\\$priceを受け取りますか？"
				."「".GetTagAllow('受け取る')."」「".GetTagDeny('受け取らない')."」" 
				if !$workflag_read;
		}
		if($cmd==$CMD_ITEM)
		{
			$ret.=$ITEM->{name}." ".$itemcount.$ITEM->{scale}."<BR>";
			$ret.="内容：".$msg."<BR>";
			$ret.="代金：\\".$price."<BR>"                 if $price;
			$ret.="消費時間：".GetTime2HMS(GetTimeDeal($price,$itemno,$itemcount))."<br>";
			$ret.="\\$price支払い"                         if $price && $workflag_pay;
			$ret.="商品を受け取りました<BR>"               if $workflag_pay;
			$ret.="商品受け取りを断りました<BR>"           if !$workflag_pay && $workflag_read;
			$ret.="代金を支払って"                         if $price && !$workflag_read;
			$ret.="商品を受け取りますか？"
				."「".GetTagAllow('受け取る')."」「".GetTagDeny('受け取らない')."」" 
				if !$workflag_read;
		}
	}
	$disp.=$ret;
	$disp.="<HR SIZE=\"1\">";
}
#$disp.=$TBE if !$MOBILE;

$disp.=$pagecontrol;

sub GetTagDelete
{
	my($msg)=@_; $msg='削除' if $msg eq '';
	return "<a href=\"box-edit.cgi?$USERPASSURL&del=$no\">$msg</a>";
}
sub GetTagDeny
{
	my($msg)=@_; $msg='受取拒否' if $msg eq '';
	return "<a href=\"box-edit.cgi?$USERPASSURL&dny=$no\">$msg</a>";
}
sub GetTagAllow
{
	my($msg)=@_; $msg='受取了承' if $msg eq '';
	return "<a href=\"box-edit.cgi?$USERPASSURL&alw=$no\">$msg</a>";
}
1;
