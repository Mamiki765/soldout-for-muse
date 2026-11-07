# $Id: box.cgi 96 2004-03-12 12:25:28Z mu $

$FLAG_TO_READ=256;
$FLAG_RETURN_YESNO=16; # on=YES off=NO
$FLAG_RECV_ALLOW=32; # on=ALLOW off=DENY
$FLAG_PAY=64; # on=DONE off=NO
$FLAG_EXPIRE=128; # on=YES off=NO
$CMD_MAIL=0;
$CMD_ITEM=1;
$CMD_MONEY=2;
$CMD_TRADE=3;
@CMDLIST=('メッセージ','商品','資金','貿易');
@SENDRECV=('送信','<B>受信</B>');

sub GetBoxFile
{
	my($get_temp)=@_;
	
	my $file1=GetPath($BOX_FILE);
	my $file2=GetPath($TEMP_DIR,$BOX_FILE);
	
	return $file1 if !$get_temp;
	return -e $file2 ? $file2 : $file1;
}

sub ReadBox
{
	my($readfile)=@_;
	
	@BOX=();
	open(BOX,$readfile||GetPath($BOX_FILE)) or return;
	@BOX=<BOX>;
	close(BOX);
}

sub WriteBox
{
	my($writefile)=@_;
	
	OpenAndCheck($writefile||GetPath($TEMP_DIR,$BOX_FILE));
	print OUT @BOX;
	close(OUT);
}

sub GetInBox
{
	@INBOX=();
	foreach(grep(/^\d+,\d+,$DT->{id},/,@BOX))
	{
		#受信メールで返答済みはリストから削除
		if(/^\d+,\d+,\d+,(\d+),/)
		{
			push(@INBOX,$_) if !($1&$FLAG_TO_READ);
		}
	}
}

sub GetOutBox
{
	@OUTBOX=grep(/^\d+,$DT->{id},/,@BOX);
}

sub GetRetBox
{
	@RETBOX=();
	foreach(grep(/^\d+,\d+,$DT->{id},/,@BOX))
	{
		#受信メールで返答済み以外はリストから削除
		if(/^\d+,\d+,\d+,(\d+),/)
		{
			push(@RETBOX,$_) if $1 & $FLAG_TO_READ;
		}
	}
}

sub SearchBoxIndex
{
	my($no)=@_;
	my $idx=-1;
	foreach(0..$#BOX)
	{
		if($BOX[$_]=~/^$no,/)
		{
			$idx=$_;
			last;
		}
	}
	return $idx;
}

sub DeleteBox
{
	my($no)=@_;
	my $idx=SearchBoxIndex($no);
	return 1 if $idx==-1;
	
	splice(@BOX,$idx,1);
	return 0;
}

sub EditBox
{
	my($no,$flag)=@_;
	my $idx=SearchBoxIndex($no);
	return 1 if $idx==-1;
	
	my $box=$BOX[$idx];
	return 1 if $box!~/^\d+,\d+,\d+,(\d+),/;
	
	my $val=$1;
	if($flag=~/^\d+$/)
		{$val=$flag;}
	else
		{$val=eval($val.$flag);}
	$box=~s/^(\d+,\d+,\d+),\d+,\d+,/$1,$val,$NOW_TIME,/;
	
	$BOX[$idx]=$box;
	return 0;
}

sub NewBox
{
	my($cmd,$to,$flag,$msg,$data,$price)=@_;
	
	my @nolist=();
	foreach(@BOX)
	{
		push(@nolist,$1) if /^(\d+),/;
	}
	my $no=100; #start number
	foreach(sort{$a<=>$b}@nolist)
	{
		last if $no!=$_;
		$no++;
	}
	push(@BOX,"$no,$DT->{id},$to,$flag,$NOW_TIME,$cmd,$NOW_TIME,$price,$data,$msg\n");
	
	return $no;
}
1;