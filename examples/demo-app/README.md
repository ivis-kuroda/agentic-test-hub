# demo-app

A small, fictional application the hub tests itself against.

## なぜ存在するか

hub は汎用でなければならない。しかし、実際に動かす相手が特定のシステム1つだけだと、
そのシステムの事情がコードに染み込んでいくのを誰も止められない。

このアプリは「本物ではない対象」であることが役割そのものである。hub の e2e テストは
`plugin.yaml` 経由でこのアプリを操作する。hub が特定ターゲットに依存し始めたら、
そのテストが壊れる。

## 何をするアプリか

通知の送信を受け付ける架空のサービス。

| ルート | 動作 |
|---|---|
| `GET /` | 送信フォームと一覧のページ。全要素に `data-testid` を持つ |
| `GET /health` | 死活確認 |
| `POST /notifications` | 送信受付。認証必須、チャネル検証あり |
| `GET /notifications` | 一覧 |
| `DELETE /notifications` | 全削除 |
| `GET /logs` | サーバが書いたログ（証跡収集の対象） |

`POST` は 201 / 401（認証なし）/ 400（不正なチャネル・宛先なし）を返し分けるので、
正常系と異常系の両方を素直に書ける。

## 依存ゼロ・単一ファイル

Node の `http` だけで書いてあり、外部依存を持たない。起動は即時で、このアプリ自体が
プロジェクト化してしまうことがない。ビルドもしない。

```
node --import tsx examples/demo-app/cli.ts count --url http://127.0.0.1:3000
```
