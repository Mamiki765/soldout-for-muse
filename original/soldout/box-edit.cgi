#! /usr/local/bin/perl
# $Id: box-edit.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

Lock() if $Q{cmd}ne'newmail' && $Q{cmd}ne'newmoney' && $Q{cmd}ne'newitem';

DataRead();
CheckUserPass();

$backurl="<HR><A HREF=\"box.cgi?$USERPASSURL\">[一覧に戻る]</A>";

$Q{price}=int($Q{price}+0);
$Q{itemcnt}=int($Q{itemcnt}+0);
ReadBox();

if($Q{cmd}eq'newmail')
{
	CheckOutBoxBuffer();
	RequireFile('inc-html-box-new-mail.cgi');
}
elsif($Q{cmd}eq'newmoney')
{
	CheckOutBoxBuffer();
	RequireFile('inc-html-box-new-money.cgi');
}
elsif($Q{cmd}eq'newitem')
{
	CheckOutBoxBuffer();
	RequireFile('inc-html-box-new-item.cgi');
}
elsif($Q{reset}ne'')
{
	if($DT->{boxcount}<0)
	{
		$DT->{boxcount}=0;
		DataWrite();
		$disp.="受信数をリセットしました";
	}
	else
	{
		$disp.="リセットする必要はありません";
	}
}
elsif($Q{del})
{
	getBoxDetail($Q{del},0,'nocheckshop');
	if($flag & $FLAG_TO_READ)
	{
		DeleteBox($no);
		WriteBox();
		$disp.="メッセージを削除しました";
		$DT->{boxcount}--;
		SetUserDataEx($DT,"_so_trtm_$no","");
		#$DT->{boxcount}=0 if $DT->{boxcount}<0;
		DataWrite();
	}
	elsif($modtime<$NOW_TIME-$BOX_STOCK_TIME)
	{
		CheckTradeProcess() if $cmd==$CMD_TRADE;
		DeleteBox($no);
		WriteBox();
		if($to>=100)
		{
			if(exists $id2idx{$to})
			{
				my $DTS=$DT[$id2idx{$to}];
				$DTS->{boxcount}--;
				#$DTS->{boxcount}=0 if $DTS->{boxcount}<0;
			}
		}
		SetUserDataEx($DT,"_so_trtm_$no","");
		$disp.="メッセージを強制削除しました";
		DataWrite();
	}
}
elsif($Q{sendmail})
{
	CheckOutBoxBuffer();
	$Q{sendmail}+=0;
	$Q{price}+=0;
	($precheckerror,$DTS)=PreCheckNewBoxArg('mail',$Q{sendmail},$Q{price});
	if($Q{conf} ne '' || $Q{ok} eq '' || $precheckerror ne '')
	{
		RequireFile('inc-html-box-new-mail.cgi');
	}
	else
	{
		CheckNewBoxArg();
		
		UseTime($TIME_SEND_MONEY) if $Q{price};
		NewBox($CMD_MAIL,$Q{sendmail},0,$Q{msg},$Q{title},$Q{price});
		WriteBox();
		$disp.=$DTS->{shopname}."へメッセージを送信しました";
		$DTS->{boxcount}++;
		DataWrite();
		WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."へ料金付き情報を送信しました",1) if $Q{price};
	}
}
elsif($Q{sendmoney})
{
	CheckOutBoxBuffer();
	$Q{sendmoney}+=0;
	$Q{price}+=0;
	($precheckerror,$DTS)=PreCheckNewBoxArg('money',$Q{sendmoney},$Q{price});
	if($Q{conf} ne '' || $Q{ok} eq '' || $precheckerror ne '')
	{
		RequireFile('inc-html-box-new-money.cgi');
	}
	else
	{
		CheckNewBoxArg();
		
		UseTime($TIME_SEND_MONEY) if $Q{price};
		NewBox($CMD_MONEY,$Q{sendmoney},0,$Q{msg},$Q{title},$Q{price});
		WriteBox();
		$disp.=$DTS->{shopname}."へ\\".$Q{price}."送金しました";
		$DT->{money}-=$Q{price};
		$DT->{paytoday}+=$Q{price};
		$DTS->{boxcount}++;
		DataWrite();
		WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."へ\\$Q{price}送金しました",1);
	}
}
elsif($Q{senditem})
{
	CheckOutBoxBuffer();
	$Q{senditem}+=0;
	$Q{price}+=0;
	$Q{itemno}+=0;
	$Q{itemcnt}+=0;
	($precheckerror,$DTS)=PreCheckNewBoxArg('item',$Q{senditem},$Q{price},$Q{itemno},$Q{itemcnt});
	if($Q{conf} ne '' || $Q{ok} eq '' || $precheckerror ne '')
	{
		RequireFile('inc-html-box-new-item.cgi');
	}
	else
	{
		$Q{msg}=" " if $Q{msg}eq"";
		CheckNewBoxArg();
		$Q{msg}="" if $Q{msg}eq" ";
		my $itemno=CheckItemNo($Q{itemno},$DT);
		my $ITEM=$ITEM[$itemno];
		my $price=$Q{price};
		$price*=$Q{itemcnt} if $Q{unit};
		
		if($Q{senditem}>=100) # >=100:通常の店舗相手 ==1:貿易
		{
			UseTime($TIME_SEND_ITEM);
			NewBox($CMD_ITEM,$Q{senditem},0,$Q{msg},$itemno."!".$Q{itemcnt},$price);
			WriteBox();
			$disp.=$DTS->{shopname}."へ".$ITEM->{name}."を".$Q{itemcnt}.$ITEM->{scale}."送りました";
			$DTS->{boxcount}++;
			$DT->{item}[$itemno-1]-=$Q{itemcnt};
			DataWrite();
			WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."へ".$ITEM->{name}.":".$Q{itemcnt}.$ITEM->{scale}."を".($price?"\\$priceにて":"")."送りました",1);
		}
		elsif($Q{senditem}==1 && $TRADE_ENABLE)
		{
			CheckTradeProcess();
			OutError('金額が不明です') if $price<=0;
			UseTime($TIME_SEND_ITEM);
			NewBox($CMD_TRADE,1,0,$Q{msg},$itemno."!".$Q{itemcnt}."!1",$price);
			WriteBox();
			$disp.=$ITEM->{name}."を".$Q{itemcnt}.$ITEM->{scale}."輸出しました";
			$DT->{item}[$itemno-1]-=$Q{itemcnt};
			DataWrite();
			WriteLog(3,0,0,$DT->{shopname}."が".$ITEM->{name}.":".$Q{itemcnt}.$ITEM->{scale}."を".($price?"\\$priceにて":"")."輸出しました",1);
		}
	}
}
elsif($Q{tradein})
{
	CheckTradeProcess();
	CheckOutBoxBuffer();
	if($Q{ok} eq '')
	{
		RequireFile('inc-html-box-tradein.cgi');
	}
	else
	{
		my %itemcode2idx=();
		foreach(0..$MAX_ITEM){$itemcode2idx{$ITEM[$_]->{code}}=$_;}
		my($hostcode,$boxno,$itemcode,$itemcnt,$price)=split(/!/,$Q{tradein});
		$price=int($price);
		my $itemno=$itemcode2idx{$itemcode};
		my $ITEM=$ITEM[$itemno];
		OutError('不正な要求です') if CheckItemFlag($itemno,'notradein');
		OutError('資金が足りません') if $DT->{money}<$price;
		OutError('不正な輸出品のようですので手続きできません') if $itemcnt=~/\D/ or $price=~/\D/;
		
		my($shopname,$hostname,$msg);
		open(IN,GetPath($TRADE_FILE));
		($TRADE_STOCK_TIME)=split(/[\t\n]/,<IN>);
		while(<IN>)
		{
			chop;
			my($trademode,$tradetime,$tradecode,$shopinfo)=split(/\t/);
			next if $trademode!=1 || $tradecode ne $Q{tradein};
			
			$shopname=(split(/!/,$shopinfo,3))[-1];
			($shopname,$hostname,$msg)=split(/,/,$shopname);
			last;
		}
		close(IN);
		
		my $newboxno=NewBox($CMD_TRADE,1,0,$Q{msg},"$itemno!$itemcnt!0!$hostcode!$boxno!$shopname!$hostname!$msg",$price);
		WriteBox();
		$disp.=$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."の輸入手続きをしました";
		$DT->{money}-=$price;
		UseTime(SetUserDataEx($DT,"_so_trtm_$newboxno",GetTimeDeal($price,$itemno,$itemcnt)));
		DataWrite();
		WriteLog(1,$DT->{id},0,$ITEM->{name}.":".$itemcnt.$ITEM->{scale}."の輸入手続きをしました",1);
	}
}
elsif($Q{alw} || $Q{dny})
{
	getBoxDetail(($Q{alw}!=0 ? $Q{alw}+0 : $Q{dny}+0),1);
	goto esc_box_edit if $flag & $FLAG_TO_READ;
	
	my $idx=$id2idx{$from};
	my $DTS=$DT[$idx];
	my $workflag_pay=$flag & $FLAG_PAY;
	my $boxcountnoop=0;
	
	if($cmd==$CMD_MAIL)
	{
		if($price && !$workflag_pay)
		{
			if($Q{alw})
			{
				if($price>$DT->{money})
				{
					$disp.="資金が足りませんでした";
				}
				else
				{
					$DT->{money}-=$price;
					$DTS->{moneystock}+=$price;
					$DT->{paytoday}+=$price;
					$disp.="\\$price支払いました";
					WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."へ情報料\\$priceを支払いました",1);
					EditBox($no,"|".$FLAG_PAY);
					DataWrite();
					WriteBox();
				}
				goto esc_box_edit;
			}
			else
			{
				$disp.="受信を拒否しました";
				WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."からの情報提供を拒否しました",1);
				EditBox($no,"|".$FLAG_TO_READ);
			}
		}
		else
		{
			if($Q{alw})
			{
				$disp.="返答として「はい」を送信しました";
				EditBox($no,"|".($FLAG_TO_READ+$FLAG_RETURN_YESNO));
			}
			else
			{
				$disp.="返答として「いいえ」を送信しました";
				EditBox($no,"|".$FLAG_TO_READ);
			}
		}
	}
	if($cmd==$CMD_MONEY)
	{
		if($Q{alw})
		{
			$DT->{moneystock}+=$price;
			$disp.="\\$price受け取りました";
			EditBox($no,"|".($FLAG_PAY+$FLAG_TO_READ));
			WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."からの送金\\$priceを受け取りました",1);
		}
		else
		{
			$disp.="資金の受け取りを拒否しました";
			EditBox($no,"|".($FLAG_TO_READ));
			WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."からの送金を受け取り拒否しました",1);
		}
	}
	if($cmd==$CMD_ITEM)
	{
		if($Q{alw})
		{
			if($price>$DT->{money})
			{
				$disp.="資金が足りませんでした";
				goto esc_box_edit;
			}
			else
			{
				my($itemno,$itemcnt)=split(/!/,$data);
				UseTimeDeal($price,$itemno,$itemcnt);
				$DT->{money}-=$price;
				$DT->{paytoday}+=$price;
				
				my($taxrate,$tax)=GetSaleTax($itemno,$num,$price*$num,GetUserTaxRate($DTS));
				$DTS->{moneystock}+=$price-$tax;
				$DTS->{saletoday}+=$price;
				$DTS->{taxtoday}+=$tax;
				
				my $itemplus=$itemcnt;
				my $ITEM=$ITEM[$itemno];
				$itemplus=$ITEM->{limit}-$DT->{item}[$itemno-1] if $DT->{item}[$itemno-1]+$itemplus>$ITEM->{limit};
				$DT->{item}[$itemno-1]+=$itemplus;
				$disp.="\\$price支払い、" if $price;
				$disp.=$ITEM->{name}."を".$itemcnt.$ITEM->{scale}."受け取りました";
				$disp.="　が、所持最大数を超えたので".($itemcnt-$itemplus).$ITEM->{scale}."を破棄しました" if $itemplus!=$itemcnt;
				EditBox($no,"|".($FLAG_PAY+$FLAG_TO_READ));
				WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."へ商品(".$ITEM->{name}.":".$itemcnt.$ITEM->{scale}.")の代金\\$priceを支払いました",1) if $price;
				WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."からの商品(".$ITEM->{name}.":".$itemcnt.$ITEM->{scale}.")を受けとりました",1) if !$price;
			}
		}
		else
		{
			$disp.="商品の受け取りを拒否しました";
			EditBox($no,"|".($FLAG_TO_READ));
			WriteLog(3,0,0,$DT->{shopname}."が".$DTS->{shopname}."からの商品受け取りを拒否しました",1);
		}
	}

	WriteBox();
	$DT->{boxcount}--;
	$DT->{boxcount}=0 if $DT->{boxcount}<0;
	$DTS->{boxcount}++;
	$DT->{money}=$MAX_MONEY if $DT->{money}>$MAX_MONEY;
	DataWrite();
}

esc_box_edit:

DataCommitOrAbort(),UnLock() if $Q{cmd}ne'newmail' && $Q{cmd}ne'newmoney' && $Q{cmd}ne'newitem';

$disp.=$backurl;
OutHTML('郵便箱',$disp);
exit;

sub getBoxDetail
{
	my($num,$sendrecvmode,$mode)=@_;

	my $idx=SearchBoxIndex($num);
	OutError('存在しないメッセージです'.$backurl) if $idx==-1;
	
	($no,$from,$to,$flag,$modtime,$cmd,$time,$price,$data,$msg)=split(/,/,$BOX[$idx]);
	
	OutError('存在しない店舗でした'.$backurl) if !defined($id2idx{$to}) && $mode ne 'nocheckshop';
	OutError('存在しない店舗でした'.$backurl) if !defined($id2idx{$from});
	
	OutError('権限がありません'.$backurl) if $sendrecvmode==0 && $DT->{id}!=$from;
	OutError('権限がありません'.$backurl) if $sendrecvmode==1 && $DT->{id}!=$to;
}

sub CheckOutBoxBuffer
{
	GetOutBox();
	OutError('送信は'.$MAX_BOX.'通までです<BR>送信済みを削除してください'.$backurl) if $#OUTBOX+1>=$MAX_BOX;
}

sub CheckNewBoxArg
{
	require $JCODE_FILE;
	
	$Q{msg}=CutStr(jcode::sjis($Q{msg},$CHAR_SHIFT_JIS&&'sjis'),200);
	$Q{title}=CutStr(jcode::sjis($Q{title},$CHAR_SHIFT_JIS&&'sjis'),40);
	OutError('内容がありません'.$backurl) if $Q{msg}eq'';
	$Q{title}="無題" if $Q{title}eq'';
	$Q{price}+=0;
	$Q{price}=$MAX_MONEY if $Q{price}>$MAX_MONEY;
}

sub PreCheckNewBoxArg
{
	my($mode,@data)=@_;
	my $DTS={};
	my @ret=();
	
	my $maxlength;
	
	$DTS=$DT[$id2idx{$data[0]}] if defined($id2idx{$data[0]});
	
	if($mode eq 'mail')
	{
		push(@ret,'相手先を指定してください。') if !defined($id2idx{$data[0]});
		push(@ret,'情報料が不明です。')         if $data[1]<0;
	}
	elsif($mode eq 'money')
	{
		push(@ret,'相手先を指定してください。') if !defined($id2idx{$data[0]});
		push(@ret,'送金額が\\0以下です。')      if $data[1]<=0;
		push(@ret,'資金が足りません。')         if $data[1]>$DT->{money};
	}
	elsif($mode eq 'item')
	{
		push(@ret,'相手先を指定してください。')          if !defined($id2idx{$data[0]}) && $data[0]!=1;
		push(@ret,'商品を選択してください。'),$data[2]=0 if $data[2]<1 || $data[2]>$MAX_ITEM;
		push(@ret,'送付個数が不明です。')                if $data[3]<=0;
		push(@ret,'商品在庫が足りません。')              if $data[2] && $DT->{item}[$data[2]-1]<$data[3];
		push(@ret,'金額が不明です。')                    if $data[1]<0;
		push(@ret,'金額が不明です。')                    if $data[1]==0 && $data[0]==1;
		push(@ret,'送付不可商品です。')                  if $data[0]!=1 && CheckItemFlag($data[2],'nosend');
		push(@ret,'輸出不可商品です。')                  if $data[0]==1 && CheckItemFlag($data[2],'notradeout');
	}
	
	push(@ret,'金額が高すぎます。') if $data[1]>$MAX_MONEY;
	
	$maxlength=40;
	push(@ret,'タイトルは半角'.$maxlength.'文字(全角'.int($maxlength/2).'文字)までです。現在半角'.length($Q{title}).'文字です。') if length($Q{title})>$maxlength;
	$maxlength=200;
	push(@ret,'内容文は半角'.$maxlength.'文字(全角'.int($maxlength/2).'文字)までです。現在半角'.length($Q{msg}).'文字です。') if length($Q{msg})>$maxlength;
	
	push(@ret,'内容文がありません。') if $Q{msg} eq '' && ($mode ne 'item' || $data[0]!=1) ;
	
	push(@ret,"<hr>") if @ret!=();
	
	return (join("<br>",@ret),$DTS);
}

1;
