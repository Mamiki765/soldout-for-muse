#! /usr/local/bin/perl
# $Id: user.cgi 106 2004-03-17 13:15:34Z mu $

require './_base.cgi';
require $JCODE_FILE;

GetQuery();

#コメント変更
if(defined($Q{cmt}))
{
	$comment=jcode::sjis($Q{cmt},$CHAR_SHIFT_JIS&&'sjis');
	OutError('コメントの文字数が多いです。') if length($comment)>50;
	$comment=~s/&/&amp;/g;
	$comment=~s/>/&gt;/g;
	$comment=~s/</&lt;/g;
}

#パスワード変更
if(defined($Q{pw1}))
{
	OutError('現在のパスワードが入力されていません。') if $Q{pwvrf}eq'';
	OutError('確認入力と不一致のため変更中止します。') if $Q{pw1}ne$Q{pw2};
	OutError('変更パスワードが入力されていません。') if $Q{pw1}eq'';
	OutError('パスワードに使用できない文字がありましたので変更中止します。') if $Q{pw1}=~/[^a-zA-Z0-9_\-]/;
	OutError('パスワードは12文字までです。') if length($Q{pw1})>12;
}

#店じまい
if(defined($Q{cls}))
{
	OutError('現在のパスワードが入力されていません。') if $Q{pwvrf}eq'';
	OutError('店じまいしたい場合は closeshop と入力してください。') if $Q{cls}ne'closeshop';
}

#店舗名変更
if($Q{rename}ne'')
{
	$Q{rename}=jcode::sjis($Q{rename},$CHAR_SHIFT_JIS&&'sjis');
	OutError('名前・店名・パスワードに使用できない文字が含まれています。') if $Q{rename} =~ /([,:;\t\r\n<>&])/;
	OutError('店名は20文字以内です。') if length($Q{rename})>40;
	OutError('店名が短すぎます。') if length($Q{rename})<4;
	OutError('名前・店名が空白になっているか、使用不可文字が使用されています。') if $Q{rename}=~/^(\s|\x81\x40)+$/;
}

#ギルド入脱会
if($Q{guild}ne'')
{
	OutError('そんなギルドは存在しません') if $Q{guild} ne 'leave' && !defined($GUILD{$Q{guild}}->[$GUILDIDX_name]);
}

#表示行数変更
if($Q{pagerows}ne'')
{
	$Q{pagerows}=int($Q{pagerows});
	OutError('0～50で指定してください。') if $Q{pagerows}<0 || $Q{pagerows}>50;
}

#サブタイトル変更
if($Q{usertitle})
{
	OutError('変更権利がありません') if !$USE_USER_TITLE || $DTidx!=0;
	OutError('サブタイトルが長すぎます') if length $Q{usertitle} > 40;
}

Lock();
DataRead();
CheckUserPass();

#コメント変更
if(defined($Q{cmt}))
{
	$DT->{comment}=$comment;
	$disp.="コメント更新しました";
}

#パスワード変更
if(defined($Q{pw1}))
{
	VerifyPass();
	$DT->{pass}=$PASSWORD_CRYPT ? crypt($Q{pw1},GetSalt()) : $Q{pw1};
	$disp.="パスワード変更しました<BR>トップより入店し直してください<BR><BR>";
	#$disp.="<A HREF='index.cgi?u=$DT->{name}!$Q{pw1}'>トップへ</A>"; #セキュリティ的に不適当
}

#店じまい
if($Q{cls}eq'closeshop')
{
	VerifyPass();
	if(!$MASTER_USER)
	{
		CloseShop($DT->{id},'自主閉店');
		WriteLog(1,0,0,$DT->{shopname}."が閉店しました",1);
		$disp.="店じまいの手続きが完了いたしました<BR><BR>"
			  ."本ゲームへの参加、本当にありがとうございました";
	}
	else
	{
		CloseShop($DT->{id},'追放');
		$Q{closecmt}="【".jcode::sjis($Q{closecmt})."】" if $Q{closecmt}ne'';
		WriteLog(1,0,0,$Q{closecmt}.$DT->{shopname}."は追放されました",1);
		$disp.="追放完了";
	}
	$DTblockip=$DT->{remoteaddr};
}

#店舗名変更
if($Q{rename}ne'')
{
	OutError('資金が足りません。') if $DT->{money}<200000;
	foreach my $idx (0..$#DT)
	{
		OutError('既に存在する店名です。-> '.$Q{rename}) if $DT[$idx]->{shopname} eq $Q{rename};
	}
	WriteLog(1,0,0,$DT->{shopname}."が「".$Q{rename}."」へ改名しました。",1);
	$DT->{shopname}=$Q{rename};
	$DT->{money}-=200000;
	$disp.=$DT->{shopname}."へ改名しました。";
}

#ギルド入脱会
if($Q{guild}ne'')
{
	OutError('資金が足りません。') if $DT->{money}<200000;
	if($DT->{guild}eq'')
	{
		OutError('どこにも入会していません') if $Q{guild} eq 'leave';
		
		my $name=$GUILD{$Q{guild}}->[$GUILDIDX_name];
		WriteLog(1,0,0,$DT->{shopname}."がギルド「".$name."」へ入会しました。",1);
		$DT->{guild}=$Q{guild};
		$disp.=$name."へ入会しました。";
	}
	else
	{
		OutError('現在所属しているギルドを退会しないと入会できません') if $Q{guild} ne 'leave';
		
		my $name=$GUILD{$DT->{guild}}->[$GUILDIDX_name];
		$name="解散したギルド" if $name eq '';;
		WriteLog(1,0,0,$DT->{shopname}."がギルド「".$name."」から脱退しました。",1);
		$disp.=$name."から脱退しました。";
		$DT->{guild}="";
	}
	$DT->{money}-=200000;
}

#オプション設定
if($Q{option} eq 'set')
{
	$DT->{options}=0;
	$DT->{options}|=1 if $Q{short_menu} eq 'on';
	$disp.='短縮メニュー:'.($DT->{options}&1 ? '有効' : '無効').'<br>';
}

#サブタイトル変更
if($USE_USER_TITLE && $Q{usertitle} && $DTidx==0)
{
	my $msg=$Q{usertitle};
	$msg=$msg eq 'delete' ? '' : EscapeHTML(jcode::sjis($msg,$CHAR_SHIFT_JIS&&'sjis')." by $DT->{shopname}");
	SetTownData('sub_title',$msg);
	$disp.='サブタイトルを変更しました';
}

DataWrite();
DataCommitOrAbort();
UnLock();

OutHTML('各種手続き',$disp);
exit;

sub VerifyPass
{
	OutError('現在のパスワードの入力が間違っています')
		if !CheckPassword($Q{pwvrf},$DT->{pass}) && $MASTER_PASSWORD ne $Q{pwvrf};
}

