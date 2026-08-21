// ── PP-OCRv3 Chinese OCR engine (onnxruntime-web, fully offline) ───────────
// Ported from RapidOCR v1.1.0 (Apache-2.0) detector/recognizer/classifier.
// Pure pixel ops on {w, h, data: Uint8ClampedArray(RGBA)} so it runs
// identically in the browser (Capacitor WebView) and in Node (for tests).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('onnxruntime-web'));
  } else {
    root.OCR = factory(null); // ort lazy-loaded via <script> in browser
  }
})(typeof self !== 'undefined' ? self : this, function (ort) {

  var MODEL_DIR = 'models/';
  var MODELS = { det: 'det.onnx', rec: 'rec.onnx', cls: 'cls.onnx' };

  // params from shipped config.yaml files
  var DET = {
    limitSideLen: 736,
    thresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6,
    minSize: 3, maxCandidates: 1000,
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225]
  };
  var REC = { imgH: 48, imgW: 320, meanStd: 0.5 };
  var CLS = { imgH: 48, imgW: 192, thresh: 0.9 };

  var sessions = null; // {det, rec, cls}
  var dict = null;     // ['', ...ppocr_keys_v1]
  var runtime = null;  // ort instance (browser global or Node require)
  var initPromise = null; // 单次初始化共享 Promise，避免并发重复加载

  // ort 1.27 的 wasm EP 会从 ort.min.js 自身 URL 推导同目录的 .jsep.mjs glue
  // （并经由它 fetch jsep.wasm），所以不需要也不应该手动设置 wasmPaths ——
  // 手动加前缀会把路径拼成 vendor/vendor/... 导致动态 import 404。
  // WebKit 在该 import 挂起时静默不报错，正是进度冻在 55% 的根因。
  function configureWasmPaths() {
    runtime.env.wasm = runtime.env.wasm || {};
    runtime.env.wasm.numThreads = 1; // WebView: no SharedArrayBuffer
  }

  // ── bootstrap ────────────────────────────────────────────────────────────
  function ensureOrt() {
    if (runtime) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      if (ort) { runtime = ort; resolve(); return; } // Node path
      if (typeof window !== 'undefined' && window.ort) { // already <script>-loaded
        runtime = window.ort;
        configureWasmPaths();
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = 'vendor/ort.min.js';
      s.onload = function () {
        runtime = window.ort;
        configureWasmPaths();
        resolve();
      };
      s.onerror = function () { reject(new Error('无法加载 OCR 运行库')); };
      document.head.appendChild(s);
    });
  }

  function fetchBytes(path) {
    if (typeof module !== 'undefined' && module.exports) {
      var fs = require('fs');
      var p = require('path');
      return Promise.resolve(fs.readFileSync(p.resolve(__dirname, '..', 'www', path)));
    }
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('加载 ' + path + ' 失败');
      return r.arrayBuffer();
    });
  }

  function tensorFloat32(data, dims) {
    return new runtime.Tensor('float32', data, dims);
  }

  function sessionFrom(file, frac, onProgress) {
    return fetchBytes(MODEL_DIR + file).then(function (buf) {
      if (onProgress) onProgress(frac);
      return runtime.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    });
  }

function init(onProgress) {
    if (sessions || initPromise) {
      if (sessions && onProgress) onProgress(1);
      return initPromise || Promise.resolve();
    }
    initPromise = ensureOrt().then(function () {
      return Promise.all([
        sessionFrom(MODELS.det, 0.3, onProgress),
        sessionFrom(MODELS.rec, 0.65, onProgress),
        sessionFrom(MODELS.cls, 0.82, onProgress)
      ]).then(function (arr) {
        sessions = { det: arr[0], rec: arr[1], cls: arr[2] };
        return fetchBytes(MODEL_DIR + 'ppocr_keys_v1.txt');
      }).then(function (txt) {
        var s;
        if (typeof TextDecoder !== 'undefined') s = new TextDecoder().decode(txt);
        else s = txt;
        // Reference (RapidOCR): index 0 = CTC blank, then dict lines, then ' '.
        // Any other layout shifts every decoded char by one → garbage text.
        ctcDict = ['blank'].concat(s.split('\n').map(function (l) { return l.replace(/\r$/, ''); }).filter(function (l) { return l.length > 0; })).concat([' ']);
        if (onProgress) onProgress(1);
      });
    }).catch(function (e) {
      initPromise = null; // 允许下次重试
      throw e;
    });
    return initPromise;
  }

  // ── pixel ops ────────────────────────────────────────────────────────────
  function resize(img, tw, th) {
    var src = img.data, sw = img.w, sh = img.h;
    var out = new Uint8ClampedArray(tw * th * 4);
    for (var y = 0; y < th; y++) {
      var sy = (y + 0.5) * sh / th - 0.5;
      var y0 = Math.floor(sy); if (y0 < 0) y0 = 0;
      var y1 = y0 + 1; if (y1 > sh - 1) y1 = sh - 1;
      var fy = sy - y0;
      for (var x = 0; x < tw; x++) {
        var sx = (x + 0.5) * sw / tw - 0.5;
        var x0 = Math.floor(sx); if (x0 < 0) x0 = 0;
        var x1 = x0 + 1; if (x1 > sw - 1) x1 = sw - 1;
        var fx = sx - x0;
        var o = (y * tw + x) * 4;
        for (var c = 0; c < 3; c++) {
          var i00 = (y0 * sw + x0) * 4 + c, i01 = (y0 * sw + x1) * 4 + c;
          var i10 = (y1 * sw + x0) * 4 + c, i11 = (y1 * sw + x1) * 4 + c;
          var v = (src[i00] * (1 - fx) + src[i01] * fx) * (1 - fy) + (src[i10] * (1 - fx) + src[i11] * fx) * fy;
          out[o + c] = v;
        }
        out[o + 3] = 255;
      }
    }
    return { w: tw, h: th, data: out };
  }

  // ── det ──────────────────────────────────────────────────────────────────
  function detPreprocess(img) {
    var h = img.h, w = img.w;
    var ratio = 1;
    if (Math.min(h, w) < DET.limitSideLen) ratio = DET.limitSideLen / Math.min(h, w);
    var rw = Math.max(Math.round(w * ratio / 32) * 32, 32);
    var rh = Math.max(Math.round(h * ratio / 32) * 32, 32);
    if (rw !== w || rh !== h || rw !== img.w) img = resize(img, rw, rh);
    var data = new Float32Array(3 * rh * rw);
    var d = img.data;
    for (var p = 0; p < rw * rh; p++) {
      for (var c = 0; c < 3; c++) {
        var v = d[p * 4 + c] / 255;
        data[c * rw * rh + p] = (v - DET.mean[c]) / DET.std[c];
      }
    }
    return { data: data, dims: [1, 3, rh, rw], mapW: rw, mapH: rh };
  }

  function dilate2x2(mask, w, h) {
    var out = new Uint8Array(mask.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var m = mask[y * w + x];
        if (m) {
          out[y * w + x] = 1;
          if (x + 1 < w) out[y * w + x + 1] = 1;
          if (y + 1 < h) {
            out[(y + 1) * w + x] = 1;
            if (x + 1 < w) out[(y + 1) * w + x + 1] = 1;
          }
        }
      }
    }
    return out;
  }

  function connectedComponents(mask, w, h) {
    var seen = new Uint8Array(w * h);
    var comps = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!mask[idx] || seen[idx]) continue;
        var stack = [idx];
        seen[idx] = 1;
        var px = [];
        while (stack.length) {
          var cur = stack.pop();
          px.push(cur);
          var cx = cur % w, cy = (cur / w) | 0;
          // 8-connectivity, matching cv2.findContours so anti-aliased glyphs
          // that only touch at corners still merge into one text line
          if (cx + 1 < w && mask[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1); }
          if (cx > 0 && mask[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1); }
          if (cy + 1 < h && mask[cur + w] && !seen[cur + w]) { seen[cur + w] = 1; stack.push(cur + w); }
          if (cy > 0 && mask[cur - w] && !seen[cur - w]) { seen[cur - w] = 1; stack.push(cur - w); }
          if (cx + 1 < w && cy + 1 < h && mask[cur + w + 1] && !seen[cur + w + 1]) { seen[cur + w + 1] = 1; stack.push(cur + w + 1); }
          if (cx > 0 && cy + 1 < h && mask[cur + w - 1] && !seen[cur + w - 1]) { seen[cur + w - 1] = 1; stack.push(cur + w - 1); }
          if (cx + 1 < w && cy > 0 && mask[cur - w + 1] && !seen[cur - w + 1]) { seen[cur - w + 1] = 1; stack.push(cur - w + 1); }
          if (cx > 0 && cy > 0 && mask[cur - w - 1] && !seen[cur - w - 1]) { seen[cur - w - 1] = 1; stack.push(cur - w - 1); }
        }
        if (px.length >= 3) comps.push(px);
      }
    }
    return comps;
  }

  // OBB of a pixel cluster via PCA → {cx, cy, w, h, angle(rad)}
  function pcaOBB(px, w, h) {
    var n = px.length;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += px[i] % w; sy += (px[i] / w) | 0; }
    var cx = sx / n, cy = sy / n;
    var m00 = 0, m01 = 0, m11 = 0;
    for (var j = 0; j < n; j++) {
      var dx = (px[j] % w) - cx, dy = ((px[j] / w) | 0) - cy;
      m00 += dx * dx; m01 += dx * dy; m11 += dy * dy;
    }
    var trace = m00 + m11;
    var det = Math.sqrt(Math.max((m00 - m11) * (m00 - m11) + 4 * m01 * m01, 0));
    var l1 = (trace + det) / 2;
    var v1x, v1y;
    if (det < 1e-9) { v1x = 1; v1y = 0; }
    else {
      v1x = m01; v1y = l1 - m00;
      var nrm = Math.hypot(v1x, v1y);
      v1x /= nrm; v1y /= nrm;
    }
    var min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
    for (var k = 0; k < n; k++) {
      var dx2 = (px[k] % w) - cx, dy2 = ((px[k] / w) | 0) - cy;
      var p1 = dx2 * v1x + dy2 * v1y;
      var p2 = -dx2 * v1y + dy2 * v1x;
      if (p1 < min1) min1 = p1; if (p1 > max1) max1 = p1;
      if (p2 < min2) min2 = p2; if (p2 > max2) max2 = p2;
    }
    return { cx: cx, cy: cy, w: max1 - min1, h: max2 - min2, angle: Math.atan2(v1y, v1x) };
  }

  function quadCorners(box) {
    var cos = Math.cos(box.angle), sin = Math.sin(box.angle);
    var hw = box.w / 2, hh = box.h / 2;
    return [
      [box.cx + cos * -hw - sin * -hh, box.cy + sin * -hw + cos * -hh],
      [box.cx + cos * hw - sin * -hh, box.cy + sin * hw + cos * -hh],
      [box.cx + cos * hw - sin * hh, box.cy + sin * hw + cos * hh],
      [box.cx + cos * -hw - sin * hh, box.cy + sin * -hw + cos * hh]
    ];
  }

  function quadScore(pred, mw, mh, box) {
    var corners = quadCorners(box);
    var x0 = Math.max(Math.floor(Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0])), 0);
    var y0 = Math.max(Math.floor(Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1])), 0);
    var x1 = Math.min(Math.ceil(Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0])), mw - 1);
    var y1 = Math.min(Math.ceil(Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1])), mh - 1);
    var v1x = corners[1][0] - corners[0][0], v1y = corners[1][1] - corners[0][1];
    var v2x = corners[3][0] - corners[0][0], v2y = corners[3][1] - corners[0][1];
    var n1 = v1x * v1x + v1y * v1y, n2 = v2x * v2x + v2y * v2y;
    var sum = 0, cnt = 0;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - corners[0][0], dy = y - corners[0][1];
        var u = (dx * v1x + dy * v1y) / n1;
        var v = (dx * v2x + dy * v2y) / n2;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { sum += pred[y * mw + x]; cnt++; }
      }
    }
    return cnt ? sum / cnt : 0;
  }

  function detPost(pred, mapW, mapH) {
    var seg = new Uint8Array(mapW * mapH);
    for (var i = 0; i < pred.length && i < seg.length; i++) if (pred[i] > DET.thresh) seg[i] = 1;
    seg = dilate2x2(seg, mapW, mapH);
    var comps = connectedComponents(seg, mapW, mapH);
    // merge comps that are too close (row-wise) to avoid fragmenting lines
    var boxes = [];
    for (var c = 0; c < comps.length && boxes.length < DET.maxCandidates; c++) {
      var box = pcaOBB(comps[c], mapW, mapH);
      if (box.w < DET.minSize || box.h < DET.minSize) continue;
      var score = quadScore(pred, mapW, mapH, box);
      if (score < DET.boxThresh) continue;
      var d = box.w * box.h * DET.unclipRatio / (2 * (box.w + box.h));
      box.w += 2 * d; box.h += 2 * d;
      if (box.w / mapW < 0.01 && box.h / mapH < 0.01) continue; // noise specks
      if (box.h > box.w) { // text runs along the short axis → swap orientation
        var t = box.w; box.w = box.h; box.h = t;
        box.angle += Math.PI / 2;
      }
      while (box.angle > Math.PI / 2) box.angle -= Math.PI;
      while (box.angle < -Math.PI / 2) box.angle += Math.PI;
      boxes.push(box);
    }
    return mergeLineBoxes(boxes);
  }

  // Adjacent boxes on the same text line (small x-gap, overlapping y extent,
  // similar angle) are merged so one line produces a single recognition crop.
  // Fragments are put back in left-to-right order so chains merge correctly.
  function mergeLineBoxes(boxes) {
    boxes.sort(function (a, b) { return (a.cx - a.w / 2) - (b.cx - b.w / 2); });
    var out = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var placed = false;
      for (var j = 0; j < out.length; j++) {
        var m = out[j];
        if (Math.abs(b.cy - m.cy) > 0.6 * Math.min(b.h, m.h)) continue;
        if (Math.abs(b.angle - m.angle) > 0.15) continue;
        var bL = b.cx - b.w / 2, bR = b.cx + b.w / 2;
        var mL = m.cx - m.w / 2, mR = m.cx + m.w / 2;
        var gap = Math.max(bL - mR, mL - bR, 0);
        if (gap > 2 * Math.max(b.h, m.h)) continue;
        var x0 = Math.min(bL, mL), x1 = Math.max(bR, mR);
        m.cx = (x0 + x1) / 2; m.w = x1 - x0;
        m.cy = (m.cy + b.cy) / 2;
        m.h = Math.max(m.h, b.h);
        m.angle = (m.angle + b.angle) / 2;
        placed = true;
        break;
      }
      if (!placed) out.push({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, angle: b.angle });
    }
    return out;
  }

  // ── crop / cls / rec ─────────────────────────────────────────────────────
  function cropBox(img, box, pad) {
    var cos = Math.cos(box.angle), sin = Math.sin(box.angle);
    var hw = box.w / 2 + pad, hh = box.h / 2 + pad;
    var ow = Math.ceil(2 * (hw * Math.abs(cos) + hh * Math.abs(sin)));
    var oh = Math.ceil(2 * (hw * Math.abs(sin) + hh * Math.abs(cos)));
    var out = new Uint8ClampedArray(ow * oh * 4);
    for (var y = 0; y < oh; y++) {
      for (var x = 0; x < ow; x++) {
        var dx = x - ow / 2, dy = y - oh / 2;
        var rx = dx * cos - dy * sin;
        var ry = dx * sin + dy * cos;
        var sx = box.cx + rx, sy = box.cy + ry;
        var sx0 = Math.floor(sx), sy0 = Math.floor(sy);
        var fx = sx - sx0, fy = sy - sy0;
        var x0 = Math.min(Math.max(sx0, 0), img.w - 2), y0 = Math.min(Math.max(sy0, 0), img.h - 2);
        for (var c = 0; c < 3; c++) {
          var i00 = (y0 * img.w + x0) * 4 + c;
          var i01 = (y0 * img.w + x0 + 1) * 4 + c;
          var i10 = ((y0 + 1) * img.w + x0) * 4 + c;
          var i11 = ((y0 + 1) * img.w + x0 + 1) * 4 + c;
          out[(y * ow + x) * 4 + c] =
            (img.data[i00] * (1 - fx) + img.data[i01] * fx) * (1 - fy) +
            (img.data[i10] * (1 - fx) + img.data[i11] * fx) * fy;
        }
        out[(y * ow + x) * 4 + 3] = 255;
      }
    }
    return { w: ow, h: oh, data: out };
  }

  function normImg(img, h, w) {
    var resized = resize(img, w, h);
    var data = new Float32Array(3 * h * w);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        for (var c = 0; c < 3; c++) {
          var v = resized.data[(y * w + x) * 4 + c] / 255;
          data[c * h * w + y * w + x] = (v - 0.5) / 0.5;
        }
      }
    }
    return { data: data, dims: [1, 3, h, w] };
  }

  function rotate90(img) {
    var w = img.w, h = img.h;
    var out = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = ((h - 1 - y) * w + x) * 4; // already vertical text dir: rotate to horizontal
        var d = (x * h + (h - 1 - y)) * 4;
        out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
      }
    }
    return { w: h, h: w, data: out };
  }

  // ── recognize (public) ───────────────────────────────────────────────────
  function recognize(img, onProgress, opts) {
    opts = opts || {};
    if (!sessions) return Promise.reject(new Error('OCR 未初始化'));
    var maxSide = 1600;
    if (Math.max(img.w, img.h) > maxSide) {
      var k = maxSide / Math.max(img.w, img.h);
      img = resize(img, Math.round(img.w * k), Math.round(img.h * k));
    }
    var pre = detPreprocess(img);
    var t = tensorFloat32(pre.data, pre.dims);
    var inp = {};
    inp[sessions.det.inputNames[0]] = t;
    return sessions.det.run(inp).then(function (out) {
      if (onProgress) onProgress(0.35);
      var pred = out[sessions.det.outputNames[0]].data, mw = pre.mapW, mh = pre.mapH;
      var boxes = detPost(pred, mw, mh);
      var sx = img.w / mw, sy = img.h / mh;
      var scaled = [];
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.w * sx < 14 || b.h * sy < 14) continue; // specks / noise
        scaled.push({ cx: b.cx * sx, cy: b.cy * sy, w: b.w * sx, h: b.h * sy, angle: b.angle });
      }
      if (!scaled.length) return { text: '', lines: [] };

      // cluster into rows by center-y
      var rows = [];
      scaled.forEach(function (b) {
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (Math.abs(b.cy - row.cy) < Math.max(4, 0.5 * Math.min(row.h, b.h))) {
            row.items.push(b);
            row.cy = row.cy * (1 - 1 / row.items.length) + b.cy / row.items.length;
            return;
          }
        }
        rows.push({ cy: b.cy, h: b.h, items: [b] });
      });
      rows.sort(function (a, b) { return a.cy - b.cy; });

      var lines = [];
      var queue = [];
      rows.forEach(function (row) {
        row.items.sort(function (a, b) { return a.cx - b.cx; });
        row.items.forEach(function (b) {
          queue.push({ crop: cropBox(img, b, Math.max(6, b.h * 0.15)), box: b });
        });
      });

      var chain = Promise.resolve();
      var debugInfo = null;
      if (opts && opts.debug) {
        debugInfo = { boxes: scaled.map(function (b) { return { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angle: b.angle }; }), crops: [] };
        var prof = [];
        for (var pr = 0; pr < mh; pr++) { var cnt = 0; for (var pc = 0; pc < mw; pc++) if (pred[pr * mw + pc] > 0.25) cnt++; if (cnt) prof.push([pr, cnt]); }
        debugInfo.mapProfile = prof;
      }
      queue.forEach(function (item) {
        chain = chain.then(function () {
          if (debugInfo) debugInfo.crops.push({ w: item.crop.w, h: item.crop.h, data: item.crop.data.slice() });
          var clsReq = clsJudge(item.crop);
          return clsReq.then(function (rotated) {
            return recLine(rotated);
          }).then(function (res) {
            lines.push({ text: res.text, score: res.score, box: item.box });
            if (onProgress) onProgress(0.4 + 0.6 * (lines.length / Math.max(1, queue.length)));
          });
        });
      });
      return chain.then(function () {
        var result = { text: lines.map(function (l) { return l.text; }).join('\n'), lines: lines };
        if (debugInfo) result.debug = debugInfo;
        return result;
      });
    });
  }

  // cls/rec shared helpers
  function clsJudge(crop) {
    var inp = normImg(crop, CLS.imgH, CLS.imgW);
    var feed = {};
    feed[sessions.cls.inputNames[0]] = tensorFloat32(inp.data, inp.dims);
    return sessions.cls.run(feed).then(function (out) {
      var probs = out[sessions.cls.outputNames[0]].data;
      if (probs.length >= 2 && probs[1] > CLS.thresh) {
        // rotate 180
        var w = crop.w, h = crop.h;
        var out2 = new Uint8ClampedArray(w * h * 4);
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var s = ((h - 1 - y) * w + (w - 1 - x)) * 4;
            var d = (y * w + x) * 4;
            out2[d] = crop.data[s]; out2[d + 1] = crop.data[s + 1]; out2[d + 2] = crop.data[s + 2]; out2[d + 3] = 255;
          }
        }
        return { w: w, h: h, data: out2 };
      }
      return crop;
    });
  }

  function recLine(crop) {
    var im = crop;
    if (im.h > im.w) im = rotate90(im); // portrait → landscape
    var ratio = im.w / im.h;
    var tw = Math.min(REC.imgW, Math.max(4, Math.ceil(REC.imgH * ratio)));
    var input = normImg(im, REC.imgH, tw);
    return sessions.rec.run({ [sessions.rec.inputNames[0]]: tensorFloat32(input.data, input.dims) }).then(function (out) {
      var logits = out[sessions.rec.outputNames[0]].data; // [1, T, C]
      var dimsArr = out[sessions.rec.outputNames[0]].dims;
      var T = dimsArr[1], C = dimsArr[2];
      var best = new Int32Array(T);
      for (var t = 0; t < T; t++) {
        var b = 0, bv = logits[t * C];
        for (var c = 1; c < C; c++) {
          var v = logits[t * C + c];
          if (v > bv) { bv = v; b = c; }
        }
        best[t] = b;
      }
      var chars = [];
      var scoreSum = 0, prev = -1;
      for (var s = 0; s < T; s++) {
        var idx = best[s];
        if (idx !== 0 && idx !== prev) { chars.push(ctcDict[idx] || ''); scoreSum += logits[s * C + idx]; }
        prev = idx;
      }
      var text = chars.join('');
      return { text: text, score: scoreSum / Math.max(1, text.length) };
    });
  }

  // ── API ───────────────────────────────────────────────────────────────────
  return {
    init: init,
    recognize: recognize,
    ensureOrt: ensureOrt
  };
});