#! /usr/local/bin/perl
# $Id: move-town.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';

OutError('使用不可です') if !$MOVETOWN_ENABLE || !$TOWN_CODE;
my $townmaster=ReadTown($TOWN_CODE,'getown');
OutError('使用不可です') if !$townmaster;

GetQuery();
DataRead();
CheckUserPass(1);

if(!$GUEST_USER && $Q{towncode} ne '')
{
	if($Q{pass} ne '')
	{
		OutError('パスワードが正しくありません') if $Q{pass} ne $MASTER_PASSWORD && !CheckPassword($Q{pass},$DT->{pass});
		#移転処理
		$disp.=MoveShop($DT,$Q{towncode});
	}
	else
	{
		#移転用操作HTML表示
		$disp.=GetMoveShopForm($Q{towncode});
	}
}
else
{
	$disp.=GetTownListHTML();
}
OutHTML('移転手続き',$disp);

exit;

sub GetMoveShopForm
{
	my($towncode)=@_;
	
	my($town)=ReadTown($towncode);
	return '<b>移転可能な街が見つかりません</b>' if !$town;
	
	my $disp="";
	
	my $dist=GetTownDistance($townmaster->{position},$town->{position});
	my $movetime=GetMoveTownTime($DT,$townmaster,$town);
	
	$disp.=$TB;
	$disp.="$TR$TD移転先$TD$town->{name}$TRE";
	$disp.="$TR$TDコメント$TD$town->{comment}$TRE";
	$disp.="$TR$TD現在地からの距離$TD".($dist*80)."m$TRE";
	$disp.="$TR$TD移転先までの移動時間$TD".GetTime2HMS($movetime).' ※予定時間です。移転先によって変動します。'.$TRE;
	$disp.=$TBE;
	
	sub GetMarkDeny
	{
		return $_[0] ? " <font color=red><b>←条件を満たしていません</b></font>" : "";
	}
	my @flag=();
	push(@flag,"資金 \\$town->{allowmoney} 以上".GetMarkDeny($town->{allowmoney}>$DT->{money}+$DT->{moneystock})) if $town->{allowmoney} ne '';
	push(@flag,"資金 \\$town->{denymoney} 以下".GetMarkDeny($town->{denymoney}<$DT->{money}+$DT->{moneystock}))  if $town->{denymoney} ne '';
	push(@flag,"ギルド ".join("/",map{GetTagImgGuild($_,1,1)}split(/\W/,$town->{allowguild})).($town->{onlyguild} ? '':' およびギルド無所属')." のみ".GetMarkDeny($DT->{guild} ne '' && !scalar(grep($_ eq $DT->{guild},split(/[^\w]+/,$town->{allowguild}))))) if $town->{allowguild} ne '';
	push(@flag,"ギルド ".join("/",map{GetTagImgGuild($_,1,1)}split(/\W/,$town->{denyguild})).($town->{onlyguild} ? ' およびギルド無所属':'')." 以外".GetMarkDeny($DT->{guild} ne '' && scalar(grep($_ eq $DT->{guild},split(/[^\w]+/,$town->{denyguild}))))) if $town->{denyguild} ne '';
	push(@flag,"トップ獲得回数 $town->{allowtopcount} 回以上".GetMarkDeny($town->{allowtopcount}>$DT->{rankingcount})) if $town->{allowtopcount} ne '';
	push(@flag,"トップ獲得回数 $town->{denytopcount} 回以下".GetMarkDeny($town->{denytopcount}<$DT->{rankingcount}))  if $town->{denytopcount} ne '';
	push(@flag,"開業期間 ".GetTime2HMS($town->{allowfoundation})." 以上".GetMarkDeny($town->{allowfoundation}>$NOW_TIME-$DT->{foundation})) if $town->{allowfoundation} ne '';
	push(@flag,"開業期間 ".GetTime2HMS($town->{denyfoundation})." 以下".GetMarkDeny($town->{denyfoundation}<$NOW_TIME-$DT->{foundation}))  if $town->{denyfoundation} ne '';
	push(@flag,"ギルド所属のみ ".GetMarkDeny($DT->{guild} eq '')) if $town->{onlyguild} ne '';
	push(@flag,"ギルド無所属のみ ".GetMarkDeny($DT->{guild} ne '')) if $town->{noguild} ne '';
	push(@flag,"職業 ".join("/",map{$JOBTYPE{$_}}split(/\W+/,$town->{allowjob})).($town->{onlyjob} ? '':' および職業不定')." のみ".GetMarkDeny($DT->{job} ne '' && !scalar(grep($_ eq $DT->{job},split(/\W+/,$town->{allowjob}))))) if $town->{allowjob} ne '';
	push(@flag,"職業 ".join("/",map{$JOBTYPE{$_}}split(/\W+/,$town->{denyjob})).($town->{onlyjob} ? ' および職業不定':'')." 以外".GetMarkDeny($DT->{job} ne '' && scalar(grep($_ eq $DT->{job},split(/\W+/,$town->{denyjob}))))) if $town->{denyjob} ne '';
	push(@flag,"職業店舗のみ ".GetMarkDeny($DT->{job} eq '')) if $town->{onlyjob} ne '';
	push(@flag,"職業不定店舗のみ ".GetMarkDeny($DT->{job} ne '')) if $town->{nojob} ne '';
	$disp.="<br>$TB$TR$TD移転条件 ※移転先の条件が更新された場合は表\示条件を満たしても移転できない場合もあります<ul><li>".join("<li>",@flag)."</ul>$TRE$TBE" if scalar(@flag);
	
	$disp.=<<"HTML";
		<form action="$MYNAME" $METHOD>
		$USERPASSFORM
		<input type=hidden name=towncode value="$towncode">
		移転先での名前(ID) <input type=text name=name value="$Q{nm}">(半角英数のみ)<br>
		現在のパスワード <input type=password name=pass value=""><br>
		<input type=submit value="移転手続き開始">
		</form>
		<hr>
		移転で引き継がれないデータは下記の通りです。それ以外はほぼそのまま引き継がれます。
		<ul>
		<li>前期の順位情報
		<li>郵便箱の中身（全て破棄）
		<li>移転先に存在しない商品（一時保管）
		</ul>
		一時保管の商品は、その商品が存在する街へ移転すると返還されますが、以下の条件で破棄されます。
		<ul>
		<li>保管から10回の移転の間にその商品が存在する街へ行かなかった場合
		</ul>
		以下の場合は移転の際店舗データが一部失われます
		<ul>
		<li>システム改造等で店舗データに互換性がない場合
		</ul>
		以下の場合は移転できません
		<ul>
		<li>現在所属中のギルドが移転先にない場合(退会後移転すればOK)
		<li>移転先が満員の場合
		<li>移転先に同じ名前(ID)や店舗名がある場合
		</ul>
HTML
	return $disp;
}

sub GetTownListHTML
{
	my @townlist=ReadTown();
	return '<b>移転可能な街が見つかりません</b>' if !scalar(@townlist);
	
	my $ret="";
	$ret.='●移転可能な街<hr>';
	$ret.=$TB;
	foreach(@townlist)
	{
		$ret.=$TR;
		$ret.=$TDNW.$_->{name};
		$ret.=$TD.$_->{comment};
		$ret.=$TDNW.GetTagA("確認","jump.cgi?town=$_->{code}",0,"_blank");
		$ret.=$TDNW.GetTagA("移転手続き","$MYNAME?$USERPASSURL&towncode=$_->{code}") if !$GUEST_USER;
		$ret.=$TRE;
	}
	$ret.=$TBE;
	
	return $ret;
}

sub MoveShop
{
	my($DT,$towncode)=@_;
	
	my($town)=ReadTown($towncode);
	return '<b>移転可能な街が見つかりません</b>' if !$town;
	return '<b>移転先での名前が不正です(半角英数12文字以内)</b>' if $Q{name} eq '' || length $Q{name}>12 || $Q{name}=~/[^\w\-]/;
	
	$DT->{newname}=$Q{name};
	$DT->{newpass}=$Q{pass};
	$DT->{remoteaddr}=GetTrueIP();
	
	require "$ITEM_DIR/funcshopout.cgi" if $DEFINE_FUNCSHOPOUT;
	
	$DT->{_MoveTownTimeSrc}=GetMoveTownTime($DT,$townmaster,$town);
	
	MakeMoveDT($DT);
	my $data=GetDataTree($DT);
	my $subdata=ReadSubData($DT);
	#my $datahash=GetHash(time(),$data);
	my $towndata="code\t$TOWN_CODE\tname\t$townmaster->{name}";
	$towndata.="\tgroup\t$townmaster->{group}" if $townmaster->{group} ne '';
	my $trueip=GetTrueIP();
	my $result=PostHTTP($town->{recvshopurl},"$data\n$subdata->{stock}\n$towndata\n$trueip",$townmaster->{password},$TOWN_CODE);
	
	if($result eq 'OK')
	{
		Lock();
		DataRead();
		CheckUserPass();
		WriteLog(1,0,0,$DT->{shopname}."が".$town->{name}."へ移転しました",1);
		CloseShop($DT->{id},$town->{name}."へ移転");
		DataWrite();
		DataCommitOrAbort();
		UnLock();
		my $trash="";
		if($GET_DATA{trash})
		{
			@_=split(/\t/,$GET_DATA{trash});
			my($code,$name)=split(/!/,shift);
			my %trashitem=@_; my $val=0;
			foreach(values(%trashitem)){$val+=$_;}
			$trash=$name."で保管していた商品 ".scalar(keys(%trashitem))." 種類 ".$val." 個が破棄されました。";
		}
		return	$town->{name}."へ移転しました。<br>".
				GetTagA($town->{name}."へ移動","jump.cgi?town=$town->{code}")."<br><br>".$trash;
	}
	elsif($result eq 'DENY')
	{
		return	"移転を拒否されました。移転先の状況や移転受け入れ条件等をご確認下さい。<br>".
				"<b>$GET_DATA{msg}</b><br>".
				GetTagA($town->{name}."を訪れてみる","jump.cgi?town=$town->{code}","","_blank");
	}
	elsif($result eq 'ERROR')
	{
		return	"移転先に接続出来ませんでした。移転先の状況を確認し、必要があれば各管理者までご連絡下さい。<br>".
				GetTagA($town->{name}."を確認","jump.cgi?town=$town->{code}","","_blank");
	}
	else
	{
		return "error code [ $result ]";
	}
}

sub MakeMoveDT
{
	my($DT)=@_;
	$DT->{itemcode}={};
	$DT->{expcode}={};
	$DT->{itemyesterdaycode}={};
	$DT->{itemtodaycode}={};
	my $val;
	foreach my $no (1..$MAX_ITEM)
	{
		my $code=$ITEM[$no]->{code};
		
		$val=$DT->{item}->[$no-1];
		$DT->{itemcode}->{$code}=$val if $val;
		
		$val=$DT->{exp}->{$no};
		$DT->{expcode}->{$code}=$val if $val;
		
		$val=$DT->{itemyesterday}->{$no};
		$DT->{itemyesterdaycode}->{$code}=$val if $val;
		
		$val=$DT->{itemtoday}->{$no};
		$DT->{itemtodaycode}->{$code}=$val if $val;
	}
	$DT->{showcasecode}=[];
	foreach my $idx (0..$DT->{showcasecount}-1)
	{
		my $itemno=$DT->{showcase}->[$idx];
		my $price=$DT->{price}->[$idx];
		$price=0 if !$itemno;
		$DT->{price}->[$idx]=$itemno ? $price : 0;
		$DT->{showcasecode}->[$idx]=$itemno ? $ITEM[$itemno]->{code} : "";
	}
	delete $DT->{showcase};
	#delete $DT->{price};
	delete $DT->{item};
	delete $DT->{exp};
	delete $DT->{itemyesterday};
	delete $DT->{itemtoday};
	
	foreach(grep /^_so_trtm_/,keys %{$DT->{user}})
	{
		delete $DT->{user}{$_};
	}
}
