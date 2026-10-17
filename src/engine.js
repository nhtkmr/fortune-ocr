// OCR エンジン (PaddleOCR PP-OCRv4 + onnxruntime-web)。
// esbuild で docs/ocr-engine.js (IIFE) にバンドルされ、window.FortuneOcrEngine として公開される。
import * as ort from 'onnxruntime-web'
import cv from '@techstark/opencv-js'
import Ocr from '@gutenye/ocr-browser'

let ocrPromise = null

function waitOpenCv() {
  return new Promise((resolve) => {
    if (cv.Mat) return resolve()
    const prev = cv.onRuntimeInitialized
    cv.onRuntimeInitialized = () => {
      prev?.()
      resolve()
    }
  })
}

// baseUrl: docs/ の公開URL (末尾スラッシュ付き)
export function init(baseUrl) {
  if (!ocrPromise) {
    ort.env.wasm.wasmPaths = baseUrl + 'ort/'
    // 対象サイトは crossOriginIsolated でないためシングルスレッド
    ort.env.wasm.numThreads = 1
    ocrPromise = waitOpenCv().then(() =>
      Ocr.create({
        models: {
          detectionPath: baseUrl + 'models/ch_PP-OCRv4_det_infer.onnx',
          recognitionPath: baseUrl + 'models/ch_PP-OCRv4_rec_infer.onnx',
          dictionaryPath: baseUrl + 'models/ppocr_keys_v1.txt',
        },
      }),
    )
    ocrPromise.catch(() => {
      ocrPromise = null
    })
  }
  return ocrPromise
}

// imageUrl: blob URL など。戻り値: [{ text, mean }]
export async function detect(baseUrl, imageUrl) {
  const ocr = await init(baseUrl)
  const { texts } = await ocr.detect(imageUrl)
  return texts.map((t) => ({ text: t.text, mean: t.mean }))
}
