# keiri-data 雛形

このディレクトリは、keiriが読み書きする利用者データ用リポジトリの雛形です。keiri本体とは別のGitリポジトリへコピーして使用します。

## 初期設定

keiriリポジトリと同じ親ディレクトリへ `keiri-data` を作る場合は、keiriリポジトリのルートで次を実行します。

```sh
cp -R templates/keiri-data ../keiri-data
```

コピー後、次の作業を行います。

1. `issuers/your-issuer-id.yaml` の置換用値を実際の発行者情報へ変更する
2. 発行者IDに合わせて、発行者YAMLのファイル名を `<発行者ID>.yaml` へ変更する
3. `business-partners/<取引先コード>.yaml` を取引先ごとに作成する
4. keiri本体の `.env` で `KEIRI_DATA_DIR` にこのリポジトリのパスを指定する
5. このディレクトリを必要に応じてGitリポジトリとして初期化する

`your-issuer-id.yaml` は置換漏れを検出できるよう、意図的にkeiriの検証に通らない値を含みます。初期設定中はYAMLを直接編集し、初期設定後の月次請求Markdown以外の変更にはkeiriのUIまたはCLIを使用します。

## 取引先の記述例

次の例を `business-partners/<取引先コード>.yaml` として保存し、すべての値を実際の取引先と発行者の設定に合わせます。

```yaml
revision: 1
code: ACME
addressee: 株式会社サンプル
honorific: 御中
requiresMonthlyInvoice: true
billingInstructions: |-
  毎月月初に前月分を請求する。
  支払期限は請求時に具体的な日付を確認する。
unitPricesIncludeTax: false
issuerDisplay:
  phone: true
  email: false
  bankAccountIds:
    - primary
pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}"
```

`issuerDisplay.bankAccountIds` には発行者YAMLに存在する振込先IDを、PDFへ表示する順に1件以上指定します。電話番号またはメールアドレスを表示する場合は、発行者YAMLにも対応する値が必要です。

## ファイル管理の境界

keiriが生成・更新する構造化データは、取引先、発行者、税区分、設定および請求書のYAMLです。月次請求Markdownは、人間またはLLMが直接編集します。

`documents/<取引年>/sales/invoices/<取引先コード>/` のうち、keiriが管理するのは、keiri自身が生成し、発行済み請求書YAMLから参照されているPDFだけです。参照されていないPDFや、そのほかの手動追加書類をkeiriが変更・移動・削除することはありません。

keiriはこのリポジトリに対するcommitやpushを行いません。変更内容を確認したうえで、利用者がGit操作を行います。
