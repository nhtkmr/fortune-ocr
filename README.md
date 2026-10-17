# fortune-ocr

櫻坂46 16th シングル応募券の13桁シリアルを写真から読み取り、
https://ticket.fortunemeets.app/sakurazaka46/16th#/registration の入力枠に入れるブックマークレット。

- OCR: PaddleOCR PP-OCRv4 (`@gutenye/ocr-browser` + onnxruntime-web)。端末内で処理し外部送信なし
- `docs/` を GitHub Pages で公開。使い方は `docs/index.html`

## 構成
- `docs/fortune-ocr.js` — ブックマークレットから注入される本体（UI・入力枠への反映）
- `src/engine.js` → `docs/ocr-engine.js` — OCRエンジン（`npm run build` で生成。モデルとwasmも `docs/` にコピー）
- `test/index.html` — 登録ページのモック。`npx http-server -p 8765` で起動し `/test/` を開いて動作確認

## ビルド
```
npm install
npm run build
```
