# $Id: inc-html-buy.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$TIME_SEND_ITEM=int($TIME_SEND_ITEM/2) if !$id;
my $usetime=GetTimeDeal($price,$itemno,1);

my $baseprice=$price;
my($guild,$guildrate,$guildmargin)=CheckGuild($DT,$DTS,$baseprice);
my $saleprice=$baseprice+($guild==1 ? -$guildmargin : $guildmargin);
$price=$saleprice;

$disp.="●購入<HR>";

my $ITEM=$ITEM[$itemno];

$disp.=$TB.$TR.$TD."店名".$TD.GetTagImgGuild($DTS->{guild}).$DTS->{shopname}.$TRE;
$disp.=$TR.$TD."商品".$TD.GetTagImgItemType($itemno).$ITEM->{name}.$TRE;
#$disp.=$TR.$TD.$TD.$ITEM->{info}.$TRE;
$disp.=$TR.$TD."価格".$TD.'@\\'.$baseprice.$TRE;
$disp.=$TR.$TD.("ギルド内割引価格","ギルド間割増価格")[$guild-1].$TD.'@\\'.$saleprice.$TRE if $guild>0;
$disp.=$TR.$TD."ギルド資金不足".$TD."ギルド内割引補助はありません".$TRE if $guild==-1;
$disp.=$TR.$TD.'販売在庫'.$TD.$stock.$ITEM->{scale}.$TRE;
$disp.=$TR.$TRE;
$disp.=$TR.$TD.'自店保有数'.$TD.($DT->{item}[$itemno-1]+0).$ITEM->{scale}.$TRE;
$disp.=$TBE;

if($DT->{item}[$itemno-1]>=$ITEM->{limit})
	{$disp.='<BR>この商品はこれ以上ストックできません<BR>';}
elsif($DT->{money}<$price)
	{$disp.='<BR>資金が足りません<BR>';}
elsif(GetStockTime($DT->{time})<$usetime)
	{$disp.='<BR>時間が足りません<BR>';}
else
{
	$disp.="<FORM ACTION=\"buy-s.cgi\" $METHOD>";
	$disp.="$USERPASSFORM";
	$disp.="<INPUT TYPE=HIDDEN NAME=bk VALUE=\"$Q{bk}\">";
	$disp.="<INPUT TYPE=HIDDEN NAME=id VALUE=\"$id\">";
	$disp.="<INPUT TYPE=HIDDEN NAME=pr VALUE=\"$price\">";
	$disp.="<INPUT TYPE=HIDDEN NAME=sc VALUE=\"$showcase\">";
	$disp.="<INPUT TYPE=HIDDEN NAME=it VALUE=\"$itemno\">";
	$disp.="上記を ";
	$limit=$ITEM[$itemno]->{limit}-$DT->{item}[$itemno-1];
	$money=$MAX_MONEY;
	$money=int($DT->{money}/$price) if $price;
	$msg{1}=1;
	$msg{10}=10;
	$msg{100}=100;
	$msg{1000}=1000;
	$msg{10000}=10000;
	$msg{$stock}="$stock(全部)";
	$msg{$limit}="$limit(倉庫最大)";
	$msg{$money}="$money(資金最大)";
	$disp.="<SELECT NAME=num1 SIZE=1>";
	my $oldcnt=0;
	foreach my $cnt (sort { $a <=> $b } (1,10,100,1000,10000,$stock,$limit,$money))
	{
		last if $stock<$cnt || $DT->{money}<$cnt*$price || $cnt>$limit || $cnt==$oldcnt;
	
		$disp.="<OPTION VALUE=\"$cnt\">$msg{$cnt}";
		$oldcnt=$cnt;
	}
	$disp.="</SELECT> $ITEM[$itemno]->{scale}、もしくは ";
	$disp.="<INPUT TYPE=TEXT NAME=num2 SIZE=5> $ITEM[$itemno]->{scale} ";
	$disp.="<INPUT TYPE=SUBMIT VALUE='買う'>";
	$disp.="<br>(消費時間:".GetTime2HMS($usetime).")";
	$disp.="</FORM>";
}

1;
