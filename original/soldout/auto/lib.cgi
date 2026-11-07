# $Id: lib.cgi 96 2004-03-12 12:25:28Z mu $
# カスタマイズに便利な関数群
# SOLD OUT の auto ディレクトリにコピーしてください。
# いつでもどこからでも使えるようになります。
# package は main になるので、そこだけご注意を。

# usage : LibMin($a,$b) $aと$bを比較して小さい方を返す
sub LibMin{return $_[0]<$_[1] ? $_[0] : $_[1]}

# usage : LibMax($a,$b) $aと$bを比較して大きい方を返す
sub LibMax{return $_[0]>$_[1] ? $_[0] : $_[1]}

# usage : LibSwap(\$a,\$b) $aと$bを交換する
sub LibSwap{my $tmp=${$_[0]}; ${$_[0]}=${$_[1]}; ${$_[1]}=$tmp; return}

sub LibGetCount
{
	# usage: LibGetCount($count)
	#
	# ex: LibGetCount(100);    # 100
	#     LibGetCount(12.3);   # 12 or 13
	#     LibGetCount(-12.3);  # -12 or -13
	#     LibGetCount(0);      # 0
	#
	# 確率付き整数カウント
	# 確率を使って小数部分を整数に変換する (3.1なら1/10の確率で4に変換される)
	#
	# $count : 小数を含む整数
	# 戻り値 : 整数
	my($val)=@_;
	my $int=int $val;
	$val>0 ? ($int++) : ($int--) if $val!=$int and rand 1<abs($val-$int);
	return $int;
}

sub LibEditData
{
	# usage: LibEditData($ref,$val[,{[min=>$min,][max=>$max,][set=>1,][float=>1,][abs=>1,]}])
	#
	# ex: $data=100;
	#     LibEditData(\$data,123);             # $data+=123;              (戻り値  123)       # $data == 223
	#     LibEditData(\$data,-123);            # $data-=123;              (戻り値 -123)       # $data == 100
	#     LibEditData(\$data,123,{max=>200});  # $data+=100;              (戻り値  100)       # $data == 200
	#     LibEditData(\$data,12.3);            # $data+=12; or $data+=13; (戻り値 12 or 13)   # $data == 112 or 113
	#     LibEditData(\$data,123,{set=>1});    # $data=123;               (戻り値 123)        # $data == 123
	#     LibEditData(\$data,-23.45,{abs=>1}); # $data-=23 or 24          (戻り値 23 or 24)   # $data == 100 or 99
	#     LibEditData(\$data,"string!!");      # $data="string!!"         (戻り値 "string!!") # $data eq "string!!"
	#
	# 補正付きデータ変更or置換関数
	# 現在の値を増減させ、必要であれば最小値最大値のチェック&補正を行います。
	# 数値 + - .(コンマ)以外の値が含まれている場合や、オプションで指定された場合は置き換えます。
	#
	# $ref   : 対象変数のリファレンス (\$data 等々)
	# $val   : 増減値 or 文字列
	# min    : option 最小値 (省略時は最小指定無し)
	# max    : option 最大値 (省略時は最大指定無し)
	# float  : option 小数を認める (このオプションがない場合は小数をLibGetCountで補正する)
	# set    : option 増減ではなく$valに置き換える (文字列では必須のオプション)
	# abs    : option 戻り値の増減値を絶対値で
	# 戻り値 : 実際に増減できた値 or 設定後の値
	#        : $ref に変数のリファレンスが与えられなかった場合は undef
	my($ref,$val,$option)=@_;
	return undef if ref $ref ne "SCALAR";
	
	return $$ref=$val if $val eq "" or $val=~/[^\d\-\+\.e]/;
	
	$val=LibGetCount($val) if !$option->{float};
	$val=$$ref+$val if !$option->{set};
	$val=LibMax($val,$option->{min}) if exists $option->{min};
	$val=LibMin($val,$option->{max}) if exists $option->{max};
	
	my $old=$$ref;
	$$ref=$val;
	return $option->{set} ? $val : ($option->{abs} ? abs($val-$old) : ($val-$old));
}

my %_Lib_minmax_table=(
	rank		=>	[100,10000],
	money		=>	[0,$main::MAX_MONEY],
	moneystock	=>	[0,$main::MAX_MONEY],
);

sub LibDTEdit
{
	# usage: LibDTEdit($dt,$key,$val[,{option}])
	#
	# ex: LibDTEdit($dt,'money',12345,{set=>1}); # $dt->{money}=12345;  (戻り値  12345) # 所持金を12345に
	#     LibDTEdit($dt,'money',12345);          # $dt->{money}+=12345; (戻り値  12345) # 所持金を+12345
	#     LibDTEdit($dt,'money',-50000);         # $dt->{money}-=24690; (戻り値 -24690) # 所持金を-50000(足りないので0に補正)
	#     オプションは LibEditData と同等
	#
	# 補正付き$DTデータセット(補正リストは%_Lib_minmax_table)
	# $dt  : いわゆる$DT(ユーザデータハッシュ)
	# $key : データのキー
	# $val : LibEditDataと同じ
	# 戻り値 : LibEditDataと同じ
	my($dt,$key,$val,$option)=@_;
	return undef if !$dt or !$key;
	
	if($_Lib_minmax_table{$key})
	{
		$option||={};
		$option->{min}=$_Lib_minmax_table{$key}[0] if !exists $option->{min};
		$option->{max}=$_Lib_minmax_table{$key}[1] if !exists $option->{max};
	}
	$dt->{$key}=0 if !exists $dt->{$key};
	return defined $val ? LibEditData(\$dt->{$key},$val,$option) : $dt->{$key};
}

sub LibDTItem
{
	# usage: LibDTItem($dt,$itemno[,$val[,{option}]])
	#
	# ex: LibDTItem($dt,10,123,{set=>1}); # $dt->{item}[10-1] =123; (戻り値  123) # アイテムNo10を123個に
	#     LibDTItem($dt,10,123);          # $dt->{item}[10-1]+=123; (戻り値  123) # アイテムNo10を+123(在庫上限チェックあり)
	#     LibDTItem($dt,10,-500);         # $dt->{item}[10-1]-=246; (戻り値 -246) # アイテムNo10を-500(足りないので0に補正)
	#     オプションは LibEditData と同等
	#
	# 補正付きアイテム数取得or増減or置換
	# $dt     : いわゆる$DT(ユーザデータハッシュ)
	# $itemno : 商品番号(1～)
	# $val    : LibEditDataと同じ 省略時は現在の所持数を取得
	# 戻り値  : LibEditDataと同じ
	#         : $val省略時は現在の値を取得
	my($dt,$itemno,$val,$option)=@_;
	return 0 if $itemno<=0 || $itemno>$main::MAX_ITEM;
	$option||={};
	$option->{min}=0                           if !exists $option->{min};
	$option->{max}=$main::ITEM[$itemno]{limit} if !exists $option->{max};;
	return !defined $val ? ($dt->{item}[$itemno-1]||0) : LibEditData(\$dt->{item}[$itemno-1],$val,$option);
}

sub LibDTExp
{
	# usage: LibDTExp($dt,$itemno[,$val[,{option}]])
	#
	# ex: LibDTItem と同等
	#
	# 補正付き熟練度取得or増減or置換
	# $dt     : いわゆる$DT(ユーザデータハッシュ)
	# $itemno : 商品番号(1～)
	# $val    : LibEditDataと同じ 省略時は現在の熟練度を取得
	# 戻り値  : LibEditDataと同じ
	#         : $val省略時は現在の値を取得
	my($dt,$itemno,$val,$option)=@_;
	return 0 if $itemno<=0 || $itemno>$main::MAX_ITEM;
	$option||={};
	$option->{min}=0    if !exists $option->{min};
	$option->{max}=1000 if !exists $option->{max};;
	return !defined $val ? ($dt->{exp}{$itemno}||0) : LibEditData(\$dt->{exp}{$itemno},$val,$option);
}

sub LibDTUser
{
	# usage: LibDTUser($dt,$key[,$val[,{option}]])
	#
	# ex: LibDTUser($dt,'dust',123,{set=>1}); # $dt->{user}{dust} =123;   (戻り値  123) # 独自データ dust を123に
	#     LibDTUser($dt,'dust',123);          # $dt->{user}{dust}+=123;   (戻り値  123) # 独自データ dust を+123(上限チェックなし)
	#     LibDTUser($dt,'dust',-500);         # $dt->{user}{dust}-=500;   (戻り値 -500) # 独自データ dust を-500(下限チェックなし)
	#     LibDTUser($dt,'dust',"");           # delete $dt->{user}{dust}; (戻り値   "") # 独自データ dust を削除
	#     オプションは LibEditData と同等
	#
	# $DT->{user}独自データの取得or増減or置換
	# $dt  : いわゆる$DT(ユーザデータハッシュ)
	# $key : ユーザデータの独自キー
	# $val : LibEditDataと同じ 省略時は現在の値を取得
	# option : LibEditDataと同じ
	# 戻り値 : LibEditDataと同じ
	#        : $val省略時は現在の値を取得
	my($dt,$key,$val,$option)=@_;
	
	my $user_val=main::GetUserDataEx($dt,$key);
	return $user_val if !defined $val;
	
	my $result=LibEditData(\$user_val,$val,$option);
	main::SetUserDataEx($dt,$key,$user_val);
	return $result;
}

sub LibDTEditMoney
{
	# usage: LibDTEditMoney($dt,$val[,{option}])
	#
	# 補正付き $DT->{money} & $DT->{moneystock} 増減
	# $DT->{money}を増減し、最大($MAX_MONEY)or最小(0)を超えた場合に残りの増減を $DT->{monetstock} に行います。
	# オプション指定で、「moneystock 優先」「最大最小を超えても moneystock を増減しない」等、制御できます。
	#
	# $dt  : いわゆる$DT(ユーザデータハッシュ)
	# $val : LibEditDataと同じ
	# dem_money : option 増減をmoney(資金)優先で行います。(デフォルト)
	# dem_stock : option 増減をmoneystock(金庫)優先で行います。
	# dem_only  : option 増減の結果最大最小を超えても他方(money/moneystock)を増減しません。
	# 戻り値 : LibEditDataと同じ
	my($dt,$val,$option)=@_;
	
	$option||={};
	my $target1="money";
	my $target2="moneystock";
	my $abs=exists $option->{abs};
	my $val_orig=$val;
	
	LibSwap(\$target1,\$target2) if exists $option->{dem_stock};
	delete $option->{abs} if $abs;
	
	my $result=LibDTEdit($dt,$target1,$val,$option);
	if(!exists $option->{set} && !exists $option->{dem_only} && $result!=$val)
	{
		my $result2=LibDTEdit($dt,$target2,$val-$result,$option);
		$result+=$result2;
	}
	$option->{abs}=1 if $abs;
	
	return $abs ? abs($result) : $result;
}

sub LibDTEditTime
{
	# usage: LibDTEditMoney($dt,$val[,{option}])
	#
	# 補正付き $DT->{time} 増減
	# $DT->{time} を増減し、持ち時間の操作を行います。
	# 最大持ち時間($MAX_STOCK_TIME)を計算に入れます。
	#
	# $dt  : いわゆる$DT(ユーザデータハッシュ)
	# $val : LibEditDataと同じ
	# 戻り値 : LibEditDataと同じ
	my($dt,$val,$option)=@_;
	
	LibDTEdit($dt,'time',0,{min=>$main::NOW_TIME-$main::MAX_STOCK_TIME}); # 持ち時間を最大状態に補正
	return -LibDTEdit($dt,'time',-$val,{min=>$main::NOW_TIME-$main::MAX_STOCK_TIME});
}

sub LibDTItemList
{
	# usage: LibDTItemList($dt,[,{option}])
	#
	# $DT所有商品リスト取得
	# 所持している商品番号リストのリファレンスを返します。
	#
	# $dt  : いわゆる$DT(ユーザデータハッシュ)
	# 戻り値 : [所持商品番号1,所持商品番号2,所持商品番号3,...]
	#        : なにも持っていない場合は空リスト
	my($dt,$option)=@_;
	$option||={};
	my @itemlist=grep $dt->{item}[$_-1],(1..$main::MAX_ITEM);
	@itemlist=sort{$main::ITEM[$a]->{sort}<=>$main::ITEM[$b]->{sort}} @itemlist if $option->{sort};
	return scalar @itemlist ? \@itemlist : ();
}

sub LibItemCode2No
{
	# usage: LibItemCode2No($item_code)
	#
	# 商品コードを番号に変換
	# 
	# $code  : 商品コード($ITEM[?]->{code})
	# 戻り値 : コードに対応する商品番号
	#        : 存在しない商品であれば 0
	my($code)=@_;
	foreach my $no (1..$main::MAX_ITEM)
	{
		return $no if $main::ITEM[$no]{code} eq $code;
	}
	return 0;
}

sub LibDT{return $_[0]->{$_[1]}||""}                # LibDT($DT,$key)       $DT->{$key}を取得
sub LibItem{return $main::ITEM[$_[0]]->{$_[1]}||""} # LibItem($itemno,$key) $ITEM[$itemno]->{$key} を取得

sub LibShopname{return LibDT($_[0],'shopname')} # LibShopname($DT)      $DTリファレンスから店舗名を取得
sub LibItemName{return LibItem($_[0],'name')}   # LibItemName($itemno)  商品番号から名称を取得
sub LibItemScale{return LibItem($_[0],'scale')} # LibItemScale($itemno) 商品番号から数え単位を取得

1;
