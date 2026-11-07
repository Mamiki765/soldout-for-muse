#! /usr/local/bin/perl
# $Id: chat.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
require './_base.cgi';
OutError('使用不可です') if !$USE_CHAT;
GetQuery();

DataRead();
CheckUserPass(1);
OutError('使用不可です') if $GUEST_USER && $DENY_GUEST_CHAT;

$LOG_FILE=$CHAT_FILE;
$CHATMODE=1;
($Q{msg},$errormsg)=WriteBBS($Q{msg},100) if !$GUEST_USER && $Q{msg};

ReadLog();
RequireFile('inc-html-chat.cgi');

$Q{bk}="none",$NOMENU=1 if $MASTER_USER;
OutHTML($CHAT_TITLE,$disp,$OUTPUT_LAST_MODIFIED ? (stat(GetPath($LOG_FILE)))[9] : 0);
