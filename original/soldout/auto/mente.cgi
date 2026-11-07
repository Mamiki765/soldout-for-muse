# $Id: mente.cgi 96 2004-03-12 12:25:28Z mu $

sub MenteDisplay
{
	#メンテ中
	my $msg="";
	if(-f "./lock")
	{
		open(IN,"./lock");
		$msg=join("",<IN>);
		close(IN);
	}
	elsif(-f "$DATA_DIR/lock")
	{
		open(IN,"$DATA_DIR/lock");
		$msg=join("",<IN>);
		close(IN);
	}
	if($ENV{REMOTE_ADDR} ne $msg)
	{
		$msg='ただいまシステムメンテナンス中です。<br>申し訳ございませんが、しばらくお待ち下さい。' if $msg eq '';
		print "Content-type: text/html\n\n<html><head><title>停止中</title></head><body>$msg</body></html>";
		exit;
	}
}
1;
