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

  /**
   * Otsu's Global Binarization Thresholding.
   * Calculates maximum between-class variance to cleanly split foreground modules from background.
   * Turns faded, anti-aliased, or low-contrast PDF QR modules into crisp binary black and white.
   */
  function otsuThreshold(dataArray, width, height) {
    const len = dataArray.length;
    const hist = new Int32Array(256);
    let totalPixels = 0;

    for (let i = 0; i < len; i += 4) {
      const lum = (dataArray[i] * 0.299 + dataArray[i + 1] * 0.587 + dataArray[i + 2] * 0.114) | 0;
      hist[lum]++;
      totalPixels++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let maxVar = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const betweenVar = wB * wF * (mB - mF) * (mB - mF);
      if (betweenVar > maxVar) {
        maxVar = betweenVar;
        threshold = t;
      }
    }

    const output = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      const lum = (dataArray[i] * 0.299 + dataArray[i + 1] * 0.587 + dataArray[i + 2] * 0.114) | 0;
      const val = lum < threshold ? 0 : 255;
      output[i]     = val;
      output[i + 1] = val;
      output[i + 2] = val;
      output[i + 3] = 255;
    }
    return output;
  }

  /**
   * Bradley-Roth Adaptive Thresholding using Integral Images.
   * Handles uneven backgrounds, shaded PDF panels, colored paper, or localized shadows.
   */
  function adaptiveThreshold(dataArray, width, height, deltaPercent = 14) {
    const len = dataArray.length;
    const S = Math.max(8, Math.round(width / 12));
    const s2 = (S / 2) | 0;
    const T = (100 - deltaPercent) / 100;

    const integral = new Float64Array((width + 1) * (height + 1));
    const lums = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const idx = (rowOffset + x) * 4;
        const lum = (dataArray[idx] * 0.299 + dataArray[idx + 1] * 0.587 + dataArray[idx + 2] * 0.114) | 0;
        lums[rowOffset + x] = lum;
        sum += lum;
        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + sum;
      }
    }

    const output = new Uint8ClampedArray(len);
    for (let y = 0; y < height; y++) {
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(height - 1, y + s2);
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - s2);
        const x2 = Math.min(width - 1, x + s2);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);

        const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)]
                  - integral[(y1) * (width + 1) + (x2 + 1)]
                  - integral[(y2 + 1) * (width + 1) + (x1)]
                  + integral[(y1) * (width + 1) + (x1)];

        const lum = lums[rowOffset + x];
        const val = (lum * count <= sum * T) ? 0 : 255;
        const outIdx = (rowOffset + x) * 4;
        output[outIdx]     = val;
        output[outIdx + 1] = val;
        output[outIdx + 2] = val;
        output[outIdx + 3] = 255;
      }
    }
    return output;
  }

  /**
   * Adds a pure white (255) margin around a crop buffer.
   * Essential when users drag a box tightly around finder patterns without quiet zone.
   */
  function padBufferWithQuietZone(src, srcW, srcH, pad = 24) {
    const dstW = srcW + pad * 2;
    const dstH = srcH + pad * 2;
    const dst = new Uint8ClampedArray(dstW * dstH * 4);
    dst.fill(255); // Pure white quiet zone

    for (let y = 0; y < srcH; y++) {
      const srcRow = y * srcW * 4;
      const dstRow = ((y + pad) * dstW + pad) * 4;
      dst.set(src.subarray(srcRow, srcRow + srcW * 4), dstRow);
    }

    return { data: dst, width: dstW, height: dstH, pad };
  }

  function extractSubRegion(srcBuffer, srcW, x0, y0, subW, subH) {
    const safeW = Math.max(1, Math.round(subW));
    const safeH = Math.max(1, Math.round(subH));
    const sub = new Uint8ClampedArray(safeW * safeH * 4);
    sub.fill(255); // Default white background in case of edge clipping

    if (!srcBuffer || srcBuffer.length === 0) return sub;

    const totalPixels = (srcBuffer.length / 4) | 0;
    const srcH = Math.max(1, (totalPixels / srcW) | 0);

    for (let y = 0; y < safeH; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= srcH) continue;
      const copyW = Math.max(0, Math.min(safeW, srcW - x0));
      if (copyW <= 0) continue;
      const srcIdx = (sy * srcW + x0) * 4;
      const dstIdx = y * safeW * 4;
      if (srcIdx >= 0 && (srcIdx + copyW * 4) <= srcBuffer.length) {
        sub.set(srcBuffer.subarray(srcIdx, srcIdx + copyW * 4), dstIdx);
      }
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

    // 1c. Otsu's Global Binarization (vital for PDF anti-aliased gray modules)
    if (detectedQRCodes.length === 0) {
      try {
        const otsu = otsuThreshold(rawData, width, height);
        testWithJsQR(otsu, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1d. Bradley-Roth Adaptive Thresholding (uneven lighting, colored PDF backgrounds)
    if (detectedQRCodes.length === 0) {
      try {
        const adapt = adaptiveThreshold(rawData, width, height);
        testWithJsQR(adapt, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1e. Sharpening filter on full frame (unblurs small QR edges)
    if (detectedQRCodes.length === 0) {
      try {
        const sharp = sharpenFilter(rawData, width, height);
        testWithJsQR(sharp, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1f. Contrast enhancement on full frame
    if (detectedQRCodes.length === 0) {
      try {
        const contrast = enhanceContrast(rawData, width, height);
        testWithJsQR(contrast, width, height, 0, 0, 1);
      } catch (e) {}
    }

    // 1g. Inverted colors
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
    // PASS 2: Multi-Scale Fine-Grid Tiling with 2x Upscaling & Binarization
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

          // Tile attempt 3: Otsu Binarization (Anti-aliased PDF modules)
          if (!found) {
            try {
              const otsuTile = otsuThreshold(subData, subW, subH);
              found = testWithJsQR(otsuTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }

          // Tile attempt 4: Adaptive Threshold (Shaded/colored PDF background)
          if (!found) {
            try {
              const adaptTile = adaptiveThreshold(subData, subW, subH);
              found = testWithJsQR(adaptTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }

          // Tile attempt 5: Sharpened tile
          if (!found) {
            try {
              const sharpTile = sharpenFilter(subData, subW, subH);
              found = testWithJsQR(sharpTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }

          // Tile attempt 6: Contrast enhanced tile
          if (!found) {
            try {
              const contrastTile = enhanceContrast(subData, subW, subH);
              found = testWithJsQR(contrastTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }

          // Tile attempt 7: Inverted tile
          if (!found) {
            try {
              const invTile = invertColors(subData, subW, subH);
              testWithJsQR(invTile, subW, subH, x0, y0, 1);
            } catch (e) {}
          }
        }
      }
    }

    return detectedQRCodes;
  }

  /**
   * Scan an explicit crop/ROI rectangle specified by user (e.g. box drag or select tool).
   * Robust against:
   * 1. Tight selections (synthetic quiet zone padding + outward context expansion)
   * 2. Small QRs (adaptive multi-scale 1x, 2x, 3x, 4x)
   * 3. PDF anti-aliasing / gray blur (Otsu & Adaptive thresholding)
   * 4. Inverted or low-contrast backgrounds
   */
  async function scanRegion(source, cropBox, options = {}) {
    if (!source) throw new Error('No source provided to scanRegion.');
    if (!cropBox) throw new Error('cropBox is required for scanRegion.');

    const imgW = Math.max(10, Math.round(source.naturalWidth || source.width || 0));
    const imgH = Math.max(10, Math.round(source.naturalHeight || source.height || 0));

    let boxX = Math.round(Number(cropBox.x));
    let boxY = Math.round(Number(cropBox.y));
    let boxW = Math.round(Number(cropBox.width));
    let boxH = Math.round(Number(cropBox.height));

    if (isNaN(boxX)) boxX = 0;
    if (isNaN(boxY)) boxY = 0;
    if (isNaN(boxW) || boxW < 8) boxW = imgW;
    if (isNaN(boxH) || boxH < 8) boxH = imgH;

    // Expand crop box outward by 12% to capture real quiet zone if user dragged tightly
    const expandRatio = 0.12;
    const expandX = Math.round(boxW * expandRatio);
    const expandY = Math.round(boxH * expandRatio);

    const x0 = Math.max(0, boxX - expandX);
    const y0 = Math.max(0, boxY - expandY);
    const cropW = Math.min(imgW - x0, boxW + expandX * 2);
    const cropH = Math.min(imgH - y0, boxH + expandY * 2);

    let subData;

    // In a browser DOM environment with an Image or Canvas, use canvas drawImage to extract pixels reliably
    if (typeof document !== 'undefined' && (
      (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
      (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement)
    )) {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
      cropCtx.drawImage(source, x0, y0, cropW, cropH, 0, 0, cropW, cropH);

      // Try native BarcodeDetector on the crop canvas first if available
      if (typeof global.BarcodeDetector !== 'undefined') {
        try {
          const detector = new global.BarcodeDetector({ formats: ['qr_code'] });
          const barcodes = await detector.detect(cropCanvas);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            const nb = barcodes[0];
            const nbBox = nb.boundingBox || { x: 0, y: 0, width: cropW, height: cropH };
            const finalX = Math.round(x0 + (nbBox.x || 0));
            const finalY = Math.round(y0 + (nbBox.y || 0));
            const finalW = Math.round(nbBox.width || cropW);
            const finalH = Math.round(nbBox.height || cropH);

            return [{
              id: 1,
              data: nb.rawValue,
              x: finalX,
              y: finalY,
              width: finalW,
              height: finalH,
              type: detectContentType(nb.rawValue),
              location: {
                topLeftCorner: { x: finalX, y: finalY },
                topRightCorner: { x: finalX + finalW, y: finalY },
                bottomRightCorner: { x: finalX + finalW, y: finalY + finalH },
                bottomLeftCorner: { x: finalX, y: finalY + finalH }
              }
            }];
          }
        } catch (e) {
          // Fall through to jsQR multi-scale pipeline
        }
      }

      const imgData = cropCtx.getImageData(0, 0, cropW, cropH);
      subData = new Uint8ClampedArray(imgData.data);
    } else {
      let rawData = source.data;
      if (!rawData && typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
        const ctx = source.getContext('2d');
        rawData = ctx.getImageData(0, 0, imgW, imgH).data;
      }
      subData = extractSubRegion(rawData, imgW, x0, y0, cropW, cropH);
    }

    // Safety check: verify subData buffer length
    if (!subData || subData.length !== cropW * cropH * 4) {
      subData = new Uint8ClampedArray(cropW * cropH * 4);
      subData.fill(255);
    }

    const decoder = global.jsQR || (typeof require !== 'undefined' ? require('../lib/jsQR.js') : null);
    if (!decoder) throw new Error('jsQR library not available.');

    // Multi-scale candidate selection:
    // For small crops, upscaling (2x, 3x, 4x) is required so module size >= 3-4px.
    // For large crops, 1x and 2x are optimal.
    let scalesToTry = [1, 2, 3];
    if (cropW < 90 || cropH < 90) {
      scalesToTry = [3, 2, 4, 1];
    } else if (cropW < 180 || cropH < 180) {
      scalesToTry = [2, 1, 3];
    } else {
      scalesToTry = [1, 2];
    }

    const quietPad = 24; // 24px pure white quiet zone ensures finder pattern detection

    for (const scale of scalesToTry) {
      // 1. Scale buffer
      const scaled = scale === 1
        ? { data: new Uint8ClampedArray(subData), width: cropW, height: cropH }
        : upscaleBuffer(subData, cropW, cropH, scale);

      // 2. Pad buffer with pure white margin (fixes zero-quiet-zone user selections)
      const padded = padBufferWithQuietZone(scaled.data, scaled.width, scaled.height, quietPad);

      // Filter attempts to try on padded buffer:
      const filters = [
        { name: 'raw', getBuf: () => padded.data },
        { name: 'otsu', getBuf: () => otsuThreshold(padded.data, padded.width, padded.height) },
        { name: 'adaptive', getBuf: () => adaptiveThreshold(padded.data, padded.width, padded.height) },
        { name: 'sharp', getBuf: () => sharpenFilter(padded.data, padded.width, padded.height) },
        { name: 'contrast', getBuf: () => enhanceContrast(padded.data, padded.width, padded.height) },
        { name: 'inverted', getBuf: () => invertColors(padded.data, padded.width, padded.height) }
      ];

      for (const filter of filters) {
        let testBuf;
        try {
          testBuf = filter.getBuf();
        } catch (e) {
          continue;
        }

        const res = decoder(testBuf, padded.width, padded.height, { inversionAttempts: 'attemptBoth' });
        if (res && res.data) {
          // Map coordinates from padded, scaled buffer back to original image coordinates
          const toOrigX = (px) => Math.round(x0 + (px - quietPad) / scale);
          const toOrigY = (py) => Math.round(y0 + (py - quietPad) / scale);

          const tl = { x: toOrigX(res.location.topLeftCorner.x), y: toOrigY(res.location.topLeftCorner.y) };
          const tr = { x: toOrigX(res.location.topRightCorner.x), y: toOrigY(res.location.topRightCorner.y) };
          const br = { x: toOrigX(res.location.bottomRightCorner.x), y: toOrigY(res.location.bottomRightCorner.y) };
          const bl = { x: toOrigX(res.location.bottomLeftCorner.x), y: toOrigY(res.location.bottomLeftCorner.y) };

          const minX = Math.min(tl.x, tr.x, br.x, bl.x);
          const minY = Math.min(tl.y, tr.y, br.y, bl.y);
          const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
          const maxY = Math.max(tl.y, tr.y, br.y, bl.y);

          return [{
            id: 1,
            data: res.data,
            x: Math.max(0, minX),
            y: Math.max(0, minY),
            width: Math.max(10, maxX - minX),
            height: Math.max(10, maxY - minY),
            type: detectContentType(res.data),
            location: {
              topLeftCorner: tl,
              topRightCorner: tr,
              bottomRightCorner: br,
              bottomLeftCorner: bl
            }
          }];
        }
      }
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
    upscaleBuffer,
    otsuThreshold,
    adaptiveThreshold,
    padBufferWithQuietZone
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QRScanner;
  } else {
    global.QRScanner = QRScanner;
  }
})(typeof window !== 'undefined' ? window : globalThis);
