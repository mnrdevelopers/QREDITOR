/**
 * PDF Processor Module for QR Code Scanner, Editor & Replacer (V2)
 * Handles client-side PDF rendering using pdf.js and lossless PDF modification using pdf-lib.
 * 100% client-side, offline, no backend required.
 */

(function(global) {
  'use strict';

  /**
   * Check if a file or filename is a PDF
   * @param {File|Blob|string} fileOrName
   * @returns {boolean}
   */
  function isPDF(fileOrName) {
    if (!fileOrName) return false;
    if (typeof fileOrName === 'string') {
      return fileOrName.toLowerCase().endsWith('.pdf');
    }
    if (fileOrName.type === 'application/pdf') return true;
    if (fileOrName.name) {
      return fileOrName.name.toLowerCase().endsWith('.pdf');
    }
    return false;
  }

  /**
   * Initialize and configure PDF.js worker
   */
  function initPdfJs() {
    if (typeof global.pdfjsLib !== 'undefined') {
      // Set worker source to local vendored file if available
      if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        } else {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
        }
      }
    }
  }

  /**
   * Load a PDF document from an ArrayBuffer
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<object>} { pdfDoc, numPages, originalBytes }
   */
  async function loadPDF(arrayBuffer) {
    initPdfJs();
    if (typeof global.pdfjsLib === 'undefined') {
      throw new Error('pdf.js library is not loaded.');
    }

    const uint8Array = new Uint8Array(arrayBuffer);
    const loadingTask = global.pdfjsLib.getDocument({
      data: uint8Array,
      cMapUrl: undefined,
      cMapPacked: true
    });

    const pdfDoc = await loadingTask.promise;
    return {
      pdfDoc,
      numPages: pdfDoc.numPages,
      originalBytes: uint8Array
    };
  }

  /**
   * Render a specific page of a PDF document to an HTMLCanvasElement
   * @param {object} pdfDoc The pdf.js document
   * @param {number} pageNumber 1-indexed page number
   * @param {number} scale Scale multiplier (default 2.0 = ~150 DPI for crisp QR detection)
   * @returns {Promise<HTMLCanvasElement>} Rendered canvas
   */
  async function renderPageToCanvas(pdfDoc, pageNumber = 1, scale = 2.0) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Fill clean white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;
    return canvas;
  }

  /**
   * Replace a QR code directly inside a PDF document using pdf-lib.
   * Modifies only the designated page while preserving all other pages and vector content.
   *
   * @param {Uint8Array|ArrayBuffer} originalPdfBytes
   * @param {number} pageNumber 1-indexed page number
   * @param {object} bbox { x, y, width, height } in canvas pixel coordinates
   * @param {HTMLCanvasElement} newQRCanvas The generated QR code canvas
   * @param {{ width: number, height: number }} canvasDimensions Dimensions of the canvas bbox was extracted from
   * @param {object} options { padding: 3, maskColor: [1, 1, 1] }
   * @returns {Promise<Uint8Array>} Modified PDF bytes
   */
  async function replaceQROnPDF(originalPdfBytes, pageNumber, bbox, newQRCanvas, canvasDimensions, options = {}) {
    const PDFLib = global.PDFLib || (typeof require !== 'undefined' ? require('../lib/pdf-lib.min.js') : null);
    if (!PDFLib || !PDFLib.PDFDocument) {
      throw new Error('pdf-lib library is not loaded.');
    }

    const padding = typeof options.padding === 'number' ? options.padding : 3;
    const pdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();

    if (pageNumber < 1 || pageNumber > pages.length) {
      throw new Error(`Invalid page number ${pageNumber}. Document has ${pages.length} pages.`);
    }

    const targetPage = pages[pageNumber - 1];
    const pdfPageWidth = targetPage.getWidth();
    const pdfPageHeight = targetPage.getHeight();

    // Calculate scale mapping from rendered canvas pixels to PDF points
    const scaleX = pdfPageWidth / canvasDimensions.width;
    const scaleY = pdfPageHeight / canvasDimensions.height;

    // Map bounding box coordinates to PDF points
    const pdfX = bbox.x * scaleX;
    const pdfBoxWidth = bbox.width * scaleX;
    const pdfBoxHeight = bbox.height * scaleY;
    const pdfPad = padding * scaleX;

    // In PDF specification, coordinate (0, 0) is at the BOTTOM-LEFT corner
    // In Canvas, coordinate (0, 0) is at the TOP-LEFT corner
    const pdfY = pdfPageHeight - ((bbox.y + bbox.height) * scaleY);

    // 1. Cover the old QR code with clean white mask rectangle
    targetPage.drawRectangle({
      x: Math.max(0, pdfX - pdfPad),
      y: Math.max(0, pdfY - pdfPad),
      width: Math.min(pdfPageWidth, pdfBoxWidth + pdfPad * 2),
      height: Math.min(pdfPageHeight, pdfBoxHeight + pdfPad * 2),
      color: PDFLib.rgb(1, 1, 1)
    });

    // 2. Convert newQRCanvas to PNG bytes and embed in PDF
    let pngBytes;
    if (newQRCanvas instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(newQRCanvas))) {
      pngBytes = newQRCanvas;
    } else if (newQRCanvas && typeof newQRCanvas.toDataURL === 'function') {
      const pngDataUrl = newQRCanvas.toDataURL('image/png');
      pngBytes = dataUrlToUint8Array(pngDataUrl);
    } else {
      throw new Error('newQRCanvas must be an HTMLCanvasElement or PNG Uint8Array.');
    }
    const embeddedQr = await pdfDoc.embedPng(pngBytes);

    // 3. Draw new QR code exactly onto target page coordinates
    targetPage.drawImage(embeddedQr, {
      x: pdfX,
      y: pdfY,
      width: pdfBoxWidth,
      height: pdfBoxHeight
    });

    // 4. Save and return modified PDF bytes
    return await pdfDoc.save();
  }

  /**
   * Helper to convert Base64 Data URL to Uint8Array
   */
  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const PDFProcessor = {
    isPDF,
    loadPDF,
    renderPageToCanvas,
    replaceQROnPDF
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFProcessor;
  } else {
    global.PDFProcessor = PDFProcessor;
  }
})(typeof window !== 'undefined' ? window : globalThis);
