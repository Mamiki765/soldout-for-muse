#! /usr/local/bin/perl
# $Id: stock.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass();

RequireFile('inc-html-stock.cgi');

OutHTML('倉庫',$disp);
