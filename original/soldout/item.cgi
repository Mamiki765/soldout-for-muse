#! /usr/local/bin/perl
# $Id: item.cgi 96 2004-03-12 12:25:28Z mu $

$NOMENU=1;
require './_base.cgi';
GetQuery();

Turn();

DataRead();
CheckUserPass();

$itemno=$Q{no};
$showcase=$Q{sc};
CheckItemNo($itemno);

RequireFile('inc-html-item.cgi');
RequireFile('inc-html-item-send.cgi');

$itemcode=GetPath($ITEM_DIR,"use",$ITEM[$itemno]->{code});
if($itemcode ne '' && -e $itemcode)
{
	my $ITEM=$ITEM[$itemno];
	@item::DT=@DT;
	$item::DT=$DT;
	@item::ITEM=@ITEM;
	$item::ITEM=$ITEM;
	RequireFile('inc-item.cgi');
	require $itemcode;
	#require "$ITEM_DIR/funcuse.cgi" if $DEFINE_FUNCUSE;
	#require(GetPath($ITEM_DIR,"use-s",$ITEM->{code})) if $DEFINE_FUNCUSE_SUB;
	#@USE=@item::USE;
	#my $func=$ITEM->{func};
	#&$func($ITEM->{param}) if $func;
	@USE=GetUseItemList();
	if($USE[0]->{name} ne '')
	{
		RequireFile('inc-html-item-uselist.cgi');
	}
}

OutHTML('倉庫',$disp);

