# $Id: inc-html-item-uselist.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

foreach my $USE (@USE)
{
	$disp.="●";
	$disp.=qq|<a href="item-use.cgi?item=$itemno&no=$USE->{no}&$USERPASSURL&bk=$Q{bk}">| if $USE->{useok};
	$disp.=($USE->{useok} || $USE->{dispok}) ? $USE->{name} : "？？？？？？？？";
	$disp.="</a>" if $USE->{useok};
	$disp.="<br>";
}
1;
