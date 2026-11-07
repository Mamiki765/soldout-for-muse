#! /usr/local/bin/perl
# $Id: main.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

Turn();

Lock() if $Q{pw};
DataRead();
CheckUserPass();
if($Q{pw})
{
	($Q{ck} ? SetCookie($Q{nm},$Q{pw}) : SetCookie("",""));
	DataWrite();
	DataCommitOrAbort();
	UnLock();
}

if(GetUserDataEx($DT,"_so_market"))
{
	$disp.='<b>現在外出中です。</b><hr>';
}

RequireFile('inc-html-owner.cgi');
$disp.="<BR>";
RequireFile('inc-html-showcase.cgi');
$disp.="<BR>";
ReadLog($DT->{id},0,'','');
RequireFile('inc-html-log.cgi');

OutHTML('店長室',$disp);

exit;

sub SetCookie
{
	my($nm,$pw)=@_;
	my $time=$nm ne "" ? $NOW_TIME+($EXPIRE_TIME<60*60*24*365 ? $EXPIRE_TIME*2 : 60*60*24*365) : 0;
	my $expire=GetTime2HTTPDate($time);
	print "Set-Cookie: USERNAME=$nm; expires=$expire;\n";
	print "Set-Cookie: PASSWORD=$pw; expires=$expire;\n";
	#print "Set-Cookie: shop=;\n";
}
