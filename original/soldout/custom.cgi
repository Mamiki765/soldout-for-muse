#! /usr/local/bin/perl
# $Id: custom.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
Deny() if !$USE_CUSTOM || !$DEFINE_FUNCCUSTOM;

GetQuery();

DataRead();
CheckUserPass(1);
Deny() if $GUEST_USER && $DENY_GUEST_CUSTOM;

require "$ITEM_DIR/funccustom.cgi";

my $cmd=lc($Q{cmd}||'');
$cmd=~s/[^a-z_]//g;

my $result=1;
$result=CustomPageInit($cmd) if defined(&CustomPageInit);
Deny() if !$result;
$cmd=$result if $result!~/[^a-z_]/;

foreach(1..10) # 最大10ループ
{
	$result=1;
	$result=&{"CustomPage_$cmd"}() if defined(&{"CustomPage_$cmd"});
	Deny() if !$result;
	last if $result=~/[^a-z_]/;
	$cmd=$result;
}

Deny() if !$disp;

OutHTML($CUSTOM_TITLE,$disp);
exit;

sub Deny{OutError('使用不可です')}
