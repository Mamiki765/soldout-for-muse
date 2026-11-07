#! /usr/local/bin/perl
# $Id: box.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass();

ReadBox();

GetInBox();
GetOutBox();
GetRetBox();
RequireFile('inc-html-box.cgi');

OutHTML('郵便箱',$disp);
exit;
