# $Id: inc-error.cgi 96 2004-03-12 12:25:28Z mu $

my($msg)=@_;
die($msg) if $ERROR_REENTRY; # 念のため
$ERROR_REENTRY=1;

@_=(gmtime(time()+60*60*9))[5,4,3,2,1,0];
$_[0]+=1900; $_[1]++;
my $nowtime=sprintf("%d/%02d/%02d %02d:%02d:%02d",@_);
my $subject="SOLD OUT ERROR";
my $body=join("\n",
	$nowtime,
	$ENV{SERVER_NAME}.
	$ENV{SCRIPT_NAME},
	$ENV{REMOTE_ADDR},
	$ENV{HTTP_REFERER},
	$ENV{HTTP_USER_AGENT},
	$Q{INPUT_DATA},
	$msg,
);
if($JCODE_FILE)
{
	require $JCODE_FILE;
	$body=jcode::jis($body);
}

if($SENDMAIL && $ADMIN_EMAIL && -s "$DATA_DIR/$ERROR_COUNT_FILE$FILE_EXT"<$MAX_ERROR_COUNT && open(MAIL,"| $SENDMAIL $ADMIN_EMAIL"))
{
	open(OUT,">>$DATA_DIR/$ERROR_COUNT_FILE$FILE_EXT");
	print OUT "1";
	close(OUT);
	
	my $footer="";
	if(-s "$DATA_DIR/$ERROR_COUNT_FILE$FILE_EXT"==$MAX_ERROR_COUNT)
	{
		$footer=join("\n",
			"エラー数が $MAX_ERROR_COUNT になりましたので、以後のメール送信は行いません。",
			"管理メニューにてエラーカウントをリセットしてください。",
		);
		$footer=jcode::jis($footer) if $JCODE_FILE;
	}
	print MAIL qq|Subject: $subject \[AUTO\]\nFrom: $ADMIN_EMAIL\nTo: $ADMIN_EMAIL\n\n$body\n$footer\n|;
	close(MAIL);
}

die($msg) if !$DEBUG_PRINT;

$body=~s/&/&amp;/g;
$body=~s/"/&quot;/g;
$body=~s/</&lt;/g;
$body=~s/>/&gt;/g;

$msg=~s/\n/<br>/g;

print STDOUT <<"HTML";
Cache-Control: no-cache, must-revalidate
Pragma: no-cache
Content-type: text/html

<html>
<head><title>error</title></head>
<body>
<p><b>ERROR or WARNING</b><br></p>
<form action="mailto:$ADMIN_EMAIL">
<input type="hidden" name="subject" value="$subject">
<textarea cols=80 rows=10 name=body>
$body
</textarea>
<p>
プレイ中にこのメッセージに遭遇した方は、
上記メッセージをそのままコピーして管理人までご報告をお願いします。
</p>
<p>
<b>上記メッセージには個人情報(パスワード等)が含まれている可能\性があります</b>ので、
掲示板等に投稿しないようご注意下さい。
</p>
<p>
管理人メールアドレス <a href="mailto:$ADMIN_EMAIL">$ADMIN_EMAIL</a>
</p>
<input type="submit" value="メールでエラー内容を送信">
</form>
</body>
</html>
HTML

exit(-1);
1;
