# $Id: login.cgi 96 2004-03-12 12:25:28Z mu $

sub CheckLogin
{
	my($username,$password,$fn)=@_;
	
	$MASTER_USER=1 if $password eq $MASTER_PASSWORD;
	
	my $trueip=GetTrueIP();
	my $ua=$ENV{HTTP_USER_AGENT};
	my $hr=$ENV{HTTP_REFERER};
	my $ha=$ENV{HTTP_ACCEPT};
	my $ip=join("\t",GetTime2FormatTime($NOW_TIME),$trueip,$ua,$hr,$ha)."\n";
	
	if(!CheckPassword($password,$name2pass{$username}) && !$MASTER_USER)
	{
		if($name2pass{$username}) # exists username
		{
			my $DT=$DT[$name2idx{$username}];
			Lock();
			my $ref=ReadDTSub($DT,'login'); # $ref == $DT->{_login}
			$ref->{fail_count}++;
			$ref->{last_time}=$NOW_TIME;
			$ref->{last_ip}=$trueip;
			$ref->{last_ua}=$ua;
			$ref->{last_referer}=$hr;
			$ref->{last_accept}=$ha;
			WriteDTSub($DT,'login');
			UnLock();
		}
		OutErrorNoUser($username);
	}
	
	$session=crypt(rand(),GetSalt());
	$session=~s/[^0-9A-Za-z]//g;
	$session=substr($session,-5,5);
	
	open(SESS,$fn); my @client=<SESS>; close(SESS);
	if($MASTER_USER)
	{
		shift(@client);
	}
	else
	{
		$client[0]=$ip;
		my %same=();
		@client=grep(!$same{(split(/\t/,$_,2))[1]}++,@client);
	}
	open(SESS,">$fn");
	print SESS $session."\n";
	print SESS @client[0..9];
	close(SESS);
	
	if(!$MASTER_USER)
	{
		my $ipfile=GetPath($IP_FILE);
		my $overlap=0;
		my @buf=();
		Lock();
		if(open(DATA,$ipfile))
		{
			my @data=<DATA>;
			close(DATA);
			foreach my $line (@data)
			{
				@_=split(/\t/,$line,2);
				next if !defined($name2idx{$_[0]}) || $_[0] eq $username;
				@_=split(/\t/,$_[1]);
				$overlap=1 if $_[1] eq $trueip && $_[2] eq $ua; # && $_[4] eq $ha."\n";
				push(@buf,$line);
			}
			push(@buf,$username."\t".$ip);
		}
		else
			{WriteErrorLog("ip file read error ",$LOG_ERROR_FILE);}
		
		if(open(DATA,">$ipfile"))
		{
			print DATA @buf;
			close(DATA);
		}
		else
			{WriteErrorLog("ip file write error ",$LOG_ERROR_FILE);}
		
		UnLock();
		
		my $DT=$DT[$name2idx{$username}];
		OutErrorBlockLogin($DT->{blocklogin}) if $DT->{blocklogin} ne '' && $DT->{blocklogin} ne 'mark';
		OutErrorBlockLogin('重複登録疑惑') if !$MOBILE && $CHECK_IP && !$DT->{nocheckip} && $overlap;
		
		my $ref=ReadDTSub($DT,'login');
		if($ref && $ref->{fail_count})
		{
			my @report=(
				$ref->{fail_count},
				$ref->{last_time},
				$ref->{last_ip},
				$ref->{last_ua},
				$ref->{last_referer},
			);
			$ref->{fail_count}="";
			$ref->{last_time}="";
			$ref->{last_ip}="";
			$ref->{last_ua}="";
			$ref->{last_referer}="";
			$ref->{last_accept}="";
			Lock();
			WriteDTSub($DT,'login');
			OutError("attack report",@report);
		}
		
		if(!$MASTER_USER && $DT->{blocklogin} eq 'mark')
		{
			local $USER=$username;
			WriteErrorLog("$ENV{HTTP_USER_AGENT} $ENV{HTTP_ACCEPT}",$LOG_MARK_FILE);
		}
	}
	return $session;
}

1;
