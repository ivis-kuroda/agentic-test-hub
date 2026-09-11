# ローカル環境構築ガイド

このリポジトリを手元で動かし、Web編集UIやテスト実行を試すための手順。

## 前提条件

| 必要なもの | バージョン | 確認コマンド |
|---|---|---|
| Node.js | 26 以上（`.node-version` / `.nvmrc` に固定） | `node -v` |
| pnpm | 10.33.0（`package.json` の `packageManager` で固定） | `pnpm -v` |
| git | 任意の新しいバージョン | `git -v` |

**Node のバージョンは実際に効きます。** このリポジトリはビルドステップを持たず、TypeScript を直接実行する構成になっている（`docs/TOOLCHAIN.md` 参照）。Node 26 未満だと動くには動くが、`pnpm install` や `pnpm check` の際に

```
WARN  Unsupported engine: wanted: {"node":">=26"} ...
```

という警告が出る。無視して進めても大抵は問題ないが、正式な検証は CI（GitHub Actions）側が Node 26 で行う。手元で警告を消したいだけなら [nvm](https://github.com/nvm-sh/nvm) 等でバージョンを切り替えるか、`.node-version` に書かれたバージョンを直接インストールする。

## 1. クローンして依存関係をインストール

```bash
git clone https://github.com/ivis-kuroda/agentic-test-hub.git
cd agentic-test-hub
pnpm install
```

これだけで以下が全部済む。

- ワークスペース全パッケージ（`packages/*`, `apps/*`, `examples/*`）の依存解決
- `apps/hub` の `postinstall` により `nuxt prepare` が自動実行され、`.nuxt/` 配下の型定義が生成される
- `esbuild` / `vue-demi` のビルドスクリプト実行は `package.json` の `pnpm.onlyBuiltDependencies` で事前許可済みなので、対話プロンプトは出ない

## 2. Web編集UIを起動する

```bash
cd apps/hub
pnpm dev
```

`http://localhost:3000` を開く。**環境変数を何も設定しなくても、`examples/demo-app/specs` に入っているサンプル仕様（架空の通知配信サービス向け）がそのまま読み込まれる。** 観点一覧・ケース一覧・カバレッジマトリクスがすぐに見られるはずなので、まずはここで一通り触ってみるのがおすすめ。

ポートを変えたい場合:

```bash
pnpm dev --port 3210
```

### 別の仕様ディレクトリを開く

`SPECS_ROOT` 環境変数で、読み込む仕様ディレクトリを切り替えられる。

```bash
SPECS_ROOT=/path/to/some/specs pnpm dev
```

`specs/` ディレクトリは以下の構成を想定している（`packages/store/src/layout.ts` が定義）。

```
specs/
  viewpoints/*.yaml
  factors/*.yaml
  matrices/*.yaml
  baselines/*.yaml
  cases/*.yaml
  scenarios/*.yaml
```

対象アプリケーション向けのプラグインリポジトリ（`plugin.yaml` と `specs/` を持つ別リポジトリ）を用意すれば、その `specs/` を指定して同じUIで編集できる。

## 3. 仕様書を作成・編集してみる

Web UI から「New viewpoint」等で作成すると、指定した `SPECS_ROOT` 配下に実際に `.yaml` ファイルが書き込まれる。2つの画面を同時に開いて同じ観点を編集し、片方を保存した後もう片方から保存しようとすると、**楽観ロックによる競合検出**（409、相手の変更内容を表示）が体験できる。

## 4. 生成物を作る（レビュー者ビュー・納品Excel）

Web UI とは別に、CLIから直接ドキュメントを生成できる。

```bash
# レビュー者向けHTML（観点一覧・カバレッジマトリクス）を生成
pnpm specs:review
# → /tmp/reviewer-view.html に出力

# 納品用Excelを生成（デモ用の汎用列レイアウト）
pnpm specs:excel
# → /tmp/delivery.xlsx に出力
```

いずれも既定では `examples/demo-app/specs` を対象にする。別のディレクトリを見せたい場合は、`scripts/render-reviewer-view.ts` と `scripts/render-delivery-excel.ts` を直接 `node` で呼び出し、引数でパスを渡す（各スクリプト冒頭の使い方コメント参照）。

## 5. 仕様ファイルの整合性を確認する

```bash
pnpm specs:check     # YAMLが正規形（決定論的シリアライズ）かどうか
pnpm specs:normalise  # 正規形でなければ書き直す
pnpm specs:validate   # 参照整合性（ダングリング参照・観点カバレッジ等）
```

Web UI経由の保存は自動的に正規形になるが、エディタで直接YAMLを手書きした場合は `pnpm specs:normalise` をかけるとよい。

## 6. テストを実行する

```bash
pnpm test         # 単体・結合テスト（packages/* と apps/hub、実インフラなしで完結）
pnpm test:watch   # 監視モード
pnpm test:coverage
```

e2e（Playwrightによる実ブラウザテスト）は初回のみブラウザのインストールが要る。

```bash
pnpm exec playwright install --with-deps chromium
pnpm e2e
pnpm e2e:report   # 直近の実行結果をブラウザで見る
```

## 7. 一括チェック（コミット前）

```bash
pnpm check
```

内訳（詳細は `.github/workflows/ci.yml` のジョブ構成と対応）:

| コマンド | 何をするか |
|---|---|
| `pnpm fmt:check` | フォーマット |
| `pnpm lint` | `packages/*` と `apps/*` の静的解析（内部で分離実行） |
| `pnpm typecheck` | 同上の型チェック（`apps/hub` は `nuxi typecheck` を使用） |
| `pnpm lint:no-target-coupling` | hub が特定ターゲットに依存していないかの検査 |
| `pnpm test` | 単体・結合テスト |

e2e は時間がかかるため `pnpm check` には含まれていない。必要なら別途 `pnpm e2e` を回す。

## トラブルシューティング

**`Unsupported engine` 警告が出る**
Node のバージョンが26未満。動作に支障は無いことが多いが、気になる場合はNode 26系を使う。

**開発サーバ起動時、コンソールに Google Fonts 関連のフェッチエラーが出る**
`@nuxt/ui` が Google Fonts を取得しようとして、ネットワーク制限のある環境（社内プロキシ配下など）で失敗することがある。**アプリの動作自体には影響しない。** 気になる場合は `apps/hub/nuxt.config.ts` でフォント関連モジュールの設定を見直す。

**`pnpm install` 中にビルドスクリプトの承認を求められる**
`package.json` の `pnpm.onlyBuiltDependencies` に対象を追加すれば以降は聞かれなくなる。新しい依存を足したときにこれが起きたら、内容を確認した上で同様に追加する。
