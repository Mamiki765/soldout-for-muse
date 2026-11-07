# $Id: inc-html-item-send.cgi 96 2004-03-12 12:25:28Z mu $

RequireFile('inc-html-ownerinfo.cgi');

$disp.="<HR>●破棄処分<BR>";

if(CheckItemFlag($itemno,'notrash'))
{
	$disp.='この商品は破棄できません<br>';
}
else
{
	$disp.=<<STR;
<FORM ACTION="item-send.cgi" $METHOD>
$USERPASSFORM
<INPUT TYPE=HIDDEN NAME=bk VALUE="$Q{bk}">
<INPUT TYPE=HIDDEN NAME=item VALUE="$itemno">
この商品を
<SELECT NAME=cnt1>
<OPTION VALUE="0" SELECTED>
<OPTION>1
<OPTION>10
<OPTION>100
<OPTION>1000
<OPTION>10000
</SELECT>
$ITEM[$itemno]->{scale}、もしくは
<INPUT TYPE=TEXT SIZE=5 NAME=cnt2>
$ITEM[$itemno]->{scale}
<INPUT TYPE=SUBMIT VALUE="破棄する">(時間消費無)
</FORM>
STR
	#(時間${\GetTime2HMS($TIME_SEND_ITEM)}消費)
}

1;
