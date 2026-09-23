/**
 * pnpm check の入口。項目ごとのファイルを順に読み込んで実行する。
 */
import "./checks/timing";
import "./checks/storage";
import "./checks/edit";
import "./checks/accidentals";
import { finish } from "./checks/harness";

finish();
