{
  description = "scoreshot development environment (Tauri v2 / macOS + iOS + iPadOS)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, rust-overlay, ... }:
    let
      # iOS ビルドは macOS でしか通らないので darwin のみ
      system = "aarch64-darwin";

      pkgs = import nixpkgs {
        inherit system;
        overlays = [ rust-overlay.overlays.default ];
      };

      # iOS 実機・シミュレータ向けのターゲットを最初から積んでおく
      # (rustup target add 相当。nix 管理下では後から足せないため)
      rust-toolchain = pkgs.rust-bin.stable.latest.default.override {
        extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        targets = [
          "aarch64-apple-ios"     # 実機
          "aarch64-apple-ios-sim" # Apple silicon のシミュレータ
          "x86_64-apple-ios"      # Intel のシミュレータ
        ];
      };

      nodejs = pkgs.nodejs_latest;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        nativeBuildInputs = [
          rust-toolchain
          pkgs.cargo-tauri
          nodejs
          pkgs.pnpm
          pkgs.cocoapods   # Tauri の iOS ビルドが要求する
          pkgs.pkg-config
          pkgs.imagemagick # Tauri アイコン生成用 (RGBA 必須)
        ];

        buildInputs = [
          pkgs.apple-sdk # WebKit / AppKit などを含む。バージョン指定なしを使う
          pkgs.libiconv
        ];

        shellHook = ''
          echo "scoreshot dev shell"
          echo "  node    $(node --version) / pnpm $(pnpm --version)"
          echo "  rustc   $(rustc --version | cut -d' ' -f2)"
          echo "  tauri   $(cargo tauri --version 2>/dev/null | tail -n1)"
          echo "  pod     $(pod --version 2>/dev/null)"
        '';
      };
    };
}
