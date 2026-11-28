#!/usr/bin/perl
# 原作の商品データ (inc-item-data.cgi) を、原作の makeitem.cgi の解析処理そのままで読み込み、
# JSON に書き出すツール。生成物は src/data/items.json。
# 使い方: perl tools/dump-items.pl [TOWN_TYPE] > src/data/items.json
#   TOWN_TYPE: normal / sotype1 / sotype2 / timehalf / timequarter
# This file is part of SOLD OUT for Muse (GPL v2 or later).
use strict;
no strict 'refs';
no strict 'vars';
use JSON::PP;
use FindBin;
# 原作はShift_JISのバイト列として動いていたので、ここでもUTF-8をバイト列のまま扱う
# （use utf8 にすると \w が日本語にもマッチし、$HERO_NAMEの… などの展開が原作と変わる）

my $root = "$FindBin::Bin/../original/soldout";
my $towntype = $ARGV[0] // 'normal';

# makeitem.cgi から関数定義部分だけを取り出して読み込む（メイン処理は実行しない）
open(my $fh, '<:raw', "$root/makeitem.cgi") or die $!;
my $src = do { local $/; <$fh> };
close $fh;
$src =~ s/\A.*?\nexit;\n//s or die "makeitem.cgi の形式が想定と違います";

# 原作設定値（_config.cgi 相当のうち、商品データが参照するもの）
$HERO_NAME = 'ナユタ';
$TOWN_TYPE = $towntype;
$CUSTOM_DIR = "$root/custom";
$INCLUDE_DIR = "$root/inc";
$IMAGE_DIR = "/nonexistent";
$g_define = {};
$g_define->{itemusetimerate} = 1;
$g_define->{function} = {};
$g_define->{localfuncmark} = '_local_';
$g_define->{cmdhead} = '@@';
$g_define->{cmdfoot} = '';
$g_define->{dirname} = 'soldout';
$linecount = 0;

eval $src; die $@ if $@;
AnalyzeItemData("FH00", "inc-item-data.cgi");

sub num { my $v = shift; return undef if !defined $v || $v eq ''; return 0 + $v; }

my @items;
for my $it (sort { $a->{no} <=> $b->{no} } @out_item) {
	next if !$it->{code};
	my @uses;
	for my $u (@{ $out_use{$it->{code}} || [] }) {
		next if !$u;
		my $parseList = sub {
			my ($list) = @_;
			return [ map {
				my @v = split /\t/;
				my $no = GetItemNumber($v[1]);
				{ item_no => 0 + $no, count => 0 + $v[0], proba => 0 + $v[2], (defined $v[3] && $v[3] ne '' ? (message => $v[3]) : ()) }
			} @$list ];
		};
		my @jobs;
		for my $j (@{ $u->{job} }) {
			my ($jobname, $expr) = split /\t/, $j;
			my ($key, $ope, $val) = ($expr =~ /^([^\+\-\*\/\=]+)([\+\-\*\/\=])(\S+)$/);
			push @jobs, { job => GetJobCode($jobname), key => $key, op => $ope, value => 0 + GetNumber($val) };
		}
		push @uses, {
			no => 0 + $u->{no},
			name => $u->{name}, info => $u->{info}, scale => $u->{scale}, action => $u->{action},
			money => num($u->{money}) // 0, time => num($u->{time}) // 0, exptime => num($u->{exptime}) // 0,
			exp => num($u->{exp}) // 0, needexp => num($u->{needexp}),
			arg => $u->{arg}, argmessage => $u->{argmessage}, argselect => $u->{argselect},
			params => [ map { $u->{"param$_"} } 1..4 ],
			use => $parseList->($u->{use}), get => $parseList->($u->{get}),
			okmsg => $u->{okmsg}, ngmsg => $u->{ngmsg},
			func => $u->{func}, func_before => $u->{funcbefore}, func_info => $u->{funcinfo},
			local_func => $u->{localfunc} || undef,
			local_func_before => $u->{localfuncbefore} || undef,
			local_func_info => $u->{localfuncinfo} || undef,
			jobs => \@jobs,
		};
	}
	push @items, {
		no => 0 + $it->{no}, sort => 0 + $it->{sort}, type => 0 + $it->{type}, code => $it->{code},
		name => $it->{name}, info => $it->{info}, scale => $it->{scale},
		price => num($it->{price}) // 0, cost => num($it->{cost}) // 0,
		pricebase => num($it->{pricebase}) // 0, pricehalf => num($it->{pricehalf}) // 0,
		limit => num($it->{limit}) // 0, wslimit => num($it->{wslimit}) // 0,
		popular => num($it->{popular}) // 0, plus => num($it->{plus}) // 0, point => num($it->{point}) // 0,
		param => $it->{param}, flag => $it->{flag},
		func => $it->{func}, functurn => $it->{functurn}, funcsale => $it->{funcsale}, funcbuy => $it->{funcbuy},
		local_func => $it->{localfunc} || undef,
		local_functurn => $it->{localfuncturn} || undef,
		local_funcsale => $it->{localfuncsale} || undef,
		local_funcbuy => $it->{localfuncbuy} || undef,
		uses => \@uses,
	};
}

my @events;
for my $e (@out_event) {
	next if !$e->{code};
	my @params;
	for my $p (@{ $e->{param} }) {
		my ($name, $expr) = split /\t/, $p;
		my ($key, $ope, $val) = ($expr =~ /^([^\+\-\*\/\=]+)([\+\-\*\/\=])(\S+)$/);
		$key =~ s/^(\\|money)$/price/i; $key =~ s/^base$/pricebase/i;
		$key =~ s/^harf$/pricehalf/i; $key =~ s/^half$/pricehalf/i; $key =~ s/^pop$/popular/i;
		push @params, { item_no => 0 + GetItemNumber($name), key => $key, op => $ope, value => 0 + $val };
	}
	my %f;
	for my $k (qw(nowfunc startfunc endfunc)) {
		my $v = $e->{$k} // '';
		($f{$k}, $f{"${k}param"}) = $v =~ /^(.*)\((.*)\)$/ ? ($1, $2) : ($v, undef);
	}
	push @events, {
		code => $e->{code}, group => "$e->{group}", startproba => 0 + $e->{startproba},
		# startproba == -1 の event は自然発生しない（他の処理から開始されるだけ）
		auto_start => ($e->{startproba} == -1 ? JSON::PP::false : JSON::PP::true),
		basetime => 0 + ($e->{basetime} // 0), plustime => 0 + ($e->{plustime} // 0),
		info => $e->{info}, startmsg => $e->{startmsg}, endmsg => $e->{endmsg},
		startfunc => $f{startfunc} || undef, startfuncparam => $f{startfuncparam},
		endfunc => $f{endfunc} || undef, endfuncparam => $f{endfuncparam},
		nowfunc => $f{nowfunc} || undef, nowfuncparam => $f{nowfuncparam},
		local_funcstart => $e->{localfuncstart} || undef,
		local_funcend => $e->{localfuncend} || undef,
		local_funcnow => $e->{localfuncnow} || undef,
		params => \@params,
	};
}

my %define = map { ($_ => $g_define->{$_}) } grep { !ref $g_define->{$_} } keys %$g_define;
my %functions = map { ($_ => $g_define->{function}{$_}) } keys %{ $g_define->{function} };

# Muse v0.2.0 の差分。原作配布物は参照用のまま保持する。
# --original は移植元との比較・回帰検証用 (追加を適用しない)。
if (!grep { $_ eq '--original' } @ARGV) {
	open(my $fashion_fh, '<:raw', "$FindBin::Bin/fashion-v020.json") or die $!;
	my $fashion = JSON::PP->new->utf8->decode(do { local $/; <$fashion_fh> });
	close $fashion_fh;
	# 原作パーサーの文字列はUTF-8バイト列。追加定義も同じ表現に揃える。
	my $as_bytes;
	$as_bytes = sub {
		my ($v) = @_;
		return { map { $_ => $as_bytes->($v->{$_}) } keys %$v } if ref($v) eq 'HASH';
		return [ map { $as_bytes->($_) } @$v ] if ref($v) eq 'ARRAY';
		utf8::encode($v) if defined($v) && !ref($v) && utf8::is_utf8($v);
		return $v;
	};
	$fashion = $as_bytes->($fashion);
	my %by_no = map { $_->{no} => $_ } @items;
	my $copy = sub { JSON::PP->new->decode(JSON::PP->new->encode($_[0])) };
	my $lines = sub {
		my ($rows, $default_proba) = @_;
		return [ map {
			die "v0.2.0: unknown item $_->[0]" if !$by_no{$_->[0]};
			{ item_no => $_->[0], count => $_->[1], proba => $_->[2] // $default_proba }
		} @$rows ];
	};
	for my $spec (@{ $fashion->{items} }) {
		die "v0.2.0: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		my $ref = $by_no{$spec->{market_reference}} or die 'unknown market reference';
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		delete $it->{market_reference};
		@$it{qw(pricebase pricehalf wslimit)} = @$ref{qw(pricebase pricehalf wslimit)};
		# 市場に戻さない品 (タイムシガレット) は wslimit を自分で指定する
		$it->{wslimit} = $spec->{wslimit} if defined $spec->{wslimit};
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}
	for my $change (@{ $fashion->{recipe_changes} }) {
		my $u = $by_no{66}{uses}[$change->{use}];
		# 非消費の工具 (need/proba=0) は変更しない。
		$u->{use} = [ (grep { $_->{proba} == 0 } @{ $u->{use} }), @{ $lines->($change->{materials}, 1000) } ];
	}
	for my $spec (@{ $fashion->{production} }, @{ $fashion->{gathering} }) {
		my $book = $by_no{$spec->{book}};
		my $u = $copy->($book->{uses}[0]);
		$u->{no} = scalar @{ $book->{uses} };
		$u->{needexp} = $spec->{needexp};
		# 置き先の本の既存USEと同じく、非消費の工具 (count 1・proba 0) を所持条件として先頭に置く。
		$u->{use} = [ @{ $lines->([ map { [$_, 1, 0] } @{ $spec->{tools} // [] } ], 0) },
			@{ $lines->($spec->{materials} // [], 1000) } ];
		if (defined $spec->{product}) {
			my $name = $by_no{$spec->{product}}{name};
			$u->{name} = $name . 'を作成する';
			$u->{info} = $name . 'を作成します';
			$u->{okmsg} = $name . 'を作りました';
			@$u{qw(time exptime)} = @$spec{qw(time exptime)};
			$u->{params}[0] = "$spec->{lostbook}";
			$u->{jobs} = [{ job => $spec->{job}, key => 'times', op => '/', value => 2 }];
			$u->{get} = $lines->([[$spec->{product}, $spec->{get}, $spec->{proba}]], 1000);
		} else {
			$u->{name} = $spec->{name};
			$u->{info} = $spec->{name};
			$u->{time} = 10800;
			$u->{exptime} = 5400;
			$u->{exp} = 10;
			$u->{get} = $lines->($spec->{products}, 1000);
		}
		push @{ $book->{uses} }, $u;
	}
	$define{version} = $fashion->{version};

	# Muse v0.3.0 の差分: 革細工入門・木工細工入門の原作レシピは防具屋・武器屋にだけ職業ボーナスが付き、
	# 本の転職先 (革細工屋・木工細工屋 = 道具屋) には付かなかった。道具屋にも付ける (元のボーナスは残す)。
	open(my $v030_fh, '<:raw', "$FindBin::Bin/v030.json") or die $!;
	my $v030 = JSON::PP->new->utf8->decode(do { local $/; <$v030_fh> });
	close $v030_fh;
	$v030 = $as_bytes->($v030);
	for my $add (@{ $v030->{job_bonus_add} }) {
		my $u = $by_no{$add->{book}}{uses}[$add->{use}] or die "v0.3.0: unknown use $add->{book}/$add->{use}";
		die "v0.3.0: duplicate job bonus $add->{book}/$add->{use}" if grep { $_->{job} eq $add->{job} } @{ $u->{jobs} };
		push @{ $u->{jobs} }, { job => $add->{job}, key => 'times', op => '/', value => 2 };
	}

	# Muse v0.3.0 の追加品 (薬屋・酪農家・本屋・行商人・山師の新ライン)。置き場は各職業の転職の集約先。
	for my $spec (@{ $v030->{items} }) {
		die "v0.3.0: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		my $ref = $by_no{$spec->{market_reference}} or die 'unknown market reference';
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		delete $it->{market_reference};
		@$it{qw(pricebase pricehalf wslimit)} = @$ref{qw(pricebase pricehalf wslimit)};
		# 市場に戻さない品 (タイムシガレット) は wslimit を自分で指定する
		$it->{wslimit} = $spec->{wslimit} if defined $spec->{wslimit};
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}
	# 置き場の uses[0] をひな型に写し、ひな型固有の処理 (剣市の収穫2倍、ミノ牛乳を飲む) は外す。
	my $new_use = sub {
		my ($spec) = @_;
		my $book = $by_no{$spec->{book}} or die "v0.3.0: unknown book $spec->{book}";
		my $u = $copy->($book->{uses}[0]);
		$u->{no} = scalar @{ $book->{uses} };
		$u->{needexp} = $spec->{needexp};
		$u->{$_} = undef for qw(func_before local_func_before func_info local_func_info local_func arg argmessage argselect);
		$u->{money} = 0;
		$u->{jobs} = [{ job => $spec->{job}, key => 'times', op => '/', value => 2 }];
		# 工具は消費しない所持条件 (proba 0)。数字だけなら1個、[品番,個数] なら個数ぶん要る
		my @tools = map { ref $_ ? [$_->[0], $_->[1], 0] : [$_, 1, 0] } @{ $spec->{tools} // [] };
		$u->{use} = [ @{ $lines->(\@tools, 0) }, @{ $lines->($spec->{materials} // [], 1000) } ];
		push @{ $book->{uses} }, $u;
		return $u;
	};
	for my $spec (@{ $v030->{production} }) {
		my $u = $new_use->($spec);
		my $name = $by_no{$spec->{product}}{name};
		$u->{name} = $name . ($by_no{$spec->{product}}{type} == 2 ? 'を執筆する' : 'を作成する');
		$u->{info} = $name . 'を作ります';
		$u->{okmsg} = $name . 'を作りました';
		$u->{ngmsg} = '作成に失敗しました…';
		# ミノ牛乳のひな型は「飲む」(単位 本)。作る使い方には引き継がない
		@$u{qw(action scale)} = ('作る', 'セット') if $spec->{book} == 26;
		@$u{qw(time exptime exp)} = @$spec{qw(time exptime exp)};
		$u->{func} = defined $spec->{lostbook} ? 'lostbook' : undef;
		$u->{params} = [defined $spec->{lostbook} ? "$spec->{lostbook}" : undef, undef, undef, undef];
		if ($spec->{toolwear}) {
			# 道具の本 (112・113) は1セットごとに toolwear/1000 ですり切れる (1回の実行で最大1冊)
			my ($tool) = grep { !ref $_ && $by_no{$_}{type} == 2 } @{ $spec->{tools} };
			$u->{func} = 'lostbooktool';
			$u->{params} = [$u->{params}[0] // '0', "$tool", "$spec->{toolwear}", undef];
		}
		$u->{get} = $lines->([[$spec->{product}, $spec->{get}, $spec->{proba}]], 1000);
	}
	for my $spec (@{ $v030->{gathering} }) {
		my $u = $new_use->($spec);
		$u->{name} = $u->{info} = $spec->{name};
		$u->{okmsg} = undef;
		$u->{time} = 10800;
		$u->{exptime} = 5400;
		$u->{exp} = 10;
		$u->{func} = 'lostbook';
		$u->{params} = [$spec->{lostbook} // '100', undef, undef, undef];
		$u->{get} = $lines->($spec->{products}, 1000);
	}

	# イベント: 既存の変更 (原作で無効だった「不足」の復活を含む) と追加
	my %ev_by_code = map { $_->{code} => $_ } @events;
	my $params = sub { [ map { die "v0.3.0: unknown item $_->{item_no}" if !$by_no{$_->{item_no}}; +{ %$_ } } @{ $_[0] // [] } ] };
	for my $ch (@{ $v030->{event_changes} }) {
		my $e = $ev_by_code{$ch->{code}} or die "v0.3.0: unknown event $ch->{code}";
		for my $k (keys %{ $ch->{set} // {} }) {
			my $v = $ch->{set}{$k};
			$e->{$k} = $k eq 'auto_start' ? ($v ? JSON::PP::true : JSON::PP::false) : $k eq 'group' ? "$v" : $v;
		}
		my %raw = map { $_ => 1 } @{ $ch->{popular_raw} // [] };
		for my $p (@{ $e->{params} }) {
			$p->{value} = 1.5 if $raw{$p->{item_no}} && $p->{key} eq 'popular' && $p->{op} eq '*';
		}
		push @{ $e->{params} }, @{ $params->($ch->{add_params}) };
	}
	for my $spec (@{ $v030->{events} }) {
		die "v0.3.0: duplicate event $spec->{code}" if $ev_by_code{$spec->{code}};
		push @events, {
			code => $spec->{code}, group => "$spec->{group}", startproba => $spec->{startproba},
			auto_start => ($spec->{auto_start} ? JSON::PP::true : JSON::PP::false),
			basetime => $spec->{basetime}, plustime => $spec->{plustime},
			info => $spec->{info}, startmsg => $spec->{startmsg}, endmsg => $spec->{endmsg},
			startfunc => undef, startfuncparam => undef, endfunc => undef, endfuncparam => undef,
			nowfunc => undef, nowfuncparam => undef,
			local_funcstart => undef, local_funcend => undef, local_funcnow => undef,
			params => $params->($spec->{params}),
		};
	}

	$define{version} = $v030->{version};

	# Party #4 の追加品 (固めプリン)。版番号は変えない (次版の番号は管理者が決める)。
	open(my $pudding_fh, '<:raw', "$FindBin::Bin/pudding.json") or die $!;
	my $pudding = JSON::PP->new->utf8->decode(do { local $/; <$pudding_fh> });
	close $pudding_fh;
	$pudding = $as_bytes->($pudding);
	for my $spec (@{ $pudding->{items} }) {
		die "pudding: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		die "pudding: item $spec->{no} is not next" if $spec->{no} != @items + 1;
		my $ref = $by_no{$spec->{market_reference}} or die 'unknown market reference';
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		delete $it->{market_reference};
		@$it{qw(pricebase pricehalf wslimit)} = @$ref{qw(pricebase pricehalf wslimit)};
		# 市場に戻さない品 (タイムシガレット) は wslimit を自分で指定する
		$it->{wslimit} = $spec->{wslimit} if defined $spec->{wslimit};
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}
	for my $spec (@{ $pudding->{production} }) {
		my $u = $new_use->($spec);
		my $name = $by_no{$spec->{product}}{name};
		$u->{name} = $name . 'を作成する';
		$u->{info} = $name . 'を作ります';
		$u->{okmsg} = $name . 'を作りました';
		$u->{ngmsg} = '作成に失敗しました…';
		# 置き場 (ミノ牛乳) の「飲む」の表示文言を引き継がない
		@$u{qw(action scale)} = @$spec{qw(action scale)};
		@$u{qw(time exptime exp)} = @$spec{qw(time exptime exp)};
		$u->{func} = undef;
		$u->{params} = [undef, undef, undef, undef];
		$u->{get} = $lines->([[$spec->{product}, $spec->{get}, $spec->{proba}]], 1000);
	}
	my %ev_now = map { $_->{code} => $_ } @events;
	for my $ch (@{ $pudding->{event_add_params} }) {
		my $e = $ev_now{$ch->{code}} or die "pudding: unknown event $ch->{code}";
		push @{ $e->{params} }, @{ $params->($ch->{params}) };
	}

	# 目安箱 #6: 禁断の書を手放す使い方 (加害でない選択肢)。本を1冊消費し、効果は scripts.ts の 商品コード:func。
	open(my $fb_fh, '<:raw', "$FindBin::Bin/forbidden-book.json") or die $!;
	my $fb = JSON::PP->new->utf8->decode(do { local $/; <$fb_fh> });
	close $fb_fh;
	$fb = $as_bytes->($fb);
	for my $spec (@{ $fb->{uses} }) {
		my $it = $by_no{$spec->{item}} or die "forbidden-book: unknown item $spec->{item}";
		die "forbidden-book: duplicate use $spec->{name}" if grep { $_->{name} eq $spec->{name} } @{ $it->{uses} };
		push @{ $it->{uses} }, {
			action => $spec->{action}, name => $spec->{name}, info => $spec->{info},
			okmsg => $spec->{okmsg}, ngmsg => undef, scale => '回',
			no => scalar @{ $it->{uses} }, needexp => undef, jobs => [],
			arg => 'nocount', argmessage => undef, argselect => undef,
			time => $spec->{time}, exptime => $spec->{time}, exp => 0, money => 0,
			func => $spec->{func}, params => ["$spec->{rank_up}", undef, undef, undef],
			func_before => undef, func_info => undef,
			local_func => undef, local_func_before => undef, local_func_info => undef,
			use => [{ item_no => $spec->{item}, count => 1, proba => 1000 }],
			get => [],
		};
	}

	# 目安箱 #7 (0.6.0): 干し草飼料。干し草 (115) を足し、木こりの山歩き7つに副産物、新しい行き先「牧草地で草を刈る」、
	# ミノタウロス♀に「干し草を与えて搾る」(処理は scripts.ts の mino:_local_2 / _local_b2) と「放牧地で草を刈る」を足す。
	# 原作の乳を搾る・ハードに乳を搾るは式を変えず、説明 (info) に数字を足すだけ。
	open(my $hay_fh, '<:raw', "$FindBin::Bin/hay.json") or die $!;
	my $hay = JSON::PP->new->utf8->decode(do { local $/; <$hay_fh> });
	close $hay_fh;
	$hay = $as_bytes->($hay);
	for my $spec (@{ $hay->{items} }) {
		die "hay: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		die "hay: item $spec->{no} is not next" if $spec->{no} != @items + 1;
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}
	for my $bp (@{ $hay->{byproducts} }) {
		for my $no (@{ $bp->{uses} }) {
			my $u = $by_no{$bp->{book}}{uses}[$no] or die "hay: unknown use $bp->{book}/$no";
			die "hay: duplicate byproduct $bp->{book}/$no" if grep { $_->{item_no} == $bp->{get}[0] } @{ $u->{get} };
			push @{ $u->{get} }, @{ $lines->([$bp->{get}], 1000) };
		}
	}
	for my $spec (@{ $hay->{gathering} }) {
		my $u = $new_use->($spec);
		$u->{name} = $u->{info} = $spec->{name};
		$u->{okmsg} = undef;
		@$u{qw(time exptime exp)} = @$spec{qw(time exptime exp)};
		$u->{func} = 'lostbook';
		$u->{params} = [$spec->{lostbook}, undef, undef, undef];
		$u->{get} = $lines->($spec->{products}, 1000);
	}
	my $cow = $by_no{25};
	for my $spec (@{ $hay->{cow_uses} }) {
		die "hay: duplicate use $spec->{name}" if grep { $_->{name} eq $spec->{name} } @{ $cow->{uses} };
		my $u = $copy->($cow->{uses}[0]);
		$u->{no} = scalar @{ $cow->{uses} };
		$u->{$_} = undef for qw(func_before local_func_before func_info local_func_info local_func okmsg ngmsg arg argmessage argselect needexp);
		@$u{qw(name action scale info time exptime exp)} = @$spec{qw(name action scale info time exptime exp)};
		$u->{okmsg} = $spec->{okmsg};
		$u->{func} = $spec->{func};
		$u->{func_before} = $spec->{func_before};
		$u->{params} = $spec->{params} // [undef, undef, undef, undef];
		# 干し草を与えて搾るの干し草は「1頭ぶん」で書き、実行時に頭数ぶんへ直す (scripts.ts scaleUseMaterials)
		push @{ $u->{use} }, @{ $lines->($spec->{materials} // [], 1000) };
		$u->{get} = $lines->($spec->{get} // [], 1000);
		push @{ $cow->{uses} }, $u;
	}
	for my $ch (@{ $hay->{info_changes} }) {
		my $u = $by_no{$ch->{item}}{uses}[$ch->{use}] or die "hay: unknown use $ch->{item}/$ch->{use}";
		$u->{info} = $ch->{info};
	}
	# 酪農の乳製品: ヘビー発酵 (チーズ) を牛乳売りより少し上に (時間はライト発酵と同じ、2個できる)。
	# 熟練0の時間 (time) だけ書き、熟練最大の時間は下の熟練の共有で決まる。
	for my $ch (@{ $hay->{recipe_changes} }) {
		my $u = $by_no{$ch->{item}}{uses}[$ch->{use}] or die "hay: unknown use $ch->{item}/$ch->{use}";
		$u->{time} = $u->{exptime} = $ch->{time};
		$u->{get} = $lines->($ch->{get}, 1000);
		$u->{info} = $ch->{info} if defined $ch->{info};
	}
	# 牛乳は干し草で量が増えて数時間で上限に届くので、所持上限を上げる (ジェラートも)
	for my $ch (@{ $hay->{limit_changes} }) {
		my $it = $by_no{$ch->{item}} or die "hay: unknown item $ch->{item}";
		$it->{limit} = $ch->{limit};
	}

	# 1.0.0 職業バランス (tools/v100.json): E = 既存品の直し (材料・時間・成功率・値段・本のすり切れ率)、
	# F = 新しい品16品とイベントへの登録。熟練の共有 (下) より前に当てる (ミノ牛乳の品は time を書き、熟練最大は共有で決まる)。
	open(my $v100_fh, '<:raw', "$FindBin::Bin/v100.json") or die $!;
	my $v100 = JSON::PP->new->utf8->decode(do { local $/; <$v100_fh> });
	close $v100_fh;
	$v100 = $as_bytes->($v100);
	my $find_use = sub {
		my ($book, $product) = @_;
		my @u = grep { @{ $_->{get} } && $_->{get}[0]{item_no} == $product } @{ $by_no{$book}{uses} };
		die "v1.0.0: recipe $book/$product not found (or not unique)" if @u != 1;
		return $u[0];
	};
	for my $ch (@{ $v100->{recipe_changes} }) {
		my $u = $find_use->($ch->{book}, $ch->{product});
		for my $no (keys %{ $ch->{materials} // {} }) {
			my @l = grep { $_->{item_no} == $no && $_->{proba} > 0 } @{ $u->{use} };
			die "v1.0.0: material $no not in $ch->{book}/$ch->{product}" if @l != 1;
			$l[0]{count} = $ch->{materials}{$no};
		}
		$u->{exptime} = $ch->{exptime} if defined $ch->{exptime};
		$u->{time} = $u->{exptime} = $ch->{time} if defined $ch->{time};
		$u->{get}[0]{proba} = $ch->{proba} if defined $ch->{proba};
	}
	for my $no (keys %{ $v100->{price_changes} }) {
		my $it = $by_no{$no} or die "v1.0.0: unknown item $no";
		$it->{price} = $v100->{price_changes}{$no};
	}
	for my $no (keys %{ $v100->{popular_changes} }) {
		my $it = $by_no{$no} or die "v1.0.0: unknown item $no";
		$it->{popular} = $v100->{popular_changes}{$no};
	}
	# 本のすり切れ: 値段を上げたぶん率を下げる (値段×率をそろえる)。その本の使い方すべての params[0] を表で置き換える
	for my $ch (@{ $v100->{field_changes} // [] }) {
		my $it = $by_no{$ch->{item}} or die "v1.0.0: unknown item $ch->{item}";
		for my $k (grep { $_ ne 'item' && $_ ne 'note' } keys %$ch) {
			die "v1.0.0: unknown field $k" if !exists $it->{$k};
			$it->{$k} = $ch->{$k};
		}
	}
	for my $book (keys %{ $v100->{lostbook_changes} }) {
		my $map = $v100->{lostbook_changes}{$book};
		for my $u (@{ $by_no{$book}{uses} }) {
			next if !defined $u->{func} || ($u->{func} ne 'lostbook' && $u->{func} ne 'lostbooktool');
			my $old = $u->{params}[0];
			die "v1.0.0: lostbook $book/$u->{no} rate $old has no new rate" if !defined $map->{$old};
			$u->{params}[0] = "$map->{$old}";
		}
	}
	for my $spec (@{ $v100->{items} }) {
		die "v1.0.0: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		die "v1.0.0: item $spec->{no} is not next" if $spec->{no} != @items + 1;
		my $ref = $by_no{$spec->{market_reference}} or die 'unknown market reference';
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		delete $it->{market_reference};
		@$it{qw(pricebase pricehalf wslimit)} = @$ref{qw(pricebase pricehalf wslimit)};
		# 市場に戻さない品 (タイムシガレット) は wslimit を自分で指定する
		$it->{wslimit} = $spec->{wslimit} if defined $spec->{wslimit};
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}
	# 品そのものの使い方 (タイムシガレットを吸う)。ひな型は転職のススメの使い方
	for my $spec (@{ $v100->{item_uses} // [] }) {
		my $it = $by_no{$spec->{item}} or die "v1.0.0: unknown item $spec->{item}";
		my $u = $copy->($by_no{78}{uses}[0]);
		$u->{$_} = undef for qw(func func_before local_func_before func_info local_func_info local_func arg argmessage argselect ngmsg needexp);
		$u->{params} = [undef, undef, undef, undef];
		$u->{no} = scalar @{ $it->{uses} };
		@$u{qw(name action scale info okmsg)} = @$spec{qw(name action scale info okmsg)};
		@$u{qw(time exptime exp money)} = ($spec->{time}, $spec->{time}, 0, 0);
		$u->{jobs} = [];
		$u->{get} = [];
		$u->{use} = $lines->([[$it->{no}, 1]], 1000);
		push @{ $it->{uses} }, $u;
	}
	for my $spec (@{ $v100->{production} }) {
		my $u = $new_use->($spec);
		my $name = $by_no{$spec->{product}}{name};
		$u->{name} = $name . 'を作成する';
		$u->{info} = $name . 'を作ります';
		$u->{okmsg} = $name . 'を作りました';
		$u->{ngmsg} = '作成に失敗しました…';
		@$u{qw(time exptime exp)} = @$spec{qw(time exptime exp)};
		$u->{func} = 'lostbook';
		$u->{params} = ["$spec->{lostbook}", undef, undef, undef];
		$u->{get} = $lines->([[$spec->{product}, $spec->{get}, $spec->{proba}]], 1000);
	}
	my %ev_v100 = map { $_->{code} => $_ } @events;
	for my $ch (@{ $v100->{event_add_params} }) {
		my $e = $ev_v100{$ch->{code}} or die "v1.0.0: unknown event $ch->{code}";
		for my $p (@{ $ch->{params} }) {
			die "v1.0.0: duplicate event param $ch->{code}/$p->{item_no}/$p->{key}" if grep { $_->{item_no} == $p->{item_no} && $_->{key} eq $p->{key} } @{ $e->{params} };
		}
		push @{ $e->{params} }, @{ $params->($ch->{params}) };
	}
	for my $ch (@{ $v100->{info_changes} }) {
		my @u = grep { $_->{name} eq $ch->{use_name} } @{ $by_no{$ch->{item}}{uses} };
		die "v1.0.0: unknown use $ch->{item}/$ch->{use_name}" if @u != 1;
		$u[0]{info} = $ch->{info};
	}
	$define{version} = $v100->{version};

	# 1.0.1 イベント込みの職業バランス (tools/v101.json): イベントの確率・文言・効果の書き換え、交易品の品薄の追加、
	# 香水・エリクシルの popular。
	open(my $v101_fh, '<:raw', "$FindBin::Bin/v101.json") or die $!;
	my $v101 = JSON::PP->new->utf8->decode(do { local $/; <$v101_fh> });
	close $v101_fh;
	$v101 = $as_bytes->($v101);
	for my $no (keys %{ $v101->{popular_changes} }) {
		my $it = $by_no{$no} or die "v1.0.1: unknown item $no";
		$it->{popular} = $v101->{popular_changes}{$no};
	}
	my %ev_v101 = map { $_->{code} => $_ } @events;
	for my $ch (@{ $v101->{event_changes} }) {
		my $e = $ev_v101{$ch->{code}} or die "v1.0.1: unknown event $ch->{code}";
		for my $k (keys %{ $ch->{set} // {} }) {
			$e->{$k} = $ch->{set}{$k};
		}
		$e->{params} = $params->($ch->{replace_params}) if $ch->{replace_params};
		for my $p (@{ $ch->{add_params} // [] }) {
			die "v1.0.1: duplicate event param $ch->{code}/$p->{item_no}/$p->{key}" if grep { $_->{item_no} == $p->{item_no} && $_->{key} eq $p->{key} } @{ $e->{params} };
		}
		push @{ $e->{params} }, @{ $params->($ch->{add_params}) };
	}
	for my $spec (@{ $v101->{events} }) {
		die "v1.0.1: duplicate event $spec->{code}" if $ev_v101{$spec->{code}};
		push @events, {
			code => $spec->{code}, group => "$spec->{group}", startproba => $spec->{startproba},
			auto_start => ($spec->{auto_start} ? JSON::PP::true : JSON::PP::false),
			basetime => $spec->{basetime}, plustime => $spec->{plustime},
			info => $spec->{info}, startmsg => $spec->{startmsg}, endmsg => $spec->{endmsg},
			startfunc => undef, startfuncparam => undef, endfunc => undef, endfuncparam => undef,
			nowfunc => undef, nowfuncparam => undef,
			local_funcstart => undef, local_funcend => undef, local_funcnow => undef,
			params => $params->($spec->{params}),
		};
	}
	$define{version} = $v101->{version};

	# 1.2.0 街の地図 (tools/v120.json): 店用ペンキ・転居許可証。値段固定・所持上限1・維持費0。使い方は行動 paint / move
	open(my $v120_fh, '<:raw', "$FindBin::Bin/v120.json") or die $!;
	my $v120 = JSON::PP->new->utf8->decode(do { local $/; <$v120_fh> });
	close $v120_fh;
	$v120 = $as_bytes->($v120);
	for my $spec (@{ $v120->{items} }) {
		die "v1.2.0: duplicate item $spec->{no}" if $by_no{$spec->{no}};
		die "v1.2.0: item $spec->{no} is not next" if $spec->{no} != @items + 1;
		my $it = $copy->($by_no{2});
		@$it{keys %$spec} = values %$spec;
		$it->{point} = 1000;
		$it->{uses} = [];
		push @items, $it;
		$by_no{$it->{no}} = $it;
	}

	# 1.2.2 (tools/v122.json): 原作で exptime が無かった (熟練が時間に効かなかった) 使い方に、熟練100%の時間を付ける
	open(my $v122_fh, '<:raw', "$FindBin::Bin/v122.json") or die $!;
	my $v122 = JSON::PP->new->utf8->decode(do { local $/; <$v122_fh> });
	close $v122_fh;
	$v122 = $as_bytes->($v122);
	for my $ch (@{ $v122->{recipe_exptime} }) {
		my @u = grep { ($_->{name} // '') eq $ch->{name} } @{ $by_no{$ch->{item}}{uses} };
		die "v1.2.2: use $ch->{item}/$ch->{name} not found (or not unique)" if @u != 1;
		die "v1.2.2: $ch->{item}/$ch->{name} already has exptime" if $u[0]{exptime} != $u[0]{time};
		$u[0]{exptime} = $ch->{exptime};
	}

	# 1.3.0 13職を職コードごとに分ける (tools/v130.json): 職の名前を足し、転職のススメの行き先を子の職コードにする。
	# 職ボーナスは親の職コードのまま (子は親のボーナスを受ける。engine/jobs.ts)
	open(my $v130_fh, '<:raw', "$FindBin::Bin/v130.json") or die $!;
	my $v130 = JSON::PP->new->utf8->decode(do { local $/; <$v130_fh> });
	close $v130_fh;
	$v130 = $as_bytes->($v130);
	@define{keys %{ $v130->{define} }} = values %{ $v130->{define} };
	for my $no (sort keys %{ $v130->{job_change} }) {
		my ($parent, $child) = @{ $v130->{job_change}{$no} };
		die "v1.3.0: no name for $child" if !defined $define{"job-$child"};
		my $m = 0;
		for my $u (@{ $by_no{78}{uses} }) {
			next if !$u->{params} || ($u->{params}[0] // '') ne $no;
			die "v1.3.0: 78/$u->{no} is not $parent" if $u->{params}[3] ne $parent;
			$u->{params}[3] = $child;
			$m++;
		}
		die "v1.3.0: no job change to $no" if $m != 1;
	}
	$define{version} = $v130->{version};

	if (!grep { $_ eq '--before-v140-balance' } @ARGV) {
		# 1.4.0 の出来高・加工時間・木工品 (tools/v140-balance.json)。
		open(my $v140_fh, '<:raw', "$FindBin::Bin/v140-balance.json") or die $!;
		my $v140 = JSON::PP->new->utf8->decode(do { local $/; <$v140_fh> });
		close $v140_fh;
		$v140 = $as_bytes->($v140);
		for my $no (keys %{ $v140->{prices} }) {
			my $it = $by_no{$no} or die "v1.4.0: unknown item $no";
			$it->{price} = $v140->{prices}{$no};
		}
		for my $ch (@{ $v140->{recipe_times} }) {
			my $u = $find_use->($ch->{book}, $ch->{product});
			@$u{qw(time exptime)} = @$ch{qw(time exptime)};
		}
		for my $spec (@{ $v140->{items} }) {
			die "v1.4.0: item $spec->{no} is not next" if $spec->{no} != @items + 1;
			my $ref = $by_no{$spec->{reference}} or die 'v1.4.0: unknown item reference';
			my $it = $copy->($ref);
			@$it{keys %$spec} = values %$spec;
			delete $it->{reference};
			$it->{uses} = [];
			push @items, $it;
			$by_no{$it->{no}} = $it;
		}
		my $woodwork = $v140->{woodwork};
		my $template = $find_use->($woodwork->{book}, $woodwork->{template});
		my $wood_uses = $by_no{$woodwork->{book}}{uses};
		for my $spec (@{ $woodwork->{recipes} }) {
			my $u = $copy->($template);
			my $name = $by_no{$spec->{product}}{name};
			$u->{no} = scalar @$wood_uses;
			$u->{name} = $name . 'を作成する';
			$u->{info} = $name . 'を作成します';
			$u->{okmsg} = $name . 'を作りました';
			$u->{needexp} = $woodwork->{needexp};
			@$u{qw(time exptime)} = @$spec{qw(time exptime)};
			$u->{use} = $lines->($spec->{materials}, 1000);
			$u->{get} = $lines->([[$spec->{product}, $spec->{count}, $spec->{proba}]], 1000);
			push @$wood_uses, $u;
		}
		my $gather = $v140->{gathering};
		my ($gather_use) = grep { $_->{no} == $gather->{use} } @{ $by_no{$gather->{book}}{uses} };
		die 'v1.4.0: gathering use not found' if !$gather_use;
		push @{ $gather_use->{get} }, @{ $lines->([$gather->{get}], 1000) };
		for my $book (keys %{ $v140->{yield_percent} }) {
			for my $u (@{ $by_no{$book}{uses} }) {
				for my $get (@{ $u->{get} }) {
					my $scaled = $get->{count} * $v140->{yield_percent}{$book};
					if ($get->{count} >= 5) {
						$get->{count} = int(($scaled + 50) / 100);
					} else {
						$get->{count} = int($scaled / 100);
						my $remainder = $scaled % 100;
						$get->{fraction} = $remainder * 10 if $remainder;
					}
				}
			}
		}
		$define{version} = $v140->{version};

		# 1.5.0 石炭と寒波 (tools/v150-coal.json)。石炭・黒玉の原石は流入・不足のどのイベントにも入れない。
		# 鉱山の地図の行き先は 1.4.0 の出来高の倍率 (yield_percent) の後に足す (鉱山の地図は倍率の対象外)
		open(my $v150_fh, '<:raw', "$FindBin::Bin/v150-coal.json") or die $!;
		my $v150 = JSON::PP->new->utf8->decode(do { local $/; <$v150_fh> });
		close $v150_fh;
		$v150 = $as_bytes->($v150);
		for my $spec (@{ $v150->{items} }) {
			die "v1.5.0: item $spec->{no} is not next" if $spec->{no} != @items + 1;
			my $ref = $by_no{$spec->{reference}} or die 'v1.5.0: unknown item reference';
			my $it = $copy->($ref);
			@$it{keys %$spec} = values %$spec;
			delete $it->{reference};
			$it->{uses} = [];
			push @items, $it;
			$by_no{$it->{no}} = $it;
		}
		my $g150 = $v150->{gathering};
		my $map_uses = $by_no{$g150->{book}}{uses};
		my ($g_tpl) = grep { $_->{no} == $g150->{template_use} } @$map_uses;
		die 'v1.5.0: gathering template not found' if !$g_tpl;
		my $gu = $copy->($g_tpl);
		$gu->{no} = scalar @$map_uses;
		$gu->{name} = $gu->{info} = $g150->{name};
		@$gu{qw(time exptime needexp)} = @$g150{qw(time exptime needexp)};
		$gu->{get} = $lines->($g150->{get}, 1000);
		push @$map_uses, $gu;
		for my $spec (@{ $v150->{recipes} }) {
			my $u = $copy->($find_use->($spec->{book}, $spec->{template_product}));
			my $uses = $by_no{$spec->{book}}{uses};
			my $name = $by_no{$spec->{product}}{name};
			$u->{no} = scalar @$uses;
			$u->{name} = $name . 'を作成する';
			$u->{info} = $name . 'を作成します';
			$u->{okmsg} = $name . 'を作りました';
			@$u{qw(time exptime)} = @$spec{qw(time exptime)};
			# 道具 (proba 0) は見本のまま、材料だけ入れ替える
			$u->{use} = [ (grep { !$_->{proba} } @{ $u->{use} }), @{ $lines->($spec->{materials}, 1000) } ];
			$u->{get} = $lines->([[$spec->{product}, $spec->{count}, $spec->{proba}]], 1000);
			push @$uses, $u;
		}
		my %ev150 = map { $_->{code} => $_ } @events;
		for my $spec (@{ $v150->{events} }) {
			die "v1.5.0: duplicate event $spec->{code}" if $ev150{$spec->{code}};
			die "v1.5.0: group $spec->{group} is used" if grep { $_->{group} eq "$spec->{group}" } @events;
			push @events, {
				code => $spec->{code}, group => "$spec->{group}", startproba => $spec->{startproba},
				auto_start => ($spec->{auto_start} ? JSON::PP::true : JSON::PP::false),
				basetime => $spec->{basetime}, plustime => $spec->{plustime},
				info => $spec->{info}, startmsg => $spec->{startmsg}, endmsg => $spec->{endmsg},
				startfunc => undef, startfuncparam => undef, endfunc => undef, endfuncparam => undef,
				nowfunc => undef, nowfuncparam => undef,
				local_funcstart => undef, local_funcend => undef, local_funcnow => undef,
				params => $params->($spec->{params}),
			};
		}
		$define{version} = $v150->{version};

		# 1.7.0 道具3職の梱包と自分の品 (tools/v170-tool-jobs.json)。梱包6種の時間を伸ばし、自分の品の取れる数を増やす。
		# 取れる数は「個数＋端数 (fraction、1000分の1個)」の期待値に倍率を掛け、整数部を count、残りを fraction にする
		open(my $v170_fh, '<:raw', "$FindBin::Bin/v170-tool-jobs.json") or die $!;
		my $v170 = JSON::PP->new->utf8->decode(do { local $/; <$v170_fh> });
		close $v170_fh;
		$v170 = $as_bytes->($v170);
		my $pack = $v170->{packing};
		for my $name (@{ $pack->{uses} }) {
			my @hit = grep { $_->{name} eq $name } @{ $by_no{$pack->{book}}{uses} };
			die "v1.7.0: packing use not found: $name" if @hit != 1;
			$hit[0]{$_} = int($hit[0]{$_} * $pack->{time_percent} / 100) for qw(time exptime);
		}
		# 薬草をふもと以外の行き先でも (あれば本数を変え、無ければ足す)
		my $herbs = $v170->{herbs};
		for my $route (@{ $herbs->{routes} }) {
			my ($name, $count) = @$route;
			my @hit = grep { $_->{name} eq $name } @{ $by_no{$herbs->{book}}{uses} };
			die "v1.7.0: herb route not found" if @hit != 1;
			my ($line) = grep { $_->{item_no} == $herbs->{item} } @{ $hit[0]{get} };
			if ($line) { $line->{count} = $count; $line->{proba} = $herbs->{proba} }
			else { push @{ $hit[0]{get} }, @{ $lines->([[$herbs->{item}, $count, $herbs->{proba}]], 1000) } }
		}
		my %own;
		for my $job (keys %{ $v170->{own_yield_percent} }) {
			my $spec = $v170->{own_yield_percent}{$job};
			$own{$_} = $spec->{percent} for @{ $spec->{items} };
		}
		my %seen170;
		for my $it (@items) {
			for my $u (@{ $it->{uses} }) {
				for my $get (@{ $u->{get} }) {
					my $pct = $own{$get->{item_no}} or next;
					my $milli = ($get->{count} * 1000 + ($get->{fraction} // 0)) * $pct;
					$milli = int(($milli + 50) / 100);
					$get->{count} = int($milli / 1000);
					my $rest = $milli % 1000;
					if ($rest) { $get->{fraction} = $rest } else { delete $get->{fraction} }
					$seen170{$get->{item_no}}++;
				}
			}
		}
		for my $no (keys %own) { die "v1.7.0: no recipe makes $no" if !$seen170{$no} }
		# 所持上限の見直し (1回で作れる数・1決算の需要に比べて低すぎる品)
		for my $pair (@{ $v170->{limits}{items} }) {
			my ($no, $limit) = @$pair;
			my $it = $by_no{$no} or die "v1.7.0: unknown item $no";
			die "v1.7.0: limit $no lowers" if $limit < $it->{limit};
			$it->{limit} = $limit;
		}
		# ナユタの首飾りを強くする (作る時間を縮め、需要は popular で絞る)
		my $nk = $v170->{necklace};
		my @nk = grep { @{ $_->{get} } && $_->{get}[0]{item_no} == $nk->{item} } @{ $by_no{$nk->{book}}{uses} };
		die 'v1.7.0: necklace recipe not found' if @nk != 1;
		@{ $nk[0] }{qw(time exptime)} = @$nk{qw(time exptime)};
		$by_no{$nk->{item}}{popular} = $nk->{popular};
		# 採る2職の道具 (ツルハシ・オノ)。品を足し、作り方をほかの職の本に足す。効き目はエンジン (src/engine/gather-tools.ts)
		my $gt = $v170->{gather_tools};
		for my $spec (@{ $gt->{items} }) {
			die "v1.7.0: item $spec->{no} is not next" if $spec->{no} != @items + 1;
			my $ref = $by_no{$spec->{reference}} or die 'v1.7.0: unknown item reference';
			my $it = $copy->($ref);
			@$it{keys %$spec} = values %$spec;
			delete $it->{reference};
			$it->{uses} = [];
			push @items, $it;
			$by_no{$it->{no}} = $it;
		}
		for my $spec (@{ $gt->{recipes} }) {
			my $u = $copy->($find_use->($spec->{book}, $spec->{template_product}));
			my $uses = $by_no{$spec->{book}}{uses};
			my $name = $by_no{$spec->{product}}{name};
			$u->{no} = scalar @$uses;
			$u->{name} = $name . 'を作成する';
			$u->{info} = $name . 'を作成します';
			$u->{okmsg} = $name . 'を作りました';
			@$u{qw(time exptime)} = @$spec{qw(time exptime)};
			$u->{use} = [ (grep { !$_->{proba} } @{ $u->{use} }), @{ $lines->($spec->{materials}, 1000) } ];
			$u->{get} = $lines->([[$spec->{product}, $spec->{count}, $spec->{proba}]], 1000);
			push @$uses, $u;
		}
		$define{version} = $v170->{version};

		# 1.8.1 転職のススメの説明に、熟練の持ち越しと職レベルのことを書き足す (tools/v181.json)。文言だけ
		open(my $v181_fh, '<:raw', "$FindBin::Bin/v181.json") or die $!;
		my $v181 = JSON::PP->new->utf8->decode(do { local $/; <$v181_fh> });
		close $v181_fh;
		$v181 = $as_bytes->($v181);
		my $n181 = 0;
		for my $u (@{ $by_no{78}{uses} }) {
			my $book = $u->{params} && $u->{params}[0];
			next if !$book;
			die "v1.8.1: 78/$u->{no} has no rate" if ($u->{params}[2] // '') ne '0.5';
			my $suffix = $v181->{job_change_info_suffix};
			$suffix =~ s/\{book\}/$by_no{$book}{name}/g;
			$u->{info} .= $suffix;
			$n181++;
		}
		die "v1.8.1: job changes $n181" if $n181 != 13;
		$define{version} = $v181->{version};

		# 1.8.1 アイテム説明の書き足し (tools/v181-item-info.json)。実際の動きと合っていない所・肝心な効果が無い所だけ。文言だけ
		open(my $vinfo_fh, '<:raw', "$FindBin::Bin/v181-item-info.json") or die $!;
		my $vinfo = JSON::PP->new->utf8->decode(do { local $/; <$vinfo_fh> });
		close $vinfo_fh;
		$vinfo = $as_bytes->($vinfo);
		for my $ch (@{ $vinfo->{info_changes} }) {
			my $it = $by_no{$ch->{item}} or die "v1.8.1 info: unknown item $ch->{item}";
			my $t = $it;
			if (defined $ch->{use_name}) {
				my @u = grep { ($_->{name} // '') eq $ch->{use_name} } @{ $it->{uses} };
				die "v1.8.1 info: unknown use $ch->{item}/$ch->{use_name}" if @u != 1;
				$t = $u[0];
			}
			die "v1.8.1 info: $ch->{item} info changed" if ($t->{info} // '') ne $ch->{before};
			$t->{info} = $ch->{after};
		}

		# 1.8.2 地図と干し草の品不足 (tools/v182.json): 市場の天井 (wslimit) を上げ、鉱山・山の地図の傷みを下げる
		open(my $v182_fh, '<:raw', "$FindBin::Bin/v182.json") or die $!;
		my $v182 = JSON::PP->new->utf8->decode(do { local $/; <$v182_fh> });
		close $v182_fh;
		for my $pair (@{ $v182->{wslimit} }) {
			my ($no, $ws) = @$pair;
			my $it = $by_no{$no} or die "v1.8.2: unknown item $no";
			die "v1.8.2: wslimit $no lowers" if $ws <= $it->{wslimit};
			$it->{wslimit} = $ws;
		}
		my $mw = $v182->{map_wear};
		for my $no (@{ $mw->{items} }) {
			my $n = 0;
			for my $u (@{ $by_no{$no}{uses} }) {
				next if ($u->{func} // '') ne 'lostbook';
				my $p = $u->{params}[0];
				die "v1.8.2: $no/$u->{no} has no wear" if !$p;
				$u->{params}[0] = '' . int($p * $mw->{percent} / 100 + 0.5);
				$n++;
			}
			die "v1.8.2: no wear on $no" if !$n;
		}
		$define{version} = $v182->{version};

		# 1.9.0 ナユタの首飾りの人気上昇に値段をつける (tools/v184.json): 効いている間すり減る。param = 1決算あたりの傷み (1000=平均1個)
		open(my $v184_fh, '<:raw', "$FindBin::Bin/v184.json") or die $!;
		my $v184 = JSON::PP->new->utf8->decode(do { local $/; <$v184_fh> });
		close $v184_fh;
		$v184 = $as_bytes->($v184);
		my $ny = $v184->{nayuta};
		my $nit = $by_no{$ny->{item}} or die "v1.9.0: unknown item $ny->{item}";
		die "v1.9.0: $ny->{item} is not nayuta" if $nit->{code} ne 'sousyoku-nayuta';
		die "v1.9.0: $ny->{item} already has param" if defined $nit->{param};
		die "v1.9.0: nayuta info changed" if ($nit->{info} // '') ne $ny->{info_before};
		$nit->{param} = $ny->{wear};
		$nit->{info} = $ny->{info_after};
		$define{version} = $v184->{version};

		# 1.9.0 素材の市場還流 (tools/v190-resale.json): 客に売れた素材の一部を市場の掘り出し物の枠へ。resalerate = 戻す割合、bargainprice = plus 0以下の品の掘り出し物の卸値の倍率 (どちらも千分率)
		open(my $v190r_fh, '<:raw', "$FindBin::Bin/v190-resale.json") or die $!;
		my $v190r = JSON::PP->new->utf8->decode(do { local $/; <$v190r_fh> });
		close $v190r_fh;
		$v190r = $as_bytes->($v190r);
		for my $k (sort keys %{ $v190r->{define} }) {
			die "v1.9.0: define $k already exists" if exists $define{$k};
			$define{$k} = $v190r->{define}{$k};
		}
		$define{version} = $v190r->{version};

		# 1.9.1 観戦画面の市場に掘り出し物 (tools/v191.json)。データは変えず版だけ
		open(my $v191_fh, '<:raw', "$FindBin::Bin/v191.json") or die $!;
		my $v191 = JSON::PP->new->utf8->decode(do { local $/; <$v191_fh> });
		close $v191_fh;
		$define{version} = $v191->{version};
	}

	# 熟練の共有: item の使い方は exp_item (転職で熟練が集まる先) の熟練を読み書きする。
	# 物を作る使い方 (get あり) は、今の時間を熟練0の時間とし、熟練最大で production_exptime_rate 倍に縮む。
	open(my $share_fh, '<:raw', "$FindBin::Bin/skill-share.json") or die $!;
	my $share = JSON::PP->new->utf8->decode(do { local $/; <$share_fh> });
	close $share_fh;
	for my $sh (@{ $share->{shares} }) {
		my $it = $by_no{$sh->{item}} or die "skill-share: unknown item $sh->{item}";
		$by_no{$sh->{exp_item}} or die "skill-share: unknown exp_item $sh->{exp_item}";
		$it->{expitem} = $sh->{exp_item};
		for my $u (@{ $it->{uses} }) {
			next if !@{ $u->{get} };
			die "skill-share: $sh->{item}/$u->{no} already has skill" if $u->{exp} || $u->{time} != $u->{exptime};
			$u->{exptime} = int($u->{time} * $sh->{production_exptime_rate});
			$u->{exp} = $sh->{production_exp};
		}
	}
}

binmode STDOUT, ':raw';
print JSON::PP->new->canonical->pretty->encode({
	source => 'original/soldout/inc/inc-item-data.cgi',
	town_type => $towntype,
	errors => \@errormsg,
	define => \%define,
	functions => \%functions,
	items => \@items,
	events => \@events,
});
