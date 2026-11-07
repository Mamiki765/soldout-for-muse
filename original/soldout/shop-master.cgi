#! /usr/local/bin/perl
# $Id: shop-master.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
$DT={};
CheckUserPass(1);

RequireFile('inc-html-shop-master.cgi');

OutHTML('市場',$disp);

exit;
