#! /usr/local/bin/perl
# $Id: commentlist.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';

GetQuery();

DataRead();
CheckUserPass(1);

RequireFile('inc-html-commentlist.cgi');

OutHTML('コメント一覧 ',$disp);
exit;
