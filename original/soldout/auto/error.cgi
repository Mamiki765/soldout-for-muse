# $Id: error.cgi 96 2004-03-12 12:25:28Z mu $

sub OverLoad
{
	print <<"HTML";
Cache-Control: no-cache, must-revalidate
Pragma: no-cache
Content-type: text/html

<html>
<head>
<title>過負荷</title>
</head>
<body>
現在サーバが高負荷状態です。
申\し訳ありませんがしばらくアクセスを見合わせてください。<br>
負荷度 $_[0] CPUs
</body></html>
HTML
	exit;
}

sub OutError
{
	while($LOCKED){UnLock()};
	my %msg=
	(
		"not defined function"=>
			'定義されていない関数を呼び出しました。管理者に以下の情報を連絡してください。<hr>'.
			"not defined function '$_[1]'",
		"busy"=>
			'アクセスが混み合っております。'.
			'しばらく待機した後、トップページよりやり直してください。'.
			($AUTO_UNLOCK_TIME*2).'秒以上経っても接続できない場合はエラーの可能性がありますので'.
			'管理人 <a href="mailto:'.$ADMIN_EMAIL.'">'.$ADMIN_EMAIL.'</a> まで連絡をお願いします。',
		"no data"=>
			'ゲームデータが見つかりませんでした。'.
			'トップよりやり直してみてください。'.
			'このメッセージが続く場合、データファイルが破損しているかもしれません。'.
			'管理者に連絡を！',
		"no user"=>
			'IDもしくはパスワードが違います。→'.$_[1],
		"error rename"=>
			'データ更新に失敗しました',
		"timeout"=>
			'タイムアウトです。トップより入店し直してください。',
		"bad request"=>
			'不正リクエストです。ブラウザの「戻る/進む」を使っている場合は使わないようにしてください。',
		"attack report"=>
			'前回のログイン後からパスワード認証失敗が'.$_[1].'回ありました。'.
			'身に覚えが無い場合、何者かに攻撃されている可能性がありますので、'.
			'パスワードを推測されにくいものに変更するなどして自衛をお願いします。'.
			'以下は認証失敗時の情報です。<hr>'.
			'失敗回数:'.$_[1].'回<br>'.
			'最終失敗時刻:'.GetTime2FormatTime($_[2]).'<br>'.
			'IPアドレス:'.$_[3].'<br>'.
			'ブラウザ情報:'.$_[4].'<br>'.
			'<hr>この警告が何度も続くようでしたら、上記情報を添えて管理者まで連絡をお願いします。'.
			'なお、この画面は二度と表示されません。必要であれば各自メモをお願いします。'.
			'<hr><a href="index.cgi">[トップへ戻る]</a>',
	);
	my $msg=defined $msg{$_[0]} ? $msg{$_[0]} : $_[0];
	OutHTML('ERROR',$msg);
	exit;
}

sub OutErrorNoUser
{
	eval(<<'__function__');
	
	WriteErrorLog(
		join("\t",
			(
				"name=".$Q{nm},
				"pass=".$Q{pw},
				"session=".$Q{ss},
				"query=".$Q{INPUT_DATA},
				"ua=".$ENV{HTTP_USER_AGENT},
				"referer=".$ENV{HTTP_REFERER},
				"accept=".$ENV{HTTP_ACCEPT},
			)
		),
		$LOG_LOGIN_FILE,
	);
	OutError('名前/パスワードが違うか、登録抹消された可能性があります → \''.$_[0].'\'');
__function__
}

sub WriteErrorLog
{
	eval(<<'__function__');
	my($msg,$file)=@_;
	
	return if !$LOG_SIZE_MAX || $file eq '';
	
	my $fn=GetPath($LOG_DIR,$file);
	rename($fn,GetPath($LOG_DIR,$file."-old")) if (stat($fn))[7]>$LOG_SIZE_MAX;
	open(ERR,">>$fn") or return;
	print ERR
		join("\t",
			(
				$NOW_TIME,
				$ENV{SCRIPT_NAME},
				$ENV{REMOTE_ADDR},
				$ENV{REMOTE_HOST},
				GetTrueIP(),
				$USER,
				$msg,
			)
		)."\n";
	close(ERR);
__function__
}

sub OutErrorBadRequest
{
	OutError('不正リクエストです。ブラウザの「戻る/進む」を使っている場合は使わないようにしてください。');
}
sub OutErrorTimeOut
{
	OutError($_[0].'トップより入店し直してください。');
}

sub OutErrorBlockLogin
{
	OutError('
		あなたは'.$_[0].'のためアクセス制限されています。
		プレイ中の「サイト名」「街名」「ユーザ名」「店舗名」を添えて、トップページ記載の管理者メールアドレスまでメールで連絡してください。
		その際、プロバイダのメールアドレス（アカウント）を利用してください。
		無料のメールアドレス（hotmail.com等）での連絡は不可とします。
	');
}

sub OutErrorBusy
{
	OutError('
		アクセスが混み合っております。
		しばらく待機した後、トップページよりやり直してください。
		'.($AUTO_UNLOCK_TIME*2).'
		秒以上経っても接続できない場合はエラーの可能性がありますので
		管理者まで連絡をお願いします。
	');
}

1;
