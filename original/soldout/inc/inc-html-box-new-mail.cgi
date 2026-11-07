# $Id: inc-html-box-new-mail.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="●郵便箱<HR>";

$Q{price}=0 if $Q{price} eq '';

if($Q{conf} ne '' && $precheckerror eq '')
{
	$disp.=<<"HTML";
	メッセージ送信確認<hr>
	宛先：$DT[$id2idx{$Q{sendmail}}]->{shopname}<br>
	タイトル：$Q{title}<br>
	内容：$Q{msg}<br>
	情報料：\\$Q{price}<br>
	${\($Q{price} ? "消費時間：".GetTime2HMS($TIME_SEND_MONEY)."<br>" : "")}
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	<INPUT TYPE=HIDDEN NAME=sendmail VALUE="$Q{sendmail}">
	<INPUT TYPE=HIDDEN NAME=title VALUE="$Q{title}">
	<INPUT TYPE=HIDDEN NAME=msg VALUE="$Q{msg}">
	<INPUT TYPE=HIDDEN NAME=price VALUE="$Q{price}">
	<INPUT TYPE=SUBMIT NAME=ok VALUE="送信">
	<INPUT TYPE=SUBMIT NAME=ng VALUE="再編集">
	</FORM>
HTML
}
else
{
	my $formsend="<OPTION VALUE='-1'>宛先選択";
	foreach (@DT)
	{
		$formsend.="<OPTION VALUE=\"$_->{id}\"".($Q{sendmail}==$_->{id}?' SELECTED':'').">$_->{shopname}" if $DT->{id}!=$_->{id};
	}
	
	$disp.=<<"HTML";
	メッセージ送信<hr>
	$precheckerror
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	$TB
	$TR$TD宛先$TD<SELECT NAME=sendmail>$formsend</SELECT>$TRE
	$TR$TDタイトル$TD<INPUT TYPE=TEXT NAME=title SIZE=50 VALUE="$Q{title}">$TD(20文字以内)$TRE
	$TR$TD内容$TD<INPUT TYPE=TEXT NAME=msg SIZE=50 VALUE="$Q{msg}">$TD(100文字以内)$TRE
	$TR$TD情報料$TD<INPUT TYPE=TEXT NAME=price SIZE=6 VALUE="$Q{price}">円(情報料設定時のみ時間${\GetTime2HMS($TIME_SEND_MONEY)}消費)$TRE
	$TBE
	<INPUT TYPE=HIDDEN NAME=conf VALUE="conf">
	<INPUT TYPE=SUBMIT VALUE="送信確認">
	</FORM>
	※情報料を設定すると、内容閲覧時に料金の徴収が出来ます。
HTML
}
1;
