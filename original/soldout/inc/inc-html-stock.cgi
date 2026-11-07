# $Id: inc-html-stock.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $tp=$Q{tp};
my $pg=$Q{pg};

my $DTitem=$DT->{item};
my $DTitemtoday=$DT->{itemtoday};
my $DTitemyesterday=$DT->{itemyesterday};
my $DTexp=$DT->{exp};

GetMarketStatus();

my %showcase=();
my $itemno;
foreach(0..$DT->{showcasecount}-1)
{
	next if !($itemno=$DT->{showcase}[$_]);
	$showcase{$itemno}.="棚".($_+1)."\\".$DT->{price}[$_]." ";
}
$disp.="●倉庫<HR>";
foreach my $cnt (0..$#ITEMTYPE)
{
	my $name=$ITEMTYPE[$cnt];
	$name="&lt;".$name."&gt;" if $cnt==$tp;
	$name=GetTagImgItemType(0,$cnt).$name if $cnt && !$MOBILE;
	$name="<A HREF=\"$MYNAME?$USERPASSURL&tp=$cnt\">".$name."</A>" if $cnt!=$tp;
	
	$disp.=$name." ";
}
$disp.="<BR>";

my @itemlist=(1..$MAX_ITEM);
@itemlist=grep($ITEM[$_]->{type}==$tp,@itemlist) if $tp;
@itemlist=grep(
	(
		$DTitem->[$_-1] ||
		$DTitemtoday->{$_} ||
		$DTitemyesterday->{$_} ||
		$DTexp->{$_}
	),
	@itemlist
);

if(!@itemlist)
{
	$disp.="<HR>在庫がありません";
}
else
{
	#@itemlist=sort{ $ITEM[$a]->{sort} <=> $ITEM[$b]->{sort} } @itemlist; # 特定環境でエラーになるため下記で代替
	my @sort;
	foreach(@itemlist){$sort[$_]=$ITEM[$_]->{sort}};
	@itemlist=sort{ $sort[$a] <=> $sort[$b] } @itemlist;
	
	my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
		=GetPage($pg,$LIST_PAGE_ROWS,scalar(@itemlist));
	
	$disp.=$TB;
	if($MOBILE)
	{
		$tdh_sp="標準:";
		$tdh_cs="維持:";
		$tdh_st="在庫:";
		$tdh_ts="本昨売:";
		$tdh_ex="熟練:";
		$tdh_sc="陳列:";
		$tdh_mp="相場:";
		$tdh_mb="需給:";
	}
	else
	{
		$disp.=$TR.$TD.
			join($TD,
				qw(
					名称
					標準<br>価格
					維持費<br>1個24時間分
					在庫数<br>/最大
					今期<br>前期<br>売上
					熟練度
					陳列
					販売価格<br>相場
					需要供給<br>バランス
				)
			).$TRE;
	}
	
	foreach my $cnt (map{$itemlist[$_]}($pagestart..$pageend))
	{
		my $ITEM=$ITEM[$cnt];
		
		my $name=GetTagImgItemType($cnt).$ITEM->{name};
		$name="<A HREF=\"item.cgi?no=$cnt&bk=s!$page!$tp&$USERPASSURL\">".$name."</A>" if $DTitem->[$cnt-1];
		
		$disp.=$TR.$TD.
			join($TD,
				$name,
				$tdh_sp."\\".$ITEM->{price},
				$tdh_cs."\\".$ITEM->{cost},
				$tdh_st.$DTitem->[$cnt-1]."/".$ITEM->{limit},
				$tdh_ts.($DTitemtoday->{$cnt} || $DTitemyesterday->{$cnt} ? ($DTitemtoday->{$cnt}||0)."/".($DTitemyesterday->{$cnt}||0) : '　'),
				$tdh_ex.($DTexp->{$cnt} ? int($DTexp->{$cnt}/10)."%" : '　'),
				$tdh_sc.($showcase{$cnt}||'　'),
				$tdh_mp.($ITEM->{marketprice} ? "\\".$ITEM->{marketprice} : '　'),
			).
			$TDNW.$tdh_mb.GetMarketStatusGraph($ITEM->{uppoint}||=10).
			$TRE;
	}
	$disp.=$TBE;
	
	$disp.=GetPageControl($pageprev,$pagenext,"tp=$tp","",$pagemax,$page);
}

1;
