#! /usr/local/bin/perl
# $Id: showcase-edit.cgi 96 2004-03-12 12:25:28Z mu $

$NOMENU=1;
require './_base.cgi';
GetQuery();

OutError('不正な呼び出しです') if $Q{no}eq'';

Lock();
DataRead();
CheckUserPass();

$no=int($Q{no});
$itemno=int($Q{item});
$per=CheckCount(int($Q{per}),0,1,200);
$yen=CheckCount(int($Q{yen}),0,0,$MAX_MONEY);
$price=0;

UseTime($TIME_EDIT_SHOWCASE);

if($no<0 || $no>=$DT->{showcasecount}
|| $itemno<0 || $itemno>$MAX_ITEM
|| ($per<=0 && $yen<=0)
|| $per>200
|| CheckItemFlag($itemno,'noshowcase')
)
{
	OutError('不正な要求です');
}

$price=0;
if($itemno>0)
{
	OutError('そのアイテムは在庫無しです') if !$DT->{item}[$itemno-1];
	$price=$yen!=0 ? $yen : int($ITEM[$itemno]->{price} / 100 * $per);
}
$price=$MAX_MONEY if $price>$MAX_MONEY;

if($itemno && $price)
{
	$ret="棚".($no+1)."に$ITEM[$itemno]->{name}を$price円で陳列";
	WriteLog(0,$DT->{id},0,$ret,1);
	WriteLog(0,0,0,$DT->{shopname}."で$ITEM[$itemno]->{name}が$price円にて陳列されました",1);
}
else
{
	$itemno=0;
	$price=0;
	$ret="棚".($no+1)."への陳列をやめました";
	WriteLog(0,$DT->{id},0,$ret,1);
	#if($DT->{showcase}[$no])
	#{
	#	WriteLog(0,0,0,$DT->{shopname}."の$ITEM[$DT->{showcase}[$no]]->{name}が店頭から消えました",1);
	#}
}

$DT->{showcase}[$no]=$itemno;
$DT->{price}[$no]=$price;

DataWrite();
DataCommitOrAbort();
UnLock();

$disp.=$ret;
OutHTML('陳列棚',$disp);

exit;
