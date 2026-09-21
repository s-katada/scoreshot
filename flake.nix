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

      # nix の darwin stdenv は 2019 年製の xcrun スタブを PATH に載せ、
      # Apple 純正の /usr/bin/xcrun を覆い隠してしまう。
      # iOS ビルドは純正を必要とするので、PATH の先頭に置き直すための shim。
      appleShims = pkgs.runCommand "apple-shims" { } ''
        mkdir -p $out/bin
        for t in xcrun xcodebuild xcode-select; do
          ln -s /usr/bin/$t $out/bin/$t
        done
      '';
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
          pkgs.libiconv
        ];

        shellHook = ''
          # nix の darwin stdenv が Apple のツールチェーンを覆い隠すのを打ち消す。
          #   DEVELOPER_DIR / SDKROOT -> nix の apple-sdk を指してしまい、
          #                              Xcode の iOS SDK が見えなくなる
          #   xcrun                   -> 2019 年製スタブが /usr/bin/xcrun を隠す
          # iOS ビルドは Xcode 側を必要とするため、どちらも元に戻す。
          unset DEVELOPER_DIR SDKROOT
          export PATH="${appleShims}/bin:$PATH"

          # nix の cc-wrapper は単一ターゲット前提で作られており、iOS 向けに
          # 呼ばれると -mmacos-version-min を注入して衝突する
          #   clang: error: invalid argument '-mmacos-version-min=14.0'
          #          not allowed with '-mios-simulator-version-min=27.0'
          # nix 自身も "use an un-wrapped compiler instead" と警告するため、
          # iOS の 3 ターゲットだけ Xcode の素の clang を使わせる。
          if _xclang=$(/usr/bin/xcrun -f clang 2>/dev/null); then
            _xar=$(/usr/bin/xcrun -f ar 2>/dev/null)
            for _t in aarch64_apple_ios aarch64_apple_ios_sim x86_64_apple_ios; do
              export "CC_$_t=$_xclang"
              export "AR_$_t=$_xar"
            done
            export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER="$_xclang"
            export CARGO_TARGET_AARCH64_APPLE_IOS_SIM_LINKER="$_xclang"
            export CARGO_TARGET_X86_64_APPLE_IOS_LINKER="$_xclang"
            unset _xclang _xar _t
          fi

          # Xcode のビルドスクリプトからも nix develop を呼ぶため、
          # 対話的に開いたときだけバナーを出す。
          if [ -t 1 ]; then
            echo "scoreshot dev shell"
            echo "  node    $(node --version) / pnpm $(pnpm --version)"
            echo "  rustc   $(rustc --version | cut -d' ' -f2)"
            echo "  tauri   $(cargo tauri --version 2>/dev/null | tail -n1)"
            echo "  xcode   $(xcodebuild -version 2>/dev/null | head -1)"
          fi
        '';
      };
    };
}
