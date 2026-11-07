#! /usr/local/bin/perl
# $Id: gmsg-s.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
require './_base.cgi';

Error('DISNABLED GLOBAL-MESSAGE-SYSTEM') if !$USE_GLOBAL_MSG;
Error('NOT SET $TOWN_CODE') if !$TOWN_CODE;
Error("NOT ALLOW ADDR $ENV{REMOTE_ADDR}") if $GLOBAL_MSG_HOST_ALLOW ne '' && $ENV{REMOTE_ADDR}!~/$GLOBAL_MSG_HOST_ALLOW/;
Error("NOT POST") if $ENV{REQUEST_METHOD} ne "POST";

read(STDIN,$query,$ENV{CONTENT_LENGTH});
@buffer=split(/\n/,$query);

$command=shift @buffer;

$townmaster=ReadTown($TOWN_CODE,'getown');
Error("NO OWN TOWN") if !$townmaster;

# chack password hash
$passwordhash=shift @buffer;
Error("PASSWORD ERROR $passwordhash") if !CheckHash($passwordhash,$townmaster->{password});

if($command eq 'CHECK USER')
{
	my $name=shift @buffer; $name=~s/[^\w\-]//g;
	my $sess=shift @buffer; $sess=~s/\W//g;
	my $fn="$SESSION_DIR/$name.cgi";
	Error("TIME OUT [$name] [$sess]") if (stat($fn))[9]<$NOW_TIME-$SESSION_TIMEOUT_TIME || !open(SESS,$fn);
	$_=<SESS>;
	close(SESS);
	chop;
	Error("TIME OUT [$name] [$sess]") if $_ ne $sess;
	
	DataRead();
	
	my $shopname=$name eq 'soldoutadmin' ? '<b>管理人</b>' : ($DT[$name2idx{$name}]->{shopname}."[$name]");
	my $id      =$name eq 'soldoutadmin' ? 0 : $DT[$name2idx{$name}]->{id};
	print "Content-type: text/plain\n\nOK\nshopname=$shopname\nid=$id\n";
}
elsif($command eq 'POST MESSAGE')
{
	@buffer=grep($_ ne '',@buffer);
	
	Lock();
		
		my %writefile=();
		foreach my $message (reverse sort @buffer)
		{
			my @filed=split /\t/,$message;
			
			my $gmsgcategory=$filed[6];
			$gmsgcategory=~s/\W//g;
			my $gmsgfile=$GLOBAL_MSG_FILE;
			$gmsgfile.='-'.$gmsgcategory if $gmsgcategory;
			
			my $writefile=GetPath($gmsgfile);
			$writefile=GetPath($TEMP_DIR,$gmsgfile) if exists $writefile{$writefile};
			$writefile{$writefile}=1;
			
			open(IN,$writefile);
			my @data=<IN>;
			close(IN);
			
			unshift(@data,$message."\n");
			
			$MAX_GLOBAL_MSG_MESSAGE=20 if !$MAX_GLOBAL_MSG_MESSAGE;
			splice(@data,$MAX_GLOBAL_MSG_MESSAGE);
			OpenAndCheck($writefile);
			print OUT @data;
			close(OUT);
		}
		DataCommitOrAbort();
	
	UnLock();
	print "Content-type: text/plain\n\nOK\n\n";
}

exit;

sub Error
{
	WriteErrorLog($_[0],$LOG_GLOBAL_MSG_FILE);
	exit;
}
