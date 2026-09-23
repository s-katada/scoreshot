//! iOS / iPadOS のオーディオセッションを「再生」にする (#8)。
//!
//! Web Audio の音は、既定では「環境音」扱いになる。そのままだと端末の
//! 消音スイッチ (マナーモード) が入っているときに鳴らない。楽譜を再生する
//! アプリとしては困るので、起動時に AVAudioSession のカテゴリを
//! `AVAudioSessionCategoryPlayback` にする。WKWebView の音はアプリの
//! オーディオセッションに従う。
//!
//! Swift のプラグインにはせず、objc2 で Rust から直接呼んでいる。Swift
//! パッケージのビルドを足さずに済み、`gen/apple` を作り直しても消えない。
//! AVFAudio はアプリ本体にリンクしていないので、クラスは実行時に探し、
//! カテゴリも定数ではなく同じ値の文字列で渡す (リンク時に AVFAudio の
//! シンボルを要求しないように)。

use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;
use objc2_foundation::{NSError, NSString};

/// AVFAudio の本体。まだ読み込まれていなければ読み込む
const AVFAUDIO: &std::ffi::CStr = c"/System/Library/Frameworks/AVFAudio.framework/AVFAudio";

pub fn use_playback_category() {
  autoreleasepool(|_| unsafe {
    libc::dlopen(AVFAUDIO.as_ptr(), libc::RTLD_LAZY);
    let Some(class) = AnyClass::get(c"AVAudioSession") else {
      log::warn!("AVAudioSession が見つからないため、オーディオセッションを設定できませんでした");
      return;
    };
    let session: Option<Retained<AnyObject>> = msg_send![class, sharedInstance];
    let Some(session) = session else {
      log::warn!("AVAudioSession を取得できませんでした");
      return;
    };
    // AVAudioSessionCategoryPlayback の値そのもの
    let category = NSString::from_str("AVAudioSessionCategoryPlayback");
    let result: Result<(), Retained<NSError>> =
      msg_send![&session, setCategory: &*category, error: _];
    if let Err(error) = result {
      log::warn!("オーディオセッションのカテゴリを設定できませんでした: {error:?}");
    }
  });
}
