#! /usr/local/bin/perl
# ↑サーバの設定に従って変更してください。
# このファイルのパーミッションは755(or705or700)です。
# $Id: admin.cgi 96 2004-03-12 12:25:28Z mu $

BEGIN{$SIG{__WARN__}=$SIG{__DIE__}=sub{$incdir=$INCLUDE_DIR; $incdir||="./inc"; require "$incdir/inc-error.cgi"; die($_[0]);};}
print "Set-Cookie: SESSION=-check-cookie-!".time().";\n";

$MYNAME=$ENV{SCRIPT_NAME};
$MYNAME =~s/^.*\///;

open(IN,$MYNAME); $myfirstline=<IN>; $myfirstline=~s/[\r\n]//g; close(IN);
@log=();

($MYDIR,$MYNAME)=($ENV{SCRIPT_NAME}=~/^.*\/([^\/]+)\/([^\/]+)$/); # 自ファイル名/ディレクトリ名
require './_config.cgi';

push(@BACKUP_FILES,
	(
		$BBS_FILE,
		$CHAT_FILE,
		$GLOBAL_MSG_FILE,
		(map{$GLOBAL_MSG_FILE.'-'.$_}keys %GMSG_CATEGORY_NAME),
		$LOG_FILE.'-s0',
		$LOG_FILE.'-s1',
		$LOG_FILE.'-s2',
		$BOX_FILE,
		$PERIOD_FILE,
		$GUILDBAL_FILE,
		$DATA_FILE,
	)
);

GetQuery();

OutError('管理者パスワードが設定されていません') if $MASTER_PASSWORD eq '';
OutError('管理者メールアドレスが設定されていません') if $ADMIN_EMAIL eq '';
OutError('街コードが設定されていません') if ($MOVETOWN_ENABLE || $TRADE_ENABLE) && !$TOWN_CODE;
OutError('$DATA_DIR の設定不良、もしくは、$DATA_DIR ディレクトリが作成されていません') if !-e $DATA_DIR;
OutError('$SESSION_DIR $TEMP_DIR $LOG_DIR $BACKUP_DIR $SUBDATA_DIR 辺りの設定が異常です') if $SESSION_DIR eq '' || $TEMP_DIR eq '' || $LOG_DIR eq '' || $BACKUP_DIR eq '' || $SUBDATA_DIR eq '';

sub OutError
{
	print "Cache-Control: no-cache, must-revalidate\n";
	print "Pragma: no-cache\n";
	print "Content-type: text/html; charset=Shift_JIS\n\n";
	print "<HTML><HEAD><TITLE>管理メニュー</TITLE></HEAD>";
	print "<BODY>";
	print $_[0]."<br>";
	print '<font color=red><b>readme.html等の説明書を参照して正しく設定して下さい</b></font>' if !$_[1];
	print qq|<FORM ACTION="$MYNAME" METHOD="POST"><INPUT TYPE=HIDDEN NAME=admin VALUE="$Q{admin}">|;
	print qq|<INPUT TYPE="SUBMIT" VALUE="管理メニューへ戻る"></FORM>|;
	print "</BODY>";
	print "</HTML>";
	exit;
}

$checkdatadir=' ディレクトリ '.$DATA_DIR.' のパーミッションを見直してください';

if($Q{admin} ne $MASTER_PASSWORD)
{
	$disp.=<<"HTML";
	<FORM ACTION="$MYNAME" METHOD="POST">
	管理者パスワード <INPUT TYPE=PASSWORD NAME=admin>
	<INPUT TYPE=SUBMIT VALUE="管理メニューへ">
	</FORM>
HTML
}
elsif($Q{init})
{
	CheckLock();
	#各種ディレクトリ＆ダミーindex.html 作成
	foreach my $dir ($DATA_DIR,$SESSION_DIR,$TEMP_DIR,$LOG_DIR,$SUBDATA_DIR,$BACKUP_DIR)
	{
		if(!-d $dir)
		{
			if(mkdir($dir,$DIR_PERMISSION))
				{push(@log,'ディレクトリ '.$dir.' を作成しました');}
			else
			{
				push(@log,'ディレクトリ '.$dir.' は作成出来ませんでした');
				push(@log,' 設定を見直すか、手動で作成してください');
			}
		}
		if(!-e "$dir/index.html")
		{
			if(open(OUT,">$dir/index.html"))
			{
				print OUT "<html></html>";
				close(OUT);
				push(@log,'ディレクトリ '.$dir.' へダミーのindex.htmlを作成しました');
			}
			else
			{
				push(@log,'ディレクトリ '.$dir.' へのダミーindex.html作成に失敗しました');
				push(@log,' ディレクトリ '.$dir.' のパーミッションを見直してください');
			}
		}
	}
	
	#ロックファイル作成
	if(!GetFileList($DATA_DIR,"^$LOCK_FILE"))
	{
		if(open(DATA,">$DATA_DIR/$LOCK_FILE"))
		{
			print DATA 'ロックファイルです。削除してはいけません。';
			close(DATA);
			push(@log,'ロックファイルを作成しました');
		}
		else
		{
			push(@log,'ロックファイルの作成に失敗しました');
		}
	}
	
	#新規ゲームデータ作成
	if(!-e "$DATA_DIR/$DATA_FILE$FILE_EXT")
	{
		if(open(DATA,">$DATA_DIR/$DATA_FILE$FILE_EXT"))
		{
			print DATA time()."\n100000,100\n\n\n//\n"; #人口10000で初期化
			close(DATA);
			unlink(map{"$DATA_DIR/$_$FILE_EXT"}grep($_ ne $DATA_FILE,@BACKUP_FILES)); #関連ファイルを消去初期化
			push(@log,'ゲームデータを新規作成しました');
		}
		else
			{push(@log,'ゲームデータの新規作成に失敗しました',$checkdatadir);}
	}
	
	#最終更新時刻検査用ファイル作成
	MakeFile("$DATA_DIR/$LASTTIME_FILE$FILE_EXT",'最終更新時刻検査用ファイル','');
	#ギルド定義ファイルベース作成
	MakeFile("$DATA_DIR/$GUILD_FILE$FILE_EXT",'ギルド定義ファイル','1;');
	
	sub MakeFile
	{
		if(!-e $_[0])
		{
			if(open(DATA,">$_[0]"))
			{
				print DATA $_[2];
				close(DATA);
				utime(1,1,$_[0]);
				push(@log,$_[1].'を作成しました');
			}
			else
				{push(@log,$_[1].'作成に失敗しました',$checkdatadir);}
		}
	}
	push(@log,'初期化/修復の必要はありませんでした') if !scalar(@log);
}
elsif($Q{uninit})
{
	CheckLock();
	#data以下全削除
	delete_dir($DATA_DIR);
	
	sub delete_dir
	{
		my($dir,$owndelete)=@_;
		
		return if !-d $dir;
		
		opendir(DIR,$dir);
		my @filelist=grep(!/^\.\.?$/,readdir(DIR));
		closedir(DIR);
		foreach my $file (@filelist)
		{
			$file="$dir/$file";
			if(-f $file)
			{
				if(unlink($file))
					{push(@log,$file.' を削除しました');}
				else
					{push(@log,' '.$file.' の削除に失敗しました');}
			}
			delete_dir($file,1) if -d $file;
		}
		if($owndelete)
		{
			if(rmdir($dir))
				{push(@log,'ディレクトリ '.$dir.' を削除しました');}
			else
				{push(@log,' ディレクトリ'.$dir.' の削除に失敗しました');}
		}
	}
	push(@log,'削除すべきデータがありませんでした') if !scalar(@log);
}
elsif($Q{mentemode})
{
	if($Q{mentemode}eq'on')
	{
		if(-d "$DATA_DIR/lock")
			{push(@log,'現在メンテモードです');}
		elsif(mkdir("$DATA_DIR/lock",$DIR_PERMISSION))
			{push(@log,'メンテモードに入りました');}
		else
			{push(@log,'メンテモードに移行できませんでした',$checkdatadir);}
	}
	elsif($Q{mentemode}eq'off')
	{
		if(!-d "$DATA_DIR/lock")
			{push(@log,'現在メンテモードではありません');}
		elsif(rmdir("$DATA_DIR/lock"))
			{push(@log,'メンテモードを解除しました');}
		else
			{push(@log,'メンテモードの解除に失敗しました',$checkdatadir);}
	}
}
elsif($Q{backup})
{
	CheckLock();
	#バックアップを現役に復元
	my @files=map{"$_$FILE_EXT"}@BACKUP_FILES;
	my @errorfiles=grep(!-e $_,map{"$Q{backup}/$_"}@files);
	
	if(scalar(@errorfiles))
	{
		push(@log,map{$_.' が存在しませんでした'}@errorfiles);
		push(@log,'バックアップデータが不完全なので処理を中止しました');
	}
	else
	{
		my $time=(stat("$Q{backup}/$DATA_FILE$FILE_EXT"))[9];
		my($s,$min,$h,$d,$m,$y)=gmtime($time+$TZ_JST);
		my $timestr=sprintf("%04d-%02d-%02d %02d:%02d",$y+1900,$m+1,$d,$h,$min);
		
		foreach my $file (@files)
		{
			my $inok=open(IN,"$Q{backup}/$file");
			my $outok=open(OUT,">$DATA_DIR/$file");
			if($inok && $outok)
			{
				my @data=<IN>;
				close(IN);
				if($file eq $DATA_FILE.$FILE_EXT)
				{
					#data.cgiの場合は更新時刻を現在に
					$data[0]=time()."\n";
					push(@log,'最終更新時刻を現在に設定しました');
				}
				if($file eq $LOG_FILE."-s0".$FILE_EXT || $file eq $PERIOD_FILE.$FILE_EXT)
				{
					#period.cgiとlog-s0.cgiの場合はバックアップ復元アナウンスを付加
					unshift(@data,time().",1,0,0,バックアップデータ復元のため[$timestr]時点に戻りました\n");
				}
				print OUT @data;
				close(OUT);
				push(@log,$file.' の復元に成功しました');
			}
			else
			{
				close(IN) if $inok;
				push(@log,$file.' の復元に失敗しました',' 再度処理を行ってください');
			}
		}
	}
}
elsif($Q{settime} || $Q{tlsec} ne '')
{
	CheckLock();
	my $time=$Q{settime};
	$Q{tlyear}-=1900 if $Q{tlyear}>=2000;
	if(!scalar(grep($_ eq '',($Q{tlsec},$Q{tlmin},$Q{tlhour},$Q{tlday},$Q{tlmon},$Q{tlyear}))))
	{
		$time=0;
		eval(<<"EVALCODE");
			require "timelocal.pl";
			$time=timegm($Q{tlsec},$Q{tlmin},$Q{tlhour},$Q{tlday},$Q{tlmon}-1,$Q{tlyear})-$TZ_JST;
EVALCODE
		push(@log,'timelocal.pl は使用不可です') if !$time;
	}
	if(!$time)
	{
		push(@log,'日付時刻設定が不正です');
	}
	elsif(open(IN,"$DATA_DIR/$DATA_FILE$FILE_EXT"))
	{
		my @data=<IN>;
		close(IN);
		$data[0]=$time."\n";
		open(OUT,">$DATA_DIR/$DATA_FILE$FILE_EXT");
		print OUT @data;
		close(OUT);
		my($s,$min,$h,$d,$m,$y)=gmtime($time+$TZ_JST);
		my $timestr=sprintf("%04d-%02d-%02d %02d:%02d:%02d",$y+1900,$m+1,$d,$h,$min,$s);
		push(@log,'最終更新時刻を['.$timestr.']に設定しました');
	}
	else
	{
		push(@log,'データファイルを変更出来ませんでした');
	}
}
elsif($Q{setscript} && $Q{"1stline"})
{
	CheckLock();
	opendir(DIR,".");
	my @filelist=grep(/^[a-z].+\.cgi$/,readdir(DIR));
	close(DIR);
	my $headline=$Q{"1stline"};
	my $modcount=0;
	foreach my $file (@filelist)
	{
		my $filedate=(stat($file))[9];
		open(IN,$file);
		my @data=<IN>;
		close(IN);
		if($data[0]=~/^\s*#!\s*.+\/perl/)
		{
			$data[0]=$headline."\n";
			if(open(OUT,">$file"))
			{
				print OUT @data;
				close(OUT);
				utime($filedate,$filedate,$file);
				push(@log,$file.' のヘッダを ['.$headline.'] に変更しました');
				$modcount++;
			}
			else
			{
				push(@log,$file.' のヘッダ変更に失敗しました');
				push(@log,' '.$file.' のパーミッションを 777 に変更してから再度実行してください');
			}
		}
	}
	push(@log,'ヘッダ自動変更を完了しました');
	push(@log,' パーミッションは適切な設定に戻しておいてください');
}
elsif($Q{errorreset})
{
	unlink("$DATA_DIR/$ERROR_COUNT_FILE$FILE_EXT");
	push(@log,'エラーカウントをリセットしました');
}
else
{
	if(-e "$DATA_DIR/$LASTTIME_FILE$FILE_EXT")
	{
		my $init=' 必要に応じて初期化/バックアップ復元作業を行ってください';
		
		push(@log,' 商品データを作成してください') if !-e $ITEM_DIR;
		
		push(@log,'現在メンテモードにつき、ゲームの進行が止まっています') if -e "./lock" or -e "$DATA_DIR/lock";
		push(@log,'ゲームデータが破損しています',$init) if !-e "$DATA_DIR/$DATA_FILE$FILE_EXT";
		push(@log,'最終更新時刻検査用ファイルが破損しています',$init) if !-e "$DATA_DIR/$LASTTIME_FILE$FILE_EXT";
		push(@log,'ギルド定義ファイルが破損しています',$init) if !-e "$DATA_DIR/$GUILD_FILE$FILE_EXT";
		
		push(@log,'ロックファイルが破損しています',$init) if !GetFileList($DATA_DIR,"^$LOCK_FILE");
		foreach my $dir ($SESSION_DIR,$TEMP_DIR,$LOG_DIR,$SUBDATA_DIR,$BACKUP_DIR)
		{
			push(@log,$dir.' が破損もしくは存在しません',$init) if !-e $dir;
		}
	}
	else
	{
		push(@log,' 初期化を行ってください');
	}
	
	my $errorcount=(-s "$DATA_DIR/$ERROR_COUNT_FILE$FILE_EXT")+0;
	
	my $backupselect=qq|<option value="" selected>復元したいバックアップを選択してください|;
	my $backupbasedir=$BACKUP_DIR;
	$backupbasedir=~s/\/([^\/]*)$//;
	foreach(GetFileList($backupbasedir,"^$1"))
	{
		my $file=$_;
		my $time=(stat("$file/$DATA_FILE$FILE_EXT"))[9];
		next if !$time;
		my($s,$min,$h,$d,$m,$y)=gmtime($time+$TZ_JST);
		my $timestr=sprintf("%04d-%02d-%02d %02d:%02d",$y+1900,$m+1,$d,$h,$min);
		$backupselect.=qq|<option value="$_">$timestr|;
	}
	
	my $userselect=qq|<option value="" selected>ユーザを選択してください|;
	if(open(IN,"$DATA_DIR/$DATA_FILE$FILE_EXT"))
	{
		while(<IN>){s/[\r\n]//g; last if $_ eq '//';}
		my @data=<IN>;
		close(IN);
		if(scalar(@data))
		{
			for(my $idx=0; $idx<$#data; $idx+=2)
			{
				@_=split(/,/,$data[$idx],5);
				
				$userselect.=qq|<option value="$_[2]">$_[2] : $_[3]|;
			}
		}
	}
	
	require "$ITEM_DIR/item.cgi" if -e "$ITEM_DIR/item.cgi";
	
	$disp.="<table><tr valign=\"top\"><td>";
	$disp.="<table bgcolor=\"#eeeeee\">";
	$disp.="<tr><td>perl version</td><td>$]</td></tr>";
	$disp.="<tr><th>パーミッション状況</th></tr>";
	foreach('.',$DATA_DIR,$INCLUDE_DIR,$AUTOLOAD_DIR,$CUSTOM_DIR,$TOWN_DIR,$GUILD_DIR,"_config.cgi",$MYNAME,"makeitem.cgi")
	{
		$disp.="<tr><td>".$_."<td>".substr(sprintf("%o",(stat($_))[2]),-3,3)."</tr>";
	}
	$disp.="</table>";
	
	$disp.=<<"HTML";
	<td>
	<table><tr>
	<td colspan="4">
	基本管理/特殊管理機能\以外はメンテモードでしか操作できません。
	</tr>
	<tr>
	<td>
	<br>
	基本管理機能\
	</tr>
	<tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="bbs.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="掲示板:管理人モード">
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="chat.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="井戸端:管理人モード">
	</FORM>
	</tr>
	<tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="counter.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="内部カウンタ">
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="メンバーリスト"><br>
	<INPUT TYPE="CHECKBOX" NAME=host>ホスト名を解決(表\示遅)
	</FORM>
	</tr>
	<tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=log VALUE=".">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="各種ログ閲覧">
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="index.cgi" METHOD="POST">
	<INPUT TYPE="SUBMIT" VALUE="ゲームTOP">
	</FORM>
	<tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=errorreset VALUE="on">
	<INPUT TYPE="SUBMIT" VALUE="エラーカウントリセット[現在$errorcount]">
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="gmsg.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="広域掲示板:管理人モード">
	</FORM>
	</tr>
	<tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=towndata VALUE="look">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="街データリスト"><br>
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=editbbs VALUE="bbs">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="掲示板系管理">
	</FORM>
	</tr>
	</table>
	</tr></table>
	<br>
	初期設定やデータ更新のための機能\
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=mentemode VALUE="on">
	<INPUT TYPE="SUBMIT" VALUE="メンテモードに移行">
	</FORM>
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=mentemode VALUE="off">
	<INPUT TYPE="SUBMIT" VALUE="メンテモードを解除">
	</FORM>
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=init VALUE="init">
	<INPUT TYPE="SUBMIT" VALUE="初期化/破損修復"><br>
	</FORM>
	<td>
	<FORM ACTION="makeitem.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="商品データ生成/更新">
	</FORM>
	</tr></table>
	<br>
	特殊な初期設定
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=setscript VALUE="on">
	<INPUT TYPE="SUBMIT" VALUE="スクリプト自動セッティング"><br>
	<INPUT TYPE="TEXT" NAME=1stline VALUE="$myfirstline" size="50">←スクリプトの1行目を指定<br>
	<INPUT TYPE="TEXT" NAME=admin VALUE="">←管理者パスワード<br>
	※スクリプトの1行目を一括で変更します。<br>soldout ディレクトリの全てのスクリプトのパーミッションを777に手動設定してから実行してください。
	</FORM>
	</tr></table>
	<br>
	特殊管理機能\
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="new.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="新規店舗オープン">
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="main.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="ユーザー店舗入店"><br>
	<SELECT NAME=nm>$userselect</SELECT><BR>
	※本人が管理人と同時に入店すると重複ログインとなり、どちらかがログアウトさせられます
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="user.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=pwvrf VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="ユーザー店舗パスワード変更"><br>
	<SELECT NAME=nm>$userselect</SELECT><BR>
	<INPUT TYPE="TEXT"   NAME=pw1 VALUE="">←新パスワード<BR>
	<INPUT TYPE="TEXT"   NAME=pw2 VALUE="">←新パスワード確認<BR>
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="ユーザー店舗閉店"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="TEXT"   NAME=comment VALUE="">←削除コメント<BR>
	<INPUT TYPE="TEXT"   NAME=closeshop VALUE="">←確認のため closeshop と入力してください<BR>
	</FORM>
	</tr></table>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="賞品授与"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="CHECKBOX" NAME=log>←最近の出来事で公表\する<BR>
	<INPUT TYPE="TEXT"   NAME=comment VALUE="">←コメント(任意)<BR>
	<SELECT NAME=senditem>${\join("",map{"<option value=\"$_\">$ITEM[$_]->{name}"}(0..$MAX_ITEM))}</SELECT>←賞品<br>
	<INPUT TYPE="TEXT"   NAME=count VALUE="1">←個数<br>
	※直接倉庫へ贈ります。
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="賞金授与"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="CHECKBOX" NAME=log>←最近の出来事で公表\する<BR>
	<INPUT TYPE="TEXT"   NAME=comment VALUE="">←コメント(任意)<BR>
	<INPUT TYPE="TEXT"   NAME=sendmoney VALUE="0">←賞金額<br>
	※直接「資金」の方へ贈ります。
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="持ち時間授与"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="CHECKBOX" NAME=log>←最近の出来事で公表\する<BR>
	<INPUT TYPE="TEXT"   NAME=comment VALUE="">←コメント(任意)<BR>
	<INPUT TYPE="TEXT"   NAME=sendtime VALUE="0">←授与時間(秒単位)<br>
	※1分=60秒 1時間=3600秒 1日=24時間=86400秒 です。
	</FORM>
	</tr></table>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="ユーザー店舗凍結"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="TEXT"   NAME=blocklogin VALUE="">←凍結理由（'off'と入力で凍結解除:'mark'と入力でマークログ(ログイン履歴ログ)対象）<BR>
	ユーザ別に入店を拒否(凍結)します。凍結ユーザーへの表\示は「あなたは[凍結理由]のためアクセス制限されています。」となります。
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="自動IPアドレス重複登録チェック"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<SELECT NAME=nocheckip><option value="check">チェック有り<option value="nocheck">チェック無し</SELECT><BR>
	IP アドレスと USER AGENT が他のユーザと重複した場合、自動的にアクセス制限をするかどうかの設定です。
	チェック有りで自動制限有効、チェック無しで無効となります。
	新装開店時はチェック有りになっています。連絡があったユーザのみチェック無しにすることで入店を個別に許可できます。
	なお、特別な場合を除き、この設定は店舗移転すると「チェック有り」に戻ります。別のサイトには引き継がれません。
	</FORM>
	</tr></table>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=u VALUE="soldoutadmin!$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="郵便未処理数変更"><br>
	<SELECT NAME=user>$userselect</SELECT><BR>
	<INPUT TYPE="TEXT" NAME=boxcount>←手動設定する表\示数(0～)<br>
	郵便未処理数の表\示が実際と合わない場合に手動で変更できます。
	ただし、表\示数が実際と合わないという状況は異状ですので、根本的に何らかの原因(エラー)があると思われます。
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=nanclean VALUE="clean">
	<INPUT TYPE="SUBMIT" VALUE="NaN除去"><br>
	NaNという特殊な数値(?)に汚染されたデータを0に置き換えてゲームを続行出来るようにします。
	ただし、「資金不足による閉店」「店舗ステータスの異常」「市場の初期化」等の副作用がありますので、ご了承下さい。
	</FORM>
	</tr></table>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=targz VALUE="make">
	<INPUT TYPE="SUBMIT" VALUE="バックアップダウンロード"><br>
	$DATA_DIR 直下と $SUBDATA_DIR を .tar.gz 圧縮し、ダウンロードします。<br>
	※要サーバ側コマンド tar
	</FORM>
	<td>
	<FORM TARGET="_blank" ACTION="admin-sub2.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=nm VALUE="soldoutadmin">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}">
	<INPUT TYPE="HIDDEN" NAME=usercheck VALUE="make">
	<INPUT TYPE="SUBMIT" VALUE="重複ユーザチェック用データ生成"><br>
	$SESSION_DIR と $DATA_DIR/$IP_FILE$FILE_EXT を .tar.gz 圧縮し、ダウンロードします。<br>
	※要サーバ側コマンド tar
	</FORM>
	</tr></table>
	<br>
	最終更新時刻変更
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="SUBMIT" VALUE="ゲーム内の最終更新時刻を変更する"><br>
	<INPUT TYPE="TEXT" NAME=settime VALUE="${\time()}">←最終時刻(1970/1/1 0:00 からの秒数)<br>
	<INPUT TYPE="TEXT" NAME=tlyear SIZE=5 VALUE="">/
	<INPUT TYPE="TEXT" NAME=tlmon SIZE=5 VALUE="">/
	<INPUT TYPE="TEXT" NAME=tlday SIZE=5 VALUE=""> 
	<INPUT TYPE="TEXT" NAME=tlhour SIZE=5 VALUE="">:
	<INPUT TYPE="TEXT" NAME=tlmin SIZE=5 VALUE="">:
	<INPUT TYPE="TEXT" NAME=tlsec SIZE=5 VALUE="">← timelocal.pl が使える場合のみ「西暦/月/日 時:分:秒」で表\記可<br>
	<INPUT TYPE="PASSWORD" NAME=admin VALUE="">←管理者パスワード<br>
	※最終時刻には「現在の時刻を表\す秒数」がデフォルトで入力されています。
	</FORM>
	</tr></table>
	<br>
	バックアップ復元
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="SUBMIT" VALUE="バックアップを復元する"><br>
	<SELECT NAME=backup>$backupselect</SELECT><br>
	<INPUT TYPE="PASSWORD" NAME=admin VALUE="">←管理者パスワード<br>
	</FORM>
	</tr></table>
	<br>
	アンインストール用<br>
	取扱には十\分気を付けてください。
	<br>
	<table><tr bgcolor="#eeeeee" valign="top">
	<!--
	<td>
	<FORM ACTION="makeitem.cgi" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=pw VALUE="$Q{admin}!delete">
	<INPUT TYPE="SUBMIT" VALUE="商品データ削除">
	</FORM>
	-->
	<td>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=uninit VALUE="delete">
	<INPUT TYPE="SUBMIT" VALUE="全データ削除"><br>
	<INPUT TYPE="PASSWORD" NAME=admin VALUE="">←管理者パスワード<br>
	</FORM>
	これまでのゲームデータ/関連ディレクトリが全て削除されます。
	</tr></table>


HTML
}

print "Cache-Control: no-cache, must-revalidate\n";
print "Pragma: no-cache\n";
print "Content-type: text/html; charset=Shift_JIS\n\n";
print "<HTML><HEAD><TITLE>管理メニュー</TITLE></HEAD>";
print "<BODY>";
foreach(@log)
{
	$_="<b>$_</b>" if substr($_,0,1) eq ' ';
	print $_."<br>";
}
print "<hr>" if scalar(@log) && $disp ne '';
print $disp;
print <<"HTML" if scalar(@log);
	<HR>
	<FORM ACTION="$MYNAME" METHOD="POST">
	<INPUT TYPE="HIDDEN" NAME=admin VALUE="$Q{admin}">
	<INPUT TYPE="SUBMIT" VALUE="管理メニューへ戻る">
	</FORM>
HTML
print "</BODY>";
print "</HTML>";
exit;

sub GetQuery
{
	my($q,@q,$key,$val);
	$q="";
	
	if($ENV{'REQUEST_METHOD'} eq "POST")
	{
		read(STDIN,$q,$ENV{'CONTENT_LENGTH'});
	}
	$q.="&".$ENV{'QUERY_STRING'};

	@q=split(/&/,$q);
	foreach (@q)
	{
		($key,$val)=split(/=/);
		$val =~ tr/\?/ /;
		$val =~ tr/+/ /;
		$val =~ s/\t/ /g;
		$val =~ s/%([a-fA-F0-9][a-fA-F0-9])/pack("H2",$1)/eg;
		$val =~ s/"/ /g;
		$val =~ s/'/ /g;
		$val =~ s/,/ /g;
		$val =~ s/[\r\n]//g;
		$Q{$key}=$val;
	}
	if($Q{u} ne '')
	{
		$Q{nm}="";
		$Q{pw}="";
		$Q{ss}="";
		($Q{nm},$Q{pw},$Q{ss})=split(/[!:]/,$Q{u},3);
	}
}

sub CheckLock
{
	return if -e "./lock" or -e "$DATA_DIR/lock";
	OutError('この操作はメンテモードでしか行えません','noerror');
}

sub GetFileList
{
	opendir(DIR,$_[0]);
	my @list=map{$_[0]."/".$_}grep(/$_[1]/ && !/^\.\.?$/,readdir(DIR));
	closedir(DIR);
	
	return @list;
}

