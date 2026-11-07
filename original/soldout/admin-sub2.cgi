#! /usr/local/bin/perl
# $Id: admin-sub2.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();
CheckUserPass();

OutError("") if !$MASTER_USER;

$NOMENU=1;
$Q{bk}="none";
if($Q{targz})
{
	my $filename="backup.tar.gz";
	
	Lock();
	my $body=`tar pcvzf - $DATA_DIR/*$FILE_EXT $SUBDATA_DIR`;
	UnLock();
	
	print "Content-type: application/download\n";
	print "Content-disposition: filename=\"$filename\"\n";
	print "Content-Length: ",(length $body),"\n";
	print "\n";
	print $body;
}
elsif($Q{usercheck})
{
	my $filename="usercheck.tar.gz";
	
	my $body=`tar pcvzf - $SESSION_DIR/*$FILE_EXT $DATA_DIR/$DATA_FILE$FILE_EXT $DATA_DIR/$IP_FILE$FILE_EXT`;
	
	print "Content-type: application/download\n";
	print "Content-disposition: filename=\"$filename\"\n";
	print "Content-Length: ",(length $body),"\n";
	print "\n";
	print $body;
}
elsif($Q{log})
{
	GetLog();
	OutHTML('各種ログ',$disp);
}
elsif($Q{towndata})
{
	GetTownData();
	OutHTML('街データ一覧($DTtown)',$disp);
}
elsif($Q{nanclean} ne '')
{
	#nanになってしまったデータを0に修正
	
	Lock();
	DataRead();
	#CheckUserPass();
	
	my $count=0;
	$count+=correct_nan(
		\$DTlasttime,\$DTpeople,\$DTnextid,\$DTblockip,\$DTTradeIn,\$DTTradeOut,
	);
	foreach my $idx (0..$#DTwholestore)
	{
		$count+=correct_nan(\$DTwholestore[$idx]);
	}
	foreach my $idx (keys %DTevent)
	{
		$count+=correct_nan(\$DTevent{$idx});
	}
	foreach my $DT (@DT)
	{
		foreach my $idx (@DTindexnamelist_num)
		{
			$count+=correct_nan(\$DT->{$idx});
		}
		foreach my $idx (1..$DT->{showcasecount})
		{
			$count+=correct_nan(\$DT->{showcase}[$idx],\$DT->{price}[$idx]);
		}
		foreach my $idx (1..$#ITEM)
		{
			$count+=correct_nan(\$DT->{item}[$idx-1]);
			$count+=correct_nan(\$DT->{itemyesterday}{$idx}) if exists $DT->{itemyesterday}{$idx};
			$count+=correct_nan(\$DT->{itemtoday}{$idx}) if exists $DT->{itemtoday}{$idx};
			$count+=correct_nan(\$DT->{exp}{$idx}) if exists $DT->{exp}{$idx};
		}
		sub correct_nan
		{
			my $count=0;
			foreach my $ref (@_)
			{
				$$ref=0,$count++ if $$ref=~/[^\d\.\-\+]/;
			}
			return $count;
		}
	}
	
	OutHTML('NaN除去','合計'.$count.'箇所が "NaN" に汚染されていました');
	DataWrite();
	DataCommitOrAbort();
	UnLock();
}
elsif($Q{editbbs} ne '')
{
	my $html="";
	my $filelist={
		bbs		=>	$BBS_FILE,
		chat	=>	$CHAT_FILE,
		gmsg	=>	$GLOBAL_MSG_FILE,
		map{("gmsg-$_","$GLOBAL_MSG_FILE-$_")}keys %GMSG_CATEGORY_NAME,
	};
	my $type=exists $filelist->{$Q{editbbs}} ? $Q{editbbs} : "bbs";
	
	$html.=join " ",map{GetTagA("[$_]","$MYNAME?editbbs=$_&$USERPASSURL")}sort keys %$filelist;
	$html.="<hr>\n";
	
	if($Q{editbbs_msgno} and $Q{editbbs_msg} || $Q{editbbs_delete})
	{
		Lock();
		OpenAndCheck(GetPath($TEMP_DIR,$filelist->{$type}));
		
		my $msgno=$Q{editbbs_msgno};
		my $msg=$Q{editbbs_delete} ? "" : $Q{editbbs_msg}||"";
		$msg=EscapeHTML($msg) if $type!~/^gmsg/;
		my $adminmsg="";
		my $townname=$type=~/^gmsg/ ? $HTML_TITLE : "";
		$adminmsg=$msg ? '<b>('.$townname.'管理人編集)</b>' : '<b>('.$townname.'管理人削除)</b>' if $Q{editbbs_admin};
		$msg||=" "; # なんとなく
		
		local *IN;
		open IN,"$DATA_DIR/$filelist->{$type}$FILE_EXT";
		while(<IN>)
		{
			my $line=$_;
			if($type!~/^gmsg/)
			{
				$line=~s/,(?:[^,\t]+?)((?:\t[^\t]*\t[^\t]*)?,$msgno)$/,$adminmsg$msg$1/;
			}
			else
			{
				$line=~s/^(\d+\t$msgno\t)[^\t]*(\t[^\t]*\t[^\t]*\t)[^\t]+/$1$adminmsg$2$msg/;
			}
			print OUT $line;
		}
		close(IN);
		close(OUT);
		DataCommitOrAbort();
		UnLock();
	}
	
	$html.=qq|<form action="$MYNAME" method="POST"><input type="hidden" name="editbbs" value="$type">$USERPASSFORM\n|;
	$html.= q|下記一覧から編集/削除対象を選択し、メッセージを入力/チェックボックスを選択してください。<br>|."\n";
	$html.= q|メッセージ<input type="text" name="editbbs_msg" size="50" value=""><br>|."\n";
	$html.= q|<input type="checkbox" name="editbbs_delete" value="delete">内容を空白にする(削除)<br>|."\n";
	$html.= q|<input type="checkbox" name="editbbs_admin" value="admin" checked>管理人による編集/削除を公表する<br>|."\n";
	$html.= q|<input type="submit" value="編集/削除する"><hr>|."\n";
	
	local *IN;
	open IN,"$DATA_DIR/$filelist->{$type}$FILE_EXT";
	while(<IN>)
	{
		tr/\n\r//d;
		my $line=$_;
		my($time,$no,$msg,$author,$adminmsg);
		if($type!~/^gmsg/)
		{
			my @fld=split /,/,$line;
			$time=$fld[0];
			$no=$fld[5];
			my @msg=split /\t/,$fld[4];
			$author="$msg[1]\[$msg[2]\]";
			$msg=$msg[0];
		}
		else
		{
			my @fld=split /\t/,$line;
			$time=$fld[0];
			$no=$fld[1];
			$author="$fld[3] $fld[4]";
			$adminmsg=$fld[2];
			$msg=EscapeHTML($fld[5]);
		}
		$html.=qq|<input type="radio" name="editbbs_msgno" value="$no">|.($adminmsg.$msg." - ".$author)."<br>\n";
	}
	close(IN);
	$html.=qq|</form>|;
	
	OutHTML('掲示板系管理',$html);
}
else
{
	GetMember();
	OutHTML('メンバーリスト',$disp);
}

exit;

sub GetFileList
{
	my($dir,$file)=@_;
	opendir(DIR,$dir);
	my @list=map{$dir."/".$_}sort grep(/$file/ && !/^\.\.?$/,readdir(DIR));
	closedir(DIR);

	return @list;
}

sub GetLog
{
	$disp.=GetTagA("[loglist]","$MYNAME?log=.&$USERPASSURL")." ";
	foreach(GetFileList($LOG_DIR,"\\$FILE_EXT\$"))
	{
		/([\w\-]+)$FILE_EXT$/;
		$disp.=GetTagA("[$1 ".GetTime2FormatTime((stat($_))[9]+0,1)."]","$MYNAME?log=$1&$USERPASSURL")." ";
	}

	if($Q{log}eq'.')
	{
		$disp.="<hr>上記タブより閲覧したいログを選択してください<br>";
		$disp.="[$LOG_DELETESHOP_FILE] 閉店/移転した店舗のログ<br>";
		$disp.="[$LOG_ERROR_FILE] 各種エラーのログ<br>";
		$disp.="[$LOG_LOGIN_FILE] ログイン失敗のログ<br>";
		$disp.="[$LOG_MOVESHOP_FILE] 移転受け入れのログ<br>";
		$disp.="[$LOG_TRADE_FILE] 貿易アクセスのログ<br>";
		$disp.="[$LOG_DEBUG_FILE] デバッグログ<br>";
		$disp.="[$LOG_GLOBAL_MSG_FILE] 広域掲示板ログ<br>";
		$disp.="[$LOG_MARK_FILE] マークログ<br>";
		$disp.="<hr>なお、表\示される内容には生のパスワードが含まれる可能\性もありますので、注意してください。";
	}
	else
	{
		open(IN,GetPath($LOG_DIR,$Q{log})) or OutError('存在しません '.$Q{log});
		my @data=reverse(<IN>);
		close(IN);

		my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
			=GetPage($Q{pg},30,scalar(@data));
		my $pagecontrol=GetPageControl($pageprev,$pagenext,"&log=$Q{log}","pg",$pagemax,$page);

		$disp.="<hr>$Q{log}<br>".$pagecontrol;
		$disp.="<table width=\"100%\">";
		$disp.="<tr><th>time<th>user<th>message<th>script<th>remoteaddr<th>remotehost<th>trueip</tr>";
		my $buf="";
		foreach(@data[$pagestart..$pageend])
		{
			chop;
			if(/^\d+\t/)
			{
				/^(\d+)\t.*\/(.+\.cgi)\t(.*?)\t(.*?)\t(.*?)\t(.*?)\t(.*)$/;
				my $msg=$7;
				if(index($msg,"\t")!=-1)
				{
					$msg=~s/\t/<BR>/g;
				}
				$disp.="<tr><td>".GetTime2FormatTime($1)."<td>$6<td>$msg<td>$2<td>$3<td>$4<td>$5</tr>";
				$disp.="<tr><td colspan=\"20\"><small>$buf</small></tr>" if $buf ne '';
				$buf="";
			}
			else
			{
				$buf="$_<br>$buf";
			}
		}
		$disp.="</table>";
		$disp.="<hr>".$pagecontrol;
	}
}

sub GetMember
{
	DataRead();
	if(open(IN,GetPath($IP_FILE)))
	{
		while(<IN>)
		{
			chop;
			@_=split(/\t/);
			my $DT=$DT[$name2idx{$_[0]}];
			#$disp.=$_[2];
			$DT->{remoteaddr}=$_[2];
			$DT->{last}=$_[1];
			$DT->{ua}=$_[3];
		}
		close(IN);
	}

	$disp.=$TB;
	$disp.=$TR;
	foreach(qw(IP No ID 名前 店名 創業 最終login 資金 金庫 行動time 人気 売上 支出 平均 棚数 凍結 IP重複許可))
	{
		$disp.=$TD.$_;
	}
	$disp.=$TRE;
	$cnt=1;

	foreach my $DT (@DT)
	{
		$count{$DT->{remoteaddr}}++ if $DT->{remoteaddr};
		open(SESS,"$SESSION_DIR/$DT->{name}.cgi");
		$DT->{clientinfo}=[<SESS>];
		close(SESS);
		shift(@{$DT->{clientinfo}});

		undef %sameAcount;
		undef %sameBcount;
		undef %sameCcount;
		undef %sameDcount;
		%samecount=();
		foreach(@{$DT->{clientinfo}})
		{
			chop;
			last if $_ eq "";
			my($date,$ip,$agent,$referer,$accept)=split(/\t/);
			$sameA{"$ip\t$agent\t$referer\t$accept"}++ if !($samecount{"$ip\t$agent\t$referer\t$accept"}++);
			$sameB{"$ip\t$agent\t$accept"}++           if !($samecount{"$ip\t$agent\t$accept"}++);
			$sameC{"$ip\t$agent"}++                    if !($samecount{"$ip\t$agent"}++);
			$sameD{"$ip"}++                            if !($samecount{"$ip"}++);
		}
	}

	foreach my $DT (@DT)
	{
		$disp.=$TR;

		$disp.=$TD.$DT->{remoteaddr};
		if($Q{host}ne'')
		{
			foreach(split(/!/,$DT->{remoteaddr}))
			{
				$disp.="[".gethostbyaddr(pack("C4",split(/\./)),2)."]";
			}
		}
		$disp.=$TD.$cnt++;
		$disp.=$TD.$DT->{id};
		$disp.=$TD.$DT->{name};
		$disp.=$TD.qq|<a href="#$DT->{id}">$DT->{shopname}</a>|;
		$disp.=$TD.GetTime2FormatTime($DT->{foundation});
		#$disp.=$TD.GetTime2FormatTime($DT->{lastlogin});
		$disp.=$TD.$DT->{last};
		$disp.=$TD.$DT->{money};
		$disp.=$TD.$DT->{moneystock};
		$disp.=$TD.GetTime2FormatTime($DT->{time});
		$disp.=$TD.$DT->{rank};
		$disp.=$TD.$DT->{saletoday};
		$disp.=$TD.$DT->{paytoday};
		$disp.=$TD.$DT->{profitstock};
		$disp.=$TD.$DT->{showcasecount};
		$disp.=$TD.$DT->{blocklogin};
		$disp.=$TD.($DT->{nocheckip} ? '重複許可':'');
		#$disp.=$TD.$DT->{comment};
		$disp.=$TRE;

		#my $warning=$DT->{ua}."<br>";
		my $warning="";
		undef %sameAcount;
		undef %sameBcount;
		undef %sameCcount;
		undef %sameDcount;
		%samecount=();
		foreach(@{$DT->{clientinfo}})
		{
			chop;
			last if $_ eq "";
			my($date,$ip,$agent,$referer,$accept)=split(/\t/);
			if($sameA{"$ip\t$agent\t$referer\t$accept"}>1 && !$samecount{"$ip\t$agent\t$referer\t$accept"})
			{
				$warning.="●IP[$ip]&AGENT&ACCEPT&REFERER重複　";
			}
			elsif($sameB{"$ip\t$agent\t$accept"}>1 && !$samecount{"$ip\t$agent\t$accept"})
			{
				$warning.="●IP[$ip]&AGENT&ACCEPT重複　";
			}
			elsif($sameC{"$ip\t$agent"}>1 && !$samecount{"$ip\t$agent"})
			{
				$warning.="●IP[$ip]&AGENT重複　";
			}
			elsif($sameD{"$ip"}>1 && !$samecount{"$ip"})
			{
				$warning.="●IP[$ip]重複　";
			}
			$samecount{"$ip\t$agent\t$referer\t$accept"}++;
			$samecount{"$ip\t$agent\t$accept"}++;
			$samecount{"$ip\t$agent"}++;
			$samecount{"$ip"}++;
		}
		if($count{$DT->{remoteaddr}}>1)
		{
			$warning.="●TRUE IP[$DT->{remoteaddr}]重複　";
		}

		if($warning ne '')
		{
			#$list=~s/\t/<br>/g;
			$disp.=$TR."<td colspan=\"20\"><a href=\"#$DT->{id}\">↑".$warning."</a>";
			$disp.="".$TRE;
		}
		my $list=join("<br>",grep($_ ne "\n",@{$DT->{clientinfo}}));
		$detail.="<pre><hr><a name=\"$DT->{id}\">●$DT->{shopname} $DT->{name}<hr>$list</pre>";
	}
	$disp.=$TBE;

	$disp.=$detail;
}

sub GetTownData
{
	DataRead();
	
	$disp.="街データ一覧<hr>\n";
	$disp.="<dl>\n";
	while(my($key,$val)=each %$DTtown)
	{
		$key=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
		$val=~s/%([\dA-Fa-f]{2})/pack("H2",$1)/eg;
		$disp.=join "","<dt>",EscapeHTML($key)," </dt>","<dd>",EscapeHTML($val)," </dd>","\n";
	}
	$disp.="</dl>\n";
}
