#! /usr/local/bin/perl
# $Id: admin-sub.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
require $JCODE_FILE;

GetQuery();

Lock();
DataRead();
CheckUserPass();
OutError('') if !$MASTER_USER || $USER ne 'soldoutadmin';

OutError('ユーザが見つかりません') if !defined($name2idx{$Q{user}});
my $DT=$DT[$name2idx{$Q{user}}];

$Q{comment}="【".jcode::sjis($Q{comment})."】" if $Q{comment} ne '';
$disp.="$DT->{shopname} [$DT->{name}] $Q{comment} ";

#重複登録自動アクセス制限の個別対応
if($Q{nocheckip})
{
	$disp.='重複登録チェック対象外としました',$DT->{nocheckip}=1 if $Q{nocheckip} eq 'nocheck';
	$disp.='重複登録チェック対象としました',$DT->{nocheckip}='' if $Q{nocheckip} eq 'check';
}

#アクセス制限制御
if($Q{blocklogin})
{
	$Q{blocklogin}=jcode::sjis($Q{blocklogin});
	if($Q{blocklogin} eq 'off')
	{
		$disp.='アクセス制限を解除しました';
		$DT->{blocklogin}='';
	}
	elsif($Q{blocklogin} ne '')
	{
		$disp.='アクセス制限をしました['.$Q{blocklogin}.']';
		$DT->{blocklogin}=$Q{blocklogin};
	}
}

#追放
if($Q{closeshop} eq 'closeshop')
{
	CloseShop($DT->{id},'追放');
	WriteLog(1,0,0,"$Q{comment}$DT->{shopname}は追放されました",1);
	$disp.="追放完了";
	$DTblockip=$DT->{remoteaddr};
}

#賞品授与(デバッグにも使用できます)
if($Q{senditem})
{
	my $itemno=$Q{senditem};
	my $ITEM=$ITEM[$itemno];
	my $itemcount=$Q{count};
	$itemcount+=$DT->{item}->[$itemno-1];
	$itemcount=$ITEM->{limit} if $itemcount>$ITEM[$itemno]->{limit};
	$DT->{item}->[$itemno-1]=$itemcount;
	
	WriteLog(2,0,0,"$Q{comment}管理人から$DT->{shopname}へ$ITEM->{name}が贈られました",1) if $Q{log};
	WriteLog(2,$DT->{id},0,"$Q{comment}管理人から$ITEM->{name}が$Q{count}$ITEM->{scale}贈られてきました",1);
	$disp.="$ITEM->{name} $Q{count}$ITEM->{scale} 賞品授与完了";
}

#賞金授与(デバッグにも使用できます)
if($Q{sendmoney})
{
	$DT->{money}+=$Q{sendmoney};
	
	WriteLog(2,0,0,"$Q{comment}管理人から$DT->{shopname}へ賞金が贈られました",1) if $Q{log};
	WriteLog(2,$DT->{id},0,"$Q{comment}管理人から\\$Q{sendmoney}が贈られてきました",1);
	$disp.="\\$Q{sendmoney} 賞金授与完了";
}

#持ち時間授与(デバッグにも使用できます)
if($Q{sendtime})
{
	$DT->{time}-=$Q{sendtime};
	
	WriteLog(2,0,0,"$Q{comment}管理人から$DT->{shopname}へ持ち時間「".GetTime2HMS($Q{sendtime})."」が贈られました",1) if $Q{log};
	WriteLog(2,$DT->{id},0,"$Q{comment}管理人から持ち時間".GetTime2HMS($Q{sendtime})."が贈られてきました",1);
	$disp.=GetTime2HMS($Q{sendtime})." 持ち時間授与完了";
}

#郵便未処理数変更
if($Q{boxcount} ne '')
{
	$DT->{boxcount}=$Q{boxcount}+0;
	$disp.='郵便未処理数を'.($Q{boxcount}+0).'に設定しました';
}

DataWrite();
DataCommitOrAbort();
UnLock();

$disp="行いたい処理とそのパラメータを正しく選択/記述してください" if $disp eq '';

$NOMENU=1;
$Q{bk}="none";
OutHTML('管理',$disp);
exit;
