/**
 * PDF Text Processor Module for QR Code & PDF Editor
 * Handles client-side text extraction, clustering into readable lines,
 * coordinate mapping, and lossless in-place text replacement using pdf-lib.
 * 100% client-side, offline, no backend required.
 */

(function(global) {
  'use strict';

  /**
   * Extract text lines with bounding boxes from a rendered PDF page
   * @param {object} pdfDoc pdf.js PDFDocumentProxy
   * @param {number} pageNumber 1-indexed page number
   * @param {{ width: number, height: number }} canvasDimensions
   * @returns {Promise<Array<object>>} Array of text lines with canvas & PDF coordinates
   */
  async function extractTextLines(pdfDoc, pageNumber, canvasDimensions) {
    if (!pdfDoc) return [];
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const pdfWidth = viewport.width;
    const pdfHeight = viewport.height;

    const scaleX = canvasDimensions.width / pdfWidth;
    const scaleY = canvasDimensions.height / pdfHeight;

    const rawItems = [];

    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const tx = item.transform[4];
      const ty = item.transform[5];
      const itemHeight = Math.max(8, Math.hypot(item.transform[2], item.transform[3]) || item.height || 10);
      const itemWidth = item.width || (item.str.length * itemHeight * 0.55);

      // Convert PDF coordinates (origin bottom-left) to Canvas coordinates (origin top-left)
      const canvasX = Math.round(tx * scaleX);
      const canvasY = Math.round((pdfHeight - ty - itemHeight) * scaleY);
      const canvasW = Math.round(itemWidth * scaleX);
      const canvasH = Math.round(itemHeight * scaleY);

      rawItems.push({
        str: item.str,
        pdfX: tx,
        pdfY: ty,
        pdfWidth: itemWidth,
        pdfHeight: itemHeight,
        canvasX,
        canvasY,
        canvasW,
        canvasH,
        fontSize: itemHeight
      });
    }

    // Cluster items into lines by matching similar baseline (pdfY)
    rawItems.sort((a, b) => {
      if (Math.abs(a.pdfY - b.pdfY) > 4) {
        return b.pdfY - a.pdfY; // Top to bottom
      }
      return a.pdfX - b.pdfX; // Left to right
    });

    const lines = [];
    let currentLine = null;

    for (const item of rawItems) {
      if (!currentLine) {
        currentLine = {
          id: `line_${lines.length + 1}`,
          text: item.str,
          pdfX: item.pdfX,
          pdfY: item.pdfY,
          pdfWidth: item.pdfWidth,
          pdfHeight: item.pdfHeight,
          canvasX: item.canvasX,
          canvasY: item.canvasY,
          canvasW: item.canvasW,
          canvasH: item.canvasH,
          fontSize: item.fontSize
        };
      } else {
        const isSameLine = Math.abs(currentLine.pdfY - item.pdfY) <= 4;
        const isCloseEnough = item.pdfX - (currentLine.pdfX + currentLine.pdfWidth) <= (item.fontSize * 1.5);

        if (isSameLine && isCloseEnough) {
          const spaceNeeded = (item.pdfX - (currentLine.pdfX + currentLine.pdfWidth)) > (item.fontSize * 0.2);
          currentLine.text += (spaceNeeded ? ' ' : '') + item.str;
          currentLine.pdfWidth = (item.pdfX + item.pdfWidth) - currentLine.pdfX;
          currentLine.pdfHeight = Math.max(currentLine.pdfHeight, item.pdfHeight);
          currentLine.canvasW = Math.round(currentLine.pdfWidth * scaleX);
          currentLine.canvasH = Math.round(currentLine.pdfHeight * scaleY);
        } else {
          lines.push(currentLine);
          currentLine = {
            id: `line_${lines.length + 1}`,
            text: item.str,
            pdfX: item.pdfX,
            pdfY: item.pdfY,
            pdfWidth: item.pdfWidth,
            pdfHeight: item.pdfHeight,
            canvasX: item.canvasX,
            canvasY: item.canvasY,
            canvasW: item.canvasW,
            canvasH: item.canvasH,
            fontSize: item.fontSize
          };
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Replace text blocks on a PDF page using pdf-lib
   * @param {Uint8Array|ArrayBuffer} originalPdfBytes
   * @param {number} pageNumber 1-indexed page number
   * @param {Array<object>} replacements Array of replacement configs:
   *   { bbox: { canvasX, canvasY, canvasW, canvasH } or { x, y, width, height },
   *     originalText, newText, fontSize, fontFamily, color: { r, g, b }, padding }
   * @param {{ width: number, height: number }} canvasDimensions
   * @returns {Promise<Uint8Array>} Modified PDF bytes
   */
  async function replaceTextOnPDF(originalPdfBytes, pageNumber, replacements, canvasDimensions) {
    const PDFLib = global.PDFLib || (typeof require !== 'undefined' ? require('../lib/pdf-lib.min.js') : null);
    if (!PDFLib || !PDFLib.PDFDocument) {
      throw new Error('pdf-lib library is not loaded.');
    }

    if (!replacements || replacements.length === 0) {
      return originalPdfBytes instanceof Uint8Array ? originalPdfBytes : new Uint8Array(originalPdfBytes);
    }

    const pdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();

    if (pageNumber < 1 || pageNumber > pages.length) {
      throw new Error(`Invalid page number ${pageNumber}. Document has ${pages.length} pages.`);
    }

    const targetPage = pages[pageNumber - 1];
    const pdfPageWidth = targetPage.getWidth();
    const pdfPageHeight = targetPage.getHeight();

    const scaleX = pdfPageWidth / canvasDimensions.width;
    const scaleY = pdfPageHeight / canvasDimensions.height;

    // Cache embedded fonts
    const fontCache = {};
    async function getFont(name) {
      const standardName = name === 'TimesRoman' ? PDFLib.StandardFonts.TimesRoman :
                           name === 'Courier' ? PDFLib.StandardFonts.Courier :
                           PDFLib.StandardFonts.Helvetica;
      if (!fontCache[standardName]) {
        fontCache[standardName] = await pdfDoc.embedFont(standardName);
      }
      return fontCache[standardName];
    }

    for (const item of replacements) {
      const bbox = item.bbox;
      const bX = bbox.canvasX !== undefined ? bbox.canvasX : bbox.x;
      const bY = bbox.canvasY !== undefined ? bbox.canvasY : bbox.y;
      const bW = bbox.canvasW !== undefined ? bbox.canvasW : bbox.width;
      const bH = bbox.canvasH !== undefined ? bbox.canvasH : bbox.height;

      const pad = typeof item.padding === 'number' ? item.padding : 2;

      // Convert canvas bounding box to PDF points
      const pdfX = bX * scaleX;
      const pdfW = bW * scaleX;
      const pdfH = bH * scaleY;
      const pdfPad = pad * scaleX;

      // Invert Y for PDF bottom-left coordinate origin
      const pdfY = pdfPageHeight - ((bY + bH) * scaleY);

      // 1. Draw whiteout mask rectangle over the original text
      targetPage.drawRectangle({
        x: Math.max(0, pdfX - pdfPad),
        y: Math.max(0, pdfY - pdfPad),
        width: Math.min(pdfPageWidth - pdfX, pdfW + pdfPad * 2),
        height: Math.min(pdfPageHeight - pdfY, pdfH + pdfPad * 2),
        color: PDFLib.rgb(1, 1, 1)
      });

      // 2. Draw replacement text
      if (item.newText && item.newText.trim() !== '') {
        const font = await getFont(item.fontFamily || 'Helvetica');
        const color = item.color || { r: 0, g: 0, b: 0 };
        const textFontSize = item.fontSize ? item.fontSize * scaleY : Math.max(7, pdfH * 0.82);

        targetPage.drawText(item.newText, {
          x: pdfX,
          y: pdfY + (pdfH * 0.12),
          size: textFontSize,
          font: font,
          color: PDFLib.rgb(color.r, color.g, color.b)
        });
      }
    }

    return await pdfDoc.save();
  }

  const PDFTextProcessor = {
    extractTextLines,
    replaceTextOnPDF
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFTextProcessor;
  } else {
    global.PDFTextProcessor = PDFTextProcessor;
  }
})(typeof window !== 'undefined' ? window : globalThis);
