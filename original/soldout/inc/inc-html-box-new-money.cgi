# $Id: inc-html-box-new-money.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="●郵便箱<HR>";

$Q{price}=0 if $Q{price} eq '';

if($Q{conf} ne '' && $precheckerror eq '')
{
	$disp.=<<"HTML";
	送金確認<hr>
	宛先：$DT[$id2idx{$Q{sendmoney}}]->{shopname}<br>
	タイトル：$Q{title}<br>
	内容：$Q{msg}<br>
	送金額：\\$Q{price}<br>
	消費時間：${\GetTime2HMS($TIME_SEND_MONEY)}<br>
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=sendmoney VALUE="$Q{sendmoney}">
	<INPUT TYPE=HIDDEN NAME=title VALUE="$Q{title}">
	<INPUT TYPE=HIDDEN NAME=msg VALUE="$Q{msg}">
	<INPUT TYPE=HIDDEN NAME=price VALUE="$Q{price}">
	<INPUT TYPE=SUBMIT NAME=ok VALUE="送信">
	<INPUT TYPE=SUBMIT NAME=ng VALUE="再編集">
	</FORM>
HTML
#消費時間：${\GetTime2HMS(GetTimeDeal($Q{price}))}<br>
}
else
{
	my $formsend="<OPTION VALUE='-1'>宛先選択";
	foreach (@DT)
	{
		$formsend.="<OPTION VALUE=\"$_->{id}\"".($Q{sendmoney}==$_->{id}?' SELECTED':'').">$_->{shopname}" if $DT->{id}!=$_->{id};
	}
	
	$disp.=<<"HTML";
	送金（現在の所持金 \\$DT->{money}）<hr>
	$precheckerror
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	$TB
	$TR$TD宛先$TD<SELECT NAME=sendmoney>$formsend</SELECT>$TRE
	$TR$TDタイトル$TD<INPUT TYPE=TEXT NAME=title SIZE=50 VALUE="$Q{title}">$TD(20文字以内)$TRE
	$TR$TD内容$TD<INPUT TYPE=TEXT NAME=msg SIZE=50 VALUE="$Q{msg}">$TD(100文字以内)$TRE
	$TR$TD送金額$TD<INPUT TYPE=TEXT NAME=price SIZE=6 VALUE="$Q{price}">円$TRE
	$TBE
	<INPUT TYPE=HIDDEN NAME=conf VALUE="conf">
	<INPUT TYPE=SUBMIT VALUE="送金確認"> (時間${\GetTime2HMS($TIME_SEND_MONEY)}消費)
	</FORM>
	※受取拒否されると、その資金は破棄されます。
HTML
}

1;
