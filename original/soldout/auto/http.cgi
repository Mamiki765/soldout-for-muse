# $Id: http.cgi 96 2004-03-12 12:25:28Z mu $

sub GetHash
{
	my($time,$str)=@_;
	my $len=length($str);
	my $hash=$time;
	my $seed=0;
	for(my $i=0; $i<$len; $i++)
	{
		my $val=unpack('C',substr($str,$i,1));
		$seed= $i&1 ? $seed*($val+1) : $seed/($val+1);
		$seed+=$val;
	}
	$seed=int($seed);
	for(my $i=0; $i<$len; $i++)
	{
		my $val=unpack('C',substr($str,$i,1));
		$val*=($seed+1);
		$seed=($val+substr($hash,-3,3)) & 255;
		$hash.=$val*($seed & 15);
		my $len1=int(length($hash)/2);
		my $len2=length($hash)-$len1;
		$hash=substr($hash,$len1,$len2).substr($hash,0,$len1);
	}
	$hash=substr($hash,int(length($hash)/4),32);
	return $hash.$time.sprintf("%02d",length($time));
}

sub CheckHash
{
	my($hash,$plain)=@_;
	return 0 if $hash eq '';
	my $len=substr($hash,-2,2);
	my $time=substr($hash,-($len+2),$len);
	return 0 if $time<time()-$PASSWORD_HASH_EXPIRE_TIME; #$PASSWORD_HASH_EXPIRE_TIME秒以上前のHashは無効
	return GetHash($time,$plain) eq $hash;
}

sub PostHTTP
{
	my($url,$query,$password,$header)=@_;
	
	$POSTHTTPERROR=0;
	
	return 'NOURL' if $url eq '';
	
	$url=~/^http:\/\/(.+?)(\/.+)$/;
	my($host,$file)=($1,$2);
	$query=$header."\n".GetHash(time(),$password)."\n".$query;
	my $length=length($query);
	
	# socket open
	my $addr=(gethostbyname($host))[4];
	my $name=pack("S n a4 x8",2,80,$addr);
	return 'NOTOPENSOCKET' if !socket(S,2,1,0);
	return 'NOTCONNECT' if !connect(S,$name);
	binmode(S);
	select(S); $|=1;
	select(STDOUT);
	
	print S join("\r\n",
		(
			"POST $file HTTP/1.0",
			"User-Agent: SOLD OUT($TOWN_CODE)",
			"Host: $host",
			"Referer: http://$host$file",
			"Content-Length: $length",
			"",
			$query
		)
	);
	$SIG{ALRM}=\&SocketTimeOut;
	alarm(60);
	while(<S>){s/[\r\n]//g; last if $_ eq "";}
	$GET_RETURN_CODE=<S>; $GET_RETURN_CODE=~s/[\r\n]//g;
	$GET_DATA="";
	while(<S>){$GET_DATA.=$_;}
	alarm(0);
	close(S);
	
	%GET_DATA=();
	$POSTHTTPERROR=1 if $GET_RETURN_CODE=~/[^A-Z]/;
	if($POSTHTTPERROR)
	{
		$GET_RETURN_CODE='ERROR';
		$GET_DATA='';
		$POSTHTTPERROR=0;
	}
	foreach(split(/\r?\n/,$GET_DATA))
	{
		$GET_DATA{$1}=$2 if /^\s*(.+?)\s*=\s*(.+)\s*$/;
	}
	
	return $GET_RETURN_CODE;
}

sub SocketTimeOut
{
	close(S);
	$POSTHTTPERROR=1;
	return "ERROR";
}
1;
