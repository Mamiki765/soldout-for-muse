# $Id: inc-html-shop-2.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $tp=int($Q{tp}+0);
my @itemlist=();
my $itn=int($Q{itn}+0);

my $rank=1;
my %itempro=();
my %itemlist=();
my %guild=();

foreach(@ITEM){$_->{no}}

foreach my $DT (@DT)
{
	my $shopname=$DT->{shopname};
	my $shopid=$DT->{id};
	$guild{$shopid}=$DT->{guild};
	my $itemtype=-1;
	foreach my $cnt (0..$DT->{showcasecount})
	{
		my $itemno=$DT->{showcase}[$cnt];
		next if !$itemno;
		my $ITEM=$ITEM[$itemno];
		my $itemtypew=$ITEM->{type};
		$itemtype=$itemtype!=-1 && $itemtypew!=$itemtype ? 0 : $itemtypew;
		next if $tp && $itemtypew!=$tp;;
		
		$itemlist{$itemno}=$ITEM;
		next if $itn && $itn!=$itemno;
		
		my $price=$DT->{price}[$cnt];
		my $stock=$DT->{item}[$itemno-1];
		my $sort=$price*$DTusercount+($DTusercount-$rank);
		push(@itemlist,[$shopid,$shopname,$cnt,$itemno,$price,$stock,$rank,$sort]);
	}
	$itempro{$shopid}=GetTagImgItemType(0,$itemtype,1)." " if $itemtype;
	
	$rank++;
}

my $itemlist="";
if($tp || !$MOBILE)
{
	$itemlist="<select name=itn>";
	foreach($ITEM[0],grep(!$tp || $_->{type}==$tp,sort{$a->{sort} <=> $b->{sort}}values(%itemlist)))
	{
		$itemlist.="<option value=\"$_->{no}\"".($_->{no}==$itn?' SELECTED':'').">".$_->{name};
	}
	$itemlist.="</select>";
}
my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{pg},$LIST_PAGE_ROWS,$#itemlist+1);

$disp.="●相場";
$disp.="<HR SIZE=\"1\">";

foreach my $cnt (0..$#ITEMTYPE)
{
	$disp.=$cnt==$tp ? "[" : "<A HREF=\"$MYNAME?$USERPASSURL&tp=$cnt&t=2\">";
	$disp.=GetTagImgItemType(0,$cnt) if $cnt && !$MOBILE;
	$disp.=$ITEMTYPE[$cnt];
	$disp.=$cnt==$tp ? "]" :"</A>";
	$disp.=" ";
}
$disp.="<hr size=\"1\">";

$disp.=<<"HTML" if $tp || !$MOBILE;
<form action="shop.cgi" $METHOD>
$USERPASSFORM
<input type=hidden name=tp value=\"$tp\">
<input type=hidden name=t value="2">
$itemlist
<input type=submit value="検索">
</form>
HTML

$pagectrl=GetPageControl($pageprev,$pagenext,"t=2&itn=$Q{itn}&tp=$tp","",$pagemax,$page);
$disp.=$pagectrl."<HR SIZE=\"1\">";

@itemlist=sort {$a->[7]<=>$b->[7]} @itemlist;

$disp.=$TB;
foreach my $item (@itemlist[$pagestart..$pageend])
{
	my($shopid,$shopname,$showcase,$itemno,$price,$stock,$rank)=@{$item};

	my $ITEM=$ITEM[$itemno];
	my $nobuy=CheckItemFlag($itemno,'nobuy');
	
	$disp.=$TR.$TD;
	$disp.="<A HREF=\"buy.cgi?buy=$shopid!$showcase!$itemno&bk=p2!$page!$itn&$USERPASSURL\">" if $stock && !$GUEST_USER && !$nobuy;
	$disp.=GetTagImgItemType($itemno).$ITEM->{name};
	$disp.='(購入不可)' if $nobuy;
	$disp.="</A>" if $stock && !$GUEST_USER && !$nobuy;
	
	$disp.=$TD."\@\\".$price;
	
	my $msg=$stock ? "残".$stock.$ITEM->{scale} : "SOLD OUT";
	$disp.=$TD.$msg;
	#$disp.=$TD.($DT->{itemtoday}{$itemno}+0).$ITEM->{scale}."売上";
	
	$disp.=$TD."RANK ".$rank.$TD.GetTagImgGuild($guild{$shopid}).$itempro{$shopid}.$shopname;
	$disp.=$TRE;
	$disp.="<HR SIZE=\"1\">" if $MOBILE;
}
$disp.=$TBE;
#$disp.="<HR SIZE=1>";

#$disp.=$pagectrl;

1;
