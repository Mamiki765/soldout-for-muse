#! /usr/local/bin/perl
# $Id: trade.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass(1);

CheckTradeProcess();

$tp=int($Q{tp}+0);
@itemlist=();
%itemlist=();

my %itemcode2idx=();
foreach(0..$MAX_ITEM){$itemcode2idx{$ITEM[$_]->{code}}=$_;}

open(IN,GetPath($TRADE_FILE));
($TRADE_STOCK_TIME)=split(/[\t\n]/,<IN>);
while(<IN>)
{
	chop;
	my($trademode,$tradetime,$tradecode,$shopinfo,$buycount)=split(/\t/);
	my($hostcode  ,$boxno  ,$itemcode,$itemcnt,$price)=split(/!/,$tradecode);
	my($hostcode_s,$boxno_s,$shopinfo_s)=split(/!/,$shopinfo,3);
	my($shopname,$hostname,$msg)        =split(/,/,$shopinfo_s);
	my $itemno=$itemcode2idx{$itemcode};
	
	next if !$itemno;
	next if $tp!=0 && $ITEM[$itemno]->{type}!=$tp;
	$itemlist{$itemno}=1;
	push(@itemlist,[$tradecode,$shopname,$hostname,$itemno,$itemcnt,$price,$msg,$tradetime,$buycount]) if (!$Q{itn} || $Q{itn}==$itemno);
}
close(IN);

RequireFile('inc-html-trade.cgi');

OutHTML('貿易品',$disp);
exit;
