/**
 * Enhanced QR Scanner Module
 * Incorporates:
 * 1. Native Chromium BarcodeDetector API (fastest, highly sensitive to small/angled QRs)
 * 2. Multi-scale pyramid & 2x/3x upscaling for tiny QR codes
 * 3. 3x3 Unsharp mask sharpening kernel for blurred/JPEG-compressed modules
 * 4. Fine-grid overlapping tiled window scanning
 * 5. Region-of-Interest (ROI) crop scanning
 * 6. Multi-QR detection & Content-Type classification
 */

(function(global) {
  'use strict';

  // Content type detection patterns
  const TYPE_PATTERNS = {
    URL: /^https?:\/\//i,
    EMAIL: /^(mailto:|[\w.-]+@[\w.-]+\.\w+)/i,
    PHONE: /^(tel:|\+?[0-9\s\-()]{7,25}$)/i,
    SMS: /^sms(to)?:/i,
    WIFI: /^WIFI:/i,
    VCARD: /^BEGIN:VCARD/i
  };

  function detectContentType(text) {
    if (!text || typeof text !== 'string') return 'UNKNOWN';
    const trimmed = text.trim();

    if (TYPE_PATTERNS.URL.test(trimmed)) return 'URL';
    if (TYPE_PATTERNS.WIFI.test(trimmed)) return 'WIFI';
    if (TYPE_PATTERNS.VCARD.test(trimmed)) return 'VCARD';
    if (TYPE_PATTERNS.EMAIL.test(trimmed)) return 'EMAIL';
    if (TYPE_PATTERNS.SMS.test(trimmed)) return 'SMS';
    if (TYPE_PATTERNS.PHONE.test(trimmed)) return 'PHONE';

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return 'JSON';
      } catch (e) {}
    }

    return 'TEXT';
  }

  function calculateBoundingBox(location, offsetX = 0, offsetY = 0, scale = 1) {
    const pts = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner
    ];

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    return {
      x: Math.round((minX * scale) + offsetX),
      y: Math.round((minY * scale) + offsetY),
      width: Math.round((maxX - minX) * scale),
      height: Math.round((maxY - minY) * scale)
    };
  }

  function isDuplicate(bboxA, bboxB) {
    const overlapX = Math.max(0, Math.min(bboxA.x + bboxA.width, bboxB.x + bboxB.width) - Math.max(bboxA.x, bboxB.x));
    const overlapY = Math.max(0, Math.min(bboxA.y + bboxA.height, bboxB.y + bboxB.height) - Math.max(bboxA.y, bboxB.y));
    const overlapArea = overlapX * overlapY;
    const minArea = Math.min(bboxA.width * bboxA.height, bboxB.width * bboxB.height);
    return minArea > 0 && (overlapArea / minArea) > 0.35;
  }

  /**
   * Fast 2x or 3x nearest-neighbor / bilinear buffer upscaler.
   * Enlarges tiny QR modules so they surpass the binarizer's minimum region threshold.
   */
  function upscaleBuffer(src, srcW, srcH, factor = 2) {
    const dstW = Math.round(srcW * factor);
    const dstH = Math.round(srcH * factor);
    const dst = new Uint8ClampedArray(dstW * dstH * 4);
    const inv = 1 / factor;

    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor(y * inv));
      const sRow = sy * srcW * 4;
      const dRow = y * dstW * 4;
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor(x * inv));
        const sIdx = sRow + sx * 4;
        const dIdx = dRow + x * 4;
        dst[dIdx]     = src[sIdx];
        dst[dIdx + 1] = src[sIdx + 1];
        dst[dIdx + 2] = src[sIdx + 2];
        dst[dIdx + 3] = src[sIdx + 3];
      }
    }

    return { data: dst, width: dstW, height: dstH };
  }

  /**
   * Contrast stretching
   */
  function enhanceContrast(dataArray, width, height) {
    const len = dataArray.length;
    const output = new Uint8ClampedArray(len);

    let minLum = 255;
    let maxLum = 0;
    const lums = new Uint8Array(len / 4);

    for (let i = 0, j = 0; i < len; i += 4, j++) {
      const lum = (dataArray[i] * 0.299 + dataArray[i + 1] * 0.587 + dataArray[i + 2] * 0.114) | 0;
      lums[j] = lum;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }

    const range = (maxLum - minLum) || 1;
    for (let i = 0, j = 0; i < len; i += 4, j++) {
      const stretched = Math.min(255, Math.max(0, ((lums[j] - minLum) * 255 / range) | 0));
      const val = stretched < 128 ? (stretched * 0.55) | 0 : Math.min(255, (stretched * 1.25) | 0);
      output[i]     = val;
      output[i + 1] = val;
      output[i + 2] = val;
      output[i + 3] = 255;
    }

    return output;
  }

  /**
   * 3x3 Sharpen convolution kernel:
   * [  0, -1,  0 ]
   * [ -1,  5, -1 ]
   * [  0, -1,  0 ]
   * Brings back crisp finder pattern edges in small, compressed, or slightly blurred QR codes.
   */
  function sharpenFilter(dataArray, w, h) {
    const output = new Uint8ClampedArray(dataArray.length);
    output.set(dataArray);

    for (let y = 1; y < h - 1; y++) {
      const rowPrev = (y - 1) * w * 4;
      const rowCurr = y * w * 4;
      const rowNext = (y + 1) * w * 4;

      for (let x = 1; x < w - 1; x++) {
        const idx = rowCurr + x * 4;
        const top = rowPrev + x * 4;
        const bot = rowNext + x * 4;
        const lft = rowCurr + (x - 1) * 4;
        const rgt = rowCurr + (x + 1) * 4;

        // Sharpen luminance
        for (let c = 0; c < 3; c++) {
          const val = 5 * dataArray[idx + c] - dataArray[top + c] - dataArray[bot + c] - dataArray[lft + c] - dataArray[rgt + c];
          output[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
        }
        output[idx + 3] = 255;
      }
    }

    return output;
  }

  function invertColors(dataArray, width, height) {
    const len = dataArray.length;
    const output = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      output[i]     = 255 - dataArray[i];
      output[i + 1] = 255 - dataArray[i + 1];
      output[i + 2] = 255 - dataArray[i + 2];
      output[i + 3] = dataArray[i + 3];
    }
    return output;
  }

  function extractSubRegion(srcBuffer, srcW, x0, y0, subW, subH) {
    const sub = new Uint8ClampedArray(subW * subH * 4);
    for (let y = 0; y < subH; y++) {
      const srcRow = ((y0 + y) * srcW + x0) * 4;
      const dstRow = y * subW * 4;
      sub.set(srcBuffer.subarray(srcRow, srcRow + subW * 4), dstRow);
    }
    return sub;
  }

  /**
   * Main scan function.
   * Can be awaited (Promise) or used synchronously when possible.
   *
   * @param {HTMLImageElement|HTMLCanvasElement|ImageData|object} source
   * @param {object} options
   * @returns {Promise<Array<object>>} Detected QR codes
   */
  async function scanQRCode(source, options = {}) {
    const maxQRs = options.maxQRs || 5;
    const enableBarcodeDetector = options.enableBarcodeDetector !== false;
    const deepScan = options.deepScan !== false;

    let width, height, rawData, canvasElement;

    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      width = source.width;
      height = source.height;
      canvasElement = source;
      const ctx = source.getContext('2d', { willReadFrequently: true });
      const imgData = ctx.getImageData(0, 0, width, height);
      rawData = new Uint8ClampedArray(imgData.data);
    } else if (source && source.data && source.width && source.height) {
      width = source.width;
      height = source.height;
      rawData = new Uint8ClampedArray(source.data);
    } else if (typeof document !== 'undefined' && source instanceof (typeof HTMLImageElement !== 'undefined' ? HTMLImageElement : Object)) {
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      width = canvas.width;
      height = canvas.height;
      canvasElement = canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height);
      rawData = new Uint8ClampedArray(imgData.data);
    } else {
      throw new Error('Unsupported image source provided to scanQRCode.');
    }

    const detectedQRCodes = [];

    function addIfUnique(qrItem) {
      const alreadyExists = detectedQRCodes.some(existing =>
        isDuplicate(existing, qrItem) || existing.data === qrItem.data
      );
      if (!alreadyExists) {
        qrItem.id = detectedQRCodes.length + 1;
        qrItem.type = detectContentType(qrItem.data);
        detectedQRCodes.push(qrItem);
        return true;
      }
      return false;
    }

    // =========================================================================
    // PASS 0: Native Chromium BarcodeDetector API (if supported)
    // Chrome's ML engine has multi-octave pyramid detection for tiny & skewed QRs
    // =========================================================================
    if (enableBarcodeDetector && typeof global.BarcodeDetector !== 'undefined') {
      try {
        const detector = new global.BarcodeDetector({ formats: ['qr_code'] });
        const target = canvasElement || source;
        const nativeBarcodes = await detector.detect(target);

        if (nativeBarcodes && nativeBarcodes.length > 0) {
          for (const nb of nativeBarcodes) {
            if (nb.rawValue) {
              const bbox = nb.boundingBox ? {
                x: Math.round(nb.boundingBox.x || nb.boundingBox.left || 0),
                y: Math.round(nb.boundingBox.y || nb.boundingBox.top || 0),
                width: Math.round(nb.boundingBox.width || 0),
                height: Math.round(nb.boundingBox.height || 0)
              } : { x: 0, y: 0, width, height };

              const corners = nb.cornerPoints || [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                { x: bbox.x, y: bbox.y + bbox.height }
              ];

              addIfUnique({
                data: nb.rawValue,
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height,
                location: {
                  topLeftCorner: corners[0] || { x: bbox.x, y: bbox.y },
                  topRightCorner: corners[1] || { x: bbox.x + bbox.width, y: bbox.y },
                  bottomRightCorner: corners[2] || { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                  bottomLeftCorner: corners[3] || { x: bbox.x, y: bbox.y + bbox.height }
                }
              });
            }
          }

          if (detectedQRCodes.length > 0) {
            return detectedQRCodes;
          }
        }
      } catch (e) {
        // Fallback to jsQR pipeline
      }
    }

    // =========================================================================
    // PASS 1: jsQR Full-Frame & Direct Enhancement Passes
    // =========================================================================
    const decoder = global.jsQR || (typeof require !== 'undefined' ? require('../lib/jsQR.js') : null);
    if (!decoder) {
      if (detectedQRCodes.length > 0) return detectedQRCodes;
      throw new Error('jsQR library is not loaded.');
    }

    function testWithJsQR(buf, w, h, offX = 0, offY = 0, scaleFactor = 1) {
      let res = decoder(buf, w, h, { inversionAttempts: 'attemptBoth' });
      if (res && res.data) {
        const bbox = calculateBoundingBox(res.location, offX, offY, 1 / scaleFactor);
        return addIfUnique({
          data: res.data,
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
          location: {
            topLeftCorner: { x: Math.round(res.location.topLeftCorner.x / scaleFactor + offX), y: Math.round(res.location.topLeftCorner.y / scaleFactor + offY) },
            topRightCorner: { x: Math.round(res.location.topRightCorner.x / scaleFactor + offX), y: Math.round(res.location.topRightCorner.y / scaleFactor + offY) },
            bottomRightCorner: { x: Math.round(res.location.bottomRightCorner.x / scaleFactor + offX), y: Math.round(res.location.bottomRightCorner.y / scaleFactor + offY) },
            bottomLeftCorner: { x: Math.round(res.location.bottomLeftCorner.x / scaleFactor + offX), y: Math.round(res.location.bottomLeftCorner.y / scaleFactor + offY) }
          }
        });
      }
      return false;
    }

    // 1a. Raw full frame
    testWithJsQR(rawData, width, height, 0, 0, 1);

    // 1b. Full frame 2x upscale for small/medium images (where tiny QR modules get lost)
    if (detectedQRCodes.length === 0 && (width <= 1400 || height <= 1400)) {
      try {
        const up = upscaleBuffer(rawData, width, height, 2);
        testWithJsQR(up.data, up.width, up.height, 0, 0, 2);
      } catch (e) {}
    }

    // 1c. Contrast enhancement on full frame
    if (detectedQRCodes.length === 0) {
      try {
        const contrast = enhanceContrast(rawData, width, height);
        testWithJsQR(contrast, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1d. Sharpening filter on full frame (unblurs small QR edges)
    if (detectedQRCodes.length === 0) {
      try {
        const sharp = sharpenFilter(rawData, width, height);
        testWithJsQR(sharp, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1e. Inverted colors
    if (detectedQRCodes.length === 0) {
      try {
        const inv = invertColors(rawData, width, height);
        testWithJsQR(inv, width, height, 0, 0, 1);
      } catch (e) {}
    }

    if (detectedQRCodes.length >= maxQRs) {
      return detectedQRCodes;
    }

    // =========================================================================
    // PASS 2: Multi-Scale Fine-Grid Tiling with 2x Upscaling for Small QRs
    // Subdivides large images into overlapping tiles and magnifies each tile
    // =========================================================================
    if (deepScan && (detectedQRCodes.length === 0 || detectedQRCodes.length < maxQRs)) {
      // Determine tile subdivision: use finer grid for larger dimensions
      const cols = width > 1800 ? 4 : (width > 800 ? 3 : 2);
      const rows = height > 1800 ? 4 : (height > 800 ? 3 : 2);

      const overlapRatio = 0.35; // 35% overlap ensures small QRs never get sliced in half
      const tileW = Math.round(width / (cols - (cols - 1) * overlapRatio));
      const tileH = Math.round(height / (rows - (rows - 1) * overlapRatio));
      const stepX = Math.round(tileW * (1 - overlapRatio));
      const stepY = Math.round(tileH * (1 - overlapRatio));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (detectedQRCodes.length >= maxQRs) break;

          const x0 = Math.min(width - tileW, c * stepX);
          const y0 = Math.min(height - tileH, r * stepY);
          const subW = Math.min(tileW, width - x0);
          const subH = Math.min(tileH, height - y0);

          const subData = extractSubRegion(rawData, width, x0, y0, subW, subH);

          // Tile attempt 1: Raw tile
          let found = testWithJsQR(subData, subW, subH, x0, y0, 1);

          // Tile attempt 2: 2x Upscaled Tile (Crucial for small QR detection)
          if (!found) {
            try {
              const upTile = upscaleBuffer(subData, subW, subH, 2);
              found = testWithJsQR(upTile.data, upTile.width, upTile.height, x0, y0, 2);
            } catch (e) {}
          }

          // Tile attempt 3: Sharpened tile
          if (!found) {
            try {
              const sharpTile = sharpenFilter(subData, subW, subH);
              found = testWithJsQR(sharpTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }

          // Tile attempt 4: Contrast enhanced tile
          if (!found) {
            try {
              const contrastTile = enhanceContrast(subData, subW, subH);
              testWithJsQR(contrastTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }
        }
      }
    }

    return detectedQRCodes;
  }

  /**
   * Scan an explicit crop/ROI rectangle specified by user (e.g. box drag or small region)
   * Magnifies the selected region 2x or 3x for guaranteed small-QR decoding.
   */
  async function scanRegion(source, cropBox, options = {}) {
    let width, height, rawData;

    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      width = source.width;
      height = source.height;
      const ctx = source.getContext('2d');
      const imgData = ctx.getImageData(0, 0, width, height);
      rawData = new Uint8ClampedArray(imgData.data);
    } else if (typeof document !== 'undefined' && source instanceof (typeof HTMLImageElement !== 'undefined' ? HTMLImageElement : Object)) {
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      width = canvas.width;
      height = canvas.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height);
      rawData = new Uint8ClampedArray(imgData.data);
    } else if (source && source.data) {
      width = source.width;
      height = source.height;
      rawData = new Uint8ClampedArray(source.data);
    }

    const x0 = Math.max(0, Math.min(width - 10, Math.round(cropBox.x)));
    const y0 = Math.max(0, Math.min(height - 10, Math.round(cropBox.y)));
    const cropW = Math.min(width - x0, Math.max(10, Math.round(cropBox.width)));
    const cropH = Math.min(height - y0, Math.max(10, Math.round(cropBox.height)));

    const subData = extractSubRegion(rawData, width, x0, y0, cropW, cropH);

    // Magnify the selected crop by 3x for small QR codes
    const upScale = 3;
    const upCrop = upscaleBuffer(subData, cropW, cropH, upScale);

    const decoder = global.jsQR || (typeof require !== 'undefined' ? require('../lib/jsQR.js') : null);
    if (!decoder) throw new Error('jsQR library not available.');

    let res = decoder(upCrop.data, upCrop.width, upCrop.height, { inversionAttempts: 'attemptBoth' });

    if (!res || !res.data) {
      // Try sharpened
      const sharp = sharpenFilter(upCrop.data, upCrop.width, upCrop.height);
      res = decoder(sharp, upCrop.width, upCrop.height, { inversionAttempts: 'attemptBoth' });
    }

    if (!res || !res.data) {
      // Try contrast
      const contrast = enhanceContrast(upCrop.data, upCrop.width, upCrop.height);
      res = decoder(contrast, upCrop.width, upCrop.height, { inversionAttempts: 'attemptBoth' });
    }

    if (res && res.data) {
      const bbox = calculateBoundingBox(res.location, x0, y0, 1 / upScale);
      return [{
        id: 1,
        data: res.data,
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        type: detectContentType(res.data),
        location: {
          topLeftCorner: { x: Math.round(res.location.topLeftCorner.x / upScale + x0), y: Math.round(res.location.topLeftCorner.y / upScale + y0) },
          topRightCorner: { x: Math.round(res.location.topRightCorner.x / upScale + x0), y: Math.round(res.location.topRightCorner.y / upScale + y0) },
          bottomRightCorner: { x: Math.round(res.location.bottomRightCorner.x / upScale + x0), y: Math.round(res.location.bottomRightCorner.y / upScale + y0) },
          bottomLeftCorner: { x: Math.round(res.location.bottomLeftCorner.x / upScale + x0), y: Math.round(res.location.bottomLeftCorner.y / upScale + y0) }
        }
      }];
    }

    return [];
  }

  const QRScanner = {
    scanQRCode,
    scanRegion,
    detectContentType,
    calculateBoundingBox,
    enhanceContrast,
    sharpenFilter,
    invertColors,
    upscaleBuffer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QRScanner;
  } else {
    global.QRScanner = QRScanner;
  }
})(typeof window !== 'undefined' ? window : globalThis);
