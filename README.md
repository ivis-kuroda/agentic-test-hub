# agentic-test-hub
An AI-driven test automation hub that generates test matrices, creates specs with Claude Code, and executes end-to-end browser tests via Playwright and agent-browser.

## ローカルで動かす

[docs/ja/SETUP.md](./docs/ja/SETUP.md) にローカル環境構築手順がある。

## 証跡の保存

Pythonで生成したテストは、環境変数 `ATH_EVIDENCE_DIR` を指定すると、実行前後の証跡（スクリーンショット、コンソール/ネットワーク、DB差分、アプリ/DBログ）をファイルに保存する。
配置と `index.json` の形式は [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) の「Saved evidence」、使い方は [docs/ja/SETUP.md](./docs/ja/SETUP.md) を参照。
