# $Id: town.cgi 96 2004-03-12 12:25:28Z mu $

sub ReadTown
{
	my($towncode,$getown)=@_;
	
	my @TOWN=();
	
	my @townlist=();
	
	opendir(DIR,$TOWN_DIR);
	@townlist=sort map{/^(\w+)$FILE_EXT$/} grep(/^\w+$FILE_EXT$/,readdir(DIR));
	closedir(DIR);
	@townlist=grep($_ eq $towncode,@townlist) if $towncode ne '';
	@townlist=grep($_ ne $TOWN_CODE,@townlist) if !$getown;
	my %denyhash=map{($_,1)}@DENY_TOWN;
	
	foreach my $code (@townlist)
	{
		next if $denyhash{$code};
		push(@TOWN,{'code',$code,(ReadConfig("$TOWN_DIR/$code$FILE_EXT"))});
	}
	
	return $towncode ne '' ? $TOWN[0] : (@TOWN);
}

sub ReadSubData
{
	my($DT)=@_;
	
	my $subdata={};
	open(IN,GetPath($SUBDATA_DIR,$DT->{name}."-s"));
	while(<IN>)
	{
		chop;
		/^\s*(.+?)\s*=\s*(.+)\s*$/;
		$subdata->{$1}=$2;
	}
	close(IN);
	return $subdata;
}

sub GetDataTree
{
	my($tree)=@_;
	my $str="";
	
	my $type=ref($tree);
	
	if(!$type)
	{
		$str.=GetString($tree).",";
	}
	if($type eq 'SCALAR')
	{
		$str.=GetString($$tree).",";
	}
	if($type eq 'REF')
	{
		$str.=GetDataTree($$tree);
	}
	if($type eq 'ARRAY')
	{
		$str.="[";
		foreach my $data (@$tree)
		{
			$str.=GetDataTree($data);
		}
		$str.="],";
	}
	if($type eq 'HASH')
	{
		my %hash=%$tree;
		$str.="{";
		foreach my $key (keys(%hash))
		{
			$str.="'$key'=>";
			$str.=GetDataTree($hash{$key});
		}
		$str.="},";
	}
	return $str;
}

sub GetTownDistance
{
	my @dist1=split(/[^\d\-]+/,$_[0],3);
	my @dist2=split(/[^\d\-]+/,$_[1],3);
	return int(sqrt(($dist1[0]-$dist2[0])**2+($dist1[1]-$dist2[1])**2))*5;
}

sub GetMoveTownTime
{
	my($DT,$town1,$town2)=@_;
	
	my $basetime=GetTownDistance($town1->{position},$town2->{position})*60;
	
	my $stocktime=0;
	my $itembox=$DT->{item};
	foreach(1..$MAX_ITEM)
	{
		my $stock=$itembox->[$_-1];
		next if !$stock;
		
		$stocktime+=$ITEM[$_]->{price}*$stock;
	}
	$stocktime=int($stocktime/100);
	
	#$disp.=$basetime.":".$stocktime;
	
	return $basetime+$stocktime;
}

sub GetTownData
{
	my($key)=@_;
	$key=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
	my $val=$DTtown->{$key}||($DTtown->{$key} eq '0' ? 0 : '');
	$val=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
	return $val;
}

sub SetTownData
{
	my($key,$val)=@_;
	$key=~s/([\x00-\x1f,%])/'%'.unpack("H2",$1)/ge;
	$val=~s/([\x00-\x1f,%])/'%'.unpack("H2",$1)/ge;
	delete($DTtown->{$key}),return '' if $val eq '';
	return $DTtown->{$key}=$val;
}

1;
