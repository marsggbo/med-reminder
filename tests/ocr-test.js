// Node smoke test for the OCR + parser pipeline (uses onnxruntime-web wasm).
// Usage: magick-generated PNGs in /tmp/ocr_test/*.png
const ort = require('onnxruntime-web');
ort.env.wasm.wasmPaths = require('path').resolve(__dirname, '..', 'node_modules/onnxruntime-web/dist') + '/';
ort.env.wasm.numThreads = 1;

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const OCR = require(path.resolve(__dirname, '..', 'assets/ocr.js'));
const Parser = require(path.resolve(__dirname, '..', 'assets/parser.js'));

const { PNG } = require('pngjs');

function loadImage(pngPath) {
  // true PNG decode (same semantics as a WebView <img>/canvas), avoiding
  // ImageMagick's 16-bit grayscale+alpha handling quirks
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  const w = png.width, h = png.height;
  const src = png.data;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = src[i * 4]; data[i * 4 + 1] = src[i * 4 + 1]; data[i * 4 + 2] = src[i * 4 + 2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}

async function main() {
  const dir = '/tmp/ocr_test';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !/_8\.png$/.test(f)).sort();
  console.log('初始化 OCR 模型…');
  await OCR.init(p => process.stdout.write(`\r加载模型 ${(p * 100).toFixed(0)}%`));
  console.log('\n模型就绪\n');

  for (const f of files) {
    const img = loadImage(path.join(dir, f));
    const t0 = Date.now();
    console.log(`\n════════ ${f} (${img.w}x${img.h}) ════════`);
    const res = await OCR.recognize(img, p => {});
    const ms = Date.now() - t0;
    console.log(`识别耗时 ${ms}ms，${res.lines.length} 行`);
    console.log('── OCR 原文 ──');
    console.log(res.text);
    const parsed = Parser.extract(res.text);
    console.log('── 解析结果 ──');
    console.log(JSON.stringify({
      name: parsed.name, dosePerTime: parsed.dosePerTime, doseUnit: parsed.doseUnit,
      timesPerDay: parsed.timesPerDay, durationDays: parsed.durationDays,
      instructions: parsed.instructions, confidence: parsed.confidence
    }, null, 2));
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });