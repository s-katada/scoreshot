/**
 * pnpm check の入口。項目ごとのファイルを順に読み込んで実行する。
 */
import "./checks/dom";
import "./checks/timing";
import "./checks/storage";
import "./checks/edit";
import "./checks/accidentals";
import "./checks/midi";
import "./checks/musicxmlImport";
import { finish } from "./checks/harness";

finish();
