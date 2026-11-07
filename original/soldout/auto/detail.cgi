# $Id: detail.cgi 96 2004-03-12 12:25:28Z mu $

sub SortDT
{
	my($mode)=@_;
	
	@DT=grep($_->{status},@DT);
	foreach(@DT){$_->{point}=GetDTPoint($_);}
	@DT=sort{(!$a->{rankingyesterday})<=>(!$b->{rankingyesterday}) or $b->{point}<=>$a->{point}}@DT;
	
	%id2idx  =map{($DT[$_]->{id},$_)}(0..$#DT);
	%name2idx=map{($DT[$_]->{name},$_)}(0..$#DT);
}

sub GetItemUseTime
{
	my($USE)=@_;
	my $exp=$USE->{result}->{expold}ne'' ? $USE->{result}->{expold} : $DT->{exp}->{$USE->{itemno}};
	return $USE->{time}-int(($USE->{time}-$USE->{exptime})*$exp/1000);
}

sub GetRankMessage
{
	my($rank,$mode)=@_;
	my $per=int($rank/100);
	
	return $per.(!$mode?"%":"") if $MOBILE;
	
	my $bar="";
	$bar ="<nobr>";
	#$bar.=qq|<img src="$IMAGE_URL/b$IMAGE_EXT" style="width:|.(    $per).qq|; height:12">| if $per;
	$bar.=qq|<img src="$IMAGE_URL/b$IMAGE_EXT" width="|.(    $per).qq|" height="12">| if $per;
	#$bar.=qq|<img src="$IMAGE_URL/r$IMAGE_EXT" style="width:|.(100-$per).qq|; height:12">| if $per!=100 && !$mode;
	$bar.=qq|<img src="$IMAGE_URL/r$IMAGE_EXT" width="|.(100-$per).qq|" height="12">| if $per!=100 && !$mode;
	$bar.=" ".$per;
	$bar.="%" if !$mode;
	$bar.="</nobr><br>";
	
	return $bar;
}

#店舗売却税率計算
sub GetUserTaxRate
{
	my($DT)=@_;
	
	my $taxrate=int($DT->{profitstock}/20000);
	$taxrate=0 if $taxrate<0;
	$taxrate=50 if $taxrate>50;
	return $taxrate;
}

sub CheckShowCaseNumber
{
	my($DT,$sc)=@_;
	
	$sc+=0;
	OutError('そんな陳列棚はありません') if $sc<0 || $DT->{showcasecount}<=$sc;

	return $sc;
}

sub GetTopCountImage
{
	my($count)=@_;
	
	return $count."回優勝" if $MOBILE;
	
	my $ret="";
	if(!@TOP_COUNT_IMAGE_LIST)
	{
		# 以前の形式
		my $num=1;
		foreach my $cnt (1,3,6,10,20)
		{
			my $fn=$IMAGE_URL."/rank".$num.$IMAGE_EXT;
			$ret.="<IMG class=\"i\" SRC=\"$fn\" ALT=\"$cnt回優勝\">" if $count>=$cnt;
			$num++;
		}
	}
	else
	{
		# 新形式
		my @scale=@TOP_COUNT_IMAGE_LIST;
		my $max=10;
		my $master_count=$count;
		
		while($count>0 && $max && @scale)
		{
			my $num=$scale[0];
			shift(@scale),next if $count<$num;
			$count-=$num;
			$max--;
			$ret.=qq|<img class="rank_$num" src="$IMAGE_URL/rank-$num$IMAGE_EXT">|;
		}
		$ret.="($master_count)";
	}
	
	return $ret;
}

sub GetMoneyMessage
{
	my($money)=@_;
	
	$money=int(($money+9999)/10000);
	foreach my $rank (10,20,50,100,500,1000,5000,10000,50000,100000)
	{
		return $rank."<FONT SIZE=\"-3\">万円以下</FONT>" if $money<=$rank;
	}
}

sub GetTaxToday
{
	my($DT)=@_;
	
	my $tax=$DT->{moneystock}-1000000;
	my $taxrate=0;
	
	$tax=0 if $tax<0;
	if($tax)
	{
		$taxrate=10+int($tax/1000000);
		$taxrate=80 if $taxrate>80;
		$tax=int($tax*$taxrate/100);
	}
	return ($tax,$taxrate);
	
	#my $tax=$DT->{saleyesterday}-$DT->{paytoday}-100000;
	#my $taxrate=0;
	#$tax=0 if $tax<0;
	#if($tax)
	#{
	#	$taxrate=50+int($tax/58000);
	#	$taxrate=80 if $taxrate>80;
	#	$tax=int($tax*$taxrate/100);
	#}
	#return ($tax,$taxrate);
}

sub GetTagImgShopIcon
{
	my($icon)=@_;
	
	return "" if $MOBILE || $icon eq '';
	
	return qq|<img src="$IMAGE_URL/shop-$icon$IMAGE_EXT" class="shopicon">|;
}

1;
