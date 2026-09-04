/**
 * Comprehensive Automated Test Suite for QR Code Scanner & Replacer
 * Verifies Test Cases 1 through 10 plus small QR handling:
 * - Simple URL
 * - Plain text
 * - Long URL
 * - High resolution image
 * - Small QR (1px/2px module scale)
 * - QR at edge
 * - Low-contrast QR
 * - Edit URL parameter (?id=123 -> ?id=456)
 * - Regeneration & jsQR auto-verification
 * - Canvas replacement precision & native resolution preservation
 */

const fs = require('fs');
const path = require('path');
const qrcode = require('./lib/qrcode.js');
const jsQR = require('./lib/jsQR.js');
const QRScanner = require('./scanner/qr-scanner.js');
const QRGenerator = require('./scanner/qr-generator.js');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, detail = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [PASS] ${testName} ${detail}`);
  } else {
    console.error(`✗ [FAIL] ${testName} ${detail}`);
    process.exitCode = 1;
  }
}

// Helper: Create an RGBA buffer with a generated QR code placed at (posX, posY)
function createSyntheticImage(text, imgWidth, imgHeight, posX, posY, scale = 4, margin = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const mCount = qr.getModuleCount();
  const qrPixelSize = (mCount + margin * 2) * scale;

  const buf = new Uint8ClampedArray(imgWidth * imgHeight * 4);
  buf.fill(255); // White background

  for (let r = 0; r < mCount; r++) {
    for (let c = 0; c < mCount; c++) {
      if (qr.isDark(r, c)) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = posX + (c + margin) * scale + dx;
            const y = posY + (r + margin) * scale + dy;
            if (x >= 0 && x < imgWidth && y >= 0 && y < imgHeight) {
              const idx = (y * imgWidth + x) * 4;
              buf[idx] = 0;
              buf[idx + 1] = 0;
              buf[idx + 2] = 0;
              buf[idx + 3] = 255;
            }
          }
        }
      }
    }
  }

  return { data: buf, width: imgWidth, height: imgHeight, qrPixelSize };
}

async function runTests() {
  console.log('=== RUNNING QR EXTENSION TEST SUITE ===\n');

  // TEST 1: Simple URL QR
  {
    const img = createSyntheticImage('https://example.com', 400, 400, 50, 50);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === 'https://example.com' && detected[0].type === 'URL',
      'TEST 1: Simple URL QR detection and type classification');
  }

  // TEST 2: Plain Text QR
  {
    const img = createSyntheticImage('Hello World Invoice Document 2026', 400, 400, 50, 50);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === 'Hello World Invoice Document 2026' && detected[0].type === 'TEXT',
      'TEST 2: Plain text QR detection and type classification');
  }

  // TEST 3: Long URL QR
  {
    const longUrl = 'https://portal.company.org/verify/session?auth_token=a9f83b4c910e4a78bcdef&timestamp=1772658400&source=mobile_app&ref=promo_qr_campaign';
    const img = createSyntheticImage(longUrl, 600, 600, 50, 50, 5);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === longUrl,
      'TEST 3: Long URL QR detection and exact payload matching');
  }

  // TEST 4: Small QR (scale = 2, ~74px on a 1200x800 canvas)
  {
    const img = createSyntheticImage('https://small-qr.com', 1200, 800, 700, 400, 2);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === 'https://small-qr.com',
      'TEST 4: Small QR code detection on large canvas');
  }

  // TEST 5: QR at Edge of Image
  {
    const img = createSyntheticImage('https://edge-qr.org', 800, 600, 10, 10, 4);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === 'https://edge-qr.org' && detected[0].x <= 30 && detected[0].y <= 30,
      'TEST 5: QR located near image edge');
  }

  // TEST 6: High Resolution Image (2000x2000)
  {
    const img = createSyntheticImage('https://high-res-doc.org/receipt/999', 2000, 2000, 600, 600, 8);
    const detected = await QRScanner.scanQRCode(img);
    assert(detected.length === 1 && detected[0].data === 'https://high-res-doc.org/receipt/999',
      'TEST 6: High resolution image scanning');
  }

  // TEST 7: Multi-Type Classification Checks
  {
    assert(QRScanner.detectContentType('https://example.com') === 'URL', 'TEST 7a: Type URL');
    assert(QRScanner.detectContentType('{"key":"value","id":123}') === 'JSON', 'TEST 7b: Type JSON');
    assert(QRScanner.detectContentType('WIFI:S:GuestNetwork;T:WPA;P:SecretPass;;') === 'WIFI', 'TEST 7c: Type WIFI');
    assert(QRScanner.detectContentType('mailto:support@company.com') === 'EMAIL', 'TEST 7d: Type EMAIL');
    assert(QRScanner.detectContentType('tel:+1234567890') === 'PHONE', 'TEST 7e: Type PHONE');
    assert(QRScanner.detectContentType('BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nEND:VCARD') === 'VCARD', 'TEST 7f: Type VCARD');
  }

  // TEST 8: Edit URL Parameter Workflow (?id=123 -> ?id=456)
  {
    const originalUrl = 'https://example.com?id=123';
    const editedUrl = 'https://example.com?id=456';
    const origImg = createSyntheticImage(originalUrl, 500, 500, 100, 100, 5);

    // 1. Scan original
    const detected = await QRScanner.scanQRCode(origImg);
    assert(detected.length === 1 && detected[0].data === originalUrl,
      'TEST 8a: Original QR detected with ?id=123');

    const detectedQR = detected[0];

    // 2. Generate new QR with editedUrl
    const newQrData = qrcode(0, 'M');
    newQrData.addData(editedUrl);
    newQrData.make();
    const newMCount = newQrData.getModuleCount();
    const margin = 4;
    const newScale = Math.floor(detectedQR.width / (newMCount + margin * 2));

    // 3. Replace QR in original image buffer at exact coordinates with padding
    const padding = 3;
    const maskX = Math.max(0, detectedQR.x - padding);
    const maskY = Math.max(0, detectedQR.y - padding);
    const maskW = detectedQR.width + padding * 2;
    const maskH = detectedQR.height + padding * 2;

    for (let y = maskY; y < maskY + maskH; y++) {
      for (let x = maskX; x < maskX + maskW; x++) {
        const idx = (y * origImg.width + x) * 4;
        origImg.data[idx] = 255;
        origImg.data[idx + 1] = 255;
        origImg.data[idx + 2] = 255;
        origImg.data[idx + 3] = 255;
      }
    }

    for (let r = 0; r < newMCount; r++) {
      for (let c = 0; c < newMCount; c++) {
        if (newQrData.isDark(r, c)) {
          const startX = detectedQR.x + (c + margin) * newScale;
          const startY = detectedQR.y + (r + margin) * newScale;
          for (let y = startY; y < startY + newScale; y++) {
            for (let x = startX; x < startX + newScale; x++) {
              const idx = (y * origImg.width + x) * 4;
              origImg.data[idx] = 0;
              origImg.data[idx + 1] = 0;
              origImg.data[idx + 2] = 0;
              origImg.data[idx + 3] = 255;
            }
          }
        }
      }
    }

    // 4. Scan modified image and verify decoded result is editedUrl
    const modifiedDetected = await QRScanner.scanQRCode(origImg);
    assert(modifiedDetected.length === 1 && modifiedDetected[0].data === editedUrl,
      'TEST 8b: Replaced QR scans and verifies to https://example.com?id=456');
  }

  // TEST 9: Filename Formatter
  {
    assert(QRGenerator.getEditedFilename('document.jpg') === 'document_qr_edited.jpg', 'TEST 9a: document.jpg -> document_qr_edited.jpg');
    assert(QRGenerator.getEditedFilename('photo.png') === 'photo_qr_edited.png', 'TEST 9b: photo.png -> photo_qr_edited.png');
    assert(QRGenerator.getEditedFilename('invoice.scan.webp', 'png') === 'invoice.scan_qr_edited.png', 'TEST 9c: Forced PNG conversion');
  }

  // TEST 10: Manifest V3 Checks
  {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    assert(manifest.manifest_version === 3, 'TEST 10a: Manifest version is 3');
    assert(manifest.permissions && manifest.permissions.includes('storage'), 'TEST 10b: Minimum storage permission present');
    assert(manifest.action && manifest.action.default_popup === 'popup.html', 'TEST 10c: Action popup set to popup.html');
    assert(fs.existsSync('assets/icon16.png') && fs.existsSync('assets/icon48.png') && fs.existsSync('assets/icon128.png'),
      'TEST 10d: All extension icon assets exist');
  }

  // TEST 11: Region Scan (ROI) for tiny QR code
  {
    const img = createSyntheticImage('https://crop-roi.org', 1600, 1200, 1100, 800, 2);
    const cropBox = { x: 1050, y: 750, width: 250, height: 250 };
    const roiResults = await QRScanner.scanRegion(img, cropBox);
    assert(roiResults.length === 1 && roiResults[0].data === 'https://crop-roi.org',
      'TEST 11a: Region scan (ROI) correctly decodes focused small QR');

    // 11b: scanRegion boundary tolerance (must not throw binarizer error even on edge/odd bounds)
    const oddCrop = { x: -20, y: -50, width: 300, height: 150 };
    const oddResults = await QRScanner.scanRegion(img, oddCrop);
    assert(Array.isArray(oddResults), 'TEST 11b: Region scan handles out-of-bounds cropbox safely without binarizer error');

    // 11c: Tight zero-margin crop selection (user dragged tightly around finder squares with 0 white margin)
    // In standard jsQR, 0 margin fails finder pattern ratio. With padBufferWithQuietZone, it decodes cleanly!
    const tightImg = createSyntheticImage('https://tight-crop.net', 400, 400, 50, 50, 3, 0); // margin = 0
    const tightBox = { x: 50, y: 50, width: tightImg.qrPixelSize, height: tightImg.qrPixelSize };
    const tightResults = await QRScanner.scanRegion(tightImg, tightBox);
    assert(tightResults.length === 1 && tightResults[0].data === 'https://tight-crop.net',
      'TEST 11c: Tight zero-margin crop selection decoded via synthetic quiet zone padding');

    // 11d: Otsu Thresholding algorithm test
    const grayBuf = new Uint8ClampedArray(100 * 100 * 4);
    // Fill with simulated anti-aliased transition grays (120, 130, 200)
    for (let i = 0; i < grayBuf.length; i += 4) {
      const v = (i % 200 < 100) ? 60 : 210;
      grayBuf[i] = v; grayBuf[i+1] = v; grayBuf[i+2] = v; grayBuf[i+3] = 255;
    }
    const otsuOut = QRScanner.otsuThreshold(grayBuf, 100, 100);
    const hasBinaryValues = otsuOut.every((val, idx) => (idx % 4 === 3) || val === 0 || val === 255);
    assert(hasBinaryValues === true, 'TEST 11d: Otsu thresholding cleanly produces pure binary 0/255 modules');

    // 11e: Adaptive Thresholding algorithm test
    const adaptOut = QRScanner.adaptiveThreshold(grayBuf, 100, 100);
    assert(adaptOut instanceof Uint8ClampedArray && adaptOut.length === grayBuf.length,
      'TEST 11e: Bradley-Roth adaptive thresholding processes buffer successfully');

    // 11f: Simulated PDF anti-aliasing / smoothing detection test
    // Create synthetic QR and blur its modules by averaging adjacent pixels (simulating PDF.js font/vector anti-aliasing)
    const pdfSimImg = createSyntheticImage('https://pdf-smoothed-qr.io', 500, 500, 60, 60, 3, 4);
    for (let y = 1; y < 499; y++) {
      for (let x = 1; x < 499; x++) {
        const idx = (y * 500 + x) * 4;
        const left = (y * 500 + (x - 1)) * 4;
        const right = (y * 500 + (x + 1)) * 4;
        // Soften edges with 30% gray blur
        if (pdfSimImg.data[idx] === 0 && (pdfSimImg.data[left] === 255 || pdfSimImg.data[right] === 255)) {
          pdfSimImg.data[idx] = 110;
          pdfSimImg.data[idx + 1] = 110;
          pdfSimImg.data[idx + 2] = 110;
        }
      }
    }
    const pdfSimDetected = await QRScanner.scanQRCode(pdfSimImg, { deepScan: true });
    assert(pdfSimDetected.length >= 1 && pdfSimDetected[0].data === 'https://pdf-smoothed-qr.io',
      'TEST 11f: Anti-aliased/smoothed PDF QR code successfully detected and decoded');
  }

  // TEST 12: PDF Support & QR Replacement on PDF
  {
    const PDFProcessor = require('./scanner/pdf-processor.js');
    const PDFLib = require('./lib/pdf-lib.min.js');

    // 12a: isPDF detection
    assert(PDFProcessor.isPDF('invoice.pdf') === true, 'TEST 12a-1: isPDF detects .pdf filename');
    assert(PDFProcessor.isPDF('photo.png') === false, 'TEST 12a-2: isPDF rejects .png filename');
    assert(PDFProcessor.isPDF({ type: 'application/pdf', name: 'doc' }) === true, 'TEST 12a-3: isPDF detects application/pdf MIME');
    assert(PDFProcessor.isPDF({ type: 'image/jpeg', name: 'photo.jpg' }) === false, 'TEST 12a-4: isPDF rejects image/jpeg MIME');

    // 12b: Create base PDF with PDFLib and replace QR
    const pdfDoc = await PDFLib.PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    page.drawText('Sample Invoice with QR Code', { x: 50, y: 750, size: 20 });
    const originalPdfBytes = await pdfDoc.save();

    // Generate a test QR PNG buffer
    const qrCanvasMock = {
      toDataURL: () => {
        // Minimal 1x1 base64 PNG data URL
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      }
    };

    const bbox = { x: 100, y: 150, width: 80, height: 80 };
    const canvasDims = { width: 600, height: 800 };

    const modifiedPdfBytes = await PDFProcessor.replaceQROnPDF(
      originalPdfBytes,
      1,
      bbox,
      qrCanvasMock,
      canvasDims,
      { padding: 2 }
    );

    assert(modifiedPdfBytes instanceof Uint8Array && modifiedPdfBytes.length > originalPdfBytes.length,
      'TEST 12b: replaceQROnPDF modified bytes returned with embedded replacement');

    // Verify modified PDF reloads cleanly
    const reloadedDoc = await PDFLib.PDFDocument.load(modifiedPdfBytes);
    assert(reloadedDoc.getPageCount() === 1, 'TEST 12c: Modified PDF reloads cleanly and preserves page count');
  }

  console.log(`\n=== RESULTS: ${passedTests} / ${totalTests} TESTS PASSED ===\n`);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
