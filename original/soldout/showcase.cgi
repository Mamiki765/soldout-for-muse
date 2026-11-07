#! /usr/local/bin/perl
# $Id: showcase.cgi 96 2004-03-12 12:25:28Z mu $

require './_base.cgi';
GetQuery();

DataRead();
CheckUserPass();

RequireFile('inc-html-ownerinfo.cgi');

RequireFile('inc-html-showcase.cgi');

OutHTML('陳列棚',$disp);
