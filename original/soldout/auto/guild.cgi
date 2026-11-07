# $Id: guild.cgi 96 2004-03-12 12:25:28Z mu $

# ギルド関連処理

sub ReadGuildData
{
	undef %GUILD_DATA;
	open(IN,GetPath($GUILDBAL_FILE));
	while(<IN>)
	{
		chop;
		@_=split(/\t/,$_,2);
		$GUILD_DATA{$_[0]}={split(/\t/,$_[1])};
	}
	close(IN);
}

sub WriteGuildData
{
	OpenAndCheck(GetPath($TEMP_DIR,$GUILDBAL_FILE));
	foreach(keys(%GUILD))
	{
		print OUT $_."\t".join("\t",%{$GUILD_DATA{$_}})."\n";
	}
	close(OUT);
}

sub EditGuildMoney
{
	my($guildcode,$money)=@_;
	my $guild=$GUILD_DATA{$guildcode};
	$guild->{in} += $money if $money>0;
	$guild->{out}+=-$money if $money<0;
	$guild->{money}+=$money;
}

sub CheckGuild
{
	my $dt1guild=$_[0]->{guild};
	my $dt2guild=$_[1]->{guild};
	my $price=$_[2];
	my $margin=0;
	my $rate=1000;
	my $type=0; # 0:片方or双方ギルド無所属 1:同ギルド 2:異ギルド -1:補助金不足
	
	if($dt1guild ne '' && $dt2guild ne '')
	{
		$type=$dt1guild eq $dt2guild ? 1 : 2;
		my $guildrate=$GUILD{$dt1guild}->[$GUILDIDX_dealrate];
		$rate+=$type==1 ? -$guildrate : $guildrate;
		$margin=int($price*$guildrate/1000);
		ReadGuildData() if !defined(%GUILD_DATA);
		if($margin)
		{
			$type=-1,$margin=0 if $type==1 && $GUILD_DATA{$dt1guild}->{money}<=0; #$margin;
		}
	}
	return($type,$rate,$margin);
	#return (ギルド所属状態,取引金額倍率,割引/割増額)
}

sub ReadGuild
{
	my($code)=@_;
	
	undef %GUILD_DETAIL;
	
	my @guildlist=GetGuildDirFiles();
	
	return "" if !scalar(@guildlist);
	
	foreach my $code (@guildlist)
	{
		my @data=ReadConfig(GetPath($GUILD_DIR,$code));
		$GUILD_DETAIL{$code}={'code',$code,@data} if scalar(@data);
	}
	
	return ($code ne '' ? $GUILD_DETAIL{$code} : "");
}

sub GetGuildDirFiles
{
	opendir(DIR,$GUILD_DIR);
	my @guildlist=sort map{/^(\w+)$FILE_EXT$/} grep(/^\w+$FILE_EXT$/,readdir(DIR));
	closedir(DIR);
	return @guildlist;
}

sub MakeGuildFile
{
	my @guildlist=GetGuildDirFiles();
	
	OpenAndCheck(GetPath($TEMP_DIR,$GUILD_FILE));
	print OUT '$GUILDIDX_name=0;$GUILDIDX_dealrate=1;$GUILDIDX_feerate=2;';
	print OUT '%GUILD=(';
	foreach my $code (keys(%GUILD_DETAIL))
	{
		my $detail=$GUILD_DETAIL{$code};
		print OUT "'$code'=>[";
		print OUT (GetString($detail->{shortname})),",";
		print OUT $detail->{dealrate}.",";
		print OUT $detail->{feerate}.",";
		print OUT "],";
	}
	print OUT ');1;';
	close(OUT);
	
	my %okguild=map{($_,1)}keys(%GUILD_DETAIL);
	foreach my $code (grep(!$okguild{$_},keys(%GUILD)))
	{
		next if $code eq '';
		WriteLog(1,0,0,"ギルド「".$GUILD{$code}->[$GUILDIDX_name]."」が解散しました",1);
		foreach my $DT (@DT)
		{
			if($DT->{guild} eq $code)
			{
				$DT->{guild}="";
				$DT->{money}+=200000;
				WriteLog(0,$DT->{id},0,"ギルド「".$GUILD{$code}->[$GUILDIDX_name]."」が解散し、入会金が返還されました",1);
			}
		}
	}
}

1;
