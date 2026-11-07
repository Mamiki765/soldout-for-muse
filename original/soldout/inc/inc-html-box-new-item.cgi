# $Id: inc-html-box-new-item.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $usertaxrate=GetUserTaxRate($DT);
my $sitetaxrate=($Q{senditem}==1 ? GetTradeTaxRate():0);

my($taxrate,$tax)=GetSaleTax($Q{itemno},$Q{itemcnt},$Q{price}*($Q{unit}?$Q{itemcnt}:1),$usertaxrate+$sitetaxrate);

$disp.="●郵便箱<HR>";

$Q{price}=0 if $Q{price} eq '';
$Q{itemcnt}=1  if $Q{itemcnt} eq '';
$price=$Q{price}*($Q{unit}?$Q{itemcnt}:1);

if($Q{conf} ne '' && $precheckerror eq '')
{
	$disp.=<<"HTML";
	商品送付確認<hr>
	宛先：${\(GetID2UserName($Q{senditem}))[0]}<br>
	内容：$Q{msg}<br>
	商品名：$ITEM[$Q{itemno}]->{name}<br>
	数量：$Q{itemcnt}$ITEM[$Q{itemno}]->{scale}<br>
	代金額：\\$Q{price}${\($Q{unit}?"×".$Q{itemcnt}:"")}
	${\($tax?"　売却税：\\$tax　税率：$taxrate%":"")}
	${\($Q{senditem}==1?"　手数料：\\".int($price/10):"")}
	<BR>
	送付時間：${\GetTime2HMS($TIME_SEND_ITEM)}<br>
	相手の受取時間(予\想)：${\GetTime2HMS(GetTimeDeal($price,$Q{itemno},$Q{itemcnt}))} <br>↑<b>【確認！】</b><br>
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=senditem VALUE="$Q{senditem}">
	<INPUT TYPE=HIDDEN NAME=title VALUE="$Q{title}">
	<INPUT TYPE=HIDDEN NAME=msg VALUE="$Q{msg}">
	<INPUT TYPE=HIDDEN NAME=price VALUE="$Q{price}">
	<INPUT TYPE=HIDDEN NAME=itemno VALUE="$Q{itemno}">
	<INPUT TYPE=HIDDEN NAME=itemcnt VALUE="$Q{itemcnt}">
	<INPUT TYPE=HIDDEN NAME=unit VALUE="$Q{unit}">
	<INPUT TYPE=SUBMIT NAME=ok VALUE="送信">
	<INPUT TYPE=SUBMIT NAME=ng VALUE="再編集">
	</FORM>
HTML
	#タイトル：$Q{title}<br>
}
else
{
	my $formsend="<OPTION VALUE='-1'>宛先選択";
	$formsend.="<OPTION VALUE='1'>輸出(貿易)" if $TRADE_ENABLE;
 	foreach (@DT)
	{
		$formsend.="<OPTION VALUE=\"$_->{id}\"".($Q{senditem}==$_->{id}?' SELECTED':'').">$_->{shopname}" if $DT->{id}!=$_->{id};
	}
	
	my @sort;
	foreach(1..$MAX_ITEM){$sort[$_]=$ITEM[$_]->{sort}};
	my @itemlist=sort { $sort[$a] <=> $sort[$b] } (1..$MAX_ITEM);
	my $formitem="";
	foreach my $idx (@itemlist)
	{
		my $cnt=$DT->{item}[$idx-1];
		my $price=$ITEM[$idx]->{price};
		my $deny_send =CheckItemFlag($idx,'nosend')     ? '[×送付]' : '';
		my $deny_trade=CheckItemFlag($idx,'notradeout') ? '[×輸出]' : '';
		$formitem.="<OPTION VALUE=\"$idx\"".($Q{itemno}==$idx?' SELECTED':'').">$deny_send$deny_trade$ITEM[$idx]->{name}($cnt/\\$price)" if $cnt;
	}
	
	$disp.=<<"HTML";
	商品送付<hr>
	$precheckerror
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	$TB
	$TR$TD宛先$TD<SELECT NAME=senditem>$formsend</SELECT>$TRE
	$TR$TD内容$TD<INPUT TYPE=TEXT NAME=msg SIZE=50 VALUE="$Q{msg}">$TD(100文字以内)$TRE
	$TR$TD商品(在庫数)$TD<SELECT NAME=itemno>$formitem</SELECT>$TRE
	$TR$TD数量$TD<INPUT TYPE=TEXT NAME=itemcnt VALUE="$Q{itemcnt}">$TRE
	$TR$TD代金額$TD<INPUT TYPE=TEXT NAME=price SIZE=6 VALUE="$Q{price}">円 <INPUT TYPE=CHECKBOX NAME=unit${\($Q{unit}?" CHECKED":"")}>単価指定$TRE
	$TBE
	<INPUT TYPE=HIDDEN NAME=conf VALUE="conf">
	<INPUT TYPE=SUBMIT VALUE="送付確認"> (時間${\GetTime2HMS($TIME_SEND_ITEM)}消費)
	</FORM>
	※代金額を設定すると、商品と引き換えに代金の徴収が出来ます。<BR>
	※受取拒否されると、その商品は破棄されます。<BR>
	※相手は受け取りの際、金額に応じて時間を消費します。(安いほど多くの時間を消費する)<BR>
	※輸出で売却されなかった場合は、金額の1/10が手数料として引かれ商品が戻ってきます。
HTML
}

1;
