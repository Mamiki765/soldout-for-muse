# $Id: inc-html-other.cgi 106 2004-03-17 13:15:34Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="●各種手続き<HR>";

$disp.=<<STR;
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
コメント
<INPUT TYPE=TEXT NAME=cmt SIZE=50 VALUE="$DT->{comment}">
<INPUT TYPE=SUBMIT VALUE="変更する">
</FORM>
STR

$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
ギルド入会/脱退(費用\\200000)
<INPUT TYPE=TEXT NAME=guild VALUE="$DT->{guild}">
<INPUT TYPE=SUBMIT VALUE="入会"><br>
入会：${\(GetMenuTag("guild","ギルドコード"))}を入力<br>
脱退：「leave」と入力
</FORM>
STR

$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
店舗名変更(改名費用\\200000)
<INPUT TYPE=TEXT NAME=rename SIZE=40 VALUE="">
<INPUT TYPE=SUBMIT VALUE="改名する">
</FORM>
STR

if($USE_USER_TITLE && $DTidx==0)
{
	$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
サブタイトル変更(全角20文字以内:HTML不可)
<INPUT TYPE=TEXT NAME=usertitle SIZE=40 VALUE="">
<INPUT TYPE=SUBMIT VALUE="変更する">
</FORM>
※現時点でトップの店舗にのみ与えられる権利です。<br>
※サブタイトルの削除は delete と入力してください。
STR
}

$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
<INPUT TYPE=HIDDEN NAME="option" value="set">
オプション<br>
<INPUT TYPE=CHECKBOX NAME=short_menu VALUE="on"${\($DT->{options}&1 ? ' checked' : '')}>短縮メニュー<br>
<INPUT TYPE=SUBMIT VALUE="設定する">
</FORM>
STR

$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
パスワード変更<br>
<INPUT TYPE=TEXT NAME=pwvrf SIZE=10 VALUE="">現在のパスワード<br>
<INPUT TYPE=TEXT NAME=pw1 SIZE=10 VALUE="">新しいパスワード<br>
<INPUT TYPE=TEXT NAME=pw2 SIZE=10 VALUE="">確認<br>
<INPUT TYPE=SUBMIT VALUE="変更する">
</FORM>
STR

$disp.=<<STR;
<HR>
<FORM ACTION="user.cgi" $METHOD>
$USERPASSFORM
店じまい(閉店)<BR>
<INPUT TYPE=TEXT NAME=pwvrf SIZE=10 VALUE="">現在のパスワード<br>
<INPUT TYPE=TEXT NAME=cls SIZE=10 VALUE="">確認のため、 closeshop と英小文字で入力してください<br>
<INPUT TYPE=SUBMIT VALUE="店じまいする">
</FORM>
STR

1;
