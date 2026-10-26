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
