# $Id: inc-html-item-usemode.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

my $MAX_COUNT=9999999999;

my $scale=$USE->{scale} ? $USE->{scale} : '回';
my $action=$USE->{action} ? $USE->{action} : '使う';
my $scaleone="";
$scaleone="(1$scale)" if $USE->{arg}!~/nocount/;

$USE->{time}=GetItemUseTime($USE);

$disp.="●";
$disp.=$USE->{name};
$disp.=$TB;
$disp.=$TR.$TD."備考".$TD.$USE->{info}.$TRE;
$disp.=$TR.$TD."費用$scaleone$TD\\".$USE->{money}.$TRE if $USE->{money};
my $exp=$DT->{exp}->{$USE->{itemno}};

if($USE->{time} || $exp)
{
	$disp.=$TR.$TD."時間$scaleone".$TD.GetTime2HMS($USE->{time});
	$disp.="(熟練度".int($exp/10)."%)" if $exp;
	$disp.=$TRE;
	
	$disp.=$TR.$TD.'必要熟練度'.$TD.int($USE->{needexp}/10).'%'.$TRE if $USE->{needexp};
}

my $count_min=$MAX_COUNT;
if(defined($USE->{use}[0]))
{
	$disp.=$TR.$TD."使用$scaleone".$TD;
	$disp.=$TB2;
	foreach my $USEITEM (@{$USE->{use}})
	{
		my $no=$USEITEM->{no};
		my $count=int($DT->{item}[$no-1]/$USEITEM->{count});
		
		$disp.=$TR;
		$disp.=$TD.$ITEM[$no]->{name};
		$disp.=$TD.$USEITEM->{count}.$TD."残".$DT->{item}[$no-1];
		if($USEITEM->{proba}==0)
		{
			$disp.=$TD."消費しない";
		}
		elsif($USEITEM->{proba}==1000)
		{
			$disp.=$TD."消費する";
			$count_min=$count if $count<$count_min;
		}
		else
		{
			$disp.=$TD."消費確率".($USEITEM->{proba}/10)."\%";
			$count_min=$count if $count<$count_min;
		}
		$disp.=$TRE;
	}
	$disp.=$TBE;
}
my $money=$MAX_COUNT;
my $time=$MAX_COUNT;
my %msg;
my $count_max;
if($USE->{arg}!~/nocount/)
{
	if($USE->{money}!=0){$money=int($DT->{money}/$USE->{money});}
	if($USE->{time}){$time=int(GetStockTime($DT->{time})/$USE->{time});}
	$msg{1}=1; $msg{2}=2; $msg{3}=3; $msg{5}=5;
	$msg{10}=10; $msg{20}=20; $msg{50}=50; $msg{100}=100;
	$msg{1000}=1000; $msg{10000}=10000;
	if($money<=$time){$count_max=$money;}else{$count_max=$time;}
	if($count_min<=$count_max){$count_max=$count_min;}
	$msg{$money}="$money(資金最大)";
	$msg{$time}="$time(時間最大)";
	$msg{$count_min}="$count_min(材料最大)";

	$disp.=$TR;
	$disp.=$TD."最大回数".$TD.$count_max;
	$disp.=$TRE;
}
$disp.=$TRE.$TBE;


if($DT->{money}<$USE->{money})
	{$nonuse=1; $disp.="<B>資金が足りません</B><BR>";}

if($DT->{time}+$USE->{time}>$NOW_TIME)
	{$nonuse=1; $disp.="<B>時間が足りません</B><BR>";}

if($exp<$USE->{needexp})
	{$nonuse=1; $disp.="<B>熟練度が足りません</B><BR>";}

$disp.=&{"item::".$USE->{functioninfo}}() if $USE->{functioninfo}; # @@use funci

my $select_target="";
my $select_count="";
my $input_message="";
my $select_userdata="";
if(!$nonuse)
{
	if($USE->{arg}=~ /target/)
	{
		$select_target="<SELECT NAME=tg>";
		foreach (@DT)
		{
			$select_target.="<OPTION VALUE='$_->{id}'>$_->{shopname}";
		}
		$select_target.="</SELECT>に対して";
	}
	
	if($USE->{arg}!~ /nocount/)
	{
		$select_count.="<SELECT NAME=cnt1>";
		my $oldcnt=0;
		foreach $cnt (sort { $a <=> $b } (1,2,3,5,10,20,50,100,1000,10000,$time,$money,$count_min))
		{
			if($count_max>=$cnt && $cnt!=$oldcnt)
				{$select_count.="<OPTION VALUE=\"$cnt\">$msg{$cnt}";}
			else
				{last;}
			$oldcnt=$cnt;
		}
		$select_count.="</SELECT>$scale ";
		$select_count.="または<INPUT TYPE=TEXT NAME=cnt2 SIZE=5>$scale";
	}
	else
	{
		$select_count.="<INPUT TYPE=HIDDEN NAME=cnt2 VALUE=\"1\">";
	}
	
	if($USE->{arg}=~ /message(\d*)/)
	{
		my $limit=$1||80;
		my $header=$USE->{argmessage}||'コメント';
		$header.='(半角'.$limit.'文字以内)';
		$input_message="$header<BR><INPUT TYPE=TEXT NAME=msg VALUE=\"\" MAXLENGTH=\"$limit\"><BR>";
	}
	
	if($USE->{argselect})
	{
		if($USE->{arg}=~/select/)
		{
			my @fld=split(/;/,$USE->{argselect});
			unshift(@fld,'選択') if @fld%2==0;
			my $header=shift @fld;
			$select_userdata.="$header<br>";
			if($USE->{arg}=~/radio/)
			{
				while(@fld)
				{
					my $val=shift @fld;
					my $cap=shift @fld;
					$select_userdata.=qq|<input type="radio" name="select" value="$val">$cap<br>|;
				}
			}
			else
			{
				my $size=$USE->{arg}=~/list/ ? ' size="'.(scalar @fld/2).'"' : '';
				$select_userdata.=qq|<select name="select"$size>|;
				while(@fld)
				{
					my $val=shift @fld;
					my $cap=shift @fld;
					$select_userdata.=qq|<option value="$val">$cap|;
				}
				$select_userdata.=qq|</select><br>|;
			}
		}
	}
	
	$disp.=<<STR;
<FORM ACTION="$MYNAME" $METHOD>
$USERPASSFORM
<INPUT TYPE=HIDDEN NAME=bk VALUE="$Q{bk}">
<INPUT TYPE=HIDDEN NAME=item VALUE="$itemno">
<INPUT TYPE=HIDDEN NAME=no VALUE="$no">
$input_message
$select_userdata
$select_target
$select_count
<INPUT TYPE=SUBMIT VALUE='$action'>
</FORM>
STR


}


1;
