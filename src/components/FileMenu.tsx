/**
 * 楽譜をファイルに書き出すボタン。
 */

import { secondaryButtonClass } from "./styles";

interface FileMenuProps {
  onExportMusicXml: () => void;
  onExportMidi: () => void;
  disabled?: boolean;
}

export function FileMenu({
  onExportMusicXml,
  onExportMidi,
  disabled,
}: FileMenuProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="ファイル">
      <button
        type="button"
        onClick={onExportMusicXml}
        disabled={disabled}
        className={secondaryButtonClass}
        title="MuseScore などで開ける MusicXML に書き出す"
      >
        MusicXML に書き出す
      </button>
      <button
        type="button"
        onClick={onExportMidi}
        disabled={disabled}
        className={secondaryButtonClass}
        title="DAW などで使える MIDI に書き出す"
      >
        MIDI に書き出す
      </button>
    </div>
  );
}
