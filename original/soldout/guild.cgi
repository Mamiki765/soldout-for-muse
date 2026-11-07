#! /usr/local/bin/perl
# $Id: guild.cgi 96 2004-03-12 12:25:28Z mu $

$NOITEM=1;
require './_base.cgi';

GetQuery();
DataRead();
CheckUserPass(1);

ReadGuild();
ReadGuildData();
undef %guildcount;
foreach(@DT)
{
	$guildcount{$_->{guild}}++;
}
@guildlist=sort{$b->{money}<=>$a->{money}}map{$GUILD_DATA{$_}->{guild}=$_;$GUILD_DATA{$_}}keys(%GUILD);

$guilddetail=exists $GUILD_DATA{$Q{detail}} ? $Q{detail} : "";

RequireFile('inc-html-guild.cgi');

OutHTML('ギルド',$disp);
exit;
