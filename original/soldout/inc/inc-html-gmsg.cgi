# $Id: inc-html-gmsg.cgi 96 2004-03-12 12:25:28Z mu $

$disp.="●$GLOBAL_MSG_TITLE$gmsgname<HR>";

my %printed=();

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{lpg},$LIST_PAGE_ROWS,scalar(@MESSAGE));

$disp.=GetMenuTag('gmsg','[地域 '.GetFileTime($GLOBAL_MSG_FILE).']');
foreach(keys %GMSG_CATEGORY_NAME)
{
	$disp.=GetMenuTag('gmsg','['.$GMSG_CATEGORY_NAME{$_}.' '.GetFileTime($GLOBAL_MSG_FILE.'-'.$_).']','&ct='.$_);
}
#$disp.="<br>";

$disp.=$gmsgcategory ?
	qq|<a target="_blank" href="$URL_GLOBAL_MSG_CENTER?centerlist">[外部接続先]</a><hr>| :
	qq|<a target="_blank" href="$URL_GLOBAL_MSG_CENTER?townlist">[地域街リスト]</a><hr>|;

if(!$GUEST_USER)
{
	my $msg=$GLOBAL_MSG_INFO{$gmsgcategory} || $GLOBAL_MSG_INFO;
	$disp.=<<"STR";
	$msg
	<FORM ACTION="$URL_GLOBAL_MSG_CENTER" $METHOD>
	<INPUT TYPE=HIDDEN NAME="name"  VALUE="$USER">
	<INPUT TYPE=HIDDEN NAME="sess"  VALUE="$USERSESSION">
	<INPUT TYPE=HIDDEN NAME="town"  VALUE="$TOWN_CODE">
	<INPUT TYPE=HIDDEN NAME="reply" VALUE="">
	<INPUT TYPE=HIDDEN NAME="cookieon" VALUE="$COOKIESESSION">
	<INPUT TYPE=HIDDEN NAME="category" VALUE="$gmsgcategory">
	$errormsg
	<INPUT TYPE=TEXT NAME=msg SIZE=50 VALUE="$Q{msg}">
	<INPUT TYPE=SUBMIT VALUE="書込">
	</FORM><HR>
STR
}
else
{
	$disp.="出店者以外は閲覧のみ<HR>";
}

my $pagecontrol=GetPageControl($pageprev,$pagenext,"ct=$gmsgcategory","lpg",$pagemax,$page);
$disp.=$pagecontrol;

my %oktown=();
$disp.="<BR>";
$disp.=$TB;
foreach(@MESSAGE[$pagestart..$pageend])
{
	chop;
	my($tm,$msgid,$replymsgid,$townname,$shopname,$message)=split(/\t/);
	
	$tm=GetTime2FormatTime($tm,1);
	my($towncode)=($msgid=~/(\w+)$/);
	$townname=qq|<a target="_blank" href="jump.cgi?gmsgtown=$towncode">$townname</a>| if !$oktown{$towncode}++;
	
	if($MOBILE)
	{
		$disp.=$tm."<BR>".$townname.":".$shopname."<BR>".$replymsgid.EscapeHTML($message);
		$disp.="<HR SIZE=1>";
	}
	else
	{
		$disp.=$TR.$TDNW.$tm.$TD.$townname.$TD.$shopname.$TD.$replymsgid.EscapeHTML($message).$TRE;
	}
}
$disp.=$TBE;

$disp.=$pagecontrol;

1;
