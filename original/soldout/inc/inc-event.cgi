# $Id: inc-event.cgi 96 2004-03-12 12:25:28Z mu $

package event; #変更不可

######################################################################
# ★イベント用下請関数：ログ書きこみ
# usage:  WriteLog(重要度,対象店舗ID,メッセージ)
#           重要度     0==一般 1==重要 2==情報
#           対象店舗ID 0==全店舗宛 店舗ID==プライベート
#           メッセージ ログメッセージ
# return: 0 固定
######################################################################
sub WriteLog
{
	my($mode,$from,$msg)=@_;
	main::WriteLog($mode,$from,0,$msg,1);
	return 0;
}

######################################################################
# ★デバッグ用ログ書きこみ
# usage: DebugLog(メッセージ)
#           メッセージ ログメッセージ
# return: 0 固定
######################################################################
sub DebugLog
{
	my($msg)=@_;
	main::WriteErrorLog($msg,$main::LOG_DEBUG_FILE) if $main::DEBUG_LOG_ENABLE;
	return 0;
}

######################################################################
# ★市場在庫調査：イベント発動きっかけ判断用
# usage:  stock_le(アイテム番号,個数)
# return: 1 市場のアイテムの在庫が個数以下の場合
#         0 上記以外
######################################################################
sub stock_le
{
	my($itemno,$count)=@_;
	return 1 if $main::DTwholestore[$itemno-1]<=$count;
	return 0;
}

######################################################################
# ★市場在庫調査：イベント発動きっかけ判断用
# usage:  stock_ge(アイテム番号,個数)
# return: 1 市場のアイテムの在庫が個数以上の場合
#         0 上記以外
######################################################################
sub stock_ge
{
	my($itemno,$count)=@_;
	return 1 if $main::DTwholestore[$itemno-1]>=$count;
	return 0;
}

sub GetUserData
{
	return &main::GetUserData;
}
require "$main::ITEM_DIR/funcevent.cgi" if $main::DEFINE_FUNCEVENT;
1;
