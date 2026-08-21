// Dump OCR debug artifacts (crops as rgba, boxes as json) — used to inspect
// what the detector/cropper actually produces, and to convert crops to PNG.
const ort = require('onnxruntime-web');
const path = require('path');
ort.env.wasm.wasmPaths = path.resolve(__dirname, '..', 'node_modules/onnxruntime-web/dist') + '/';
ort.env.wasm.numThreads = 1;
const { execSync } = require('child_process');
const fs = require('fs');
const OCR = require(path.resolve(__dirname, '..', 'assets/ocr.js'));

function loadImage(pngPath) {
  const dims = execSync(`identify -format "%w %h" "${pngPath}"`).toString().trim().split(' ').map(Number);
  const w = dims[0], h = dims[1];
  const raw = execSync(`magick "${pngPath}" -depth 8 -colorspace sRGB -alpha off rgba:-`, { maxBuffer: 64 * 1024 * 1024 });
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = raw[i * 3]; data[i * 4 + 1] = raw[i * 3 + 1]; data[i * 4 + 2] = raw[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}

(async () => {
  await OCR.init();
  const img = loadImage('/tmp/ocr_test/img1.png');
  const res = await OCR.recognize(img, null, { debug: true });
  fs.mkdirSync('/tmp/ocr_debug', { recursive: true });
  fs.writeFileSync('/tmp/ocr_debug/boxes.json', JSON.stringify(res.debug.boxes, null, 1));
  fs.writeFileSync('/tmp/ocr_debug/crops_dims.json', JSON.stringify(res.debug.crops.map(function (c) { return { w: c.w, h: c.h }; })));
  res.debug.crops.forEach((c, i) => {
    const buf = Buffer.alloc(c.w * c.h * 4);
    const arr = new Uint8Array(buf.buffer);
    c.data.forEach((v, j) => { arr[j] = v; });
    fs.writeFileSync(`/tmp/ocr_debug/crop_${i}.rgba`, buf);
  });
  console.log('boxes:', res.debug.boxes.length, 'crops:', res.debug.crops.length);
  console.log('text:', JSON.stringify(res.text));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });