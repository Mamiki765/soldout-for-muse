# $Id: pass.cgi 96 2004-03-12 12:25:28Z mu $

sub CheckPassword
{
	return 0 if $_[0] eq '' || $_[1] eq '' || $_[1] ne ($PASSWORD_CRYPT ? crypt($_[0],$_[1]) : $_[0]);
	return 1;
}
sub GetSalt
{
	my $saltlist='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
	my $len=length($saltlist);
	my $salt=substr($saltlist,int(rand($len)),1).substr($saltlist,int(rand($len)),1);
	return $salt;
}
1;
