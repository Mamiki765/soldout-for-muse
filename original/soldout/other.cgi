#! /usr/local/bin/perl
# $Id: other.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass();

RequireFile('inc-html-other.cgi');

OutHTML('各種手続き',$disp);

exit;
