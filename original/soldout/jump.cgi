#! /usr/local/bin/perl
# $Id: jump.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
$NOMENU=1;
require './_base.cgi';

GetQuery();
#DataRead();
#CheckUserPass(1);

JumpGuild($Q{guild}) if $Q{guild} ne '';
JumpMyGuild($Q{myguild},$Q{hash}) if $Q{myguild} ne '' && $JUMP_MY_GUILD;
JumpTown($Q{town}) if $Q{town} ne '';
JumpGmsgTown($Q{gmsgtown}) if $Q{gmsgtown} ne '';
JumpMarket($Q{market}) if $Q{market} ne '' && $MARKET_ENABLE;

OutHTML('各種リンク','指定されたリンクは存在しません');
exit;

sub JumpGuild
{
	my($code)=@_;
	my $guild=ReadGuild($code);
	return if !$guild || $guild->{url} eq '';
	my $disp="";
	$disp.="ギルド ".GetTagImgGuild($code).$guild->{name}."<br>";
	$disp.="<br>".$guild->{comment}."<br><br>";
	$disp.=GetTagA($guild->{name}."へ自動的にジャンプします。しない場合はこのリンクを辿ってください。",$guild->{url})."<br>";
	print "Refresh: 1; url=$guild->{url}\n";
	OutHTML('ギルド:AUTO JUMP',$disp);
	exit;
}

sub JumpMyGuild
{
	my($name,$hash)=@_;
	DataRead();
	return if !exists $name2idx{$name};
	my $DT=$DT[$name2idx{$name}];
	my $code=$DT->{guild};
	return if !$code;
	my $guild=ReadGuild($code);
	return if !$guild || $guild->{url} eq '';
	my $url=$guild->{url};
	if($JUMP_MY_GUILD_SEND_PARAM && $guild->{recvparam})
	{
		# _config.cgi 設定 $JUMP_MY_GUILD_SEND_PARAM=1;
		# ギルドパラメータ recvparam=allow
		# 上記条件を満たす場合、アクセス元の情報をギルドURLのパラメータ(クエリー)に含めます。
		# http://guild-url?from_soldout=....
		# いろいろ問題があるかもしれないので非公開仕様とします。
		my %p=();
		$p{url}=$TOP_PAGE;
		if(!$p{url})
		{
			$p{url}="$ENV{SERVER_NAME}$ENV{REQUEST_URI}";
			$p{url}=~s/\/[^\/]*?$/\/index.cgi/;
			$p{url}="http://$p{url}" if $p{url};
		}
		$p{username}=$DT->{name};
		$p{shopname}=$DT->{shopname};
		$p{townname}=$TOWN_NAME||$HTML_TITLE;
		$p{name}=$p{shopname}."[".$p{username}."]\@".$p{townname};
		if(%p)
		{
			my $param="";
			while(my($key,$val)=each %p)
			{
				next if $val eq "";
				$key=~s/(\W)/"%".unpack("H2",$1)/ge;
				$val=~s/(\W)/"%".unpack("H2",$1)/ge;
				$param.="$key=$val&";
			}
			if($param)
			{
				chop $param; # remove '&'
				$param=~s/(\W)/"%".unpack("H2",$1)/ge;
				$url.="?from_soldout=".$param;
			}
		}
	}
	my $disp="";
	$disp.="所属ギルド ".GetTagImgGuild($code).$guild->{name}."<br>";
	$disp.="<br>".$guild->{comment}."<br><br>";
	$disp.=GetTagA($guild->{name}."へ自動的にジャンプします。しない場合はこのリンクを辿ってください。",$url)."<br>";
	print "Refresh: 1; url=$url\n";
	OutHTML('所属ギルド:AUTO JUMP',$disp);
	exit;
}

sub JumpTown
{
	my($code)=@_;
	my $town=ReadTown($code);
	return if !$town || $town->{url} eq '';
	print "Refresh: 1; url=$town->{url}\n";
	OutHTML('近くの街:AUTO JUMP',GetTagA($town->{name}."へ自動的にジャンプします。しない場合はこのリンクを辿ってください。",$town->{url}));
	exit;
}

sub JumpGmsgTown
{
	my($code)=@_;
	my $town=ReadTown($code);
	
	my $jumpurl='';
	my $jumptownname='';
	
	if($town && $town->{url} ne '')
	{
		$jumpurl=$town->{url};
		$jumptownname=$town->{name};
	}
	
	if($jumpurl eq '')
	{
		foreach($GLOBAL_MSG_FILE,map{$GLOBAL_MSG_FILE.'-'.$_}keys %GMSG_CATEGORY_NAME)
		{
			open(IN,GetPath($_));
			while(<IN>)
			{
				chop;
				my($tm,$msgid,$replymsgid,$townname,$shopname,$message,$category,$url)=split /\t/;
				my($towncode)=($msgid=~/(\w+)$/);
				$jumpurl=$url,$jumptownname=$townname,last if $towncode eq $code && $url ne '';
			}
			close(IN);
			last if $jumpurl ne '';
		}
	}
	
	if($jumpurl eq '')
	{
		OutHTML(
			$GLOBAL_MSG_TITLE.':AUTO JUMP',
			'街へのリンク情報が見つかりませんでした。'.
				GetTagA('[外部接続先]',"$URL_GLOBAL_MSG_CENTER?centerlist").
				'から探してみてください。'
		);
	}
	else
	{
		print "Refresh: 1; url=$jumpurl\n";
		OutHTML($GLOBAL_MSG_TITLE.':AUTO JUMP',GetTagA($jumptownname."へ自動的にジャンプします。しない場合はこのリンクを辿ってください。",$jumpurl));
	}
	exit;
}

sub JumpMarket
{
	my($code)=@_;
	my $market={ReadConfig("$MARKET_DIR/$code.cgi")};
	return if !$market || !$market->{forward_url};
	my $disp="";
	$disp.='外出先:'.$market->{name}."<br>";
	$disp.="<br>".$market->{comment}."<br><br>";
	$disp.=GetTagA($market->{name}."へ自動的にジャンプします。しない場合はこのリンクを辿ってください。",$market->{forward_url})."<br>";
	print "Refresh: 1; url=$market->{forward_url}\n";
	OutHTML('外出先:AUTO JUMP',$disp);
	exit;
}
