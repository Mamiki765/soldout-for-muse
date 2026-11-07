# $Id: sub.cgi 96 2004-03-12 12:25:28Z mu $

sub CheckCount
{
	my($cnt1,$cnt2,$min,$max)=@_;
	my $cnt;
	
	$cnt1+=0; $cnt2+=0;
	
	$cnt=$cnt2 ? $cnt2 : $cnt1;
	$cnt=$min if $cnt<$min;
	$cnt=$max if $cnt>$max;

	return int($cnt);
}

sub CutStr
{
	my ($str,$size)=@_;
	return $str if $size>length($str);
	$str=substr($str,0,$size);
	chop $str if $str=~/^(?:(?:[\x81-\x9F|\xE0-\xEF][\x40-\x7E|\x80-\xFC])|(?:[\x20-\x7E\xA0-\xDF]))*[\x81-\x9F|\xE0-\xEF]$/;
	
	return $str;
}

sub GetString
{
	my($str)=@_;
	
	$str.='\\' if substr($str,-1,1) eq '\\';
	$str=~s/'/\\$1/g;
	return "'$str'";
}

sub GetFileList
{
	opendir(DIR,$_[0]);
	my @list=map{$_[0]."/".$_}grep(/$_[1]/ && !/^\.\.?$/,readdir(DIR));
	closedir(DIR);
	
	return @list;
}

sub EscapeHTML
{
	my($html)=@_;
	$html=~s/&/&amp;/g;
	$html=~s/</&lt;/g;
	$html=~s/>/&gt;/g;
	$html=~s/"/&quot;/g;
	return $html;
}
1;
