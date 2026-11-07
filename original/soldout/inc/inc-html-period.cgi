# $Id: inc-html-period.cgi 96 2004-03-12 12:25:28Z mu $

$disp.="<br><br>●前期の結果<HR>";

open(IN,GetPath($PERIOD_FILE));
my @log=<IN>;
close(IN);

foreach(@log)
{
	my($tm,$mode,$id,$to,$message,$no)=split(/,/);
	next if $id;
	
	$disp.=$message.("<br>","<hr>")[$MOBILE];
}
1;
