// 櫻坂46 シリアル OCR 入力ツール
// ブックマークレットから https://ticket.fortunemeets.app/... の登録ページに注入して使う。
// 撮影した応募券の写真から13桁シリアルを読み取り、確認・修正後に入力枠へ反映する（登録ボタンは押さない）。
(function () {
  'use strict'

  if (window.__fortuneOcr) {
    window.__fortuneOcr.show()
    return
  }

  var SERIAL_LENGTH = 13
  var MAX_INPUTS = 10
  var LOW_CONFIDENCE = 0.9
  var STORAGE_KEY = 'fortuneOcrSerials'
  var scriptSrc = (document.currentScript && document.currentScript.src) || ''
  var BASE_URL = scriptSrc.replace(/[^/]*$/, '')
  var SERIAL_RE = new RegExp('^[A-Z0-9]{' + SERIAL_LENGTH + '}$')

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
    '<div id="fo-head"><b>シリアル読み取り</b>' +
    '<button class="fo-btn" id="fo-min" type="button">－</button>' +
    '<button class="fo-btn" id="fo-close" type="button">×</button></div>' +
    '<div id="fo-body">' +
    '<div class="fo-row">' +
    '<button class="fo-btn fo-primary" id="fo-cam" type="button">📷 撮影</button>' +
    '<button class="fo-btn" id="fo-pick" type="button">🖼 写真を選択</button>' +
    '</div>' +
    '<div id="fo-status"></div>' +
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
      var bad = !SERIAL_RE.test(s.value)
      li.className = s.filled ? 'fo-filled' : bad ? 'fo-bad' : s.conf != null && s.conf < LOW_CONFIDENCE ? 'fo-low' : ''
      var no = document.createElement('span')
      no.className = 'fo-no'
      no.textContent = i + 1 + '.'
      var input = document.createElement('input')
      input.value = s.value
      input.autocapitalize = 'characters'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.maxLength = SERIAL_LENGTH + 4
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

  function extractSerials(texts) {
    var found = []
    texts.forEach(function (t) {
      var v = t.text.replace(/\s+/g, '')
      if (SERIAL_RE.test(v)) found.push({ value: v, conf: t.mean })
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
    loadEngine()
      .then(function (engine) {
        return files.reduce(function (p, file, idx) {
          return p.then(function () {
            setStatus('読み取り中… (' + (idx + 1) + '/' + files.length + ')')
            var url = URL.createObjectURL(file)
            return engine.detect(BASE_URL, url).then(
              function (texts) {
                URL.revokeObjectURL(url)
                extractSerials(texts).forEach(function (f) {
                  var exists = serials.some(function (s) {
                    return s.value === f.value
                  })
                  if (exists) {
                    dup++
                  } else {
                    serials.push({ value: f.value, conf: f.conf, filled: false })
                    added++
                  }
                })
                saveSerials()
                render()
              },
              function (e) {
                URL.revokeObjectURL(url)
                throw e
              },
            )
          })
        }, Promise.resolve())
      })
      .then(function () {
        var msg = added + '件読み取りました。'
        if (dup) msg += '（重複' + dup + '件は除外）'
        if (!added && !dup) msg = 'シリアルが見つかりませんでした。明るい場所で、文字が大きく写るように撮り直してください。'
        setStatus(msg, !added && !dup)
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
      return !SERIAL_RE.test(s.value)
    })
    if (invalid.length) return setStatus('13桁でないシリアルがあります（赤枠）。修正または削除してください。', true)
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
    show: function () {
      panel.style.display = ''
      panel.classList.remove('fo-min')
      $('fo-min').textContent = '－'
    },
  }

  render()
  // 撮影までの待ち時間を減らすため、エンジンを先読みしておく
  loadEngine().catch(function () {})
  setStatus(BASE_URL ? '' : 'スクリプトの配置URLを取得できませんでした。', !BASE_URL)
})()
