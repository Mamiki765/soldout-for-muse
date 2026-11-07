#! /usr/local/bin/perl
# $Id: counter.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();
DataRead();
CheckUserPass();

OutError("") if !$MASTER_USER;

my $lsize=-s GetPath($COUNTER_FILE."-l");
my $hsize=-s GetPath($COUNTER_FILE."-h");

$disp.=$hsize*1000+$lsize;

$Q{bk}="none",$NOMENU=1;
OutHTML('カウンタ',$disp);
1;
