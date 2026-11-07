#! /usr/local/bin/perl
# $Id: trade-s.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';

Error('DISNABLED TRADE-SYSTEM') if !$TRADE_ENABLE;
Error('NOT SET $TOWN_CODE') if !$TOWN_CODE;
Error("NOT ALLOW ADDR $ENV{REMOTE_ADDR}") if $TRADE_HOST_ALLOW ne '' && $ENV{REMOTE_ADDR}!~/$TRADE_HOST_ALLOW/;
Error("NOT POST") if $ENV{REQUEST_METHOD} ne "POST";

read(STDIN,$query,$ENV{CONTENT_LENGTH});
my @buffer=split(/\n/,$query);
my $login=shift(@buffer);
Error("PASSWORD ERROR $login") if !CheckHash($login,$TRADE_HOST_PASSWORD);

my @log=();
my $error=0;
my $ourbuffer="";

print "Content-type: text/plain\n\n";

Turn();

Lock();
DataRead();
ReadBox();

while(1)
{
	my $cmd=shift(@buffer);
	push(@log,"CMD:".$cmd);
	last if $cmd eq '';
	
	if($cmd eq 'START')
	{
		#open(OUT,">$DATA_DIR/tradelog.cgi");
		#close(OUT);
		OpenAndCheck(GetPath($TRADE_LOCK_FILE));
		close(OUT);
		push(@log,"START LOCK:".(-e GetPath($TRADE_LOCK_FILE)));
	}
	elsif($cmd eq 'END')
	{
		unlink(GetPath($TRADE_LOCK_FILE));
		push(@log,"END UNLOCK:".(-e GetPath($TRADE_LOCK_FILE)));
	}
	elsif($cmd eq 'GETLIST')
	{
		@BOX=grep(/^\d+,\d+,1,\d+,\d+,$CMD_TRADE,/,@BOX);
		foreach(@BOX)
		{
			my($no,$from,$to,$flag,$modtime,$cmd,$time,$price,$data,$msg)=split(/[,\n]/);
			next if $flag & $FLAG_TO_READ || !defined($id2idx{$from});
			my($itemno,$itemcnt,$trademode,$hostcode,$boxno)=split(/!/,$data);
			$boxno=$no,$hostcode=$TOWN_CODE,$shopname=$DT[$id2idx{$from}]->{shopname}.','.$HTML_TITLE.','.$msg if $trademode==1;
			$outbuffer.="$trademode\t$time\t$hostcode!$boxno!$ITEM[$itemno]->{code}!$itemcnt!$price\t$TOWN_CODE!$no!$shopname\n";
		}
		push(@log,"GETLIST:".$outbuffer);
	}
	elsif($cmd eq 'PUTLIST')
	{
		OpenAndCheck(GetPath($TEMP_DIR,$TRADE_FILE));
		while(1)
		{
			$_=shift(@buffer);
			last if $_ eq '//' || $_ eq '';
			
			print OUT $_."\n";
		}
		close(OUT);
		push(@log,"PUTLIST:".(-e GetPath($TEMP_DIR,$TRADE_FILE)));
	}
	elsif($cmd eq 'EDITBOX')
	{
		my @editbox=split(/,/,shift(@buffer));
		
		#サイト関税率計算
		my $sitetaxrate=GetTradeTaxRate();
		
		for(my $cnt=0; $cnt<$#editbox; $cnt+=3)
		{
			my($boxno,$ope,$data)=@editbox[$cnt..$cnt+2];
			my $idx=SearchBoxIndex($boxno);
			next if $idx==-1; #入港中に閉店
			my($no,$from,$to,$flag,$modtime,$cmd,$time,$price,$data2,$msg)=split(/,/,$BOX[$idx]);
			next if !defined($id2idx{$from}); #ありえないけど一応
			
			$DT=$DT[$id2idx{$from}];
			
			my($itemno,$itemcnt,$trademode,$hostcode_dummy,$boxno_dummy,$shopname,$hostname)=split(/[!,]/,$data2);
			my $ITEM=$ITEM[$itemno];
			my $log="";
			if($ope==1)
			{
				$DTTradeIn+=$price;
				$log="「".$hostname."の".$shopname."」より";
				$log.=$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."を\\$priceにて輸入しました";
				$DT->{paytoday}+=$price;
				$DT->{item}[$itemno-1]+=$itemcnt;
				if($DT->{item}[$itemno-1]>$ITEM->{limit})
				{
					my $itemtrashcnt=$DT->{item}[$itemno-1]-$ITEM[$itemno]->{limit};
					$itemcnt-=$itemtrashcnt;
					$DT->{item}[$itemno-1]-=$itemtrashcnt;
					$log.="が".$itemtrashcnt.$ITEM->{scale}."破棄されました";
				}
				UseTimeDeal($price,$itemno,$itemcnt) if !GetUserDataEx($DT,"_so_trtm_$boxno");
				WriteLog(1,$DT->{id},0,$log,1);
				WriteLog(3,0,0,$DT->{shopname}."が".$log,1);
				$DT->{boxcount}++;
				EditBox($boxno,"|".($FLAG_PAY+$FLAG_TO_READ));
			}
			elsif($ope==2)
			{
				$DTTradeOut+=$price;
				my($taxrate,$tax)=GetSaleTax($itemno,$itemcnt,$price,$sitetaxrate+GetUserTaxRate($DT));
				$DT->{moneystock}+=$price-$tax-int($price/10);
				$DT->{taxtoday}+=$tax;
				$DT->{saletoday}+=$price;
				$DT->{paytoday}+=$tax+int($price/10);
				$log="輸出していた".$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."が\\$priceにて売れました";
				$log.="/手数料\\".int($price/10) if $price>=10;
				$log.="/税金\\$tax/税率$taxrate%" if $tax;
				WriteLog(1,$DT->{id},0,$log,1);
				WriteLog(3,0,0,$DT->{shopname}."が".$log,1);
				$DT->{boxcount}++;
				EditBox($boxno,"|".($FLAG_PAY+$FLAG_TO_READ));
			}
			elsif($ope==3)
			{
				$DT->{money}+=$price;
				$DT->{time}-=GetUserDataEx($DT,"_so_trtm_$boxno");
				SetUserDataEx($DT,"_so_trtm_$boxno","");
				$log="輸入手続きしていた".$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."が手に入りませんでした";
				WriteLog(1,$DT->{id},0,$log,1);
				$DT->{boxcount}++;
				EditBox($boxno,"|".$FLAG_TO_READ);
			}
			elsif($ope==4)
			{
				$DT->{money}-=int($price/10);
				$log="輸出していた".$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."は売れませんでした";
				$log.="/手数料\\".int($price/10) if $price>=10;
				$DT->{item}[$itemno-1]+=$itemcnt;
				$DT->{item}[$itemno-1]=$ITEM[$itemno]->{limit} if $DT->{item}[$itemno-1]>$ITEM[$itemno]->{limit};
				WriteLog(1,$DT->{id},0,$log,1);
				$DT->{boxcount}++;
				EditBox($boxno,"|".$FLAG_TO_READ);
			}
		}
		#倒産判定
		foreach my $DT (@DT)
		{
			$DT->{moneystock}+=$DT->{money},$DT->{money}=0 if $DT->{money}<0;
			$DT->{money}+=$DT->{moneystock},$DT->{moneystock}=0 if $DT->{moneystock}<0;
			next if $DT->{money}>=0;
			CloseShop($DT->{id},'貿易手数料倒産');
			WriteLog(1,0,0,$DT->{shopname}."が貿易手数料を払えずに倒産しました",1);
		}
		WriteBox();
		DataWrite();
		push(@log,"EDITBOX:WriteBox DataWrite");
	}
	last if $error;
}
DataCommitOrAbort();
UnLock();

if(!$error)
{
	print "OK\n";
	print "\n";
	print $outbuffer;
	WriteErrorLog("SUCCESS $ENV{REMOTE_ADDR}",$LOG_TRADE_FILE);
}
else
{
	print "ERROR\n\n\n";
}

#open(OUT,">>$DATA_DIR/tradelog.cgi");
#print OUT $NOW_TIME."\n".join("\n",@log)."\n-----------\n";
#print OUT $outbuffer."\n-----------\n";
#close(OUT);

exit;

sub Error
{
	WriteErrorLog($_[0],$LOG_TRADE_FILE);
	exit;
}
