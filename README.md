# GitHub Actions デモプロジェクト

このプロジェクトはGitHub Actionsを使用してCI/CDパイプラインを構築する方法を示します。

## 機能

- Node.jsプロジェクトの自動テスト
- コードリントチェック
- ビルド処理
- デプロイ処理（サンプル）

## GitHub Actions ワークフロー

### トリガー
- `main`ブランチへのプッシュ
- `develop`ブランチへのプッシュ
- `main`ブランチへのプルリクエスト

### ジョブ

#### test
- Node.js 18.x と 20.x でテストを実行
- 依存関係のインストール
- テスト実行
- リントチェック
- ビルド実行

#### deploy
- testジョブが成功した場合のみ実行
- `main`ブランチでのみ実行
- ビルドとデプロイ処理を実行

## ローカルでの実行

### 依存関係のインストール
```bash
npm install
```

### テストの実行
```bash
npm test
```

### リントの実行
```bash
npm run lint
```

### リントの自動修正
```bash
npm run lint:fix
```

### ビルドの実行
```bash
npm run build
```

### アプリケーションの実行
```bash
npm start
```

## プロジェクト構成

```
.
├── .github/
│   └── workflows/
│       └── ci.yml          # GitHub Actions ワークフロー
├── index.js                # メインアプリケーションファイル
├── index.test.js           # テストファイル
├── package.json            # Node.js パッケージ設定
├── .eslintrc.js            # ESLint 設定
└── README.md               # このファイル
```

## カスタマイズ

### ワークフローの変更
`.github/workflows/ci.yml` を編集して、CI/CDパイプラインをカスタマイズできます。

### デプロイ先の追加
deployジョブに実際のデプロイ処理を追加してください。たとえば：
- AWSへのデプロイ
- Vercelへのデプロイ
- Dockerイメージのプッシュ

## 環境変数

GitHub Actionsで環境変数を使用するには、リポジトリのSettings > Secrets and variables > Actions で設定してください。

たとえば：
- `NODE_ENV`
- `API_KEY`
- `DEPLOY_TOKEN`

## 貢献

1. フィーチャーブランチを作成
2. 変更をコミット
3. プルリクエストを作成
4. CIが通過したらマージ
