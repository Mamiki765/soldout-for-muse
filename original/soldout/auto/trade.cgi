# $Id: trade.cgi 96 2004-03-12 12:25:28Z mu $

# 貿易関係の時に読み込む

sub CheckTradeProcess
{
	my $fn=GetPath($TRADE_LOCK_FILE);
	return if !-e $fn;
	
	if((stat($fn))[9]<$NOW_TIME-60*30)
	{
		#30分以上のロックは異常と見なし解除
		Lock();
		unlink($fn) if (stat($fn))[9]<$NOW_TIME-60*30; #既に解除されている可能性をチェック後解除
		UnLock();
	}
	OutError('ただ今貿易船が入港していますので輸出入手続きは行えません');
}

#サイト関税率計算
sub GetTradeTaxRate
{
	my $tradeinout=$DTTradeOut-$DTTradeIn;
	my $sitetaxrate=0;
	$sitetaxrate=int($tradeinout/200000) if $tradeinout>0;
	$sitetaxrate=50 if $sitetaxrate>50;

	return $sitetaxrate;
}

1;
