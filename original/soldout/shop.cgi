#! /usr/local/bin/perl
# $Id: shop.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass(1);

RequireFile('inc-html-shop.cgi') if $Q{t}!=2;
RequireFile('inc-html-shop-2.cgi') if $Q{t}==2;

OutHTML(($Q{t}!=2?'他店':'相場'),$disp);

exit;
