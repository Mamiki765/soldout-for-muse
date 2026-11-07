#! /usr/local/bin/perl
# $Id: analyze.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass(1);

RequireFile('inc-html-analyze.cgi');

OutHTML('市場分析',$disp);
