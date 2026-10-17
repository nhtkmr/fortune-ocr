// fortunemeets シリアル OCR 入力ツール
// ブックマークレットから https://ticket.fortunemeets.app/... の登録ページに注入して使う。
// 撮影した応募券の写真から英数字シリアルを読み取り、確認・修正後に入力枠へ反映する（登録ボタンは押さない）。
(function () {
  'use strict'

  // 不具合報告時にスマホが最新版を読み込んでいるか確認するため、パネルにも表示する
  var VERSION = '2026-10-18c'

  // 同じタブで再実行されたとき、同じ版なら既存パネルを出すだけ。古い版なら差し替える
  if (window.__fortuneOcr) {
    if (window.__fortuneOcr.version === VERSION) {
      window.__fortuneOcr.show()
      return
    }
    var oldPanel = document.getElementById('fo-panel')
    if (oldPanel) oldPanel.remove()
  }

  // シリアル桁数はイベントごとに違う（櫻坂46 16th: 13桁, 日向坂46 16th: 14桁）ため、
  // 登録ページの入力枠の maxLength から取得する。取得できない間はこの範囲で候補を拾う。
  var MIN_LENGTH = 10
  var MAX_LENGTH = 16
  var MAX_INPUTS = 10
  // 1600px だと取りこぼしが出た。2000px で全件読めることを確認済み
  var MAX_IMAGE_SIDE = 2000
  // 正常に読めたものは 0.98 前後、反射などで1文字誤読したものは 0.95 前後だった
  var LOW_CONFIDENCE = 0.97
  var STORAGE_KEY = 'fortuneOcrSerials'
  var scriptSrc = (document.currentScript && document.currentScript.src) || ''
  var BASE_URL = scriptSrc.replace(/[^/]*$/, '')

  function serialLength() {
    var input = document.querySelector('input[id^="inputSerial"]')
    return input && input.maxLength > 0 ? input.maxLength : null
  }

  function isValidSerial(v) {
    if (!/^[A-Z0-9]+$/.test(v)) return false
    var len = serialLength()
    return len ? v.length === len : v.length >= MIN_LENGTH && v.length <= MAX_LENGTH
  }

  // { value, conf, filled }
  var serials = loadSerials()

  function loadSerials() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || []
    } catch (e) {
      return []
    }
  }

  function saveSerials() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serials))
    } catch (e) {}
  }

  // ---------- UI ----------

  var css =
    '#fo-panel{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#fff;color:#222;' +
    'border-top:3px solid #f19db5;box-shadow:0 -4px 16px rgba(0,0,0,.2);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;' +
    'max-height:70vh;display:flex;flex-direction:column}' +
    '#fo-panel *{box-sizing:border-box}' +
    '#fo-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fdeef3}' +
    '#fo-head b{flex:1;font-size:15px}' +
    '#fo-body{overflow:auto;padding:10px 12px;-webkit-overflow-scrolling:touch}' +
    '#fo-panel.fo-min #fo-body{display:none}' +
    '.fo-btn{appearance:none;border:1px solid #c94f78;background:#fff;color:#c94f78;border-radius:8px;padding:8px 12px;font-size:15px;font-weight:600}' +
    '.fo-btn.fo-primary{background:#c94f78;color:#fff}' +
    '.fo-btn:disabled{opacity:.4}' +
    '.fo-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
    '.fo-row .fo-btn{flex:1 1 auto}' +
    '#fo-status{font-size:13px;color:#555;margin:4px 0 8px;min-height:1.4em;white-space:pre-wrap}' +
    '#fo-status.fo-err{color:#d00}' +
    '#fo-head small{font-size:11px;color:#999;font-weight:normal}' +
    '#fo-debug{font-size:12px;color:#555;margin:0 0 8px}' +
    '#fo-debug pre{white-space:pre-wrap;word-break:break-all;margin:4px 0 0;font:12px/1.4 Menlo,Consolas,monospace}' +
    '#fo-list{list-style:none;margin:0 0 8px;padding:0}' +
    '#fo-list li{display:flex;align-items:center;gap:6px;margin-bottom:6px}' +
    '#fo-list .fo-no{width:1.8em;text-align:right;font-size:13px;color:#888}' +
    '#fo-list input{flex:1;min-width:0;font:600 17px/1.2 Menlo,Consolas,monospace;letter-spacing:.05em;padding:7px 8px;border:1px solid #bbb;border-radius:6px;text-transform:uppercase}' +
    '#fo-list li.fo-bad input{border-color:#d00;background:#fff0f0}' +
    '#fo-list li.fo-low input{border-color:#e0a000;background:#fffbe6}' +
    '#fo-list li.fo-filled input{background:#eee;color:#888}' +
    '#fo-list .fo-tag{font-size:11px;white-space:nowrap;color:#888;width:3.6em}' +
    '#fo-list .fo-del{border:none;background:none;color:#999;font-size:20px;padding:0 4px}' +
    '.fo-note{font-size:12px;color:#777;margin:4px 0 0}'

  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var panel = document.createElement('div')
  panel.id = 'fo-panel'
  panel.innerHTML =
    '<div id="fo-head"><b>シリアル読み取り <small>v' + VERSION + '</small></b>' +
    '<button class="fo-btn" id="fo-min" type="button">－</button>' +
    '<button class="fo-btn" id="fo-close" type="button">×</button></div>' +
    '<div id="fo-body">' +
    '<div class="fo-row">' +
    '<button class="fo-btn fo-primary" id="fo-cam" type="button">📷 撮影</button>' +
    '<button class="fo-btn" id="fo-pick" type="button">🖼 写真を選択</button>' +
    '</div>' +
    '<div id="fo-status"></div>' +
    '<details id="fo-debug" hidden><summary>読み取った文字をすべて表示</summary><pre></pre></details>' +
    '<ul id="fo-list"></ul>' +
    '<div class="fo-row">' +
    '<button class="fo-btn" id="fo-add" type="button">＋ 手入力</button>' +
    '<button class="fo-btn" id="fo-clear" type="button">全削除</button>' +
    '</div>' +
    '<div class="fo-row"><button class="fo-btn fo-primary" id="fo-fill" type="button">入力枠へ反映</button></div>' +
    '<p class="fo-note">反映後、ページ側の入力内容を目視で確認してから「シリアルナンバー登録」を押してください。' +
    '登録失敗を繰り返すとアカウントが一時停止されます。黄色は読み取り信頼度が低い項目です。</p>' +
    '</div>' +
    '<input type="file" id="fo-file-cam" accept="image/*" capture="environment" hidden>' +
    '<input type="file" id="fo-file-pick" accept="image/*" multiple hidden>'
  document.body.appendChild(panel)

  function $(id) {
    return document.getElementById(id)
  }

  var statusEl = $('fo-status')
  var listEl = $('fo-list')
  var busy = false

  function setStatus(msg, isError) {
    statusEl.textContent = msg || ''
    statusEl.className = isError ? 'fo-err' : ''
  }

  function setBusy(b) {
    busy = b
    ;['fo-cam', 'fo-pick', 'fo-fill'].forEach(function (id) {
      $(id).disabled = b
    })
  }

  function render() {
    listEl.innerHTML = ''
    serials.forEach(function (s, i) {
      var li = document.createElement('li')
      var bad = !isValidSerial(s.value)
      li.className = s.filled ? 'fo-filled' : bad ? 'fo-bad' : s.conf != null && s.conf < LOW_CONFIDENCE ? 'fo-low' : ''
      var no = document.createElement('span')
      no.className = 'fo-no'
      no.textContent = i + 1 + '.'
      var input = document.createElement('input')
      input.value = s.value
      input.autocapitalize = 'characters'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.maxLength = MAX_LENGTH + 4
      input.addEventListener('change', function () {
        s.value = normalize(input.value)
        s.conf = null
        s.filled = false
        saveSerials()
        render()
      })
      var tag = document.createElement('span')
      tag.className = 'fo-tag'
      tag.textContent = s.filled ? '反映済' : bad ? s.value.length + '桁' : s.conf != null && s.conf < LOW_CONFIDENCE ? '要確認' : ''
      var del = document.createElement('button')
      del.className = 'fo-del'
      del.type = 'button'
      del.textContent = '×'
      del.addEventListener('click', function () {
        serials.splice(i, 1)
        saveSerials()
        render()
      })
      li.append(no, input, tag, del)
      listEl.appendChild(li)
    })
    var pending = serials.filter(function (s) {
      return !s.filled
    }).length
    $('fo-fill').textContent = pending > MAX_INPUTS ? '入力枠へ反映（先頭' + MAX_INPUTS + '件 / 残り' + pending + '件）' : '入力枠へ反映（' + pending + '件）'
  }

  function normalize(v) {
    return v.toUpperCase().replace(/[^A-Z0-9]/g, '')
  }

  // ---------- OCR ----------

  var enginePromise = null

  function loadEngine() {
    if (!enginePromise) {
      enginePromise = new Promise(function (resolve, reject) {
        if (window.FortuneOcrEngine) return resolve(window.FortuneOcrEngine)
        var s = document.createElement('script')
        s.src = BASE_URL + 'ocr-engine.js'
        s.onload = function () {
          resolve(window.FortuneOcrEngine)
        }
        s.onerror = function () {
          reject(new Error('OCRエンジンの読み込みに失敗しました'))
        }
        document.head.appendChild(s)
      }).then(function (engine) {
        return engine.init(BASE_URL).then(function () {
          return engine
        })
      })
      enginePromise.catch(function () {
        enginePromise = null
      })
    }
    return enginePromise
  }

  // OCR ライブラリは画像をフル解像度のまま検出モデルに入れるため、スマホのカメラ写真
  // (12MP〜) だとメモリ不足で落ちる。長辺 MAX_IMAGE_SIDE px に縮小した JPEG の URL を返す。
  var lastImageSize = null

  function downscale(file) {
    return new Promise(function (resolve, reject) {
      var srcUrl = URL.createObjectURL(file)
      var img = new Image()
      img.onload = function () {
        URL.revokeObjectURL(srcUrl)
        var scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
        var canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        lastImageSize = img.naturalWidth + 'x' + img.naturalHeight + '→' + canvas.width + 'x' + canvas.height
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          function (blob) {
            if (blob) resolve(URL.createObjectURL(blob))
            else reject(new Error('画像の変換に失敗しました'))
          },
          'image/jpeg',
          0.92,
        )
      }
      img.onerror = function () {
        URL.revokeObjectURL(srcUrl)
        reject(new Error('画像を読み込めませんでした（HEIC形式などは非対応の場合があります）'))
      }
      img.src = srcUrl
    })
  }

  // 桁数がページと合わない候補も捨てずに返す（リスト上で赤表示し、理由をステータスに出す）。
  // 例: 櫻坂46 (13桁) の登録ページで日向坂46 (14桁) の券を読んだ場合
  function extractSerials(texts) {
    var found = []
    texts.forEach(function (t) {
      var v = t.text.replace(/\s+/g, '')
      if (/^[A-Z0-9]+$/.test(v) && v.length >= MIN_LENGTH && v.length <= MAX_LENGTH) found.push({ value: v, conf: t.mean })
    })
    return found
  }

  function handleFiles(files) {
    if (!files || !files.length || busy) return
    files = Array.prototype.slice.call(files)
    setBusy(true)
    setStatus('OCRエンジンを準備中…（初回は約40MBのダウンロードがあります）')
    var added = 0
    var dup = 0
    var wrongLength = 0
    var debugLines = []
    loadEngine()
      .then(function (engine) {
        return files.reduce(function (p, file, idx) {
          return p.then(function () {
            setStatus('読み取り中… (' + (idx + 1) + '/' + files.length + ')')
            var url
            return downscale(file)
              .then(function (u) {
                url = u
                return engine.detect(BASE_URL, url)
              })
              .then(
                function (texts) {
                  URL.revokeObjectURL(url)
                  debugLines.push(
                    '[' + file.name + '] ' + (lastImageSize || '') + ' ' + texts.length + '行',
                  )
                  texts.forEach(function (t) {
                    debugLines.push('  ' + t.text + ' (' + (t.mean != null ? t.mean.toFixed(2) : '-') + ')')
                  })
                  extractSerials(texts).forEach(function (f) {
                    var exists = serials.some(function (s) {
                      return s.value === f.value
                    })
                    if (exists) {
                      dup++
                    } else {
                      serials.push({ value: f.value, conf: f.conf, filled: false })
                      added++
                      if (!isValidSerial(f.value)) wrongLength++
                    }
                  })
                  saveSerials()
                  render()
                },
                function (e) {
                  if (url) URL.revokeObjectURL(url)
                  throw e
                },
              )
          })
        }, Promise.resolve())
      })
      .then(function () {
        $('fo-debug').hidden = false
        $('fo-debug').querySelector('pre').textContent = debugLines.join('\n')
        var msg = added + '件読み取りました。'
        if (dup) msg += '（重複' + dup + '件は除外）'
        if (!added && !dup) msg = 'シリアルが見つかりませんでした。明るい場所で、文字が大きく写るように撮り直してください。'
        var len = serialLength()
        if (wrongLength && len) {
          msg +=
            '\n赤の' + wrongLength + '件は' + len + '桁ではありません。このページのシリアルは' + len + '桁です。' +
            '別のイベントの券ではないか確認してください（櫻坂46 16th は13桁、日向坂46 16th は14桁）。'
        }
        setStatus(msg, (!added && !dup) || wrongLength > 0)
      })
      .catch(function (e) {
        setStatus('エラー: ' + (e && e.message ? e.message : e), true)
      })
      .then(function () {
        setBusy(false)
      })
  }

  // ---------- ページの入力枠へ反映 ----------

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms)
    })
  }

  function pageInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('input[id^="inputSerial"]'))
  }

  function findAddButton() {
    return Array.prototype.slice.call(document.querySelectorAll('button')).filter(function (b) {
      return b.textContent.indexOf('入力枠を追加') >= 0 && !panel.contains(b)
    })[0]
  }

  // React の制御 input に値を入れる
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  function setReactValue(input, value) {
    nativeSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function fill() {
    if (busy) return
    var targets = serials.filter(function (s) {
      return !s.filled
    })
    if (!targets.length) return setStatus('反映するシリアルがありません。', true)
    var invalid = targets.filter(function (s) {
      return !isValidSerial(s.value)
    })
    if (invalid.length) return setStatus('桁数が' + (serialLength() || '正しく') + 'でないシリアルがあります（赤枠）。修正または削除してください。', true)
    if (!pageInputs().length) return setStatus('入力枠が見つかりません。ログインして「シリアルナンバー登録」ページを開いてから実行してください。', true)

    targets = targets.slice(0, MAX_INPUTS)
    setBusy(true)
    ;(async function () {
      for (var guard = 0; pageInputs().length < targets.length && guard < MAX_INPUTS; guard++) {
        var addBtn = findAddButton()
        if (!addBtn) break
        addBtn.click()
        await sleep(50)
      }
      var inputs = pageInputs()
      var n = Math.min(inputs.length, targets.length)
      for (var i = 0; i < inputs.length; i++) {
        setReactValue(inputs[i], i < n ? targets[i].value : '')
        await sleep(30)
      }
      for (var j = 0; j < n; j++) targets[j].filled = true
      saveSerials()
      render()
      var rest = serials.filter(function (s) {
        return !s.filled
      }).length
      var msg = n + '件を入力枠に反映しました。内容を確認して「シリアルナンバー登録」を押してください。'
      if (rest) msg += '\n登録完了後、もう一度このツールの「入力枠へ反映」で残り' + rest + '件を入力できます。'
      setStatus(msg)
      inputs[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    })()
      .catch(function (e) {
        setStatus('エラー: ' + (e && e.message ? e.message : e), true)
      })
      .then(function () {
        setBusy(false)
      })
  }

  // ---------- イベント ----------

  $('fo-cam').addEventListener('click', function () {
    $('fo-file-cam').click()
  })
  $('fo-pick').addEventListener('click', function () {
    $('fo-file-pick').click()
  })
  ;['fo-file-cam', 'fo-file-pick'].forEach(function (id) {
    $(id).addEventListener('change', function (e) {
      handleFiles(e.target.files)
      e.target.value = ''
    })
  })
  $('fo-add').addEventListener('click', function () {
    serials.push({ value: '', conf: null, filled: false })
    render()
    var inputs = listEl.querySelectorAll('input')
    inputs[inputs.length - 1].focus()
  })
  $('fo-clear').addEventListener('click', function () {
    serials = []
    saveSerials()
    render()
    setStatus('')
  })
  $('fo-fill').addEventListener('click', fill)
  $('fo-min').addEventListener('click', function () {
    panel.classList.toggle('fo-min')
    $('fo-min').textContent = panel.classList.contains('fo-min') ? '＋' : '－'
  })
  $('fo-close').addEventListener('click', function () {
    panel.style.display = 'none'
  })

  window.__fortuneOcr = {
    version: VERSION,
    show: function () {
      panel.style.display = ''
      panel.classList.remove('fo-min')
      $('fo-min').textContent = '－'
    },
  }

  render()
  // エンジンは先読みしない。Android ではカメラ起動中に裏のタブがメモリ不足で破棄され、
  // 撮影後にページごと再読み込みされることがあるため、写真を受け取ってから読み込む。
  setStatus(BASE_URL ? '' : 'スクリプトの配置URLを取得できませんでした。', !BASE_URL)
})()
