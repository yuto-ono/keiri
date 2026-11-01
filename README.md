# keiri

自分用の経理環境。

確定した仕様は [SPEC.md](SPEC.md) に記録します。

## 開発環境

Node.jsとpnpmのバージョンは `mise.toml` で固定している。

```sh
mise install
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
cp .env.example .env
pnpm dev
```

`.env` の `KEIRI_DATA_DIR` には、`keiri-data` のパスを指定する。相対パスはkeiriリポジトリルートを基準に解決する。

利用者データの初期作成は、[keiri-data雛形](templates/keiri-data/README.md) の手順に従う。

コードの検証には次のコマンドを使用する。

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
```

## ドキュメント

- [SPEC.md](SPEC.md): 確定した要件の唯一の正
- [AGENTS.md](AGENTS.md): 仕様を扱う際の約束

## 月次請求

Codexから [月次請求スキル](.agents/skills/keiri-monthly-billing/SKILL.md) を使って、請求対象の確認、下書き作成、承認後の発行と月次記録の更新を進める。

例: `$keiri-monthly-billing で今月の請求を進めて`

利用者固有の共通ルールは `keiri-data/README.md`、取引先ごとの条件は `billingInstructions`、月ごとの記録は月次請求Markdownに置く。
