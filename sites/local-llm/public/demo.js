/*
 * Local LLM — in-browser GGUF chat demo.
 *
 * Everything here runs inside the visitor's own tab. The only files this
 * script ever fetches are same-origin, vendored copies of wllama
 * (./vendor/wllama/*) that ship with this site; the only other input is
 * whatever GGUF file the visitor picks from their own disk via the file
 * input below. Nothing is uploaded anywhere, and nothing here talks to any
 * host the visitor didn't knowingly hand a file to.
 *
 * Powered by wllama (https://github.com/ngxson/wllama), a WebAssembly
 * binding for llama.cpp. See vendor/wllama/NOTICE.txt for exactly which
 * files were vendored, from which release, and why the library's own
 * default CDN-hosted compatibility fallback is disabled here.
 */

(function () {
  'use strict';

  var els = {
    fileInput: document.getElementById('demo-file'),
    loadBtn: document.getElementById('demo-load'),
    resetBtn: document.getElementById('demo-reset'),
    statusDot: document.getElementById('demo-status-dot'),
    statusText: document.getElementById('demo-status-text'),
    chatLog: document.getElementById('demo-chat-log'),
    chatForm: document.getElementById('demo-chat-form'),
    chatInput: document.getElementById('demo-chat-input'),
    sendBtn: document.getElementById('demo-send'),
    stopBtn: document.getElementById('demo-stop'),
    clearBtn: document.getElementById('demo-clear'),
  };

  // Section isn't on every page this script might get pasted into; bail
  // out quietly rather than throwing on null element access.
  if (!els.fileInput) return;

  // wllama's own hard ceiling: a single GGUF part is read into one
  // ArrayBuffer, which cannot exceed 2GiB in any browser.
  var MAX_BYTES = 2 * 1024 * 1024 * 1024;

  var wllama = null;
  var messages = [];
  var abortController = null;
  var busy = false;

  function formatBytes(n) {
    if (n >= 1024 * 1024 * 1024) {
      return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function setStatus(dotClass, text) {
    els.statusDot.className = 'dot ' + dotClass;
    els.statusText.textContent = text;
  }

  function appendMessage(role, text) {
    var row = document.createElement('div');
    row.className = 'demo-msg demo-msg--' + role;
    var label = document.createElement('div');
    label.className = 'demo-msg__role';
    label.textContent = role === 'user' ? 'You' : 'Model';
    var body = document.createElement('div');
    body.className = 'demo-msg__body';
    body.textContent = text;
    row.appendChild(label);
    row.appendChild(body);
    els.chatLog.appendChild(row);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return body;
  }

  function resetChatUI() {
    messages = [];
    els.chatLog.innerHTML = '';
    els.chatForm.hidden = true;
    els.chatInput.disabled = true;
    els.sendBtn.disabled = true;
  }

  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (!file) {
      els.loadBtn.disabled = true;
      return;
    }
    if (file.size === 0) {
      els.loadBtn.disabled = true;
      setStatus('dot-warn', 'That file is empty.');
      return;
    }
    if (file.size > MAX_BYTES) {
      els.loadBtn.disabled = true;
      setStatus(
        'dot-warn',
        formatBytes(file.size) + ' is over wllama’s 2GB hard limit for a single in-browser file. Pick something smaller.'
      );
      return;
    }
    els.loadBtn.disabled = false;
    setStatus('dot-faint', formatBytes(file.size) + ' selected — click Load model.');
  });

  els.loadBtn.addEventListener('click', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (!file || busy) return;
    busy = true;
    els.loadBtn.disabled = true;
    els.fileInput.disabled = true;
    setStatus('dot-progress', 'Loading ' + file.name + ' (' + formatBytes(file.size) + ')… this can take a while on a large file.');

    // Lazy import: nobody who never clicks "Load model" pays for the 350KB
    // JS module.
    import('./vendor/wllama/wllama.esm.js')
      .then(function (mod) {
        var w = new mod.Wllama({ default: './vendor/wllama/wllama.wasm' });

        // wllama's default behavior, for browsers missing WebAssembly JSPI
        // or Memory64, is to fall back to a CDN-hosted compatibility build
        // (jsdelivr). This page makes zero requests to any host the
        // visitor didn't choose themselves, so that fallback is switched
        // off here, on purpose. Browsers that would have needed it can't
        // run this demo at all; see the note above the file picker.
        w.setCompat(null);

        return w.loadModel([file], {
          n_threads: 1, // force single-thread WASM: no SharedArrayBuffer,
                        // no cross-origin-isolation headers required, and
                        // none of this site's static hosting can set them
                        // anyway
          n_gpu_layers: 0, // CPU-only WASM, on purpose, for predictable
                            // behavior regardless of what GPU (if any) the
                            // visitor's browser can reach via WebGPU
          n_ctx: 2048,
        }).then(function () {
          return w;
        });
      })
      .then(function (w) {
        wllama = w;
        resetChatUI();
        els.chatForm.hidden = false;
        els.chatInput.disabled = false;
        els.sendBtn.disabled = false;
        els.resetBtn.disabled = false;
        setStatus('dot-good', 'Model loaded — running single-threaded, CPU-only, in this tab.');
      })
      .catch(function (err) {
        console.error(err);
        var msg = err && err.message ? err.message : String(err);
        setStatus('dot-warn', 'Failed to load: ' + msg);
        els.loadBtn.disabled = false;
        els.fileInput.disabled = false;
      })
      .finally(function () {
        busy = false;
      });
  });

  els.resetBtn.addEventListener('click', function () {
    var toExit = wllama;
    wllama = null;
    resetChatUI();
    els.resetBtn.disabled = true;
    els.fileInput.value = '';
    els.fileInput.disabled = false;
    els.loadBtn.disabled = true;
    setStatus('dot-faint', 'No model loaded.');
    if (toExit) {
      toExit.exit().catch(function (err) {
        console.warn('wllama.exit() during reset:', err);
      });
    }
  });

  els.clearBtn.addEventListener('click', function () {
    messages = [];
    els.chatLog.innerHTML = '';
  });

  els.chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!wllama || busy) return;
    var text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = '';
    appendMessage('user', text);
    messages.push({ role: 'user', content: text });

    busy = true;
    els.sendBtn.hidden = true;
    els.stopBtn.hidden = false;
    els.chatInput.disabled = true;

    var replyEl = appendMessage('assistant', '');
    var full = '';
    abortController = new AbortController();

    (async function () {
      try {
        var stream = await wllama.createChatCompletion({
          messages: messages,
          stream: true,
          max_tokens: 256,
          temperature: 0.7,
          top_p: 0.9,
          abortSignal: abortController.signal,
        });
        for await (var chunk of stream) {
          var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (delta && delta.content) {
            full += delta.content;
            replyEl.textContent = full;
            els.chatLog.scrollTop = els.chatLog.scrollHeight;
          }
        }
        messages.push({ role: 'assistant', content: full });
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        replyEl.textContent = full + (full ? '\n\n' : '') + '[' + msg + ']';
        if (full) {
          messages.push({ role: 'assistant', content: full });
        }
      } finally {
        busy = false;
        els.sendBtn.hidden = false;
        els.stopBtn.hidden = true;
        els.chatInput.disabled = false;
        els.chatInput.focus();
        abortController = null;
      }
    })();
  });

  els.stopBtn.addEventListener('click', function () {
    if (abortController) abortController.abort();
  });
})();
