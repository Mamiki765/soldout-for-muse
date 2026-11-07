# $Id: inc-html-guild.cgi 96 2004-03-12 12:25:28Z mu $

if($guilddetail)
{
	$disp.="●ギルド詳細<HR>";
	
	my $code    =$guilddetail;
	my $name    =$GUILD{$code}->[$GUILDIDX_name];
	my $dealrate=$GUILD{$code}->[$GUILDIDX_dealrate];
	my $feerate =$GUILD{$code}->[$GUILDIDX_feerate];
	my $url     =$GUILD_DETAIL{$code}->{url};
	my $comment =$GUILD_DETAIL{$code}->{comment};
	my $guild={};
	my $rank=0;
	foreach my $guildlist (@guildlist){$rank++; $guild=$guildlist,last if $guildlist->{guild} eq $code;}
	
	$disp.=qq|<p><a target="_blank" href="jump.cgi?guild=$code">|.GetTagImgGuild($code).$name.' の本拠地へ'."</a></p>";
	
	$disp.=$TB;
	$disp.=$TR.$TD.'RANK'.$TD.$rank.$TRE;
	$disp.=$TR.$TD.'ギルドコード'.$TD.$code.$TRE;
	$disp.=$TR.$TD.'会員'.$TD.($guildcount{$code}+0).'店舗'.$TRE;
	$disp.=$TR.$TD.'資金'.$TD.'\\'.($guild->{money}+0).($guild->{money}<0 ? '(赤字)' : '').$TRE;
	$disp.=$TR.$TD.'収入'.$TD.'\\'.($guild->{in}+0).$TRE;
	$disp.=$TR.$TD.'支出'.$TD.'\\'.($guild->{out}+0).$TRE;
	$disp.=$TR.$TD.'割引増率'.$TD.($dealrate/10).'%'.$TRE;
	$disp.=$TR.$TD.'会費率'.$TD.($feerate/10).'%'.$TRE;
	$disp.=$TR.$TD.'コメント'.$TD.$comment.$TRE;
	$disp.=$TBE;
	
	$disp.=qq|<p><a href="guild.cgi?pg=$Q{pg}&$USERPASSURL">|.'一覧に戻る'."</a></p>";
}
else
{
	$disp.="●ギルド一覧<HR>";
	
	my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
		=GetPage($Q{pg},$LIST_PAGE_ROWS,scalar(@guildlist));
	my $pagecontrol=GetPageControl($pageprev,$pagenext,"","",$pagemax,$page);
	$disp.=$pagecontrol."<BR>";
	
	my $rank=$pagestart+1;
	
	$disp.=$TB;
	foreach my $guild (@guildlist[$pagestart..$pageend])
	{
		my $code    =$guild->{guild};
		my $name    =$GUILD{$code}->[$GUILDIDX_name];
		#my $dealrate=$GUILD{$code}->[$GUILDIDX_dealrate];
		#my $feerate =$GUILD{$code}->[$GUILDIDX_feerate];
		#my $url     =$GUILD_DETAIL{$code}->{url};
		#my $comment =$GUILD_DETAIL{$code}->{comment};
		
		$disp.=$TR;
		$disp.=$TD."RANK".$rank++;
		$disp.=$TD.qq|<a href="guild.cgi?detail=$code&pg=$Q{pg}&$USERPASSURL">|.GetTagImgGuild($code).$name."</a>";
		$disp.=$TD."会員 ".($guildcount{$code}+0)." 店舗";
		$disp.=$TRE;
	}
	$disp.=$TBE;
	
	$disp.=$pagecontrol;
}
1;
