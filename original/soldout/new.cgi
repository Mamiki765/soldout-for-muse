#! /usr/local/bin/perl
# $Id: new.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
require $JCODE_FILE;
GetQuery();

DataRead();

if($Q{admin} ne $MASTER_PASSWORD)
{
	OutError('新規店舗登録権限がありません') if $NEW_SHOP_ADMIN;
	OutError('あなたは現在登録制限されています') if $NEW_SHOP_BLOCKIP && GetTrueIP() eq $DTblockip;
	OutError('出店キーワードが正しくありません') if $NEW_SHOP_KEYWORD && $Q{sname} && $Q{newkey} ne $NEW_SHOP_KEYWORD;
	checkMaxUser();
}


if($Q{sname}.$Q{name}.$Q{pass1}.$Q{pass2})
{
	$Q{name}=jcode::sjis($Q{name},$CHAR_SHIFT_JIS&&'sjis');
	$Q{sname}=jcode::sjis($Q{sname},$CHAR_SHIFT_JIS&&'sjis');

	if(($Q{sname}.$Q{name}.$Q{pass1}.$Q{pass2}) =~ /([,:;\t\r\n<>&])/
	|| ($Q{pass1}.$Q{pass2}.$Q{name}) =~ /([^A-Za-z0-9_\-])/
	|| $Q{name} eq 'soldoutadmin'
	|| CheckNGName($Q{sname})
	)
	{
		OutError('名前・店名・パスワードに使用できない'.
		         '文字が含まれています。');
	}
	if(!$Q{sname} || !$Q{name} || !$Q{pass1} || !$Q{pass2})
	{
		OutError('名前・店名・パスワードを入力してください。');
	}
	if($Q{sname}=~/^(\s|\x81\x40)+$/ || $Q{name}=~/^(\s|\x81\x40)+$/)
	{
		OutError('名前・店名が空白になっているか、使用不可文字が使用されています。');
	}
	if($Q{pass1} ne $Q{pass2})
	{
		OutError('確認パスワードが違っています。');
	}
	if(length($Q{sname})<4)
	{
		OutError('店名の文字数が少ないです。');
	}
	if(length($Q{name})>12 || length($Q{sname})>20
	|| length($Q{pass1})>12 || length($Q{pass2})>12)
	{
		OutError('名前(12文字)・店名(全角10文字)・パスワード(12文字)の文字数が多いです。');
	}
	
	Lock();
	DataRead();
	checkMaxUser() if $Q{admin} ne $MASTER_PASSWORD;
	OutError('既に存在する名前です。-> '.$Q{name}) if $name2pass{$Q{name}};
	
	foreach $idx (0..$#DT)
	{
		OutError('既に存在する店名です。-> '.$Q{sname}) if $DT[$idx]->{shopname} eq $Q{sname};
	}
	
	$idx=$DTusercount;
	$DTlasttime=$NOW_TIME if !$idx;
	$DT[$idx]={};
	$DT=$DT[$idx];
	$DT->{status}	    =1;
	$DT->{id}           =$DTnextid;
	$DT->{lastlogin}    =$NOW_TIME;
	$DT->{name}         =$Q{name};
	$DT->{shopname}     =$Q{sname};
	$DT->{pass}         =$PASSWORD_CRYPT ? crypt($Q{pass1},GetSalt()) : $Q{pass1};
	$DT->{money}        =100000;
	$DT->{moneystock}   =0;
	$DT->{time}         =$NOW_TIME-12*60*60;
	$DT->{rank}         =5010;
	$DT->{saleyesterday}=0;
	$DT->{saletoday}    =0;
	$DT->{costtoday}    =0;
	$DT->{costyesterday}=0;
	$DT->{paytoday}     =0;
	$DT->{payyesterday} =0;
	$DT->{showcasecount}=1;
	$DT->{itemyesterday}={};
	$DT->{itemtoday}	={};
	$DT->{remoteaddr}   =GetTrueIP();
	$DT->{rankingyesterday}='';
	$DT->{taxtoday}     =0;
	$DT->{taxyesterday} =0;
	$DT->{foundation}   =$NOW_TIME;
	foreach $cnt (0..$DT->{showcasecount}-1)
	{
		$DT->{showcase}[$cnt]=0;
		$DT->{price}[$cnt]=0;
	}
	foreach $cnt (0..$MAX_ITEM-1)
	{
		$DT->{item}[$cnt]=0;
	}
	
	$DTblockip=$DT->{remoteaddr};
	
	require "$ITEM_DIR/funcnew.cgi" if $DEFINE_FUNCNEW;
	WriteLog(1,0,0,$Q{sname}."が新装開店しました",1) if !$DEFINE_FUNCNEW || !$DEFINE_FUNCNEW_NOLOG;
	
	DataWrite();
	DataCommitOrAbort();
	UnLock();
	
	OutHTML
	(
		'登録終了',
		"名前:$Q{name}<BR>店名:$Q{sname}<BR>パスワード:$Q{pass1}<BR><BR>".
		"上記にて登録しました。<BR><BR>".
		"それでは、お楽しみ下さい。<BR><BR>".
		"初めての方は、メニューの「経営入門」を一通りご覧下さい。<BR><BR>".
		"<A HREF=\"index.cgi?u=$Q{name}!$Q{pass1}\">ゲームスタート</A><BR><BR>".
		"※携帯端末の場合、上記リンクに移動後、ブックマークしておくとパスワード入力の手間が省けます。".
		"ただし、ブックマークにパスワード情報が記録されますので、注意してください。"
	);
	exit;
}

$disp.="残り".($MAX_USER-$DTusercount)."名様<hr>";

$disp.=<<"HTML";
<FORM ACTION="$MYNAME" $METHOD>
<INPUT TYPE=HIDDEN NAME=admin VALUE="$Q{admin}">
名前 <INPUT TYPE=TEXT NAME=name> 半角英数のみ<BR>
店名 <INPUT TYPE=TEXT NAME=sname> 半角全角OK('や"や,は空白になります)<BR>
パスワード <INPUT TYPE=PASSWORD NAME=pass1> 半角英数のみ<BR>
パスワード確認のためもう一度 <INPUT TYPE=PASSWORD NAME=pass2><BR>
HTML
if($NEW_SHOP_KEYWORD)
{
	$disp.=<<"HTML";
出店キーワード <INPUT TYPE=TEXT NAME=newkey> 出店するには出店キーワードが必要です(入手方法はサイト毎に違います)<BR>
HTML
}
$disp.=<<"HTML";
<INPUT TYPE=SUBMIT VALUE="登録">
</FORM>
<hr>
<a target="_blank" href="help.cgi?p=10">ルール(必読)</a>※別ウィンドウで開きます
<hr>
<a target="_blank" href="help.cgi?p=11">セキュリティについての詳細</a>※別ウィンドウで開きます<br><br>
パスワードには万が一ばれても構\わないものをお使い下さい。
絶対にプロバイダ接続用やメールアカウント用などの重要なパスワードと同じものは使わないでください。
ばれても本ゲーム以外には損害がないパスワードでお願いします。
HTML

OutHTML('新規店舗開店',$disp);
exit;

sub checkMaxUser
{
	OutError('申し訳ありませんが、現在空き店舗がありません。<BR>空くのをお待ちください。')
		if $DTusercount>=$MAX_USER;
}

sub CheckNGName
{
	my($sname)=@_;

	return scalar(grep(index($sname,$_)!=-1,@NG_SHOP_NAME));
}
