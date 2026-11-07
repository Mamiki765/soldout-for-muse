#! /usr/local/bin/perl
# $Id: gmsg.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
require './_base.cgi';
OutError('使用不可です') if !$USE_GLOBAL_MSG;

GetQuery();

DataRead();
CheckUserPass(1);
OutError('使用不可です') if $GUEST_USER && $DENY_GUEST_GLOBAL_MSG;

$gmsgcategory=$Q{ct};
$gmsgcategory=~s/\W//g;
OutError('存在しません') if $gmsgcategory && !exists $GMSG_CATEGORY_NAME{$gmsgcategory};

$gmsgfile=$GLOBAL_MSG_FILE;
$gmsgfile.='-'.$gmsgcategory if $gmsgcategory;
open(IN,GetPath($gmsgfile));
@MESSAGE=<IN>;
close(IN);

$gmsgname="";
$gmsgname="[$GMSG_CATEGORY_NAME{$gmsgcategory}]" if $gmsgcategory;
$gmsgname||='[地域]';
RequireFile('inc-html-gmsg.cgi');

$Q{bk}="none",$NOMENU=1 if $MASTER_USER;
OutHTML($GLOBAL_MSG_TITLE.$gmsgname,$disp,$OUTPUT_LAST_MODIFIED ? (stat(GetPath($gmsgfile)))[9] : 0);
