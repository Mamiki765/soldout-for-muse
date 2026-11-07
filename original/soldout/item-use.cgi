#! /usr/local/bin/perl
# $Id: item-use.cgi 96 2004-03-12 12:25:28Z mu $

$NOMENU=1;
require './_base.cgi';
GetQuery();

$Q{cnt}=int($Q{cnt2} ? $Q{cnt2} : $Q{cnt1});
$Q{cnt}=0 if $Q{cnt}<=0;

Lock() if $Q{cnt} || $Q{tg}ne'';
DataRead();
CheckUserPass();

$itemno=$Q{item};
$no=$Q{no};
$target=$Q{tg};
$message=$Q{msg};
$select=$Q{select};
CheckItemNo($itemno);
OutError('標的が見つかりません') if $target && !defined($id2idx{$target});

$itemcode=GetPath($ITEM_DIR,"use",$ITEM[$itemno]->{code});
OutError('使えません') if $itemcode eq '' || !(-e $itemcode);

$ITEM=$ITEM[$itemno];
@item::DT=@DT;
$item::DT=$DT;
@item::ITEM=@ITEM;
$item::ITEM=$ITEM;
RequireFile('inc-item.cgi');
require $itemcode;
#require "$ITEM_DIR/funcuse.cgi" if $DEFINE_FUNCUSE;
#require(GetPath($ITEM_DIR,"use-s",$ITEM->{code})) if $DEFINE_FUNCUSE_SUB;
#@USE=@item::USE;
#$func=$ITEM->{func};
#&$func($ITEM->{param}) if $func;

$USE=GetUseItem($no,GetUseItemList());
OutError('使えません') if !$USE || !$USE->{useok};
$item::USE=$USE;

if($Q{cnt} || $Q{tg}ne'')
{
	if($USE->{arg}=~/message(\d*)/)
	{
		my $limit=$1||80;
		require $JCODE_FILE;
		$message=EscapeHTML(jcode::sjis($message,$CHAR_SHIFT_JIS&&'sjis'));
		OutError('入力文字数が多すぎます (<>&"は4～6文字に換算されます)') if length $message>$limit;
	}
	my %select_hash;
	if($USE->{arg}=~/select/)
	{
		my @fld=split(/;/,$USE->{argselect});
		shift(@fld) if @fld%2==1;
		%select_hash=@fld;
		while(@fld)
		{
			last if shift @fld eq $select;
			shift @fld;
		}
		OutError('選択肢が不正です') if !@fld;
	}
	$USE->{arg}={};
	$USE->{arg}->{target}=$target;
	$USE->{arg}->{targetidx}=$id2idx{$target};
	$USE->{arg}->{count}=$Q{cnt};
	$USE->{arg}->{message}=$message;
	$USE->{arg}->{select}=$select;
	$USE->{arg}->{select_hash}=\%select_hash;
	UseItem($USE,$Q{cnt});
	DataWrite();
	DataCommitOrAbort();
	UnLock();
	RequireFile('inc-html-item-use.cgi');
}
else
{
	RequireFile('inc-html-item-usemode.cgi');
}
OutHTML('倉庫',$disp);

