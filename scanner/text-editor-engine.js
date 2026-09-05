/**
 * Text Editor Engine — PDF Text Object Management & Undo/Redo
 * Manages document state, text/QR objects, coordinate transforms,
 * history (undo/redo via operation objects, not page snapshots).
 * Used exclusively by pdf-editor.js — does not modify any existing module.
 */

(function(global) {
  'use strict';

  // ─── ID Generator ───────────────────────────────────────────────────────────
  let _idCounter = 0;
  function genId(prefix) {
    return `${prefix}-${++_idCounter}-${Date.now()}`;
  }

  // ─── Text Object Factory ─────────────────────────────────────────────────────
  /**
   * Creates a text object representing one piece of text on a PDF page.
   * Coordinates are in CANVAS PIXEL space (at the render scale used when the
   * PDF page was rasterised), so they are zoom-independent.
   *
   * @param {object} opts
   * @returns {TextObject}
   */
  function createTextObject(opts) {
    const pageNum = opts.page || 1;
    return {
      id:         opts.id         || genId('txt'),
      page:       pageNum,
      pageIndex:  opts.pageIndex !== undefined ? opts.pageIndex : (pageNum - 1),
      text:       typeof opts.text === 'string' ? opts.text : '',
      x:          typeof opts.x === 'number'    ? opts.x    : 0,
      y:          typeof opts.y === 'number'    ? opts.y    : 0,
      width:      typeof opts.width === 'number'  ? opts.width  : 100,
      height:     typeof opts.height === 'number' ? opts.height : 20,
      fontSize:   opts.fontSize   || 12,
      fontFamily: opts.fontFamily || 'Helvetica',
      fontName:   opts.fontName   || null,
      transform:  opts.transform  || null,
      color:      opts.color      || '#000000',
      bgColor:    opts.bgColor    || null,
      bold:       opts.bold       || false,
      italic:     opts.italic     || false,
      align:      opts.align      || 'left',
      deleted:    opts.deleted    || false,
      isAdded:    opts.isAdded    || false,   // true = user-added (not extracted)
      isEdited:   opts.isEdited   || false,   // true = text was changed by user
      originalText: opts.originalText !== undefined ? opts.originalText : (opts.text || ''),
      originalWidth: typeof opts.originalWidth === 'number' ? opts.originalWidth : (opts.width || 100),
      originalHeight: typeof opts.originalHeight === 'number' ? opts.originalHeight : (opts.height || 20),
      origX:      typeof opts.origX === 'number' ? opts.origX : (opts.x || 0),
      origY:      typeof opts.origY === 'number' ? opts.origY : (opts.y || 0),
      // PDF-points coordinates for export (filled during text extraction)
      pdfX:       opts.pdfX       || null,
      pdfY:       opts.pdfY       || null,
      pdfWidth:   opts.pdfWidth   || null,
      pdfHeight:  opts.pdfHeight  || null,
      rawItems:   opts.rawItems   || [],
    };
  }

  // ─── QR Object Factory ───────────────────────────────────────────────────────
  function createQRObject(opts) {
    const pageNum = opts.page || 1;
    return {
      id:          opts.id          || genId('qr'),
      page:        pageNum,
      pageIndex:   opts.pageIndex !== undefined ? opts.pageIndex : (pageNum - 1),
      data:        opts.data        || '',
      originalData:opts.data        || '',
      x:           typeof opts.x === 'number'      ? opts.x      : 0,
      y:           typeof opts.y === 'number'      ? opts.y      : 0,
      width:       typeof opts.width === 'number'  ? opts.width  : 80,
      height:      typeof opts.height === 'number' ? opts.height : 80,
      type:        opts.type        || 'TEXT',
      replaced:    opts.replaced    || false,
      newQRCanvas: opts.newQRCanvas || null,  // HTMLCanvasElement after generation
    };
  }

  // ─── Document State ──────────────────────────────────────────────────────────
  /**
   * Central document state. One instance per open PDF session.
   * Maintains structured operations according to the specification.
   */
  function createDocumentState(fileName) {
    return {
      fileName: fileName || '',
      pageCount: 0,
      // Structured modification model:
      textEdits: [],
      addedText: [],
      qrEdits: [],
      deletedText: [],
      // Per-page caches of extracted text objects: { [pageNum]: TextObject[] }
      pageTextObjects: {},
      // All user-added text objects (any page)
      addedTextObjects: [],
      // Detected QR objects (any page)
      qrObjects: [],
      // Currently selected object (TextObject or QRObject or null)
      selectedObject: null,
      // Undo/redo stacks
      history: [],
      historyIndex: -1,
      // Page render scale (used for coord transforms)
      renderScale: 2.0,
    };
  }

  // ─── Text Extraction from PDF.js ─────────────────────────────────────────────
  /**
   * Extracts text items from a PDF page via pdf.js getTextContent().
   * Groups adjacent words/characters on the same horizontal baseline into
   * natural lines and sentences (Word-like paragraph/line reconstruction).
   *
   * @param {object} pdfPage   A pdf.js page proxy (from pdfDoc.getPage())
   * @param {number} pageNum   1-indexed
   * @param {number} renderScale  Scale used to render the page canvas (e.g. 2.0)
   * @returns {Promise<TextObject[]>}
   */
  async function extractPageTextObjects(pdfPage, pageNum, renderScale, canvasCtx) {
    const viewport = pdfPage.getViewport({ scale: renderScale });
    let content;
    try {
      content = await pdfPage.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    } catch (e) {
      return [];
    }

    const rawItems = content.items || [];
    if (!rawItems.length) return [];

    // Parse each raw item using matrix magnitude for visual font scale
    const parsed = [];
    for (const item of rawItems) {
      if (!item.str || item.str.trim() === '') continue;
      const tx = item.transform;
      const pdfX = tx[4];
      const pdfY = tx[5];
      // Section 10: Determine visual font size from matrix magnitude
      const fontSize = Math.hypot(tx[0], tx[1]) || Math.hypot(tx[2], tx[3]) || 12;

      const [canvasX, canvasY] = viewport.convertToViewportPoint(pdfX, pdfY);
      const pdfW = item.width || (item.str.length * fontSize * 0.6);
      const fontScaled = fontSize * renderScale;
      // Snug ascent and descent calculation so box tightly fits text without overflowing into QR code above
      const ascent = Math.round(fontScaled * 0.80);
      const descent = Math.round(fontScaled * 0.22);
      const boxTopY = Math.max(0, Math.round(canvasY - ascent));
      const boxH = Math.max(8, ascent + descent);
      const boxW = Math.max(4, Math.round(pdfW * renderScale));

      parsed.push({
        str: item.str,
        pdfX,
        pdfY,
        fontSize,
        pdfW,
        pdfH: item.height || fontSize,
        transform: tx,
        canvasX: Math.max(0, Math.round(canvasX)),
        canvasY: boxTopY,
        canvasW: boxW,
        canvasH: boxH,
        baselineY: Math.round(canvasY),
        fontFamily: _mapPdfFont(item.fontName),
        bold: _isBoldFont(item.fontName),
        italic: _isItalicFont(item.fontName),
        fontName: item.fontName,
      });
    }

    if (!parsed.length) return [];

    // Sort items: top-to-bottom (pdfY descending in PDF space), then left-to-right (pdfX ascending)
    parsed.sort((a, b) => {
      const yDiff = b.pdfY - a.pdfY;
      if (Math.abs(yDiff) > 2.5) return yDiff;
      return a.pdfX - b.pdfX;
    });

    // Group items into coherent lines / sentences (Word-like reconstruction)
    const lineGroups = [];
    let currentLine = null;

    for (const it of parsed) {
      if (!currentLine) {
        currentLine = {
          items: [it],
          pdfY: it.pdfY,
          fontSize: it.fontSize,
          fontFamily: it.fontFamily,
          bold: it.bold,
          italic: it.italic,
          minPdfX: it.pdfX,
          maxEndPdfX: it.pdfX + it.pdfW,
          canvasX: it.canvasX,
          canvasY: it.canvasY,
          maxCanvasRight: it.canvasX + it.canvasW,
          maxCanvasBottom: it.canvasY + it.canvasH,
          maxPdfH: it.pdfH,
          text: it.str,
          transform: it.transform,
        };
        lineGroups.push(currentLine);
        continue;
      }

      // Check if this item is on the same line as currentLine
      const yTol = Math.max(3, Math.min(it.fontSize, currentLine.fontSize) * 0.4);
      const sameBaseline = Math.abs(it.pdfY - currentLine.pdfY) <= yTol;
      const gap = it.pdfX - currentLine.maxEndPdfX;

      // Group if on same baseline and not an extreme column jump (e.g. > 18pt or 1.5x font size)
      const maxWordGap = Math.max(14, it.fontSize * 1.5);
      if (sameBaseline && gap >= -2 && gap <= maxWordGap) {
        // Same line! Check if we need to insert a space
        const needsSpace = gap > (it.fontSize * 0.16) && !currentLine.text.endsWith(' ') && !it.str.startsWith(' ');
        if (needsSpace) {
          currentLine.text += ' ' + it.str;
        } else {
          currentLine.text += it.str;
        }

        currentLine.items.push(it);
        currentLine.maxEndPdfX = Math.max(currentLine.maxEndPdfX, it.pdfX + it.pdfW);
        currentLine.minPdfX = Math.min(currentLine.minPdfX, it.pdfX);
        currentLine.canvasX = Math.min(currentLine.canvasX, it.canvasX);
        currentLine.canvasY = Math.min(currentLine.canvasY, it.canvasY);
        currentLine.maxCanvasRight = Math.max(currentLine.maxCanvasRight, it.canvasX + it.canvasW);
        currentLine.maxCanvasBottom = Math.max(currentLine.maxCanvasBottom, it.canvasY + it.canvasH);
        currentLine.maxPdfH = Math.max(currentLine.maxPdfH, it.pdfH);
      } else {
        // Start a new line
        currentLine = {
          items: [it],
          pdfY: it.pdfY,
          fontSize: it.fontSize,
          fontFamily: it.fontFamily,
          bold: it.bold,
          italic: it.italic,
          minPdfX: it.pdfX,
          maxEndPdfX: it.pdfX + it.pdfW,
          canvasX: it.canvasX,
          canvasY: it.canvasY,
          maxCanvasRight: it.canvasX + it.canvasW,
          maxCanvasBottom: it.canvasY + it.canvasH,
          maxPdfH: it.pdfH,
          text: it.str,
          transform: it.transform,
        };
        lineGroups.push(currentLine);
      }
    }

    // Convert line groups to TextObjects
    const textObjects = lineGroups.map(lg => {
      const fullText = lg.text.trim();
      const canvasW = Math.max(10, lg.maxCanvasRight - lg.canvasX);
      const canvasH = Math.max(10, lg.maxCanvasBottom - lg.canvasY);
      const pdfW = Math.max(8, lg.maxEndPdfX - lg.minPdfX);

      // Recover text stroke color and background color if canvas context is available
      const itemColor = canvasCtx ? sampleTextColor(canvasCtx, lg.canvasX, lg.canvasY, canvasW, canvasH) : '#000000';
      const itemBgColor = canvasCtx ? sampleBackgroundColor(canvasCtx, lg.canvasX, lg.canvasY, canvasW, canvasH) : null;

      return createTextObject({
        page: pageNum,
        pageIndex: pageNum - 1,
        text: fullText,
        originalText: fullText,
        x: Math.round(lg.canvasX),
        y: Math.round(lg.canvasY),
        width: Math.round(canvasW),
        height: Math.round(canvasH),
        originalWidth: Math.round(canvasW),
        originalHeight: Math.round(canvasH),
        origX: Math.round(lg.canvasX),
        origY: Math.round(lg.canvasY),
        fontSize: Math.round(lg.fontSize * renderScale),
        fontFamily: lg.fontFamily,
        transform: lg.transform || null,
        bold: lg.bold,
        italic: lg.italic,
        color: itemColor,
        bgColor: itemBgColor,
        pdfX: lg.minPdfX,
        pdfY: lg.pdfY,
        pdfWidth: pdfW,
        pdfHeight: lg.maxPdfH,
        rawItems: lg.items, // Keep all constituent items for complete masking
      });
    });

    return textObjects;
  }

  function _isBoldFont(fontName) {
    if (!fontName) return false;
    const n = fontName.toLowerCase();
    return n.includes('bold') || n.includes('heavy') || n.includes('black') || n.includes('w7') || n.includes('w8') || n.includes('w9');
  }

  function _isItalicFont(fontName) {
    if (!fontName) return false;
    const n = fontName.toLowerCase();
    return n.includes('italic') || n.includes('oblique') || n.includes('slanted');
  }

  /** Map pdf.js internal font name to a CSS-friendly font family */
  function _mapPdfFont(fontName) {
    if (!fontName) return 'Helvetica';
    const n = fontName.toLowerCase();
    if (n.includes('times') || n.includes('serif')) return 'Times New Roman';
    if (n.includes('courier') || n.includes('mono')) return 'Courier New';
    if (n.includes('helvetica') || n.includes('arial') || n.includes('sans')) return 'Helvetica';
    return 'Helvetica'; // safe fallback
  }

  // ─── Coordinate Transforms ────────────────────────────────────────────────────
  /**
   * Convert canvas-pixel coordinates to display-pixel coordinates (applying zoom).
   */
  function canvasToDisplay(x, y, zoomLevel) {
    return { x: x * zoomLevel, y: y * zoomLevel };
  }

  /**
   * Convert display-pixel coordinates (pointer/event) to canvas-pixel coordinates.
   */
  function displayToCanvas(x, y, zoomLevel) {
    return { x: x / zoomLevel, y: y / zoomLevel };
  }

  /**
   * Convert canvas-pixel coords to PDF-point coords for pdf-lib export.
   *
   * @param {number} canvasX
   * @param {number} canvasY  top-left in canvas pixels
   * @param {number} canvasH  height in canvas pixels
   * @param {number} renderScale
   * @param {number} pdfPageHeight  In PDF points (from pdf-lib page.getHeight())
   * @returns {{ pdfX, pdfY, pdfW, pdfH }}  where pdfY is the BOTTOM-LEFT y
   */
  function canvasToPdfPoints(canvasX, canvasY, canvasW, canvasH, renderScale, pdfPageHeight) {
    const pdfX = canvasX / renderScale;
    // PDF Y origin is bottom; canvas Y origin is top.
    // bottom-left of text in PDF points:
    const pdfYBottom = pdfPageHeight - (canvasY + canvasH) / renderScale;
    const pdfW = canvasW / renderScale;
    const pdfH = canvasH / renderScale;
    return { pdfX, pdfY: pdfYBottom, pdfW, pdfH };
  }

  // ─── Hit Testing ─────────────────────────────────────────────────────────────
  /**
   * Find the closest text/QR object at a given canvas-pixel position.
   * Returns the matching object or null.
   *
   * @param {TextObject[]|QRObject[]} objects
   * @param {number} cx  Canvas-pixel X
   * @param {number} cy  Canvas-pixel Y
   * @param {number} [tolerance=6]  Extra px padding around each bounding box
   */
  function hitTest(objects, cx, cy, tolerance) {
    tolerance = tolerance || 6;
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.deleted) continue;
      if (cx >= obj.x - tolerance &&
          cx <= obj.x + obj.width + tolerance &&
          cy >= obj.y - tolerance &&
          cy <= obj.y + obj.height + tolerance) {
        return obj;
      }
    }
    return null;
  }

  // ─── Undo / Redo ─────────────────────────────────────────────────────────────
  const MAX_HISTORY = 100;

  /**
   * Record an operation in the history stack.
   * Clears any forward history (operations after current index).
   */
  function pushHistory(docState, operation) {
    // Discard any forward history
    docState.history = docState.history.slice(0, docState.historyIndex + 1);
    docState.history.push(operation);
    if (docState.history.length > MAX_HISTORY) {
      docState.history.shift();
    }
    docState.historyIndex = docState.history.length - 1;
  }

  /**
   * Undo the last operation.  Returns the operation that was undone, or null.
   */
  function undo(docState, applyFn) {
    if (docState.historyIndex < 0) return null;
    const op = docState.history[docState.historyIndex];
    docState.historyIndex--;
    applyFn(op, 'undo');
    return op;
  }

  /**
   * Redo the next operation.  Returns the operation that was re-applied, or null.
   */
  function redo(docState, applyFn) {
    if (docState.historyIndex >= docState.history.length - 1) return null;
    docState.historyIndex++;
    const op = docState.history[docState.historyIndex];
    applyFn(op, 'redo');
    return op;
  }

  // ─── Operations ──────────────────────────────────────────────────────────────
  /** Operation creators — lightweight plain objects stored in history */

  function opEditText(obj, prevText, nextText) {
    return { type: 'edit-text', objectId: obj.id, prevText, nextText };
  }

  function opMoveObject(obj, prevX, prevY, nextX, nextY) {
    return { type: 'move-object', objectId: obj.id, prevX, prevY, nextX, nextY };
  }

  function opAddText(obj) {
    return { type: 'add-text', objectId: obj.id, page: obj.page };
  }

  function opDeleteObject(obj) {
    return { type: 'delete-object', objectId: obj.id, prevDeleted: false };
  }

  function opFormatChange(obj, prevFormat, nextFormat) {
    return { type: 'format-change', objectId: obj.id, prevFormat, nextFormat };
  }

  function opReplaceQR(qrObj, prevData, nextData, newQRCanvas = null) {
    return { type: 'replace-qr', objectId: qrObj.id, prevData, nextData, newQRCanvas };
  }

  function opResizeObject(obj, prev, next) {
    return { type: 'resize-object', objectId: obj.id, prev, next };
  }

  // ─── Apply Operations (for undo/redo) ────────────────────────────────────────
  /**
   * Apply an operation in a given direction ('undo'|'redo').
   * This mutates the text/QR objects in place.
   * The caller must re-render after calling this.
   *
   * @param {object}   op          The operation object
   * @param {string}   direction   'undo' | 'redo'
   * @param {Function} findById    (id) => object|null
   */
  function applyOperation(op, direction, findById) {
    const isUndo = direction === 'undo';
    const obj = findById(op.objectId);
    if (!obj && op.type !== 'add-text') return;

    switch (op.type) {
      case 'edit-text':
        obj.text = isUndo ? op.prevText : op.nextText;
        obj.isEdited = obj.text !== obj.originalText;
        break;

      case 'move-object':
        obj.x = isUndo ? op.prevX : op.nextX;
        obj.y = isUndo ? op.prevY : op.nextY;
        break;

      case 'add-text':
        if (obj) obj.deleted = isUndo; // undo=hide it, redo=restore it
        break;

      case 'delete-object':
        if (obj) obj.deleted = !isUndo; // undo=restore, redo=delete again
        break;

      case 'format-change': {
        const fmt = isUndo ? op.prevFormat : op.nextFormat;
        Object.assign(obj, fmt);
        break;
      }

      case 'replace-qr':
        obj.data = isUndo ? op.prevData : op.nextData;
        if (isUndo) {
          obj.replaced = false;
          obj.newQRCanvas = null;
        } else {
          obj.replaced = true;
          if (op.newQRCanvas) obj.newQRCanvas = op.newQRCanvas;
        }
        break;

      case 'resize-object': {
        const r = isUndo ? op.prev : op.next;
        obj.x = r.x; obj.y = r.y;
        obj.width = r.width; obj.height = r.height;
        break;
      }
    }
  }

  // ─── Color & Background Sampling (Sections 14 & 20) ──────────────────────────
  /**
   * Sample foreground text stroke color from rendered canvas context.
   */
  function sampleTextColor(ctx, x, y, width, height) {
    if (!ctx) return '#000000';
    try {
      const rx = Math.max(0, Math.round(x));
      const ry = Math.max(0, Math.round(y));
      const rw = Math.min(Math.round(width), ctx.canvas.width - rx);
      const rh = Math.min(Math.round(height), ctx.canvas.height - ry);
      if (rw <= 0 || rh <= 0) return '#000000';

      const imgData = ctx.getImageData(rx, ry, rw, rh).data;
      let sumR = 0, sumG = 0, sumB = 0, count = 0;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (a > 128 && lum < 220) {
          sumR += r; sumG += g; sumB += b;
          count++;
        }
      }

      if (count > 0) {
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);
        return `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1)}`;
      }
    } catch (_) {}
    return '#000000';
  }

  /**
   * Sample background color from perimeter around text bounding box.
   */
  function sampleBackgroundColor(ctx, x, y, width, height) {
    if (!ctx) return { r: 1, g: 1, b: 1, hex: '#ffffff', isWhite: true };
    try {
      const rx = Math.max(0, Math.round(x));
      const ry = Math.max(0, Math.round(y));
      const rw = Math.min(Math.round(width), ctx.canvas.width - rx);
      const rh = Math.min(Math.round(height), ctx.canvas.height - ry);
      if (rw <= 0 || rh <= 0) return { r: 1, g: 1, b: 1, hex: '#ffffff', isWhite: true };

      const sampleCoords = [];
      const stepX = Math.max(1, Math.floor(rw / 8));
      for (let sx = rx; sx < rx + rw; sx += stepX) {
        if (ry > 2) sampleCoords.push([sx, ry - 2]);
        if (ry + rh + 2 < ctx.canvas.height) sampleCoords.push([sx, ry + rh + 2]);
      }
      const stepY = Math.max(1, Math.floor(rh / 4));
      for (let sy = ry; sy < ry + rh; sy += stepY) {
        if (rx > 2) sampleCoords.push([rx - 2, sy]);
        if (rx + rw + 2 < ctx.canvas.width) sampleCoords.push([rx + rw + 2, sy]);
      }

      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (const [px, py] of sampleCoords) {
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel[3] > 128) {
          sumR += pixel[0]; sumG += pixel[1]; sumB += pixel[2];
          count++;
        }
      }

      if (count > 0) {
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);
        const hex = `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1)}`;
        const isWhite = (avgR > 250 && avgG > 250 && avgB > 250);
        return {
          r: avgR / 255,
          g: avgG / 255,
          b: avgB / 255,
          hex,
          isWhite
        };
      }
    } catch (_) {}
    return { r: 1, g: 1, b: 1, hex: '#ffffff', isWhite: true };
  }

  // ─── Synchronize Structured Modifications (Section 1) ────────────────────────
  function syncDocumentModifications(docState) {
    if (!docState) return;
    const textEdits = [];
    const deletedText = [];
    const qrEdits = [];

    Object.keys(docState.pageTextObjects || {}).forEach(pg => {
      const objs = docState.pageTextObjects[pg] || [];
      objs.forEach(obj => {
        if (obj.deleted) {
          deletedText.push({
            id: obj.id,
            pageIndex: obj.pageIndex,
            textItemId: obj.id,
            originalText: obj.originalText,
            pdfX: obj.pdfX,
            pdfY: obj.pdfY
          });
        } else if (obj.isEdited) {
          textEdits.push({
            id: obj.id,
            pageIndex: obj.pageIndex,
            textItemId: obj.id,
            oldValue: obj.originalText,
            newValue: obj.text,
            pdfX: obj.pdfX,
            pdfY: obj.pdfY,
            fontSize: obj.fontSize,
            fontFamily: obj.fontFamily,
            color: obj.color
          });
        }
      });
    });

    (docState.qrObjects || []).forEach(qr => {
      if (qr.replaced) {
        qrEdits.push({
          id: qr.id,
          pageIndex: qr.pageIndex,
          originalData: qr.originalData,
          newData: qr.data,
          x: qr.x,
          y: qr.y,
          width: qr.width,
          height: qr.height
        });
      }
    });

    docState.textEdits = textEdits;
    docState.deletedText = deletedText;
    docState.qrEdits = qrEdits;
    docState.addedText = (docState.addedTextObjects || []).filter(o => !o.deleted);
  }

  // ─── Scanned PDF Detection ────────────────────────────────────────────────────
  /**
   * Returns true if the page appears to contain no extractable text
   * (i.e. it is likely a scanned image page).
   *
   * @param {TextObject[]} textObjects   Result of extractPageTextObjects()
   * @returns {boolean}
   */
  function isScannedPage(textObjects) {
    return (!textObjects || textObjects.length === 0);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────
  const TextEditorEngine = {
    // Factories
    createDocumentState,
    createTextObject,
    createQRObject,
    // Extraction
    extractPageTextObjects,
    isScannedPage,
    // Color & Background
    sampleTextColor,
    sampleBackgroundColor,
    syncDocumentModifications,
    // Coordinates
    canvasToDisplay,
    displayToCanvas,
    canvasToPdfPoints,
    // Hit testing
    hitTest,
    // History
    pushHistory,
    undo,
    redo,
    applyOperation,
    // Operation creators
    opEditText,
    opMoveObject,
    opAddText,
    opDeleteObject,
    opFormatChange,
    opReplaceQR,
    opResizeObject,
    // Utilities
    genId,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextEditorEngine;
  } else {
    global.TextEditorEngine = TextEditorEngine;
  }

})(typeof window !== 'undefined' ? window : globalThis);
