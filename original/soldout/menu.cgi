#! /usr/local/bin/perl
# $Id: menu.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
require './_base.cgi';
GetQuery();
DataRead();
CheckUserPass(1);

OutHTML('メニュー','');

exit;
