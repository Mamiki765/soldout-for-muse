#! /usr/local/bin/perl
# $Id: index.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
RequireFile('inc-version.cgi');

Turn();

GetQuery();
GetCookie();
SetCookieSession(); # try cookie
DataRead();

$username=$Q{nm} ? $Q{nm} : $COOKIE{USERNAME};
$password=$Q{pw} ? $Q{pw} : $COOKIE{PASSWORD};

$sub_title=$GAME_SUB_TITLE;
if($USE_USER_TITLE)
{
	my $msg=GetTownData('sub_title');
	$sub_title="<p>$msg</p>" if $msg;
}

$disp.=<<"STR";
$GAME_TITLE
$sub_title
$GAME_INFO
<FORM ACTION="main.cgi" $METHOD>
名前<INPUT TYPE=TEXT NAME=nm VALUE="$username">
パスワード<INPUT TYPE=PASSWORD NAME=pw VALUE="$password">
<INPUT TYPE=CHECKBOX NAME=ck CHECKED>クッキーで保存
<INPUT TYPE=SUBMIT VALUE="店へ入る">
</FORM>
STR

$DT={};
$DT->{id}=-1;
$GUEST_USER=1;

RequireFile('inc-html-ranking.cgi');
RequireFile('inc-html-period.cgi');

$disp.="<hr>";
if(!$NEW_SHOP_ADMIN)
{
	$disp.=GetTagA('【新規店舗オープン】残り'.($MAX_USER-$DTusercount).'名様',"new.cgi") if $MAX_USER>$DTusercount;
	$disp.='【新規店舗オープン】現在満員につき新規店舗オープンできません' if $MAX_USER<=$DTusercount;
}
else
{
	$disp.=qq|参加したい方は管理者までお問い合わせ下さい|;
}
$disp.="<br>";
if($MOVETOWN_ENABLE)
{
	$disp.='【移転店舗受け入れ】';
	$disp.='残り'.($MAX_MOVE_USER-$DTusercount).'名様' if $MAX_MOVE_USER>$DTusercount;
	$disp.='現在移転受入できません' if $MAX_MOVE_USER<=$DTusercount;
	$disp.="<br>";
}
$disp.=qq|<HR>本サイトの管理者 <a href="mailto:$ADMIN_EMAIL">$ADMIN_EMAIL</a>|;
$disp.=qq|<hr>SOLD OUT system ver.$VERSION item ver.$ITEM_VERSION|;
$disp.=qq|<br><A HREF="http://mutoys.com/" target="_blank">MUTOYSへ (SOLD OUT 開発元)</A>|; # この行はなるべく変更しないでください

OutHTML('トップ',$disp);
exit;

sub GetCookie
{
	foreach(split(/\s*;\s*/,$ENV{HTTP_COOKIE}))
	{
		@_=split(/=/);
		$COOKIE{$_[0]}=$_[1];
		next if $_[0] ne 'shop';
		foreach(split(/,/,$_[1]))
		{
			@_=split(/:/);
			$COOKIE{$_[0]}=$_[1];
		}
	}
}
