{
  description = "smsf-server — SMSForwarder 短信中心（FastAPI 后端 + Vite 前端）";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      # ------------------------------------------------------------------ dev
      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            name = "smsf-server-dev";
            packages = [
              pkgs.python313
              pkgs.uv
              pkgs.nodejs_22
              pkgs.corepack_22
              pkgs.pnpm
            ];
            shellHook = ''
              echo "smsf-server 开发环境就绪"
              echo "  后端: cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8801"
              echo "  前端: cd frontend && pnpm install && pnpm dev"
            '';
          };
        });

      # --------------------------------------------------------------- package
      #
      # 说明：Vite/React 前端在纯 Nix 沙箱里构建依赖链过重，因此本 package 只负责
      # 后端 + 运行期依赖，并在构建时把「已经由 pnpm build 生成」的 frontend/dist
      # 拷入 app/static。使用前请先执行：
      #     cd frontend && pnpm install && pnpm build
      # 若 frontend/dist 不存在，构建仍会成功，只是 app/static 为空（前端不可用），
      # 后端 API 与 /api/health 不受影响。
      # ----------------------------------------------------------------------
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          lib = pkgs.lib;
          python = pkgs.python313;

          # 与 backend/pyproject.toml 对齐的运行期依赖
          pythonEnv = python.withPackages (ps: with ps; [
            fastapi
            uvicorn
            sqlalchemy
            alembic
            pydantic
            pydantic-settings
            argon2-cffi
            python-multipart
            pillow
            loguru
          ]);

          # 后端源码：过滤虚拟环境、缓存与运行期数据，避免污染 Nix store
          backendSrc = lib.cleanSourceWith {
            src = ./backend;
            filter = path: type:
              let base = baseNameOf path;
              in !(builtins.elem base [
                ".venv" "venv" "__pycache__" ".pytest_cache" ".mypy_cache" ".ruff_cache" "data"
              ]);
          };

          # 前端源码：排除 node_modules 与构建产物
          frontendSrc = lib.cleanSourceWith {
            src = ./frontend;
            filter = path: type:
              !(builtins.elem (baseNameOf path) [ "node_modules" "dist" ]);
          };

          # 在 Nix 沙箱里真正构建前端。
          #
          # 不要指望「宿主机先跑 pnpm build，再由 Nix 拷进 static」：frontend/dist 与
          # backend/app/static 都在 .gitignore 里，而 flake 源是按 git 跟踪状态拷贝的，
          # 被忽略的文件根本进不了沙箱 —— 结果就是 app/static 为空、网页端静默不可用
          # （API 还活着，所以很难发现）。
          frontendDist = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "smsf-frontend";
            version = "0.1.0";
            src = frontendSrc;

            nativeBuildInputs = [ pkgs.nodejs_22 pkgs.pnpm pkgs.pnpmConfigHook ];

            # 依赖走固定输出派生，沙箱内离线安装；升级 package.json 后 hash 会要求更新。
            # 必须 `inherit pnpm`：fetcher 的默认 pnpm 与构建用的 pnpm 若不是同一版本，
            # 离线 store 的格式可能对不上。fetcherVersion = 4 是 pnpm >= 11 的要求。
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              pnpm = pkgs.pnpm;
              fetcherVersion = 4;
              hash = "sha256-i6bpsjQyO3hHsfMuoqB0WiktksWMf9Ffw7qO11SWZho=";
            };

            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r dist/. $out/
              runHook postInstall
            '';

            meta = with lib; {
              description = "SMSForwarder 短信中心前端产物（Vite 构建）";
              platforms = platforms.linux;
            };
          });

          # 后端源码 + 前端产物合成一棵 app 树
          appTree = pkgs.runCommand "smsf-app-tree" { } ''
            mkdir -p $out
            cp -r ${backendSrc}/. $out/
            # Nix store 里的目录是只读的，cp 会保留只读位；先改可写再写入 static
            chmod -R u+w $out
            rm -rf $out/app/static
            mkdir -p $out/app/static
            cp -r ${frontendDist}/. $out/app/static/
          '';

          # makeWrapper 生成 smsf-server：先确保数据目录可写，再以绝对路径跑迁移，最后启动。
          #
          # 关键：不要 `cd` 进 appTree 再跑 alembic。那棵 Nix store 树是只读的，
          # 一旦运行时把 CWD 落在里面，任何相对路径写操作（含默认数据库目录）
          # 都会 EROFS 崩掉。迁移改用 app.migrations（内部用绝对路径定位 alembic.ini），
          # 数据目录则通过 SMSF_DATA_DIR 显式指到用户可写位置。
          smsfServer = pkgs.runCommand "smsf-server-0.1.0" {
            nativeBuildInputs = [ pkgs.makeWrapper ];
            meta = with lib; {
              description = "SMSForwarder 短信中心（FastAPI 后端 + Nix 沙箱内构建的 Vite 前端）。数据库默认落在 $SMSF_DATA_DIR（回退 $XDG_DATA_HOME/smsf-server 或 $HOME/.local/share/smsf-server）。";
              mainProgram = "smsf-server";
              platforms = platforms.linux;
            };
          } ''
            mkdir -p $out/bin
            makeWrapper ${pythonEnv}/bin/uvicorn $out/bin/smsf-server \
              --add-flags "--host 0.0.0.0 --port 8801 --workers 1 app.main:app" \
              --prefix PYTHONPATH : "${appTree}" \
              --set SMSF_STATIC_DIR "${appTree}/app/static" \
              --run 'if [ -z "$SMSF_DATA_DIR" ]; then if [ -n "$XDG_DATA_HOME" ]; then SMSF_DATA_DIR="$XDG_DATA_HOME/smsf-server"; elif [ -n "$HOME" ]; then SMSF_DATA_DIR="$HOME/.local/share/smsf-server"; else SMSF_DATA_DIR="$PWD/data"; fi; fi; export SMSF_DATA_DIR; mkdir -p "$SMSF_DATA_DIR"' \
              --run 'if [ -n "$SMSF_DATABASE_URL" ]; then echo "[smsf-server] 数据库: $SMSF_DATABASE_URL"; else echo "[smsf-server] 数据库: $SMSF_DATA_DIR/smsf.sqlite3（可用 SMSF_DATABASE_URL 或 SMSF_DATA_DIR 覆盖）"; fi' \
              --run "${pythonEnv}/bin/python -c 'from app.migrations import run_migrations; run_migrations()'"
          '';
        in
        {
          default = smsfServer;
          smsf-server = smsfServer;
        });

      # ----------------------------------------------------------------- apps
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/smsf-server";
        };
      });
    };
}
