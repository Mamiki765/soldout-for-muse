# $Id: log.cgi 96 2004-03-12 12:25:28Z mu $

# 最近の出来事や掲示板/井戸端のデータが必要な時に読み込む

sub ReadLog
{
	my($id,$mode,$keyword,$target)=@_;
	
	undef @MESSAGE;
	
	$id=$DT->{id} if $id eq '';
	
	if($BBSMODE || $CHATMODE)
	{
		open(IN,GetPath($LOG_FILE));
		@MESSAGE=<IN>;
		close(IN);
	}
	else
	{
		open(IN,GetPath($LOG_FILE."-s0"));
		push(@MESSAGE,<IN>);
		close(IN);
		open(IN,GetPath($LOG_FILE."-s1"));
		push(@MESSAGE,<IN>);
		close(IN);
		
		@MESSAGE=grep(/^\d+,\d+,($id|0),/o,@MESSAGE);
		if($mode)
		{
			$mode+=0;
			@MESSAGE=grep(/^\d+,$mode,/o,@MESSAGE);
		}
		if($keyword)
		{
			require $JCODE_FILE;
			$keyword=jcode::sjis($keyword,$CHAR_SHIFT_JIS&&'sjis');
			@MESSAGE=grep(/\Q$keyword\E/oi,@MESSAGE);
		}
		if($target)
		{
			require $JCODE_FILE;
			$target=jcode::sjis($target,$CHAR_SHIFT_JIS&&'sjis');
			@MESSAGE=grep(/\Q$target\E/o,@MESSAGE);
		}
		@MESSAGE=("0,0,0,0,情報はありません,0\n") if !scalar(@MESSAGE);
	}
}

sub WriteLog
{
	my($mode,$from,$to,$msg,$nolock)=@_;
	
	my @data=();
	
	Lock() if !$nolock;

	CheckLockStatus(); #念のためロックチェック（本来はチェックに引っかからないハズだけど…）
	
	if($BBSMODE || $CHATMODE)
	{
		open(IN,GetPath($LOG_FILE));
		@data=<IN>;
		close(IN);
		
		my $no=(split(/,/,$data[0]))[5]+1;
		$no=1 if $no>scalar(@data)*2;
		unshift(@data,"$NOW_TIME,$mode,$from,$to,$msg,$no\n");
		if($BBSMODE)
		{
			$MAX_BBS_MESSAGE=20 if !$MAX_BBS_MESSAGE;
			splice(@data,$MAX_BBS_MESSAGE);
		}
		elsif($CHATMODE)
		{
			$MAX_CHAT_MESSAGE=20 if !$MAX_CHAT_MESSAGE;
			splice(@data,$MAX_CHAT_MESSAGE);
		}
		OpenAndCheck(GetPath($TEMP_DIR,$LOG_FILE));
		print OUT @data;
		close(OUT);
	}
	else
	{
		my $s0=GetPath($LOG_FILE."-s0");
		my $s1=GetPath($LOG_FILE."-s1");
		my $s2=GetPath($LOG_FILE."-s2");
		my $tempfile=GetPath($TEMP_DIR,$LOG_FILE."-s0");
		
		push(@data,"$NOW_TIME,$mode,$from,$to,$msg,\n");
		if($PERIOD_MODE)
		{
			open(OUT,">>".GetPath($TEMP_DIR,$PERIOD_FILE));
			print OUT @data;
			close(OUT);
		}
		if((stat($s1))[9]<$NOW_TIME-$LOG_EXPIRE_TIME)
		{
			RenameAndCheck($s1,$s2) if -e $s1;
			RenameAndCheck($s0,$s1) if -e $s0;
		}
		else
		{
			open(IN,(-e $tempfile ? $tempfile : $s0));
			push(@data,<IN>);
			close(IN);
		}
		OpenAndCheck($tempfile);
		print OUT @data;
		close(OUT);
	}

	DataCommitOrAbort(),UnLock() if !$nolock;
}

sub WriteBBS
{
	# global args
	# $LOG_FILE=$BBS_FILE or $LOG_FILE=$CHAT_FILE
	# $BBSMODE=1 or $CHATMODE=1
	my($msg,$maxlength)=@_;
	
	return ('','') if !$msg;
	
	return ($msg,'発言は半角'.$maxlength.'文字(全角'.int($maxlength/2).'文字)までです。現在半角'.length($msg).'文字です。<br>')
		if length($msg)>$maxlength;
	
	require $JCODE_FILE;
	my $msg=CutStr(jcode::sjis($msg,$CHAR_SHIFT_JIS&&'sjis'),$maxlength);
	$msg=~s/&/&amp;/g;
	$msg=~s/>/&gt;/g;
	$msg=~s/</&lt;/g;
	
	my $securemode=($BBSMODE && $SECURE_MODE_BBS or $CHATMODE && $SECURE_MODE_CHAT);
	my $count=0;
	my $wait=0;
	my $lasttm=0;
	ReadLog();
	foreach(@MESSAGE)
	{
		my($tm,$mode,$dummy,$id,$msgline,$no)=split(/,/);
		($msgline)=split(/\t/,$msgline);
		next if $DT->{id}!=$id;
		return ('','重複投稿は出来ません。<br>') if $tm>$NOW_TIME-60*15 && $msgline eq $msg;
		$count++,$wait+=3**$count/($NOW_TIME-$tm+1) if $securemode && $count<10;
		$lasttm||=$tm;
	}
	$wait=int($lasttm+$wait-$NOW_TIME);
	return ('','連続投稿は出来ません。あと'.$wait.'秒お待ち下さい。<br>') if $wait>0;
	
	Lock();
	WriteLog(0,0,0,$msg,1) if $MASTER_USER;
	WriteLog(0,0,$DT->{id},$msg."\t".$DT->{shopname}."\t".$DT->{name},1) if !$MASTER_USER;
	DataCommitOrAbort();
	UnLock();
	return ('','');
}

1;
