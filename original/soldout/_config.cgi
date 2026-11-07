# このファイルのパーミッションは644(or604or600)です。
# $Id: _config.cgi 100 2004-03-15 11:32:20Z mu $

#----------------------
# ◆◆◆絶対設定◆◆◆ 
#----------------------
$MASTER_PASSWORD	='';		# 管理者パスワード(マスターパスワード) ◆半角英数のみ◆
$ADMIN_EMAIL		='';		# 管理者メールアドレス
$TOWN_CODE			='';		# この街のコード
								#   他の街と重複しない固有のコード ◆半角英数10文字以内小文字のみ◆
								#   移転機能および貿易機能を使用しない場合は設定しないでください。

#----------
# 表示設定 
#----------
$HTML_TITLE	='SOLD OUT';				# 全ページのHTMLタイトル(HTML不可)
$GAME_TITLE	='<H1>SOLD OUT</H1>';		# トップページのタイトル(HTML可)
$GAME_SUB_TITLE	='';					# トップページのタイトルの次に表示されるサブタイトル(HTML可)
$GAME_INFO	='';						# トップページのタイトルorサブタイトルの次に表示される説明(HTML可)
$BBS_INFO	='';						# 掲示板の説明(HTML可)
$CHAT_INFO	='';						# 井戸端の説明(HTML可)
$GLOBAL_MSG_INFO='';					# 広域掲示板のデフォルト説明(HTML可)
										#   $GLOBAL_MSG_INFO{カテゴリーコード}が設定されていればそちらが優先
$RULE_INFO	='・1人1店舗';				# このサイトのルール(HTML可)
$MARKET_INFO	='';					# 外出の説明(HTLM可)

#------------
# 表示色設定 
#------------
#<body>以外の属性はスタイルシートで行う方針です
$HTML_BODY_BGCOLOR		='#ffffff';	# <BODY>背景色
$HTML_BODY_TEXT			='#000033';	# <BODY>テキスト
$HTML_BODY_LINK			='#5566ff';	# <BODY>リンク色
$HTML_BODY_ALINK		='#5566ff';	# <BODY>アクティブリンク色
$HTML_BODY_VLINK		='#5566ff';	# <BODY>訪問済リンク色
$HTML_BODY_BACKGROUND	='';		# <BODY>背景画像

#----------------
# <head>追加設定 
#----------------
#<body>以外の属性はスタイルシートで行う方針です
$HTML_HEAD=<<'HTML';				# <HEAD>追加HTML
<Style Type="text/css">
<!--
A:link   {text-decoration:none}
A:visited{text-decoration:none}
A:hover  {text-decoration:underline; color:#669966; background-color:#ccffcc}
IMG {border:1 #000000 none}
IMG.i {width:16; height:16}
IMG.s {width:32; height:16}
IMG.il {width:32; height:32; align:left}
IMG.r {width:16; height:12}
IMG.shopicon {width:32; height:32}
IMG.rank_1 {width:4; height:16}
IMG.rank_5 {width:8; height:16}
IMG.rank_10 {width:12; height:16}
IMG.rank_25 {width:14; height:16}
IMG.rank_50 {width:16; height:16}
IMG.rank_75 {width:18; height:16}
IMG.rank_100 {width:20; height:16}
IMG.rank_150 {width:22; height:16}
IMG.rank_200 {width:24; height:16}
TABLE {background-color: #ccddff}
TR {background-color: #eef4ff}
-->
</Style>
HTML

#----------
# 環境設定 
#----------
$HOME_PAGE			='/';					# ホームページURL
$HOME_PAGE_MOBILE	='/';					# 携帯端末の場合のホームページURL
$IMAGE_DIR			='./image';				# 画像ディレクトリ(755)
$IMAGE_URL			='image';				# 画像URL(URLと実際のディレクトリが違う場合設定)
$IMAGE_EXT			='.png';				# 画像フォーマット(.gif .jpg 等も画像を用意すれば使用可能)
$DATA_DIR			='./data';				# データ保存用ディレクトリ(777)
$AUTOLOAD_DIR		='./auto';				# AUTOLOAD用関数ファイルディレクトリ(755)
$INCLUDE_DIR		='./inc';				# INCLUDEディレクトリ(755)
$CUSTOM_DIR			='./custom';			# カスタムデータディレクトリ(755)
$TOWN_DIR			='./town';				# 他街データ格納ディレクトリ(755)
$MARKET_DIR			='./market';			# 外出先データ格納ディレクトリ(755)
$GUILD_DIR			='./guild';				# ギルドデータディレクトリ(755)
$JCODE_FILE			=$INCLUDE_DIR.'/jcode.pl';# jcode.plの位置
$GZIP_PATH			='';					# gzipのパス&オプション(圧縮転送が有効になる)
											#   設定不正の場合は動作不可(パスチェック無し)
											#   例) '/usr/bin/gzip --fast --stdout'
$DIR_PERMISSION		=0777;					# ディレクトリ作成時のパーミッション（WEBユーザの所有になる可能性も考慮すること）
$TZ_JST				=60*60*9;				# GMTからの時差
$SENDMAIL			='';					# sendmailのパス&オプション
											#   エラー情報をメールで受け取る場合のみ設定

#--------------
# 貿易機能設定 
#--------------
$TRADE_ENABLE		=0;			# 貿易機能の有効化 1:有効 0:無効
								#   貿易は別途貿易機能提供サイトへの登録が必要です
$TRADE_HOST_ALLOW	='';		# 貿易許可IP：    貿易網参加時に貿易機能提供サイト側より指定
$TRADE_HOST_PASSWORD='';		# 貿易パスワード：貿易網参加時に貿易機能提供サイト側より指定

#--------------
# 移転機能設定 
#--------------
$MOVETOWN_ENABLE	=0;			# 移転機能の有効化 1:有効 0:無効

#--------------
# 外出機能設定 
#--------------
$MARKET_ENABLE		=0;			# 外出機能の有効化 1:有効 0:無効

#------------------
# _config 設定拡張 
#------------------
# 環境設定を動的に変更したい場合は下記ファイルを新規作成し、記述してください。
# 例えば、1つの SOLD OUT スクリプトを共有して複数の街を動作させたい場合など。
require './_config-local-pre.cgi' if -e './_config-local-pre.cgi';

#----------------------------------------------------------------
# 各種データファイル設定(変更が望ましいですがそのままでもOKです) 
#----------------------------------------------------------------
$FILE_EXT			='.cgi';					# 各種データファイルの拡張子

$COMMIT_FILE		='commit';					# データ更新用ファイル名
$LASTTIME_FILE		='lasttime';				# 最終更新時刻検査用ファイル名
$LOCK_FILE			='lockfile';				# ロック用ファイル名
$DATA_FILE			='data';					# データファイル
$COUNTER_FILE		='counter';					# 内部カウンタファイルベース名
$LOG_FILE			='log';						# 最近の出来事ファイルベース名
$BBS_FILE			='bbslog';					# 掲示板ログファイル
$CHAT_FILE			='chatlog';					# 井戸端ログファイル
$GLOBAL_MSG_FILE	='gmsg';					# 広域掲示板ファイルベース名
$BOX_FILE			='box';						# 郵便箱ファイル
$GUILDBAL_FILE		='guildbal';				# ギルド収支ファイル
$GUILD_FILE			='guild';					# ギルド定義ファイル
$PERIOD_FILE		='period';					# 決算時ログファイル
$IP_FILE			='ip';						# ユーザーのIPリストファイル名
$TRADE_FILE			='trade';					# 貿易品ファイル
$TRADE_LOCK_FILE	='tradelock';				# 貿易用ロックファイル
$ERROR_COUNT_FILE	='errorcnt';				# 実行エラー回数記録ファイル

$LOG_ERROR_FILE		='error';					# エラーログファイル
$LOG_DELETESHOP_FILE='delete';					# 閉店した店舗のバックアップデータ
$LOG_MOVESHOP_FILE	='moveshop';				# 移転アクセスログファイル
$LOG_TRADE_FILE		='trade';					# 貿易アクセスログファイル
$LOG_LOGIN_FILE		='login';					# ログイン不成功ログファイル
$LOG_DEBUG_FILE		='debug';					# デバッグログファイル
$LOG_GLOBAL_MSG_FILE='gmsg';					# 広域掲示板ログファイル
$LOG_MARK_FILE		='mark';					# マークログファイル
$LOG_SIZE_MAX		=30000;						# 各種ログの最大サイズ(byte) 0:ログ保存無し 1～:最大サイズ

$LOG_DIR			=$DATA_DIR.'/log';			# 各種削除可能ログファイル格納ディレクトリ名
$ITEM_DIR			=$DATA_DIR.'/item';			# アイテムデータディレクトリ名
$SESSION_DIR		=$DATA_DIR.'/session';		# セッションID格納ディレクトリ名
$BACKUP_DIR			=$DATA_DIR.'/backup';		# バックアップディレクトリベース名
$TEMP_DIR			=$DATA_DIR.'/temp';			# 作業用ディレクトリ
$SUBDATA_DIR		=$DATA_DIR.'/subdata';		# サブデータファイル格納ディレクトリ名

#-------------------------------------------------------
# 以下、ゲーム設定です。必ずしも変更の必要はありません。
#-------------------------------------------------------

#----------
# 基本設定 
#----------
$HERO_NAME			='ナユタ';	# 伝説の英雄の名前(商品名等に使用される)
$MAX_USER			=50;		# 新装開店許可最大店舗数
$MAX_MOVE_USER		=55;		# 移転受け入れ最大店舗数
								#   実際の最大店舗数はどちらか大きい方が有効
								#   ◆◆重要◆◆店舗数設定を大きくするとサーバ負荷が高くなります
								#   なるべくデフォルト設定以下でお願いします
$PASSWORD_CRYPT		=0;			# パスワード暗号化 0=しない 1=する

#----------
# 制限設定 
#----------
$NEW_SHOP_ADMIN		=0;			# 新規店舗オープン権限 0:一般 1:管理者のみ
$NEW_SHOP_BLOCKIP	=0;			# 1で同一IPによる連続登録(閉店後の再登録も含む)を阻止
$CHECK_IP			=1;			# 同一IP＆USER_AGENTのアクセスを自動的に制限する 1:制限する 0:制限しない
@NG_SHOP_NAME		=qw(管理 馬鹿 阿呆);
								# 店舗名として使用できない文字をスペース区切りで登録
$NEW_SHOP_KEYWORD	='';		# 新規店舗オープンに必要なキーワードの設定
								#   このキーワードを知っている人だけが登録できるようになります。
								#   使用例) ルールページの最後にこのキーワードを掲載して、
								#           ルールを読んだ人だけが登録できるようにする等。
$USE_USER_TITLE		=0;			# トップ店舗に「サブタイトル」を変更できる権利を与えるかどうかの設定です。
								#   1:与える 0:与えない
$CHAR_SHIFT_JIS		=0;			# ユーザからの日本語入力を SHIFT JIS 固定として扱うかどうか 0:自動判定 1:SHIFT JIS 固定
								#   固定にすると半角カナ利用による文字化けを防ぐことが可能になりますが、
								#   EUC ベースの端末等からの入力を正しく扱えなくなる可能性があります。
$JUMP_MY_GUILD		=1;			# メニューに、所属するギルド本拠地へのリンクを表示するかどうか 0:しない 1:する
$GUILD_UNATTACH_PENALTY	=0;		# ギルド無所属の店舗に課すペナルティ率 0:無効 1~1000:決算時に売り上げの0.1~100%を徴収

#----------
# 時間設定 
#----------
$UPDATE_TIME			=60*5;		# 最短更新サイクル(秒)
$EXPIRE_TIME			=3600*24*7;	# 未ログイン登録抹消期限(秒)
$EXPIRE_EX_TIME			=3600*4;	# 未ログイン登録抹消期限延長時間(秒) (長期プレイヤー優遇の為、経営期間1日毎に延長される時間です。)
$EXPIRE_MAX_TIME		=3600*24*14;# 未ログイン登録抹消期限最大(秒) (延長限度)
$AUTO_UNLOCK_TIME		=60;		# ロック自動解除待ち秒数
$SESSION_TIMEOUT_TIME	=600;		# セッションタイムアウト秒数(短いほどセキュリティ的に良いが不便になる）
$ONE_DAY_TIME			=3600*27;	# 決算サイクル(秒)(3600*24で24時間毎に決算)
$DATE_REVISE_TIME		=0;			# 決算時刻をずらす秒数(-3600で1時間前倒し)
$MAX_STOCK_TIME			=48*60*60;	# 最大持ち時間(秒)
$BOX_STOCK_TIME			=48*60*60;	# 郵便が有効な時間(秒)
$LOG_EXPIRE_TIME		=3600*24;	# 最近の出来事の保存期限(実際はこれの2倍の期間保存される)
$PASSWORD_HASH_EXPIRE_TIME	=60*15;	# 移転/貿易/広域掲示板で使用する一時的なパスワードの有効期間(秒)
									#   短いほどセキュリティ的に良いが、ホスト間の時差も考慮する必要がある。

#--------------
# 表示行数設定 
#--------------
$TOP_RANKING_PAGE_ROWS	=5;		# 「トップ」ランキング表示件数
$MAIN_LOG_PAGE_ROWS		=10;	# 「店長室」最近の出来事表示件数
$SHOP_PAGE_ROWS			=5;		# 「他店」店舗表示件数
$RANKING_PAGE_ROWS		=10;	# ランキング表示件数
$LIST_PAGE_ROWS_PC		=20;	# 各種リスト表示件数(PC)
$LIST_PAGE_ROWS_MOBILE	=5;		# 各種リスト表示件数(MOBILE)

#----------
# 表示設定 
#----------
$SHOP_ICON_HEADER		='';	# 店舗アイコンの呼称(ランキング表示等に利用)
								#   image/shop-$DT->{icon}.png が店舗アイコンとして表示されます。
								#   アイコンを使用しない場合は '' を設定してください。
								#   設定例:$SHOP_ICON_HEADER='店舗';
@TOP_COUNT_IMAGE_LIST	=qw();	# 優勝勲章設定
								#   勲章の種類を設定します。
								#   未設定()の場合は今まで通りの表示になります。
								#   設定例:@TOP_COUNT_IMAGE_LIST=qw(200 150 100 75 50 25 10 5 1);
								#   この例の設定では、優勝回数93回の場合、
								#    image/rank-50.png image/rank-25.png image/rank-10.png
								#    image/rank-5.png image/rank-1.png image/rank-1.png image/rank-1.png
								#   の順に勲章が表示されます。対応する勲章画像が必要です。
								#   画像の幅と高さの設定はスタイルシートで行なってください。
								#   IMG.rank_1 IMG.rank_5 IMG.rank_10 といったクラスになります。
								#   また、勲章の数が合計10個を超えた場合は以降の表示を省略します。

#--------------
# メニュー設定 
#--------------
$USE_BBS			=1;			# 掲示板使用 0:使用しない 1:使用する
$BBS_TITLE			='掲示板';	# 掲示板メニュータイトル
$MAX_BBS_MESSAGE	=100;		# 掲示板保存行数
$DENY_GUEST_BBS		=0;			# 掲示板閲覧 0:誰でもOK 1:プレイヤーのみ
$SECURE_MODE_BBS	=1;			# 掲示板荒らし対策 0:何もしない 1:連続投稿を防ぐ
								#   短時間の連続投稿を阻止します。

$USE_CHAT			=1;			# 井戸端使用 0:使用しない 1:使用する
$CHAT_TITLE			='井戸端';	# 井戸端メニュータイトル
$MAX_CHAT_MESSAGE	=20;		# 井戸端保存行数
$DENY_GUEST_CHAT	=0;			# 井戸端閲覧 0:誰でもOK 1:プレイヤーのみ
$SECURE_MODE_CHAT	=0;			# 井戸端荒らし対策 0:何もしない 1:連続投稿を防ぐ
								#   短時間の連続投稿を阻止します。

$USE_GLOBAL_MSG		=0;			# 広域掲示板使用 0:使用しない 1:使用する
$GLOBAL_MSG_TITLE	='広域掲示板';# 広域掲示板メニュータイトル
$MAX_GLOBAL_MSG_MESSAGE	=100;	# 広域掲示板保存行数
$URL_GLOBAL_MSG_CENTER	=	"";	# 広域掲示板センターURL
								#   所属センターのURLを指定します。
%GMSG_CATEGORY_NAME	=('_global','外部接続');
								# 広域掲示板受信カテゴリー（'コード','名称',...）
								#   受け付けるカテゴリーのコードおよび名称のリスト。
								#   何も指定しなくても、デフォルトのカテゴリーは強制的に受信させられる。
								#   コードおよび名称は任意。
								#   ただし、_(アンダーバー)から始まるコードはシステム予約。
								#   同じコードを採用している広域掲示板センターおよび街との交流が可能。

$USE_CUSTOM			=0;			# カスタムページ使用  0:使用しない 1:使用する
$CUSTOM_TITLE		='カスタム';# カスタムページメニュータイトル
$DENY_GUEST_CUSTOM	=0;			# カスタムページ閲覧 0:誰でもOK 1:プレイヤーのみ
								#   「0:誰でもOK」に設定しても、カスタムページ処理内でその都度閲覧不可に出来ます。

@CUSTOM_MENU=();				# 画面上部のメニューに追加するカスタムメニュー ('URL','名称',...)
								# 自サイト以外へのリンクだとセッション情報が他サイトへ流出するので注意。
$USE_PORT			=0;			# [外部]メニューの使用 0:使用しない 1:使用する
$OUTPUT_LAST_MODIFIED	=0;		# 井戸端/掲示板/広域掲示板でHTTPヘッダLAST-MODIFIEDを出力 0:出力しない 1:出力する

#----------------------
# バックアップ時間設定 
#----------------------
$BACKUP_TIME	=3600;	# 定期データバックアップ秒数
$BACKUP			=3;		# データバックアップ世代数(期)
@BACKUP_FILES	=();	# 追加バックアップ対象ファイル配列
						#   以下に関連するファイルはデフォルトでバックアップ対象になっています。
						#   $BBS_FILE $CHAT_FILE $GLOBAL_MSG_FILE $LOG_FILE $BOX_FILE $PERIOD_FILE $GUILDBAL_FILE $DATA_FILE

#--------------------
# ゲームバランス設定 
#--------------------
$PROFIT_DAY_COUNT	=3;			# 点数計算の際考慮する過去の純利益（期）
$SALE_SPEED			=10;		# 売れ行き倍率(inc-item-data.cgiでの設定を1として)
$POP_DOWN_RATE		=5;			# 人気自然減少率(大きいほど、現在の人気に応じての上下幅が大きくなる)
$LIMIT_EXP			=0;			# 熟練度の合計値リミット 0:上限無し 1~:上限設定(1=0.1%)
$EXP_DOWN_POINT		=5;			# 決算時に自然減少する熟練度ポイント(1%==10)
$EXP_DOWN_RATE		=60;		# 決算時に自然減少する熟練度割合(6%==60)
								# 例:現在の熟練度50%の場合、固定の0.5%と50%の6%で3%、合わせて3.5%減少する
$MAX_BOX			=5;			# メッセージ類送信最大数
$TOWN_TYPE			="normal";	# 街(商品データ)のタイプ設定
								#  normal   -> [途上タイプ] 通常時間パターン
								#  sotype1  -> [加工タイプ] 加工時間短縮パターン
								#  sotype2  -> [資源タイプ] 素材採取時間短縮パターン
								#  timehalf -> [先進タイプ] 全時間短縮パターン

#--------------
# デバッグ設定 
#--------------
$DEBUG_MOBILE		=0;			# 1で携帯端末処理固定
$DEBUG_PRINT		=0;			# 1で可能な限り500エラーの内容を表示
								#   セキュリティ上の懸念があるため、デフォルトでは出力無し。
								#   使用はローカルでの開発時のみに限定してください。
$DEBUG_LOG_ENABLE	=0;			# 1でitem::DebugLog()とevent::DebugLog()を有効化
$MAX_ERROR_COUNT	=5;			# メールでエラー報告する最大数(デフォルトを推奨)
								#   多数のエラーメールでメールボックスが溢れるのを防ぐための制限です。
								#   この回数以上のメール報告は行われません。
								#   累積回数は管理メニューでリセットできます。
								#   エラーメールが届くたびにリセットするといいでしょう。
								#   ※エラーメールの有効化には$SENDMAILの設定が必要です。

#--------------------------------------
# 数値パラメータ自動チェック除外リスト 
#--------------------------------------
# "nan" もしくは "inf" が入力されてもそれを受け入れるパラメータのリストです。
# "nan" もしくは "inf" を文字列として利用する場合には、
# そのコマンドのスクリプト名(bbs,chat等)とパラメータ名(msg等)をリストに追加して下さい。
# このリストに入っていないパラメータの場合、
# "nan" もしくは "inf" から始まる入力は全て 0 に置き換えられます。
# 書式は以下を参考にしてください。("ファイルベース名:パラメータ名"=>"str", ...)
%QUERY_TYPE_TABLE=(
	"u"				=>	"str",
	"nm"			=>	"str",
	"pw"			=>	"str",
	"ss"			=>	"str",
	"bbs:msg"			=>	"str",
	"box-edit:cmd"		=>	"str",
	"box-edit:msg"		=>	"str",
	"box-edit:title"	=>	"str",
	"box-edit:tradein"	=>	"str",
	"buy:buy"			=>	"str",
	"chat:msg"			=>	"str",
	"custom:cmd"		=>	"str",
	"gmsg:ct"			=>	"str",
	"item-use:msg"		=>	"str",
	"jump:guild"		=>	"str",
	"jump:town"			=>	"str",
	"jump:gmsgtown"		=>	"str",
	"log:key"			=>	"str",
	"log:tgt"			=>	"str",
	"main:ck"			=>	"str",
	"move-town:towncode"=>	"str",
	"move-town:pass"	=>	"str",
	"move-town:nm"		=>	"str",
	"move-town:name"	=>	"str",
	"new:admin"			=>	"str",
	"new:name"			=>	"str",
	"new:sname"			=>	"str",
	"new:pass1"			=>	"str",
	"new:pass2"			=>	"str",
	"new:newkey"		=>	"str",
	"user:cmt"			=>	"str",
	"user:pw1"			=>	"str",
	"user:pw2"			=>	"str",
	"user:pwvrf"		=>	"str",
	"user:cls"			=>	"str",
	"user:rename"		=>	"str",
	"user:guild"		=>	"str",
	"user:usertitle"	=>	"str",
	"user:closecmt"		=>	"str",
	"admin-sub:user"		=>	"str",
	"admin-sub:comment"		=>	"str",
	"admin-sub:nocheckip"	=>	"str",
	"admin-sub:blocklogin"	=>	"str",
);

# set umask
umask(~$DIR_PERMISSION & 0777);

#------------------
# _config 設定拡張 
#------------------
# 各サイト毎の変更点はこのファイルを作成し、記述すると便利かもしれません。内容は自由です。
require './_config-local.cgi' if -e './_config-local.cgi';
1;
