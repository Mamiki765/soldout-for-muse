# $Id: user.cgi 96 2004-03-12 12:25:28Z mu $

sub GetTagImgGuild
{
	my($guildcode,$noimage,$movetown)=@_;
	
	return "" if $guildcode eq '';
	my $name=$GUILD{$guildcode}->[$GUILDIDX_name];
	$name=(!$movetown ? "解散したギルド":"この街に存在しないギルド") if $name eq '';
	return $name."所属 " if $MOBILE || $noimage;
	return qq|<IMG class="s" ALT="$name 所属" SRC="$IMAGE_URL/guild-$guildcode$IMAGE_EXT"> |;
}

sub GetStockTime
{
	my($tm)=@_;
	my $tmp=$NOW_TIME-$tm;
	$tmp=$MAX_STOCK_TIME if $tmp>$MAX_STOCK_TIME;
	
	return $tmp;
}

sub GetID2UserName
{
	my($to)=@_;
	return ("貿易","") if $to==1;
	return ($DT[$id2idx{$to}]->{shopname},$DT[$id2idx{$to}]->{name}) if defined($id2idx{$to});
	return ('閉店済','');
}

sub CheckUserID
{
	my($id,$enable0)=@_;
	$id+=0;
	
	return 0 if $enable0 && !$id;
	OutError('その店舗は存在しません。') if !defined($id2idx{$id});

	return ($id,$id2idx{$id});
}

sub UseTime
{
	my($tm)=@_;
	
	if($DT->{status})
	{
		my $tmp=$NOW_TIME-$DT->{time};
		$DT->{time}=$NOW_TIME-$MAX_STOCK_TIME if $tmp>$MAX_STOCK_TIME;
		
		OutError('時間待ちでしょ？') if $tmp<0 && $USER ne '';
		
		$DT->{time}+=$tm;
	}
}

sub GetUserData
{
	#$_[0]->{user}={split(/[\t,]/,$_[0]->{user})} if !ref($_[0]->{user});
	return $_[0]->{user};
}

sub SetUserData
{
	#$_[0]->{user}=join(",",%{$_[0]->{user}}) if ref($_[0]->{user}) eq "HASH";
}

sub GetUserDataEx
{
	my($DT,$key)=@_;
	$key=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
	my $val=$DT->{user}{$key}||($DT->{user}{$key} eq '0' ? 0 : '');
	$val=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
	return $val;
}

sub SetUserDataEx
{
	my($DT,$key,$val)=@_;
	$key=~s/([\x00-\x1f,%:])/'%'.unpack("H2",$1)/ge;
	$val=~s/([\x00-\x1f,%:])/'%'.unpack("H2",$1)/ge;
	delete($DT->{user}{$key}),return '' if $val eq '';
	return $DT->{user}{$key}=$val;
}

sub ReadDTSub
{
	my($DT,$tag)=@_;
	
	return 0 if !$DT or !$DT->{name}; # error $DT
	return $DT->{"_$tag"}={} if !open(IN,GetPath($SUBDATA_DIR,$DT->{name}."-$tag")); # no file
	
	my @line=<IN>; # IN: key <LF> value <LF> key <LF> value <LF> ...
	close(IN);
	chop @line;
	
	foreach(@line){s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg} # unescape
	
	return $DT->{"_$tag"}={@line};
}

sub WriteDTSub
{
	my($DT,$tag)=@_;
	
	CheckLockStatus();
	
	return 0 if !$DT or !$DT->{name}; # error $DT
	
	my $data=$DT->{"_$tag"}||{};
	while(my($key,$val)=each %$data){delete $data->{$key} if $data->{$key} eq ""} # delete empty data
	
	my @line=%$data;
	foreach(@line){s/([\x00-\x1f%])/'%'.unpack("H2",$1)/ge} # escape
	
	OpenAndCheck(GetPath($SUBDATA_DIR,$DT->{name}."-$tag"));
	#return 0 if !open(OUT,">".GetPath($SUBDATA_DIR,$DT->{name}."-$tag")); # cannot open file
	
	print OUT join "\n",@line,"";
	close(OUT);
	
	return 1;
}

sub EditMoney
{
	my($DT,$money)=@_;
	
	$DT->{money}+=int $money;
	$DT->{money}=$MAX_MONEY if $DT->{money}>$MAX_MONEY;
	$DT->{money}=0          if $DT->{money}<0;
}

sub EditTime
{
	my($DT,$time)=@_;
	
	my $stock=$DT->{time};
	$stock=$NOW_TIME-$MAX_STOCK_TIME if $stock<$NOW_TIME-$MAX_STOCK_TIME;
	$stock-=int $time;
	$stock=$NOW_TIME-$MAX_STOCK_TIME if $stock<$NOW_TIME-$MAX_STOCK_TIME;
	$DT->{time}=$stock;
}

sub GetExpireTimeExtend
{
	my($DT)=@_;
	my $expire_ex=int(($DT->{lastlogin}-$DT->{foundation})/86400)*$EXPIRE_EX_TIME;
	$expire_ex=$EXPIRE_MAX_TIME if $expire_ex>$EXPIRE_MAX_TIME;
	return $expire_ex;
}
1;
