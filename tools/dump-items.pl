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
	for my $add (@{ $v030->{job_bonus_add} }) {
		my $u = $by_no{$add->{book}}{uses}[$add->{use}] or die "v0.3.0: unknown use $add->{book}/$add->{use}";
		die "v0.3.0: duplicate job bonus $add->{book}/$add->{use}" if grep { $_->{job} eq $add->{job} } @{ $u->{jobs} };
		push @{ $u->{jobs} }, { job => $add->{job}, key => 'times', op => '/', value => 2 };
	}
	$define{version} = $v030->{version};
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
