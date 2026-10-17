import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

await build({
  entryPoints: ['src/engine.js'],
  outfile: 'docs/ocr-engine.js',
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'FortuneOcrEngine',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' },
  // opencv-js が Node 用に参照するモジュールを無効化
  external: ['fs', 'path', 'crypto'],
  logLevel: 'info',
})

mkdirSync('docs/ort', { recursive: true })
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  cpSync(`node_modules/onnxruntime-web/dist/${f}`, `docs/ort/${f}`)
}
mkdirSync('docs/models', { recursive: true })
for (const f of ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ppocr_keys_v1.txt']) {
  cpSync(`node_modules/@gutenye/ocr-models/assets/${f}`, `docs/models/${f}`)
}
