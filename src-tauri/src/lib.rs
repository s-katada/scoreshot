#[cfg(target_os = "ios")]
mod audio_session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // 消音スイッチ (マナーモード) が入っていても音が鳴るようにする (#8)。
  // macOS には無い仕組みなので iOS / iPadOS だけ
  #[cfg(target_os = "ios")]
  audio_session::use_playback_category();

  tauri::Builder::default()
    // 楽譜をアプリデータディレクトリに保存する (#4)
    .plugin(tauri_plugin_fs::init())
    // MusicXML / MIDI の読み書きでファイルを選ばせる (#5)
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
