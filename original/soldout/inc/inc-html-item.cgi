# $Id: inc-html-item.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

GetMarketStatus();

$disp.="●倉庫<HR>";

my $ITEM=$ITEM[$itemno];

my $itemimage=GetTagImgItemType($itemno,0,2);
#$itemimage.="<br>" if $itemimage ne '';
$disp.= $itemimage;
$disp.="名称:".GetTagImgItemType(0,$ITEM[$itemno]->{type}).$ITEM->{name}."<BR>";
$disp.="在庫:$DT->{item}[$itemno-1] $ITEM->{scale}<BR>";
$disp.="標準:\\$ITEM->{price}<BR>";
$disp.="維持:\\$ITEM->{cost}<BR>";
$disp.="説明:$ITEM->{info}<BR>";
$disp.="<HR SIZE=1>";
if($ITEM->{marketprice})
{
	$disp.="相場:\\$ITEM->{marketprice}<br>";
	$disp.="最安値:\\$ITEM->{marketpricelow}<br>";
	$disp.="最高値:\\$ITEM->{marketpricehigh}<br>";
}
else
{
	$disp.="相場:販売店舗なし<br>";
}
$disp.="需供:".GetMarketStatusGraph($ITEM->{uppoint})."<br>";
$disp.="<HR SIZE=1>";

if(CheckItemFlag($itemno,'noshowcase'))
{
	$disp.='この商品は陳列できません<br>';
}
else
{
	$disp.="<FORM ACTION=\"showcase-edit.cgi\" $METHOD>\n";
	$disp.="$USERPASSFORM";
	$disp.="<INPUT TYPE=HIDDEN NAME=bk VALUE=\"$Q{bk}\">";
	$disp.="<INPUT TYPE=HIDDEN NAME=item VALUE=\"$itemno\">";
	$disp.="この商品を";
	$disp.="<SELECT NAME=no>";
	foreach my $cnt (1..$DT->{showcasecount})
	{
		$disp.="<OPTION VALUE='".($cnt-1)."'".($showcase==$cnt?' SELECTED':'').">";
		$disp.="棚$cnt($ITEM[$DT->{showcase}[$cnt-1]]->{name})";
	}
	$disp.="</SELECT>";
	$disp.="へ標準価格の";
	$disp.=<<STR;
<SELECT NAME=per>
<OPTION VALUE='50'>5割引
<OPTION VALUE='60'>4割引
<OPTION VALUE='70'>3割引
<OPTION VALUE='80'>2割引
<OPTION VALUE='90'>1割引
<OPTION VALUE='100' SELECTED>まま
<OPTION VALUE='110'>1割増
<OPTION VALUE='120'>2割増
</SELECT>
または
<INPUT TYPE=TEXT NAME=yen SIZE=6 VALUE="$Q{pr}">円
で
<INPUT TYPE=SUBMIT VALUE='陳列する'>
(時間${\GetTime2HMS($TIME_EDIT_SHOWCASE)}消費)
</FORM>
STR
}

1;
