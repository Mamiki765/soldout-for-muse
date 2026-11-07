# $Id: period.cgi 96 2004-03-12 12:25:28Z mu $

sub TurnPeriod
{
	$PERIOD_MODE=1;
	foreach(keys(%GUILD))
	{
		$GUILD_DATA{$_}->{in}=0;
		$GUILD_DATA{$_}->{out}=0;
	}
	
	if(defined($DT[0]))
	{
		#その時点でのトップの店のTOPカウンタを+1
		$DT[0]->{rankingcount}++;
		
		#優勝者発表
		my $DT=$DT[0];
		my $count=$DT->{rankingcount}==1 ? "初優勝" : $DT->{rankingcount}."度目の優勝";
		my $msg="「今期の優勝店は".$DT->{shopname}."さんでした。".$count."おめでとうございます。」";
		WriteLog(1,0,0,$msg,1);
		
		$msg="「点数は".$DT->{point}."点";
		$msg.="で、2位との差は".($DT->{point}-$DT[1]->{point})."点" if defined($DT[1]);
		$msg.="でした。」";
		WriteLog(1,0,0,$msg,1);
	}
	
	require "$ITEM_DIR/funcupdate.cgi" if $DEFINE_FUNCUPDATE;
	
	#決算時のカスタム処理
	UpdateResetBefore() if defined(&UpdateResetBefore);
	
	my $dtcount=0;
	foreach my $DT (@DT)
	{
		#next if !$DT->{status};
		$dtcount++;
		
		#ランキング&点数バックアップ
		$DT->{rankingyesterday}=$dtcount;
		$DT->{pointyesterday}=$DT->{point};
	
		#入金庫税金額決定
		my($taxtoday)=GetTaxToday($DT);
		
		#売上詳細情報を更新・初期化
		$DT->{profitstock}=int(($DT->{profitstock}*$PROFIT_DAY_COUNT+$DT->{saletoday}-$DT->{paytoday})/($PROFIT_DAY_COUNT+1));
		$DT->{saleyesterday}=$DT->{saletoday};
		$DT->{saletoday}=0;
		$DT->{payyesterday}=$DT->{paytoday};
		$DT->{paytoday}=0;
		$DT->{itemyesterday}=$DT->{itemtoday};
		$DT->{itemtoday}={};
		$DT->{taxyesterday}=$taxtoday+$DT->{taxtoday};
		$DT->{taxtoday}=0;
		
		#念のため所持数オーバーチェック＆不正値修正
		foreach my $cnt (1..$MAX_ITEM)
		{
			$DT->{item}[$cnt-1]=$ITEM[$cnt]->{limit} if $DT->{item}[$cnt-1]>$ITEM[$cnt]->{limit};
			$DT->{item}[$cnt-1]=int($DT->{item}[$cnt-1]);
		}
		
		#維持費徴収処理
		my $cost=int($DT->{costtoday});
		$cost+=$SHOWCASE_COST[$DT->{showcasecount}-1];
		$DT->{money}-=$cost;
		$DT->{paytoday}+=$cost;
		
		#入金庫税金徴収処理
		$DT->{money}-=$taxtoday;
		#$DT->{paytoday}+=$taxtoday; #コメントアウト/支払いに入れない
		
		#ギルド会費
		if($DT->{guild} ne '')
		{
			my $money=int($DT->{saleyesterday}*$GUILD{$DT->{guild}}->[$GUILDIDX_feerate]/1000);
			EditGuildMoney($DT->{guild},$money);
			$DT->{money}-=$money;
		}
		
		#ギルド未所属ペナルティ
		if($DT->{guild} eq '' && $GUILD_UNATTACH_PENALTY)
		{
			my $money=int($DT->{saleyesterday}*$GUILD_UNATTACH_PENALTY/1000);
			$DT->{money}-=$money;
			WriteLog(2,0,0,$DT->{shopname}."がギルド無所属ペナルティを受けました。-\\".$money,1);
		}
		
		$DT->{moneystock}+=$DT->{money},$DT->{money}=0 if $DT->{money}<0;
		$DT->{money}+=$DT->{moneystock},$DT->{moneystock}=0 if $DT->{moneystock}<0;
		
		#倒産判定
		if($DT->{money}<0)
		{
			CloseShop($DT->{id},'資金不足倒産');
			WriteLog(1,0,0,$DT->{shopname}."が資金不足により倒産しました",1);
		}
		$DT->{costyesterday}=$cost;
		$DT->{costtoday}=0;
		
		#熟練度自然減少
		foreach my $key (keys(%{$DT->{exp}}))
		{
			$DT->{exp}{$key}-=int($DT->{exp}{$key}*$EXP_DOWN_RATE/1000) if $EXP_DOWN_RATE;
			$DT->{exp}{$key}-=$EXP_DOWN_POINT;
			delete $DT->{exp}{$key} if $DT->{exp}{$key}<=0;
		}
	}
	SortDT();
	
	#決算時のカスタム処理（リセット後）
	UpdateResetAfter() if defined(&UpdateResetAfter);
	
	#データバックアップ($BACKUP世代≒$BACKUP期)
	mkdir($BACKUP_DIR.$BACKUP,$DIR_PERMISSION) if !(-e $BACKUP_DIR.$BACKUP);
	rename($BACKUP_DIR.$BACKUP,$BACKUP_DIR."_work");
	foreach my $count (reverse(1..$BACKUP-1))
	{
		mkdir($BACKUP_DIR.$count,$DIR_PERMISSION) if !(-e $BACKUP_DIR.$count);
		rename($BACKUP_DIR.$count,$BACKUP_DIR.($count+1));
	}
	rename($BACKUP_DIR."_work",$BACKUP_DIR."1");
	
	foreach my $filetype (@BACKUP_FILES)
	{
		open(IN,GetPath($filetype));
		open(OUT,">".GetPath($BACKUP_DIR."1",$filetype));
		while(<IN>){print OUT $_;}
		close(OUT);
		close(IN);
	}
	
	#無効なセッションデータ(期限切れ)を削除
	opendir(SESS,$SESSION_DIR);
	my @dir=readdir(SESS);
	closedir(SESS);
	my $sessiontimeout=$NOW_TIME-$EXPIRE_TIME;
	
	foreach(map{"$SESSION_DIR/$_"}grep(/^.+\.cgi$/,@dir))
	{
		unlink $_ if (stat($_))[9]<$sessiontimeout; # $EXPIRE_TIME使われなければ消去
	}
	
	MakeGuildFile();
	
	undef $PERIOD_MODE;
}
1;
