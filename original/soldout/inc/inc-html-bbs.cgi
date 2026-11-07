# $Id: inc-html-bbs.cgi 96 2004-03-12 12:25:28Z mu $

$disp.="●$BBS_TITLE<HR>";

my %printed=();

my($page,$pagestart,$pageend,$pagenext,$pageprev,$pagemax)
	=GetPage($Q{lpg},$LIST_PAGE_ROWS,scalar(@MESSAGE));

if(!$GUEST_USER)
{
	$disp.=<<"STR";
	$BBS_INFO
	<FORM ACTION="$MYNAME" $METHOD>
	$USERPASSFORM
	$errormsg
	<INPUT TYPE=TEXT NAME=msg SIZE=50 VALUE="$Q{msg}">
	<INPUT TYPE=SUBMIT VALUE="書込">
	</FORM><HR>
STR
}
else
{
	$disp.="出店者以外は閲覧のみ<HR>";
}

my $pagecontrol=GetPageControl($pageprev,$pagenext,"","lpg",$pagemax,$page);
$disp.=$pagecontrol;

$disp.="<BR>";
$disp.=$TB;
foreach(@MESSAGE[$pagestart..$pageend])
{
	chop;
	my($tm,$mode,$id,$to,$msg,$no)=split(/,/);
	my($message,$sname,$name)=split(/\t/,$msg);
	
	$tm=GetTime2FormatTime($tm);
	if(!$to)
	{
		$sname="<B>管理人</B>";
		$name ="";
	}
	else
	{
		if(defined($id2idx{$to}))
		{
			my $DT=$DT[$id2idx{$to}];
			$sname=GetTagImgGuild($DT->{guild}).$DT->{shopname};
			$name =$DT->{name};
			$sname="<a href=\"shop.cgi?ds=$to&$USERPASSURL\">".$sname."</a>" if !$printed{$to}++ && !$GUEST_USER;
		}
		else
		{
			$sname="<SMALL>closed</SMALL> ".$sname;
		}
	}
	
	if($MOBILE)
	{
		$disp.=$tm."<BR>".$no.":".$sname.":".$name."<BR>".$message;
		$disp.="<HR SIZE=1>";
	}
	else
	{
		$disp.=$TR.$TDNW.$tm.$TD.$sname.$TD.$name.$TD.$no.$TD.$message.$TRE;
	}
}
$disp.=$TBE;

$disp.=$pagecontrol;

1;
