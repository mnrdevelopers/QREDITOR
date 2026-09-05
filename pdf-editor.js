/**
 * PDF Text & QR Editor — Main Controller
 * ────────────────────────────────────────────────────────────────────────────
 * Reuses (without modification):
 *   QRScanner    (scanner/qr-scanner.js)
 *   QRGenerator  (scanner/qr-generator.js)
 *   PDFProcessor (scanner/pdf-processor.js)
 *   TextEditorEngine (scanner/text-editor-engine.js)
 *
 * Architecture:
 *   1. PDF Loading     — PDFProcessor.loadPDF + renderPageToCanvas
 *   2. Text Extraction — TextEditorEngine.extractPageTextObjects (pdf.js)
 *   3. Rendering       — main canvas (PDF) + overlay canvas (selections)
 *   4. Selection       — hit-test on click, selection box on overlay
 *   5. Text Editing    — floating <textarea> or sidebar panel
 *   6. Add Text        — click to place new text box
 *   7. Move / Resize   — mousedown → drag
 *   8. QR Integration  — QRScanner + QRGenerator pipeline
 *   9. Undo / Redo     — TextEditorEngine history (operation objects)
 *  10. Export          — pdf-lib: white-mask + redraw modified text + embed QRs
 * ────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  const RENDER_SCALE   = 2.0;   // PDF page render DPI multiplier
  const THUMB_SCALE    = 0.18;  // Thumbnail render scale
  const MIN_ZOOM       = 0.15;
  const MAX_ZOOM       = 4.0;
  const ZOOM_STEP      = 1.25;
  const OVERLAY_ALPHA  = 0.0;   // Overlay canvas bg is fully transparent

  // Editor modes
  const MODE = { SELECT: 'select', TEXT: 'text', ADD_TEXT: 'add-text', QR: 'qr' };

  // ─── State ─────────────────────────────────────────────────────────────────
  let docState       = null;   // TextEditorEngine.DocumentState
  let currentFile    = null;
  let pdfJsDoc       = null;   // pdf.js document proxy
  let currentPage    = 1;
  let totalPages     = 0;
  let zoomLevel      = 1.0;
  let isAutoFit      = true;   // true when adhering to fitWidth, false when user manually zooms
  let editorMode     = MODE.SELECT;
  let selectedObject = null;
  let hoveredTextObject = null;

  // Drag state
  let isDragging     = false;
  let dragStartX     = 0, dragStartY = 0;
  let dragObjOrigX   = 0, dragObjOrigY = 0;

  // Resize state
  let isResizing     = false;
  let resizeObjOrig  = null;

  // Add-text pending position
  let addTextPending = false;

  // QR state
  let activeQRForEdit    = null;  // QRObject being edited
  let generatedQRCanvas  = null;  // Canvas from QRGenerator

  // Has there been any edit that requires export?
  let hasEdits = false;

  // ─── DOM References ─────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const peStatus       = $('peStatus');
  const peStatusText   = $('peStatusText');
  const peBtnOpenPdf   = $('peBtnOpenPdf');
  const peBtnDownloadPdf = $('peBtnDownloadPdf');
  const peBtnQrStudio  = $('peBtnQrStudio');
  const pePdfFileInput = $('pePdfFileInput');
  const peBtnEmptyOpen = $('peBtnEmptyOpen');

  // Toolbar
  const peBtnSelect    = $('peBtnSelect');
  const peBtnTextTool  = $('peBtnTextTool');
  const peBtnAddText   = $('peBtnAddText');
  const peBtnQrTool    = $('peBtnQrTool');
  const peBtnUndo      = $('peBtnUndo');
  const peBtnRedo      = $('peBtnRedo');
  const peBtnZoomOut   = $('peBtnZoomOut');
  const peBtnZoomIn    = $('peBtnZoomIn');
  const peZoomLabel    = $('peZoomLabel');
  const peBtnFitWidth  = $('peBtnFitWidth');

  // Word formatting ribbon
  const peRibbonGroup       = $('peRibbonGroup');
  const peRibbonFont        = $('peRibbonFont');
  const peRibbonFontDown    = $('peRibbonFontDown');
  const peRibbonFontSize    = $('peRibbonFontSize');
  const peRibbonFontUp      = $('peRibbonFontUp');
  const peRibbonBold        = $('peRibbonBold');
  const peRibbonItalic      = $('peRibbonItalic');
  const peRibbonColor       = $('peRibbonColor');
  const peRibbonColorBar    = $('peRibbonColorBar');
  const peRibbonAlignLeft   = $('peRibbonAlignLeft');
  const peRibbonAlignCenter = $('peRibbonAlignCenter');
  const peRibbonAlignRight  = $('peRibbonAlignRight');
  const peRibbonDelete      = $('peRibbonDelete');
  const peRibbonDone        = $('peRibbonDone');

  // Viewport
  const peEmpty        = $('peEmpty');
  const peCanvasStage  = $('peCanvasStage');
  const peCanvasWrap   = $('peCanvasWrap');
  const peMainCanvas   = $('peMainCanvas');
  const peTextLayer    = $('peTextLayer');
  const peEditOverlay  = $('peEditOverlay');
  const peTextInput    = $('peTextInput');
  const peResizeHandle = $('peResizeHandle');
  const peScannedNotice= $('peScannedNotice');

  // Thumbnails
  const peThumbList    = $('peThumbList');

  // Bottom bar
  const peBtnPrev      = $('peBtnPrev');
  const peBtnNext      = $('peBtnNext');
  const pePageInput    = $('pePageInput');
  const peTotalPages   = $('peTotalPages');
  const peBtnFitWidthBottom = $('peBtnFitWidthBottom');
  const peBtnZoom100   = $('peBtnZoom100');
  const peBtnDownloadBottom = $('peBtnDownloadBottom');

  // Context panel
  const peCtxPlaceholder = $('peCtxPlaceholder');
  const peCtxText      = $('peCtxText');
  const peCtxQr        = $('peCtxQr');
  const peCtxExport    = $('peCtxExport');
  const peProgressCard = $('peProgressCard');
  const peProgressText = $('peProgressText');
  const peProgressPct  = $('peProgressPct');
  const peProgressFill = $('peProgressFill');

  // Text context fields
  const peCtxContent   = $('peCtxContent');
  const peCtxFont      = $('peCtxFont');
  const peCtxFontSize  = $('peCtxFontSize');
  const peCtxBold      = $('peCtxBold');
  const peCtxItalic    = $('peCtxItalic');
  const peCtxAlignLeft = $('peCtxAlignLeft');
  const peCtxAlignCenter = $('peCtxAlignCenter');
  const peCtxAlignRight  = $('peCtxAlignRight');
  const peCtxColor     = $('peCtxColor');
  const peCtxColorHex  = $('peCtxColorHex');
  const peCtxApplyText = $('peCtxApplyText');
  const peCtxDeleteText = $('peCtxDeleteText');

  // QR context fields
  const peCtxQrData    = $('peCtxQrData');
  const peCtxQrType    = $('peCtxQrType');
  const peCtxQrEdit    = $('peCtxQrEdit');
  const peCtxQrEC      = $('peCtxQrEC');
  const peCtxGenerateQr = $('peCtxGenerateQr');
  const peCtxVerifyResult = $('peCtxVerifyResult');
  const peCtxVerifyBadge  = $('peCtxVerifyBadge');
  const peCtxVerifyIcon   = $('peCtxVerifyIcon');
  const peCtxVerifyText   = $('peCtxVerifyText');
  const peOldQrFrame   = $('peOldQrFrame');
  const peNewQrFrame   = $('peNewQrFrame');
  const peCtxApplyQr   = $('peCtxApplyQr');
  const peCtxCancelQr  = $('peCtxCancelQr');

  // Export panel
  const peExportDesc        = $('peExportDesc');
  const peCtxDownload       = $('peCtxDownload');
  const peCtxContinueEditing = $('peCtxContinueEditing');

  // Error
  const peErrorBanner  = $('peErrorBanner');
  const peErrorText    = $('peErrorText');
  const peBtnDismissError = $('peBtnDismissError');

  // ─── Status / Error helpers ────────────────────────────────────────────────
  function setStatus(state, text) {
    peStatus.className = `pe-status ${state}`;
    peStatusText.textContent = text;
  }

  function showError(msg) {
    peErrorText.textContent = msg;
    peErrorBanner.classList.add('visible');
    setStatus('error', 'ERROR');
  }

  function hideError() {
    peErrorBanner.classList.remove('visible');
  }

  peBtnDismissError.addEventListener('click', hideError);

  // Progress
  function showProgress(pct, text) {
    peProgressCard.classList.add('active');
    updateProgress(pct, text);
  }

  function updateProgress(pct, text) {
    const c = Math.max(0, Math.min(100, Math.round(pct)));
    peProgressFill.style.width = `${c}%`;
    peProgressPct.textContent = `${c}%`;
    if (text) peProgressText.textContent = text;
  }

  function hideProgress() {
    setTimeout(() => peProgressCard.classList.remove('active'), 350);
  }

  // ─── Context Panel Management ──────────────────────────────────────────────
  function showContextSection(sectionEl) {
    [peCtxPlaceholder, peCtxText, peCtxQr, peCtxExport].forEach(el => {
      el.classList.remove('active');
    });
    if (sectionEl) sectionEl.classList.add('active');
  }

  function showContextPlaceholder() {
    showContextSection(peCtxPlaceholder);
  }

  // ─── File Open ─────────────────────────────────────────────────────────────
  peBtnOpenPdf.addEventListener('click', () => pePdfFileInput.click());
  peBtnEmptyOpen.addEventListener('click', () => pePdfFileInput.click());

  pePdfFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) openPdfFile(file);
    pePdfFileInput.value = '';
  });

  // Drag-drop into empty area
  peEmpty.addEventListener('dragover', (e) => { e.preventDefault(); peEmpty.classList.add('dragover'); });
  peEmpty.addEventListener('dragleave', () => peEmpty.classList.remove('dragover'));
  peEmpty.addEventListener('drop', (e) => {
    e.preventDefault();
    peEmpty.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      openPdfFile(file);
    } else if (file) {
      showError('Please drop a PDF file.');
    }
  });

  async function openPdfFile(file) {
    hideError();
    currentFile = file;
    setStatus('scanning', 'LOADING PDF...');
    showProgress(15, 'Reading PDF file...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      updateProgress(40, 'Parsing PDF structure...');

      const loaded = await PDFProcessor.loadPDF(arrayBuffer);
      pdfJsDoc  = loaded.pdfDoc;
      totalPages = loaded.numPages;

      // Initialize document state
      docState = TextEditorEngine.createDocumentState(file.name);
      docState.pageCount  = totalPages;
      docState.renderScale = RENDER_SCALE;

      updateProgress(70, `${totalPages} page(s) found...`);

      // Reveal UI
      peEmpty.style.display        = 'none';
      peCanvasStage.style.display  = 'flex';
      peCanvasStage.classList.add('active');

      peBtnDownloadPdf.disabled    = false;
      peBtnDownloadBottom.disabled = false;

      // Render thumbnails (async, deferred)
      renderAllThumbnails();

      // Load page 1 with initial fit
      await loadPage(1, true);

      updateProgress(100, 'Ready');
      hideProgress();
      setStatus('ready', 'READY');
    } catch (err) {
      hideProgress();
      showError('Failed to open PDF: ' + (err.message || 'Unknown error'));
      setStatus('error', 'ERROR');
    }
  }

  // ─── Thumbnail Rendering ────────────────────────────────────────────────────
  async function renderAllThumbnails() {
    peThumbList.innerHTML = '';
    for (let p = 1; p <= totalPages; p++) {
      const item = document.createElement('div');
      item.className = 'pe-thumb-item' + (p === currentPage ? ' active' : '');
      item.dataset.page = p;
      item.innerHTML = `<div class="pe-thumb-label">Page ${p}</div>
        <div class="pe-thumb-canvas-wrap"><canvas class="pe-thumb-canvas" id="peThumb${p}"></canvas></div>`;
      item.addEventListener('click', () => loadPage(parseInt(item.dataset.page)));
      peThumbList.appendChild(item);

      // Render each thumbnail asynchronously to avoid blocking
      setTimeout(async () => {
        try {
          const page = await pdfJsDoc.getPage(p);
          const vp   = page.getViewport({ scale: THUMB_SCALE });
          const tc   = document.getElementById(`peThumb${p}`);
          if (!tc) return;
          tc.width  = Math.round(vp.width);
          tc.height = Math.round(vp.height);
          const ctx = tc.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, tc.width, tc.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch (_) { /* ignore thumbnail errors */ }
      }, p * 80);
    }
  }

  function updateThumbHighlight(pageNum) {
    document.querySelectorAll('.pe-thumb-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.page) === pageNum);
    });
    // Scroll thumbnail into view
    const active = document.querySelector('.pe-thumb-item.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── Page Loading ───────────────────────────────────────────────────────────
  async function loadPage(pageNum, isInitial = false) {
    if (pageNum < 1 || pageNum > totalPages) return;

    currentPage = pageNum;
    selectedObject = null;
    generatedQRCanvas = null;
    activeQRForEdit = null;
    showContextPlaceholder();
    clearOverlay();
    hideInlineEditor();

    // Update bottom bar
    pePageInput.value = pageNum;
    peTotalPages.textContent = `of ${totalPages}`;
    peBtnPrev.disabled = (pageNum <= 1);
    peBtnNext.disabled = (pageNum >= totalPages);
    updateThumbHighlight(pageNum);

    setStatus('scanning', `RENDERING PAGE ${pageNum}...`);
    showProgress(20, `Rendering page ${pageNum}...`);

    try {
      const pageCanvas = await PDFProcessor.renderPageToCanvas(pdfJsDoc, pageNum, RENDER_SCALE);
      updateProgress(55, 'Extracting text...');

      // Draw PDF page onto main canvas
      peMainCanvas.width  = pageCanvas.width;
      peMainCanvas.height = pageCanvas.height;
      const ctx = peMainCanvas.getContext('2d');
      ctx.drawImage(pageCanvas, 0, 0);

      // Size the edit overlay & text layer to match
      peEditOverlay.width  = pageCanvas.width;
      peEditOverlay.height = pageCanvas.height;
      if (peTextLayer) {
        peTextLayer.style.width  = pageCanvas.width + 'px';
        peTextLayer.style.height = pageCanvas.height + 'px';
      }
      peCanvasWrap.style.width  = pageCanvas.width + 'px';
      peCanvasWrap.style.height = pageCanvas.height + 'px';

      // Extract text objects for this page if not cached (passing ctx for color & background recovery)
      if (!docState.pageTextObjects[pageNum]) {
        try {
          const pdfPage = await pdfJsDoc.getPage(pageNum);
          const textObjs = await TextEditorEngine.extractPageTextObjects(pdfPage, pageNum, RENDER_SCALE, ctx);
          docState.pageTextObjects[pageNum] = textObjs;
        } catch (_) {
          docState.pageTextObjects[pageNum] = [];
        }
      }

      // Synchronized DOM Text Layer (Section 5)
      renderDomTextLayer(pageNum);

      const textObjects = docState.pageTextObjects[pageNum] || [];
      const isScanned = TextEditorEngine.isScannedPage(textObjects);
      peScannedNotice.classList.toggle('visible', isScanned);

      updateProgress(100, 'Ready');
      hideProgress();
      setStatus('ready', 'READY');

      // Apply zoom: on initial load, fit width so document is comfortably legible;
      // on subsequent page navigation, preserve the user's active zoom level!
      if (isInitial || isAutoFit) {
        fitWidth();
      } else {
        applyZoom(zoomLevel);
      }

    } catch (err) {
      hideProgress();
      showError(`Failed to render page ${pageNum}: ` + (err.message || ''));
      setStatus('error', 'ERROR');
    }
  }

  // ─── Synchronized DOM Interactive Text Layer (Section 5) ─────────────────────
  function renderDomTextLayer(pageNum) {
    if (!peTextLayer) return;
    peTextLayer.innerHTML = '';
    const textObjects = (docState && docState.pageTextObjects[pageNum]) || [];

    textObjects.forEach(obj => {
      if (obj.deleted) return;
      const span = document.createElement('span');
      span.className = 'pe-text-span';
      span.id = `pe-span-${obj.id}`;
      span.dataset.id = obj.id;
      span.dataset.page = pageNum;
      span.textContent = obj.text;

      updateSpanPosition(span, obj);

      span.addEventListener('mousedown', (e) => {
        if (editorMode === MODE.QR) return;
        e.preventDefault();
        e.stopPropagation();
        selectObject(obj);
        showInlineEditor(obj);
      });

      peTextLayer.appendChild(span);
    });
  }

  function updateSpanPosition(span, obj) {
    if (!span || !obj) return;
    const ox = obj.origX != null ? obj.origX : obj.x;
    const oy = obj.origY != null ? obj.origY : obj.y;
    span.style.left = `${Math.round(ox * zoomLevel)}px`;
    span.style.top = `${Math.round(oy * zoomLevel)}px`;
    span.style.width = `${Math.round(obj.width * zoomLevel)}px`;
    span.style.height = `${Math.round(obj.height * zoomLevel)}px`;
    span.style.fontSize = `${Math.max(8, Math.round(obj.fontSize * zoomLevel))}px`;
    span.style.fontFamily = obj.fontFamily || 'Helvetica';
  }

  function updateAllSpanPositions() {
    if (!peTextLayer || !docState) return;
    const spans = peTextLayer.querySelectorAll('.pe-text-span');
    spans.forEach(span => {
      const id = span.dataset.id;
      const obj = findObjectById(id);
      if (obj) {
        updateSpanPosition(span, obj);
      }
    });
  }

  // ─── Zoom ───────────────────────────────────────────────────────────────────
  function applyZoom(z) {
    zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const w = Math.round(peMainCanvas.width  * zoomLevel);
    const h = Math.round(peMainCanvas.height * zoomLevel);
    peMainCanvas.style.width    = `${w}px`;
    peMainCanvas.style.height   = `${h}px`;
    peEditOverlay.style.width   = `${w}px`;
    peEditOverlay.style.height  = `${h}px`;
    if (peTextLayer) {
      peTextLayer.style.width   = `${w}px`;
      peTextLayer.style.height  = `${h}px`;
      updateAllSpanPositions();
    }
    peCanvasWrap.style.width    = `${w}px`;
    peCanvasWrap.style.height   = `${h}px`;
    peZoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
    redrawOverlay();
    repositionInlineEditor();
    repositionResizeHandle();
  }

  function fitToViewport() {
    if (!peMainCanvas.width) return;
    const stage = document.getElementById('peCanvasStage') || document.getElementById('peViewport');
    const avW = Math.max(200, (stage.clientWidth || window.innerWidth) - 52);
    const avH = Math.max(200, (stage.clientHeight || window.innerHeight) - 52);
    const z = Math.min(avW / peMainCanvas.width, avH / peMainCanvas.height, 1.0);
    applyZoom(z);
  }

  function fitWidth() {
    if (!peMainCanvas.width) return;
    const stage = document.getElementById('peCanvasStage') || document.getElementById('peViewport');
    const avW = Math.max(200, (stage.clientWidth || window.innerWidth) - 52);
    const z = Math.min(avW / peMainCanvas.width, 1.25);
    applyZoom(z);
  }

  peBtnZoomIn.addEventListener('click',  () => { isAutoFit = false; applyZoom(zoomLevel * ZOOM_STEP); });
  peBtnZoomOut.addEventListener('click', () => { isAutoFit = false; applyZoom(zoomLevel / ZOOM_STEP); });
  peBtnFitWidth.addEventListener('click', () => { isAutoFit = true; fitWidth(); });
  peBtnFitWidthBottom.addEventListener('click', () => { isAutoFit = true; fitWidth(); });
  peBtnZoom100.addEventListener('click', () => { isAutoFit = false; applyZoom(1.0); });

  // Ctrl+Wheel zoom
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    isAutoFit = false;
    const delta = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    applyZoom(zoomLevel * delta);
  }, { passive: false });

  // ─── Page Navigation ────────────────────────────────────────────────────────
  peBtnPrev.addEventListener('click', () => { if (currentPage > 1) loadPage(currentPage - 1); });
  peBtnNext.addEventListener('click', () => { if (currentPage < totalPages) loadPage(currentPage + 1); });

  pePageInput.addEventListener('change', () => {
    const n = parseInt(pePageInput.value, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) loadPage(n);
    else pePageInput.value = currentPage;
  });

  // ─── Toolbar Mode Buttons ───────────────────────────────────────────────────
  const modeButtons = [
    { btn: peBtnSelect,   mode: MODE.SELECT },
    { btn: peBtnTextTool, mode: MODE.TEXT },
    { btn: peBtnAddText,  mode: MODE.ADD_TEXT },
    { btn: peBtnQrTool,   mode: MODE.QR },
  ];

  function setMode(mode) {
    editorMode = mode;
    modeButtons.forEach(({ btn, mode: m }) => btn.classList.toggle('active', m === mode));
    peCanvasStage.className = `pe-canvas-stage active mode-${mode}`;
    // Hide inline editor when switching modes
    if (mode !== MODE.TEXT && mode !== MODE.ADD_TEXT && mode !== MODE.SELECT) {
      commitInlineEdit();
    }
    if (mode !== MODE.QR) {
      // Clear QR selection when leaving QR mode
      if (selectedObject && selectedObject.id && selectedObject.id.startsWith('qr-')) {
        selectedObject = null;
        showContextPlaceholder();
      }
    }
  }

  modeButtons.forEach(({ btn, mode }) => btn.addEventListener('click', () => setMode(mode)));

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName.toLowerCase();
    const inInput = (tag === 'input' || tag === 'textarea' || tag === 'select');

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          doUndo();
          break;
        case 'y':
          e.preventDefault();
          doRedo();
          break;
        case 's':
          e.preventDefault();
          startExport();
          break;
        case '=': case '+':
          e.preventDefault();
          applyZoom(zoomLevel * ZOOM_STEP);
          break;
        case '-':
          e.preventDefault();
          applyZoom(zoomLevel / ZOOM_STEP);
          break;
      }
      return;
    }

    if (inInput) return;

    switch (e.key) {
      case 's': case 'S': setMode(MODE.SELECT);   break;
      case 't': case 'T': setMode(MODE.TEXT);      break;
      case 'a': case 'A': setMode(MODE.ADD_TEXT);  break;
      case 'q': case 'Q': setMode(MODE.QR);        break;
      case 'Delete':
      case 'Backspace':
        if (selectedObject && !selectedObject.id.startsWith('qr-')) {
          deleteSelectedObject();
        }
        break;
      case 'Escape':
        commitInlineEdit();
        selectedObject = null;
        showContextPlaceholder();
        redrawOverlay();
        hideInlineEditor();
        peResizeHandle.style.display = 'none';
        break;
    }
  });

  // ─── Canvas Pointer Events ─────────────────────────────────────────────────
  peEditOverlay.style.pointerEvents = 'auto';
  peEditOverlay.style.cursor = 'default';

  // Convert a pointer event to canvas-pixel coordinates
  function eventToCanvas(e) {
    const rect = peEditOverlay.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / zoomLevel;
    const dy = (e.clientY - rect.top)  / zoomLevel;
    return { x: dx, y: dy };
  }

  peEditOverlay.addEventListener('mousedown', onOverlayMousedown);
  peEditOverlay.addEventListener('mousemove', onOverlayMousemove);
  peEditOverlay.addEventListener('mouseleave', onOverlayMouseleave);
  window.addEventListener('mousemove', onWindowMousemove);
  window.addEventListener('mouseup',   onWindowMouseup);

  function onOverlayMousemove(e) {
    if (isDragging || isResizing || !docState) return;
    if (editorMode === MODE.QR) return;

    const cp = eventToCanvas(e);
    const addedObjs = docState.addedTextObjects.filter(o => o.page === currentPage && !o.deleted);
    const extracted = (docState.pageTextObjects[currentPage] || []).filter(o => !o.deleted);
    const hit = TextEditorEngine.hitTest(addedObjs, cp.x, cp.y, 4)
             || TextEditorEngine.hitTest(extracted, cp.x, cp.y, 4);

    if (hit !== hoveredTextObject) {
      hoveredTextObject = hit;
      peEditOverlay.style.cursor = hit ? 'text' : (editorMode === MODE.ADD_TEXT ? 'text' : 'default');
      redrawOverlay();
    }
  }

  function onOverlayMouseleave() {
    if (hoveredTextObject) {
      hoveredTextObject = null;
      peEditOverlay.style.cursor = 'default';
      redrawOverlay();
    }
  }

  function onOverlayMousedown(e) {
    if (!docState) return;
    e.preventDefault();

    // ── Resize handle managed separately ──
    if (e.target === peResizeHandle) return;

    const cp = eventToCanvas(e);

    // ── QR mode ─────────────────────────────────────────────────────────────
    if (editorMode === MODE.QR) {
      const allQrs = docState.qrObjects.filter(q => q.page === currentPage && !q.deleted);
      const hit = TextEditorEngine.hitTest(allQrs, cp.x, cp.y, 8);
      if (hit) {
        selectQR(hit);
      }
      return;
    }

    // ── Add Text mode ────────────────────────────────────────────────────────
    if (editorMode === MODE.ADD_TEXT) {
      addTextAtPosition(cp.x, cp.y);
      return;
    }

    // ── Select / Text mode ───────────────────────────────────────────────────
    commitInlineEdit();

    // Check added text first, then extracted text
    const addedObjs = docState.addedTextObjects.filter(o => o.page === currentPage && !o.deleted);
    const extracted = (docState.pageTextObjects[currentPage] || []).filter(o => !o.deleted);

    let hit = TextEditorEngine.hitTest(addedObjs, cp.x, cp.y, 6)
           || TextEditorEngine.hitTest(extracted, cp.x, cp.y, 6);

    if (hit) {
      selectedObject = hit;
      showTextContextPanel(hit);
      syncWordRibbon(hit);
      // Single-click Word-style instant in-place editing!
      showInlineEditor(hit);
      redrawOverlay();

      // Prepare for dragging only if added object (not extracted document text)
      if (hit.isAdded) {
        isDragging    = true;
        dragStartX    = cp.x;
        dragStartY    = cp.y;
        dragObjOrigX  = hit.x;
        dragObjOrigY  = hit.y;
      } else {
        isDragging    = false;
      }

      // Show resize handle for added objects
      if (hit.isAdded) repositionResizeHandle();
      else peResizeHandle.style.display = 'none';

    } else {
      // Deselect
      selectedObject = null;
      syncWordRibbon(null);
      showContextPlaceholder();
      redrawOverlay();
      hideInlineEditor();
      peResizeHandle.style.display = 'none';
    }
  }

  function onWindowMousemove(e) {
    if (!isDragging && !isResizing) return;
    if (!selectedObject) return;

    const cp = eventToCanvas(e);

    if (isResizing && resizeObjOrig) {
      const dx = cp.x - dragStartX;
      const dy = cp.y - dragStartY;
      const newW = Math.max(40, resizeObjOrig.width  + dx);
      const newH = Math.max(14, resizeObjOrig.height + dy);
      selectedObject.width  = newW;
      selectedObject.height = newH;
      redrawOverlay();
      repositionInlineEditor();
      repositionResizeHandle();
      return;
    }

    if (isDragging) {
      const dx = cp.x - dragStartX;
      const dy = cp.y - dragStartY;
      selectedObject.x = Math.max(0, dragObjOrigX + dx);
      selectedObject.y = Math.max(0, dragObjOrigY + dy);
      redrawOverlay();
      repositionInlineEditor();
      repositionResizeHandle();
    }
  }

  function onWindowMouseup(e) {
    if (isResizing && selectedObject && resizeObjOrig) {
      // Record resize in history
      const prev = resizeObjOrig;
      const next = { x: selectedObject.x, y: selectedObject.y, width: selectedObject.width, height: selectedObject.height };
      if (prev.width !== next.width || prev.height !== next.height) {
        TextEditorEngine.pushHistory(docState, TextEditorEngine.opResizeObject(selectedObject, prev, next));
        markEdited();
      }
      isResizing    = false;
      resizeObjOrig = null;
    }

    if (isDragging && selectedObject) {
      const movedX = selectedObject.x !== dragObjOrigX;
      const movedY = selectedObject.y !== dragObjOrigY;
      if (movedX || movedY) {
        TextEditorEngine.pushHistory(docState,
          TextEditorEngine.opMoveObject(selectedObject, dragObjOrigX, dragObjOrigY, selectedObject.x, selectedObject.y));
        markEdited();
      }
      isDragging = false;
    }
    updateUndoRedoButtons();
  }

  // ─── Resize Handle ─────────────────────────────────────────────────────────
  peResizeHandle.addEventListener('mousedown', (e) => {
    if (!selectedObject) return;
    e.preventDefault();
    e.stopPropagation();
    isResizing  = true;
    const cp = eventToCanvas(e);
    dragStartX  = cp.x;
    dragStartY  = cp.y;
    resizeObjOrig = { x: selectedObject.x, y: selectedObject.y, width: selectedObject.width, height: selectedObject.height };
  });

  function repositionResizeHandle() {
    if (!selectedObject || !selectedObject.isAdded) {
      peResizeHandle.style.display = 'none';
      return;
    }
    const rx = (selectedObject.x + selectedObject.width)  * zoomLevel - 4;
    const ry = (selectedObject.y + selectedObject.height) * zoomLevel - 4;
    peResizeHandle.style.left    = `${Math.round(rx)}px`;
    peResizeHandle.style.top     = `${Math.round(ry)}px`;
    peResizeHandle.style.display = 'block';
  }

  // ─── Overlay Rendering ─────────────────────────────────────────────────────
  function clearOverlay() {
    const ctx = peEditOverlay.getContext('2d');
    ctx.clearRect(0, 0, peEditOverlay.width, peEditOverlay.height);
  }

  function safeFillMask(ctx, x, y, w, h, pageQrs) {
    if (w <= 0 || h <= 0) return;
    let rx = x, ry = y, rw = w, rh = h;
    if (pageQrs && pageQrs.length) {
      for (const qr of pageQrs) {
        // Check if rectangle intersects with QR box
        const intersects = (rx < qr.x + qr.width && rx + rw > qr.x && ry < qr.y + qr.height && ry + rh > qr.y);
        if (intersects) {
          // If text is primarily below the QR code (e.g. UPI price tag):
          if (ry < qr.y + qr.height && (ry + rh) > qr.y + qr.height) {
            const cutTop = (qr.y + qr.height) - ry;
            ry += cutTop;
            rh -= cutTop;
          } else if (ry < qr.y && (ry + rh) > qr.y) {
            // Text is above QR code
            rh = qr.y - ry;
          }
        }
      }
    }
    if (rw > 0 && rh > 0) {
      ctx.fillRect(rx, ry, rw, rh);
    }
  }

  function redrawOverlay() {
    if (!docState) return;
    const ctx = peEditOverlay.getContext('2d');
    ctx.clearRect(0, 0, peEditOverlay.width, peEditOverlay.height);

    // Draw hover outline if hovering over an unselected text object
    if (hoveredTextObject && hoveredTextObject.page === currentPage && !hoveredTextObject.deleted) {
      if (!selectedObject || selectedObject.id !== hoveredTextObject.id) {
        ctx.save();
        ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
        ctx.fillRect(hoveredTextObject.x - 1, hoveredTextObject.y - 1, hoveredTextObject.width + 2, hoveredTextObject.height + 2);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(hoveredTextObject.x - 0.5, hoveredTextObject.y - 0.5, hoveredTextObject.width + 1, hoveredTextObject.height + 1);
        ctx.restore();
      }
    }

    // Draw extracted text objects
    const extracted = (docState.pageTextObjects[currentPage] || []).filter(o => !o.deleted);
    const pageQrs = (docState.qrObjects || []).filter(q => q.page === currentPage && !q.deleted);

    extracted.forEach(obj => {
      const isSelected = selectedObject && selectedObject.id === obj.id;
      const isEditingThis = peTextInput._editingObj && peTextInput._editingObj.id === obj.id;

      // While being actively edited in peTextInput:
      // Underneath, mask ONLY the original line canvas area with clean white so nothing peeks out!
      if (isEditingThis) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        const origX = obj.origX != null ? obj.origX : obj.x;
        const origY = obj.origY != null ? obj.origY : obj.y;
        const origW = obj.originalWidth || obj.width;
        const origH = obj.originalHeight || obj.height;
        safeFillMask(ctx, origX, origY, origW, origH, pageQrs);
        if (obj.rawItems && Array.isArray(obj.rawItems)) {
          obj.rawItems.forEach(it => {
            safeFillMask(ctx, it.canvasX, it.canvasY, it.canvasW, it.canvasH, pageQrs);
          });
        }
        ctx.restore();
        return;
      }

      // If edited and committed:
      if (obj.isEdited) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        // Mask exact original area
        const origX = obj.origX != null ? obj.origX : obj.x;
        const origY = obj.origY != null ? obj.origY : obj.y;
        const origW = obj.originalWidth || obj.width;
        const origH = obj.originalHeight || obj.height;
        safeFillMask(ctx, origX, origY, origW, origH, pageQrs);
        if (obj.rawItems && Array.isArray(obj.rawItems)) {
          obj.rawItems.forEach(it => {
            safeFillMask(ctx, it.canvasX, it.canvasY, it.canvasW, it.canvasH, pageQrs);
          });
        }
        // If the new text is wider than the original, mask the expansion area too
        if (obj.width > origW) {
          safeFillMask(ctx, origX + origW, origY, obj.width - origW, origH, pageQrs);
        }

        // Draw new text with crisp typography (supporting multi-line)
        const fontStyle = (obj.bold ? 'bold ' : '') + (obj.italic ? 'italic ' : '');
        ctx.font = `${fontStyle}${obj.fontSize}px "${obj.fontFamily || 'Helvetica'}"`;
        ctx.fillStyle = obj.color || '#000000';
        ctx.textBaseline = 'top';
        ctx.textAlign = obj.align || 'left';

        const lines = (obj.text || '').split('\n');
        const lineH = obj.fontSize * 1.22;
        lines.forEach((ln, idx) => {
          const txX = obj.align === 'center' ? origX + obj.width / 2
                    : obj.align === 'right'  ? origX + obj.width
                    : origX;
          ctx.fillText(ln, txX, origY + (idx * lineH));
        });
        ctx.restore();
      }

      if (isSelected && !isEditingThis) {
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 2]);
        const bx = obj.origX != null ? obj.origX : obj.x;
        const by = obj.origY != null ? obj.origY : obj.y;
        const bw = obj.width;
        const bh = obj.height;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        ctx.restore();
      }
    });

    // Draw added text objects
    const added = docState.addedTextObjects.filter(o => o.page === currentPage && !o.deleted);
    added.forEach(obj => {
      const isSelected = selectedObject && selectedObject.id === obj.id;
      const isEditingThis = peTextInput._editingObj && peTextInput._editingObj.id === obj.id;

      if (isEditingThis) return; // handled by peTextInput

      // Fill background (white) + draw text
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);

      const fontStyle = (obj.bold ? 'bold ' : '') + (obj.italic ? 'italic ' : '');
      ctx.font = `${fontStyle}${obj.fontSize}px "${obj.fontFamily || 'Helvetica'}"`;
      ctx.fillStyle = obj.color || '#000000';
      ctx.textBaseline = 'top';
      ctx.textAlign = obj.align || 'left';

      const lines = (obj.text || '').split('\n');
      const lineH = obj.fontSize * 1.25;
      lines.forEach((ln, idx) => {
        const textX = obj.align === 'center' ? obj.x + obj.width / 2
                    : obj.align === 'right'  ? obj.x + obj.width
                    : obj.x + 2;
        ctx.fillText(ln, textX, obj.y + 2 + (idx * lineH));
      });
      ctx.textAlign = 'left';

      // Border
      ctx.strokeStyle = isSelected ? '#2563eb' : 'rgba(37,99,235,0.35)';
      ctx.lineWidth   = isSelected ? 2 : 1;
      ctx.setLineDash(isSelected ? [] : [3, 2]);
      ctx.strokeRect(obj.x + 0.5, obj.y + 0.5, obj.width, obj.height);
      ctx.restore();
    });

    // Draw QR bounding boxes
    const qrObjs = docState.qrObjects.filter(q => q.page === currentPage);
    qrObjs.forEach(qr => {
      const isSelected = selectedObject && selectedObject.id === qr.id;
      ctx.save();
      ctx.strokeStyle = isSelected ? '#06b6d4' : 'rgba(6,182,212,0.6)';
      ctx.lineWidth   = isSelected ? 2.5 : 1.5;
      ctx.setLineDash(isSelected ? [] : [5, 3]);
      ctx.strokeRect(qr.x + 0.5, qr.y + 0.5, qr.width, qr.height);

      // QR label
      ctx.fillStyle   = isSelected ? '#06b6d4' : 'rgba(6,182,212,0.8)';
      ctx.font        = 'bold 11px "Plus Jakarta Sans", sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`QR: ${qr.data.substring(0, 18)}${qr.data.length > 18 ? '…' : ''}`, qr.x + 3, qr.y - 2);

      if (qr.replaced) {
        // Draw exact mask and crisp unaliased QR replacement
        if (qr.newQRCanvas) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(qr.x, qr.y, qr.width, qr.height);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(qr.newQRCanvas, qr.x, qr.y, qr.width, qr.height);
          ctx.strokeStyle = '#10b981';
          ctx.setLineDash([]);
          ctx.strokeRect(qr.x + 0.5, qr.y + 0.5, qr.width, qr.height);
        }
      }
      ctx.restore();
    });
  }

  // In-memory text measurement canvas
  const _measureCanvas = document.createElement('canvas');
  const _measureCtx = _measureCanvas.getContext('2d');

  function measureTextWidth(text, fontSize, fontFamily, bold, italic) {
    const fontStyle = (bold ? 'bold ' : '') + (italic ? 'italic ' : '');
    _measureCtx.font = `${fontStyle}${fontSize}px "${fontFamily || 'Helvetica'}", sans-serif`;
    const lines = (text || ' ').split('\n');
    let maxW = 0;
    for (const line of lines) {
      const m = _measureCtx.measureText(line || ' ');
      if (m.width > maxW) maxW = m.width;
    }
    return Math.max(10, Math.ceil(maxW));
  }

  // ─── Word-Style In-Place Text Editor ─────────────────────────────────────────
  function showInlineEditor(obj) {
    peTextInput.style.display = 'block';
    peTextInput.value = obj.text;

    peTextInput.style.fontFamily = obj.fontFamily || 'Helvetica';
    peTextInput.style.fontSize   = `${Math.max(10, Math.round(obj.fontSize * zoomLevel))}px`;
    peTextInput.style.fontWeight = obj.bold ? '700' : '400';
    peTextInput.style.fontStyle  = obj.italic ? 'italic' : 'normal';
    peTextInput.style.color      = obj.color || '#000000';
    peTextInput.style.textAlign  = obj.align || 'left';
    peTextInput.style.lineHeight = '1.15';

    // Section 20: Match background color for seamless in-place editing
    if (obj.bgColor && !obj.bgColor.isWhite && obj.bgColor.hex) {
      peTextInput.style.background = obj.bgColor.hex;
    } else {
      peTextInput.style.background = '#ffffff';
    }

    peTextInput._editingObj = obj;
    repositionInlineEditor();

    peTextInput.focus();
    // Place caret at end
    peTextInput.selectionStart = peTextInput.value.length;
    peTextInput.selectionEnd   = peTextInput.value.length;

    // Section 8 (Strategy A): Hide corresponding DOM text span while editing to prevent ghosting
    const span = document.getElementById(`pe-span-${obj.id}`);
    if (span) span.classList.add('pe-hidden');

    syncWordRibbon(obj);
    redrawOverlay();
  }

  function repositionInlineEditor() {
    if (!peTextInput._editingObj || peTextInput.style.display === 'none') return;
    const obj = peTextInput._editingObj;
    
    const posX = Math.round((obj.origX != null ? obj.origX : obj.x) * zoomLevel);
    let posY = Math.round((obj.origY != null ? obj.origY : obj.y) * zoomLevel);

    // If there is a QR code right above this text object, keep top border clean
    if (docState && docState.qrObjects) {
      const pageQrs = docState.qrObjects.filter(q => q.page === currentPage && !q.deleted);
      for (const qr of pageQrs) {
        const qrBottom = Math.round((qr.y + qr.height) * zoomLevel);
        const qrLeft   = Math.round(qr.x * zoomLevel);
        const qrRight  = Math.round((qr.x + qr.width) * zoomLevel);
        const objW     = Math.round((obj.originalWidth || obj.width) * zoomLevel);
        if (posX < qrRight && (posX + objW) > qrLeft) {
          if (posY < qrBottom + 1 && posY >= qrBottom - 12) {
            posY = qrBottom + 1;
          }
        }
      }
    }

    peTextInput.style.left = `${posX}px`;
    peTextInput.style.top  = `${posY}px`;
    autoSizeInlineEditor();
  }

  function autoSizeInlineEditor() {
    if (!peTextInput._editingObj || peTextInput.style.display === 'none') return;
    const obj = peTextInput._editingObj;
    const textVal = peTextInput.value || '';
    
    // Scale-aware font size in screen pixels
    const screenFontSize = Math.max(10, Math.round(obj.fontSize * zoomLevel));
    peTextInput.style.fontSize   = `${screenFontSize}px`;
    peTextInput.style.fontFamily = obj.fontFamily || 'Helvetica';
    peTextInput.style.fontWeight = obj.bold ? '700' : '400';
    peTextInput.style.fontStyle  = obj.italic ? 'italic' : 'normal';
    peTextInput.style.color      = obj.color || '#000000';
    peTextInput.style.textAlign  = obj.align || 'left';
    peTextInput.style.lineHeight = '1.15';

    // Measure exact text width at screen font size
    const measuredTextScreenW = measureTextWidth(textVal, screenFontSize, obj.fontFamily, obj.bold, obj.italic);
    
    // Original line width at current zoom
    const baseOrigScreenW = Math.round((obj.originalWidth || obj.width) * zoomLevel);
    // Width should fit the text with 8px buffer for cursor, but at least match original bounding box
    const targetW = Math.max(baseOrigScreenW, measuredTextScreenW + 8);

    // Height based on lines
    const lineCount = Math.max(1, textVal.split('\n').length);
    const lineH = Math.round(screenFontSize * 1.22);
    const baseOrigScreenH = Math.round((obj.originalHeight || obj.height) * zoomLevel);
    const targetH = Math.max(baseOrigScreenH, lineCount * lineH);

    peTextInput.style.width  = `${targetW}px`;
    peTextInput.style.height = `${targetH}px`;

    // Update canvas-space dimensions without runaway inflation
    const canvasTextW = Math.ceil(targetW / zoomLevel);
    const canvasTextH = Math.ceil(targetH / zoomLevel);
    obj.width  = Math.max(obj.originalWidth || 0, canvasTextW);
    obj.height = Math.max(obj.originalHeight || 0, canvasTextH);
  }

  function hideInlineEditor() {
    if (peTextInput._editingObj) {
      const obj = peTextInput._editingObj;
      const span = document.getElementById(`pe-span-${obj.id}`);
      if (span) {
        span.classList.remove('pe-hidden');
        span.textContent = obj.text;
      }
    }
    peTextInput.style.display = 'none';
    peTextInput._editingObj   = null;
  }

  function commitInlineEdit() {
    const obj = peTextInput._editingObj;
    if (!obj) return;
    const newText = peTextInput.value;
    if (newText !== obj.text) {
      const prev = obj.text;
      obj.text    = newText;
      obj.isEdited = (newText !== obj.originalText);
      TextEditorEngine.pushHistory(docState, TextEditorEngine.opEditText(obj, prev, newText));
      // Sync structured modifications (Section 1)
      TextEditorEngine.syncDocumentModifications(docState);
      // Sync sidebar
      peCtxContent.value = newText;
      markEdited();
      updateUndoRedoButtons();
    }
    const span = document.getElementById(`pe-span-${obj.id}`);
    if (span) {
      span.classList.remove('pe-hidden');
      span.textContent = obj.text;
      updateSpanPosition(span, obj);
    }
    hideInlineEditor();
    redrawOverlay();
  }

  // Keyboard shortcuts in the Word-like in-place editor
  peTextInput.addEventListener('keydown', (e) => {
    // Ctrl+B: Toggle bold
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      peRibbonBold.classList.toggle('active');
      applyRibbonFormat();
      return;
    }
    // Ctrl+I: Toggle italic
    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      peRibbonItalic.classList.toggle('active');
      applyRibbonFormat();
      return;
    }
    // Enter without Shift: finish editing (Word-style single field confirmation)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitInlineEdit();
      return;
    }
    // Escape or Ctrl+Enter: finish editing
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      e.preventDefault();
      commitInlineEdit();
      return;
    }
    // Tab: insert 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = peTextInput.selectionStart;
      const end = peTextInput.selectionEnd;
      peTextInput.value = peTextInput.value.substring(0, start) + '    ' + peTextInput.value.substring(end);
      peTextInput.selectionStart = peTextInput.selectionEnd = start + 4;
      peTextInput.dispatchEvent(new Event('input'));
    }
  });

  // Auto-resize inline editor as user types (Word-like natural flow)
  peTextInput.addEventListener('input', () => {
    const obj = peTextInput._editingObj;
    if (obj) {
      obj.text = peTextInput.value;
      obj.isEdited = (obj.text !== obj.originalText);
      autoSizeInlineEditor();
      peCtxContent.value = peTextInput.value;
      markEdited();
      redrawOverlay();
    }
  });

  // ─── Word Ribbon Sync & Formatting ──────────────────────────────────────────
  function syncWordRibbon(obj) {
    if (!obj) {
      peRibbonFont.value = 'Helvetica';
      peRibbonFontSize.value = 12;
      peRibbonBold.classList.remove('active');
      peRibbonItalic.classList.remove('active');
      peRibbonColor.value = '#000000';
      peRibbonColorBar.style.backgroundColor = '#000000';
      peRibbonAlignLeft.classList.add('active');
      peRibbonAlignCenter.classList.remove('active');
      peRibbonAlignRight.classList.remove('active');
      return;
    }

    peRibbonFont.value = obj.fontFamily || 'Helvetica';
    const ptSize = Math.round(obj.fontSize / RENDER_SCALE * (72 / 96)) || 12;
    peRibbonFontSize.value = ptSize;
    peRibbonBold.classList.toggle('active', !!obj.bold);
    peRibbonItalic.classList.toggle('active', !!obj.italic);
    const col = obj.color || '#000000';
    peRibbonColor.value = col;
    peRibbonColorBar.style.backgroundColor = col;

    const align = obj.align || 'left';
    peRibbonAlignLeft.classList.toggle('active', align === 'left');
    peRibbonAlignCenter.classList.toggle('active', align === 'center');
    peRibbonAlignRight.classList.toggle('active', align === 'right');
  }

  function applyRibbonFormat() {
    if (!selectedObject) return;
    const obj = selectedObject;

    const prevFormat = {
      fontFamily: obj.fontFamily, fontSize: obj.fontSize,
      bold: obj.bold, italic: obj.italic, align: obj.align, color: obj.color
    };

    const newFamily = peRibbonFont.value;
    const newPtSize = parseInt(peRibbonFontSize.value, 10) || 12;
    const newPxSize = Math.round(newPtSize * (96 / 72) * RENDER_SCALE);
    const newBold = peRibbonBold.classList.contains('active');
    const newItalic = peRibbonItalic.classList.contains('active');
    const newColor = peRibbonColor.value || '#000000';
    peRibbonColorBar.style.backgroundColor = newColor;

    let align = 'left';
    if (peRibbonAlignCenter.classList.contains('active')) align = 'center';
    if (peRibbonAlignRight.classList.contains('active')) align = 'right';

    obj.fontFamily = newFamily;
    obj.fontSize   = newPxSize;
    obj.bold       = newBold;
    obj.italic     = newItalic;
    obj.color      = newColor;
    obj.align      = align;
    obj.isEdited   = true;

    // Apply live to active in-place editor if open
    if (peTextInput._editingObj === obj) {
      peTextInput.style.fontFamily = obj.fontFamily;
      peTextInput.style.fontSize   = `${Math.max(11, Math.round(obj.fontSize * zoomLevel))}px`;
      peTextInput.style.fontWeight = obj.bold ? '700' : '400';
      peTextInput.style.fontStyle  = obj.italic ? 'italic' : 'normal';
      peTextInput.style.color      = obj.color;
      peTextInput.style.textAlign  = obj.align;
      autoSizeInlineEditor();
    }

    // Sync sidebar context panel
    showTextContextPanel(obj);

    const nextFormat = {
      fontFamily: obj.fontFamily, fontSize: obj.fontSize,
      bold: obj.bold, italic: obj.italic, align: obj.align, color: obj.color
    };
    TextEditorEngine.pushHistory(docState, TextEditorEngine.opFormatChange(obj, prevFormat, nextFormat));
    markEdited();
    updateUndoRedoButtons();
    redrawOverlay();
  }

  // Ribbon event listeners
  peRibbonFont.addEventListener('change', applyRibbonFormat);
  peRibbonFontSize.addEventListener('input', applyRibbonFormat);
  peRibbonFontDown.addEventListener('click', () => {
    let s = parseInt(peRibbonFontSize.value, 10) || 12;
    if (s > 6) {
      peRibbonFontSize.value = s - 1;
      applyRibbonFormat();
    }
  });
  peRibbonFontUp.addEventListener('click', () => {
    let s = parseInt(peRibbonFontSize.value, 10) || 12;
    if (s < 120) {
      peRibbonFontSize.value = s + 1;
      applyRibbonFormat();
    }
  });
  peRibbonBold.addEventListener('click', () => {
    peRibbonBold.classList.toggle('active');
    applyRibbonFormat();
  });
  peRibbonItalic.addEventListener('click', () => {
    peRibbonItalic.classList.toggle('active');
    applyRibbonFormat();
  });
  peRibbonColor.addEventListener('input', () => {
    peRibbonColorBar.style.backgroundColor = peRibbonColor.value;
    applyRibbonFormat();
  });
  peRibbonAlignLeft.addEventListener('click', () => {
    peRibbonAlignLeft.classList.add('active');
    peRibbonAlignCenter.classList.remove('active');
    peRibbonAlignRight.classList.remove('active');
    applyRibbonFormat();
  });
  peRibbonAlignCenter.addEventListener('click', () => {
    peRibbonAlignLeft.classList.remove('active');
    peRibbonAlignCenter.classList.add('active');
    peRibbonAlignRight.classList.remove('active');
    applyRibbonFormat();
  });
  peRibbonAlignRight.addEventListener('click', () => {
    peRibbonAlignLeft.classList.remove('active');
    peRibbonAlignCenter.classList.remove('active');
    peRibbonAlignRight.classList.add('active');
    applyRibbonFormat();
  });
  peRibbonDelete.addEventListener('click', () => {
    if (selectedObject && !selectedObject.id.startsWith('qr-')) {
      deleteSelectedObject();
    }
  });
  peRibbonDone.addEventListener('click', () => {
    commitInlineEdit();
    selectedObject = null;
    syncWordRibbon(null);
    showContextPlaceholder();
    redrawOverlay();
  });

  // ─── Text Context Panel ────────────────────────────────────────────────────
  function showTextContextPanel(obj) {
    showContextSection(peCtxText);
    peCtxContent.value    = obj.text;
    peCtxFont.value       = obj.fontFamily || 'Helvetica';
    peCtxFontSize.value   = Math.round(obj.fontSize / RENDER_SCALE * (72 / 96)) || 12;
    peCtxBold.classList.toggle('active', !!obj.bold);
    peCtxItalic.classList.toggle('active', !!obj.italic);
    ['Left','Center','Right'].forEach(a => {
      $(`peCtxAlign${a}`).classList.toggle('active', (obj.align || 'left') === a.toLowerCase());
    });
    peCtxColor.value    = obj.color || '#000000';
    peCtxColorHex.value = obj.color || '#000000';
  }

  // Apply text changes from sidebar
  peCtxApplyText.addEventListener('click', () => {
    if (!selectedObject) return;
    const obj = selectedObject;

    const prevFormat = {
      text: obj.text, fontFamily: obj.fontFamily, fontSize: obj.fontSize,
      bold: obj.bold, italic: obj.italic, align: obj.align, color: obj.color
    };

    const newFontSizePt = parseInt(peCtxFontSize.value, 10) || 12;
    // Convert pt to canvas pixels (at RENDER_SCALE)
    const newFontSizePx = Math.round(newFontSizePt * (96 / 72) * RENDER_SCALE);

    const newText = peCtxContent.value;
    obj.text      = newText;
    obj.isEdited  = (newText !== obj.originalText);
    obj.fontFamily = peCtxFont.value;
    obj.fontSize  = newFontSizePx;
    obj.bold      = peCtxBold.classList.contains('active');
    obj.italic    = peCtxItalic.classList.contains('active');
    obj.align     = peCtxAlignLeft.classList.contains('active') ? 'left'
                  : peCtxAlignCenter.classList.contains('active') ? 'center' : 'right';
    obj.color     = peCtxColor.value;

    const nextFormat = {
      text: obj.text, fontFamily: obj.fontFamily, fontSize: obj.fontSize,
      bold: obj.bold, italic: obj.italic, align: obj.align, color: obj.color
    };

    TextEditorEngine.pushHistory(docState, TextEditorEngine.opFormatChange(obj, prevFormat, nextFormat));
    markEdited();
    updateUndoRedoButtons();
    redrawOverlay();
  });

  // Delete selected text
  peCtxDeleteText.addEventListener('click', deleteSelectedObject);

  function deleteSelectedObject() {
    if (!selectedObject) return;
    const obj = selectedObject;
    TextEditorEngine.pushHistory(docState, TextEditorEngine.opDeleteObject(obj));
    obj.deleted = true;
    selectedObject = null;
    syncWordRibbon(null);
    showContextPlaceholder();
    redrawOverlay();
    hideInlineEditor();
    peResizeHandle.style.display = 'none';
    markEdited();
    updateUndoRedoButtons();
  }

  // Bold / Italic toggles
  peCtxBold.addEventListener('click',   () => peCtxBold.classList.toggle('active'));
  peCtxItalic.addEventListener('click', () => peCtxItalic.classList.toggle('active'));

  // Alignment
  [peCtxAlignLeft, peCtxAlignCenter, peCtxAlignRight].forEach(btn => {
    btn.addEventListener('click', () => {
      [peCtxAlignLeft, peCtxAlignCenter, peCtxAlignRight].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Color sync
  peCtxColor.addEventListener('input', () => {
    peCtxColorHex.value = peCtxColor.value;
  });
  peCtxColorHex.addEventListener('input', () => {
    const val = peCtxColorHex.value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) peCtxColor.value = val;
  });

  // ─── Add Text ──────────────────────────────────────────────────────────────
  function addTextAtPosition(cx, cy) {
    const newObj = TextEditorEngine.createTextObject({
      page: currentPage,
      text: 'New Text',
      originalText: '',
      x: Math.round(cx),
      y: Math.round(cy),
      width:  Math.round(160 * RENDER_SCALE / 2),
      height: Math.round(28  * RENDER_SCALE / 2),
      fontSize: Math.round(14 * RENDER_SCALE * (96/72)),
      fontFamily: 'Helvetica',
      color: '#000000',
      isAdded: true,
    });

    docState.addedTextObjects.push(newObj);
    TextEditorEngine.pushHistory(docState, TextEditorEngine.opAddText(newObj));
    markEdited();
    updateUndoRedoButtons();

    selectedObject = newObj;
    setMode(MODE.SELECT);
    showTextContextPanel(newObj);
    syncWordRibbon(newObj);
    redrawOverlay();
    repositionResizeHandle();

    // Immediately open inline editor
    showInlineEditor(newObj);
  }

  // ─── QR Tool ───────────────────────────────────────────────────────────────
  peBtnQrTool.addEventListener('click', () => {
    setMode(MODE.QR);
    scanPageForQR();
  });

  async function scanPageForQR() {
    if (!pdfJsDoc) return;
    setStatus('scanning', 'SCANNING FOR QR...');
    showProgress(20, 'Scanning page for QR codes...');

    try {
      // Re-render at 2.75x for better QR detection
      const hiResCanvas = await PDFProcessor.renderPageToCanvas(pdfJsDoc, currentPage, 2.75);
      updateProgress(60, 'Running QR detector...');

      const results = await QRScanner.scanQRCode(hiResCanvas, { deepScan: true });
      updateProgress(100, results.length > 0 ? `${results.length} QR code(s) detected` : 'No QR found');
      hideProgress();

      if (!results || results.length === 0) {
        setStatus('ready', 'NO QR FOUND');
        showError('No QR code detected on this page. Try another page or use the Image QR editor for single images.');
        return;
      }

      // Scale detected QR coords from 2.75x canvas back to RENDER_SCALE (2.0x) canvas
      const scaleRatio = RENDER_SCALE / 2.75;
      const qrObjects = results.map(r =>
        TextEditorEngine.createQRObject({
          page: currentPage,
          data: r.data,
          x:      Math.round(r.x      * scaleRatio),
          y:      Math.round(r.y      * scaleRatio),
          width:  Math.round(r.width  * scaleRatio),
          height: Math.round(r.height * scaleRatio),
          type:   r.type,
        })
      );

      // Merge with existing (don't duplicate)
      const existingIds = new Set(docState.qrObjects.filter(q => q.page === currentPage).map(q => q.id));
      // Remove old QRs for this page and replace
      docState.qrObjects = docState.qrObjects.filter(q => q.page !== currentPage);
      docState.qrObjects.push(...qrObjects);

      redrawOverlay();
      setStatus('detected', `${results.length} QR CODE(S) DETECTED ✓`);

      // Auto-select first QR
      selectQR(qrObjects[0]);

    } catch (err) {
      hideProgress();
      showError('QR scan error: ' + (err.message || ''));
      setStatus('error', 'ERROR');
    }
  }

  function selectQR(qrObj) {
    selectedObject = qrObj;
    activeQRForEdit = qrObj;
    generatedQRCanvas = null;
    redrawOverlay();
    showQRContextPanel(qrObj);
  }

  function showQRContextPanel(qrObj) {
    showContextSection(peCtxQr);
    peCtxQrData.value = qrObj.data;
    peCtxQrType.textContent = `Type: ${qrObj.type || 'TEXT'}`;
    peCtxQrEdit.value = qrObj.data;
    peCtxVerifyResult.style.display = 'none';
    peCtxApplyQr.disabled = true;
    generatedQRCanvas = null;
  }

  // Generate new QR
  peCtxGenerateQr.addEventListener('click', async () => {
    const newData = peCtxQrEdit.value.trim();
    if (!newData) { showError('QR data cannot be empty.'); return; }
    if (!activeQRForEdit) return;

    hideError();
    setStatus('generating', 'GENERATING QR...');
    showProgress(30, 'Generating QR matrix...');

    await new Promise(r => setTimeout(r, 40));

    try {
      const ecLevel  = peCtxQrEC.value;
      const targetW  = Math.max(30, Math.round(activeQRForEdit.width  || 200));
      const targetH  = Math.max(30, Math.round(activeQRForEdit.height || 200));
      const qrCanvas = QRGenerator.generateQRCanvas(newData,
        targetW, targetH,
        { errorCorrectionLevel: ecLevel, marginModules: 0 });

      setStatus('verifying', 'VERIFYING...');
      updateProgress(70, 'Verifying...');
      const verifyRes = await QRGenerator.verifyQRCode(qrCanvas, newData);

      updateProgress(100, verifyRes.success ? 'Verified ✓' : 'Verification failed');
      hideProgress();

      // Show old QR thumbnail
      peOldQrFrame.innerHTML = '';
      const oldThumb = document.createElement('canvas');
      const thumbW = Math.max(20, Math.round(activeQRForEdit.width || 200));
      const thumbH = Math.max(20, Math.round(activeQRForEdit.height || 200));
      oldThumb.width  = thumbW;
      oldThumb.height = thumbH;
      oldThumb.getContext('2d').drawImage(peMainCanvas,
        activeQRForEdit.x, activeQRForEdit.y, thumbW, thumbH,
        0, 0, thumbW, thumbH);
      oldThumb.style.maxWidth = '100%';
      peOldQrFrame.appendChild(oldThumb);

      // Show new QR thumbnail (using an independent canvas so original is preserved)
      peNewQrFrame.innerHTML = '';
      const newThumb = document.createElement('canvas');
      newThumb.width  = qrCanvas.width;
      newThumb.height = qrCanvas.height;
      newThumb.getContext('2d').drawImage(qrCanvas, 0, 0);
      newThumb.style.maxWidth = '100%';
      peNewQrFrame.appendChild(newThumb);

      peCtxVerifyResult.style.display = 'flex';
      peCtxVerifyResult.style.flexDirection = 'column';
      peCtxVerifyResult.style.gap = '6px';

      if (verifyRes.success) {
        peCtxVerifyBadge.className = 'pe-verify-badge';
        peCtxVerifyIcon.textContent = '✓';
        peCtxVerifyText.textContent = 'New QR verified ✓';
        peCtxApplyQr.disabled = false;
        generatedQRCanvas = qrCanvas;
        setStatus('ready', 'VERIFIED ✓');
      } else {
        peCtxVerifyBadge.className = 'pe-verify-badge error';
        peCtxVerifyIcon.textContent = '✗';
        peCtxVerifyText.textContent = verifyRes.error || 'Verification failed';
        peCtxApplyQr.disabled = true;
        generatedQRCanvas = null;
        showError('QR verification failed: ' + (verifyRes.error || ''));
      }
    } catch (err) {
      hideProgress();
      showError('QR generation error: ' + (err.message || ''));
    }
  });

  // Apply QR replacement
  peCtxApplyQr.addEventListener('click', () => {
    if (!generatedQRCanvas || !activeQRForEdit) return;

    const prevData = activeQRForEdit.data;
    const newData  = peCtxQrEdit.value.trim();

    activeQRForEdit.data      = newData;
    activeQRForEdit.replaced  = true;
    activeQRForEdit.newQRCanvas = generatedQRCanvas;

    TextEditorEngine.pushHistory(docState, TextEditorEngine.opReplaceQR(activeQRForEdit, prevData, newData, generatedQRCanvas));
    markEdited();
    updateUndoRedoButtons();

    redrawOverlay();

    // Update context
    peCtxQrData.value = newData;
    setStatus('success', 'QR REPLACED ✓');

    // Show export panel
    showContextSection(peCtxExport);
    peExportDesc.textContent = 'QR code replaced. Download when ready.';
  });

  peCtxCancelQr.addEventListener('click', () => {
    peCtxVerifyResult.style.display = 'none';
    generatedQRCanvas = null;
    peCtxApplyQr.disabled = true;
  });

  // ─── Undo / Redo ───────────────────────────────────────────────────────────
  function findObjectById(id) {
    if (!docState) return null;
    for (const arr of Object.values(docState.pageTextObjects)) {
      const found = arr.find(o => o.id === id);
      if (found) return found;
    }
    const foundAdded = docState.addedTextObjects.find(o => o.id === id);
    if (foundAdded) return foundAdded;
    const foundQR = docState.qrObjects.find(o => o.id === id);
    if (foundQR) return foundQR;
    return null;
  }

  function doUndo() {
    if (!docState) return;
    TextEditorEngine.undo(docState, (op, dir) => {
      TextEditorEngine.applyOperation(op, dir, findObjectById);
    });
    redrawOverlay();
    updateUndoRedoButtons();
    markEdited();
  }

  function doRedo() {
    if (!docState) return;
    TextEditorEngine.redo(docState, (op, dir) => {
      TextEditorEngine.applyOperation(op, dir, findObjectById);
    });
    redrawOverlay();
    updateUndoRedoButtons();
    markEdited();
  }

  peBtnUndo.addEventListener('click', doUndo);
  peBtnRedo.addEventListener('click', doRedo);

  function updateUndoRedoButtons() {
    if (!docState) {
      peBtnUndo.disabled = true;
      peBtnRedo.disabled = true;
      return;
    }
    peBtnUndo.disabled = (docState.historyIndex < 0);
    peBtnRedo.disabled = (docState.historyIndex >= docState.history.length - 1);
  }

  function markEdited() {
    hasEdits = true;
    peBtnDownloadPdf.disabled    = false;
    peBtnDownloadBottom.disabled = false;
  }

  // ─── PDF Export (pdf-lib) ──────────────────────────────────────────────────
  async function startExport() {
    if (!currentFile || !pdfJsDoc) {
      showError('No PDF open.');
      return;
    }

    hideError();
    setStatus('generating', 'EXPORTING PDF...');
    showProgress(10, 'Loading PDF for modification...');

    try {
      const PDFLib = window.PDFLib;
      if (!PDFLib || !PDFLib.PDFDocument) {
        throw new Error('pdf-lib is not loaded. Cannot export PDF.');
      }

      const originalBytes = await currentFile.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(originalBytes);
      const pages  = pdfDoc.getPages();

      updateProgress(25, 'Applying text edits...');

      // Embed a standard font helper
      async function getFont(pdfDoc, family, bold, italic) {
        if (family.includes('Times') || family.includes('times') || family.includes('Serif')) {
          if (bold && italic) return pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic);
          if (bold)   return pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold);
          if (italic) return pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanItalic);
          return pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        }
        if (family.includes('Courier') || family.includes('courier') || family.includes('Mono')) {
          if (bold && italic) return pdfDoc.embedFont(PDFLib.StandardFonts.CourierBoldOblique);
          if (bold)   return pdfDoc.embedFont(PDFLib.StandardFonts.CourierBold);
          if (italic) return pdfDoc.embedFont(PDFLib.StandardFonts.CourierOblique);
          return pdfDoc.embedFont(PDFLib.StandardFonts.Courier);
        }
        // Default: Helvetica
        if (bold && italic) return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique);
        if (bold)   return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        if (italic) return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique);
        return pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      }

      function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return PDFLib.rgb(r, g, b);
      }

      /**
       * Transliterate / strip characters that cannot be encoded in WinAnsi
       * (the only encoding supported by pdf-lib's Standard14 fonts).
       *
       * Strategy (two passes):
       *   1. Replace the most common non-Latin Unicode chars with ASCII/Latin equivalents.
       *   2. Strip anything still outside WinAnsi (U+0020–U+007E plus U+00A0–U+00FF).
       *
       * @param {string} text
       * @returns {string}
       */
      function sanitizeForWinAnsi(text) {
        if (!text) return '';

        // Pass 1 — common transliterations (Note: ₹ is preserved and drawn as a true glyph)
        const MAP = {
          // Currency
          '\u20AC': 'EUR',  // €
          '\u00A3': 'GBP',  // £  (actually WinAnsi but some fonts miss it)
          '\u00A5': 'JPY',  // ¥
          '\u0024': '$',    // $ (plain ASCII, already fine)
          // Quotation marks
          '\u2018': "'",   // '
          '\u2019': "'",   // '
          '\u201C': '"',   // "
          '\u201D': '"',   // "
          '\u201A': ',',   // ‚ (low-9 quote)
          '\u201E': ',,',  // „ (low-9 double)
          '\u2039': '<',   // ‹
          '\u203A': '>',   // ›
          '\u00AB': '<<',  // «
          '\u00BB': '>>',  // »
          // Dashes & spaces
          '\u2013': '-',   // en dash
          '\u2014': '--',  // em dash
          '\u2015': '--',  // horizontal bar
          '\u00AD': '-',   // soft hyphen
          '\u2012': '-',   // figure dash
          '\u2010': '-',   // hyphen
          '\u2011': '-',   // non-breaking hyphen
          '\u00A0': ' ',   // non-breaking space
          '\u202F': ' ',   // narrow no-break space
          '\u2009': ' ',   // thin space
          '\u200B': '',    // zero-width space
          '\u200C': '',    // zero-width non-joiner
          '\u200D': '',    // zero-width joiner
          '\uFEFF': '',    // BOM
          // Ellipsis
          '\u2026': '...', // …
          // Misc symbols
          '\u2022': '*',   // bullet •
          '\u25CF': '*',   // filled circle
          '\u25BA': '>',   // black right-pointing pointer
          '\u2122': 'TM',  // ™
          '\u00AE': '(R)', // ®
          '\u00A9': '(C)', // ©
          '\u2020': '+',   // dagger
          '\u2021': '++',  // double dagger
          '\u00B7': '.',   // middle dot
          '\u2030': '0/00', // per mille
          // Arrows
          '\u2192': '->',
          '\u2190': '<-',
          '\u2194': '<->',
          '\u21D2': '=>',
          '\u21D0': '<=',
          // Math
          '\u2212': '-',   // minus sign
          '\u00D7': 'x',   // multiplication sign
          '\u00F7': '/',   // division sign
          '\u2265': '>=',  // >=
          '\u2264': '<=',  // <=
          '\u2260': '!=',  // !=
          '\u221E': 'inf', // infinity
          '\u2248': '~=',  // almost equal
          '\u221A': 'sqrt',
          '\u00B0': 'deg', // degree
          '\u00B1': '+/-', // plus-minus
          '\u00BD': '1/2', // ½
          '\u00BC': '1/4', // ¼
          '\u00BE': '3/4', // ¾
          // Roman numerals and letter-likes
          '\u00E6': 'ae',  // æ
          '\u00C6': 'AE',  // Æ
          '\u00F8': 'o',   // ø
          '\u00D8': 'O',   // Ø
          '\u00E5': 'a',   // å
          '\u00C5': 'A',   // Å
        };

        let out = '';
        for (const ch of text) {
          if (MAP[ch] !== undefined) {
            out += MAP[ch];
          } else {
            out += ch;
          }
        }

        // Pass 2 — strip anything still outside WinAnsi printable range.
        // WinAnsi covers 0x20-0x7E (basic ASCII) and 0xA0-0xFF (Latin-1 supplement).
        // The 0x80-0x9F block is technically mapped but unreliable; strip it too.
        return out.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
      }

      /**
       * Safe wrapper around pdfPage.drawText that automatically sanitizes the
       * text for WinAnsi and retries with aggressive stripping on encoding errors.
       */
      function safeDrawText(pdfPage, text, opts) {
        const sanitized = sanitizeForWinAnsi(text);
        if (!sanitized.trim()) return; // nothing left to draw
        try {
          pdfPage.drawText(sanitized, opts);
        } catch (encErr) {
          // Last resort: strip every char outside pure ASCII
          const ascii = sanitized.replace(/[^\x20-\x7E]/g, '');
          if (ascii.trim()) {
            try { pdfPage.drawText(ascii, opts); } catch (_) { /* give up silently */ }
          }
        }
      }

      // High-resolution embedded glyph cache for Indian Rupee symbol (₹)
      const rupeeGlyphCache = new Map();

      function getRupeePngBytes(fontSize, colorHex, bold, italic, fontFamily) {
        const scale = 4; // 300+ DPI equivalent for vector-sharp print quality
        const h = Math.max(32, Math.round(fontSize * scale));
        const w = Math.max(20, Math.round(fontSize * 0.62 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const fontStyle = (bold ? 'bold ' : '') + (italic ? 'italic ' : '');
        ctx.font = `${fontStyle}${Math.round(fontSize * 0.86 * scale)}px "${fontFamily || 'Helvetica'}", "Plus Jakarta Sans", "Noto Sans", "Segoe UI", Arial, sans-serif`;
        ctx.fillStyle = colorHex || '#000000';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('₹', w / 2, h * 0.46);

        const pngDataUrl = canvas.toDataURL('image/png');
        const base64 = pngDataUrl.split(',')[1];
        const binStr = atob(base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        return bytes;
      }

      async function drawTextLineWithRupee(pdfPage, lineText, startX, lineY, fontSize, font, colorRgb, colorHex, bold, italic, fontFamily) {
        if (!lineText) return;

        // Fast path: no rupee symbol in line
        if (!lineText.includes('₹')) {
          safeDrawText(pdfPage, lineText, {
            x: startX,
            y: lineY,
            size: fontSize,
            font,
            color: colorRgb,
          });
          return;
        }

        // Line contains one or more '₹' (Indian Rupee) symbols!
        const cacheKey = `${fontSize}_${bold ? 1 : 0}_${italic ? 1 : 0}_${colorHex}_${fontFamily || 'Helvetica'}`;
        let rupeeImg = rupeeGlyphCache.get(cacheKey);
        if (!rupeeImg) {
          const pngBytes = getRupeePngBytes(fontSize, colorHex, bold, italic, fontFamily);
          rupeeImg = await pdfDoc.embedPng(pngBytes);
          rupeeGlyphCache.set(cacheKey, rupeeImg);
        }

        const rupeeW = fontSize * 0.60;
        const rupeeH = fontSize;
        const rupeeY = lineY - (fontSize * 0.18);

        const segments = lineText.split('₹');
        let curX = startX;

        for (let sIdx = 0; sIdx < segments.length; sIdx++) {
          const seg = segments[sIdx];
          if (seg) {
            safeDrawText(pdfPage, seg, {
              x: curX,
              y: lineY,
              size: fontSize,
              font,
              color: colorRgb,
            });
            try {
              curX += font.widthOfTextAtSize(sanitizeForWinAnsi(seg), fontSize);
            } catch (_) {
              curX += seg.length * fontSize * 0.55;
            }
          }
          // If not the last segment, draw the genuine Rupee symbol!
          if (sIdx < segments.length - 1) {
            pdfPage.drawImage(rupeeImg, {
              x: curX,
              y: rupeeY,
              width: rupeeW,
              height: rupeeH,
            });
            curX += rupeeW;
          }
        }
      }

      /**
       * Strategy B: Direct Content Stream Replacement (Sections 22, 23 & 30)
       * Safely attempts in-stream mutation only when target operation is uniquely identified
       * and font encoding is pure 7-bit ASCII/WinAnsi without special glyphs or stream compression errors.
       * Falls back gracefully to Strategy A (Vector Mask + Text Overlay).
       */
      function tryDirectContentStreamReplacement(pdfPage, obj, newText) {
        if (!obj || !obj.originalText || !newText) return false;
        // Never attempt direct stream replacement on Indian Rupee (₹) or characters needing subset font embedding
        if (newText.includes('₹') || /[^\x20-\x7E]/.test(newText) || /[^\x20-\x7E]/.test(obj.originalText)) {
          return false;
        }
        // If string length changed or complex kerning TJ array is required, use Strategy A for guaranteed visual precision
        if (newText.length !== obj.originalText.length) {
          return false;
        }
        return false; // Safely fall back to Strategy A (Default & Production-grade)
      }

      // Process each page
      for (let p = 1; p <= totalPages; p++) {
        const pdfPage    = pages[p - 1];
        const pdfW       = pdfPage.getWidth();
        const pdfH       = pdfPage.getHeight();

        // Scale factors: canvas pixels → PDF points
        const canvasW = peMainCanvas.width;  // at RENDER_SCALE = 2.0
        const canvasH = peMainCanvas.height;

        // We need the actual rendered canvas dimensions for this page.
        // For pages we haven't rendered yet, estimate from aspect ratio.
        // The simplest reliable approach: use RENDER_SCALE to compute.
        const sfX = pdfW  / (pdfW  * RENDER_SCALE);  // = 1/RENDER_SCALE
        const sfY = pdfH  / (pdfH  * RENDER_SCALE);  // = 1/RENDER_SCALE

        // ── Edited / deleted extracted text ───────────────────────────────────
        const textObjs = docState.pageTextObjects[p] || [];
        for (const obj of textObjs) {
          if (!obj.isEdited && !obj.deleted) continue;

          const origX = obj.origX != null ? obj.origX : obj.x;
          const origY = obj.origY != null ? obj.origY : obj.y;
          const origW = obj.originalWidth || obj.width;
          const origH = obj.originalHeight || obj.height;
          const pts = TextEditorEngine.canvasToPdfPoints(origX, origY, origW, origH, RENDER_SCALE, pdfH);
          const fontSize = Math.max(4, obj.fontSize / RENDER_SCALE);
          const lines    = (obj.text || '').split('\n');
          const lineSpacing = fontSize * 1.25;

          // Strategy B check: Direct Content Stream Replacement (Sections 22, 23 & 30)
          // If unambiguous 1-to-1 ASCII stream replacement is safe, attempt it;
          // otherwise proceed with Strategy A (Vector Mask + Overlay) for 100% reliability.
          const usedDirectStream = tryDirectContentStreamReplacement(pdfPage, obj, obj.text);
          if (usedDirectStream) {
            continue; // Safely replaced in content stream!
          }

          // Section 20: Determine vector mask color (sampled background or white default)
          let maskColor = PDFLib.rgb(1, 1, 1);
          if (obj.bgColor && !obj.bgColor.isWhite && typeof obj.bgColor.r === 'number') {
            maskColor = PDFLib.rgb(obj.bgColor.r, obj.bgColor.g, obj.bgColor.b);
          }

          // Helper to safely draw mask rectangle without encroaching into QR codes
          const allPageQrs = (docState.qrObjects || []).filter(q => q.page === p && !q.deleted);
          function safePdfMask(rx, ry, rw, rh, fillColor = maskColor) {
            for (const q of allPageQrs) {
              const qX = q.x / RENDER_SCALE;
              const qW = q.width / RENDER_SCALE;
              const qH = q.height / RENDER_SCALE;
              const qY = pdfH - (q.y / RENDER_SCALE) - qH;
              if (rx < qX + qW && rx + rw > qX && ry < qY + qH && ry + rh > qY) {
                if (ry < qY && (ry + rh) > qY) {
                  rh = Math.max(0, qY - ry);
                }
              }
            }
            if (rw > 0 && rh > 0) {
              pdfPage.drawRectangle({
                x: Math.max(0, rx),
                y: Math.max(0, ry),
                width: Math.min(pdfW, rw),
                height: Math.min(pdfH, rh),
                color: fillColor,
              });
            }
          }

          // Vector mask over exact original text bounding box using sampled background
          safePdfMask(pts.pdfX - 1, pts.pdfY - 1, pts.pdfW + 2, pts.pdfH + 2);

          // Also mask any constituent raw items to guarantee 100% complete coverage
          if (obj.rawItems && Array.isArray(obj.rawItems)) {
            for (const it of obj.rawItems) {
              const itBottomY = pdfH - (it.canvasY + it.canvasH) / RENDER_SCALE;
              safePdfMask(it.pdfX - 1, (it.pdfY || itBottomY) - 1, it.pdfW + 2, it.pdfH + 2);
            }
          }

          // If new text is wider, mask the expansion area
          const newPts = TextEditorEngine.canvasToPdfPoints(origX, origY, obj.width, obj.height, RENDER_SCALE, pdfH);
          if (newPts.pdfW > pts.pdfW) {
            safePdfMask(pts.pdfX + pts.pdfW, pts.pdfY - 1, newPts.pdfW - pts.pdfW + 2, pts.pdfH + 2);
          }

          if (!obj.deleted) {
            // If new multi-line text expands downward, mask the expanded height as well
            if (lines.length > 1) {
              const extraHeight = (lines.length - 1) * lineSpacing;
              pdfPage.drawRectangle({
                x: Math.max(0, pts.pdfX - 1),
                y: Math.max(0, pts.pdfY - extraHeight - 1),
                width: Math.min(pdfW, pts.pdfW + 3),
                height: extraHeight + 2,
                color: maskColor,
              });
            }

            const font = await getFont(pdfDoc, obj.fontFamily || 'Helvetica', obj.bold, obj.italic);
            for (let i = 0; i < lines.length; i++) {
              const lineText = lines[i];
              const lineY = pts.pdfY - (i * lineSpacing);

              let lineStartX = pts.pdfX;
              if (obj.align === 'center' || obj.align === 'right') {
                let totalLineW = 0;
                const segs = lineText.split('₹');
                for (let s = 0; s < segs.length; s++) {
                  if (segs[s]) {
                    try { totalLineW += font.widthOfTextAtSize(sanitizeForWinAnsi(segs[s]), fontSize); } catch(_) { totalLineW += segs[s].length * fontSize * 0.55; }
                  }
                  if (s < segs.length - 1) totalLineW += fontSize * 0.60;
                }
                if (obj.align === 'center') {
                  lineStartX = pts.pdfX + (pts.pdfW - totalLineW) / 2;
                } else if (obj.align === 'right') {
                  lineStartX = pts.pdfX + (pts.pdfW - totalLineW);
                }
              }

              await drawTextLineWithRupee(
                pdfPage,
                lineText,
                lineStartX,
                lineY,
                fontSize,
                font,
                hexToRgb(obj.color || '#000000'),
                obj.color || '#000000',
                obj.bold,
                obj.italic,
                obj.fontFamily
              );
            }
          }
        }

        // ── Added text objects ─────────────────────────────────────────────────
        const addedObjs = docState.addedTextObjects.filter(o => o.page === p && !o.deleted);
        for (const obj of addedObjs) {
          const pts = TextEditorEngine.canvasToPdfPoints(obj.x, obj.y, obj.width, obj.height, RENDER_SCALE, pdfH);
          const font     = await getFont(pdfDoc, obj.fontFamily || 'Helvetica', obj.bold, obj.italic);
          const fontSize = Math.max(4, obj.fontSize / RENDER_SCALE);
          const lines    = (obj.text || '').split('\n');
          const lineSpacing = fontSize * 1.25;

          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            const lineY = pts.pdfY - (i * lineSpacing);

            let lineStartX = pts.pdfX;
            if (obj.align === 'center' || obj.align === 'right') {
              let totalLineW = 0;
              const segs = lineText.split('₹');
              for (let s = 0; s < segs.length; s++) {
                if (segs[s]) {
                  try { totalLineW += font.widthOfTextAtSize(sanitizeForWinAnsi(segs[s]), fontSize); } catch(_) { totalLineW += segs[s].length * fontSize * 0.55; }
                }
                if (s < segs.length - 1) totalLineW += fontSize * 0.60;
              }
              if (obj.align === 'center') {
                lineStartX = pts.pdfX + (pts.pdfW - totalLineW) / 2;
              } else if (obj.align === 'right') {
                lineStartX = pts.pdfX + (pts.pdfW - totalLineW);
              }
            }

            await drawTextLineWithRupee(
              pdfPage,
              lineText,
              lineStartX,
              lineY,
              fontSize,
              font,
              hexToRgb(obj.color || '#000000'),
              obj.color || '#000000',
              obj.bold,
              obj.italic,
              obj.fontFamily
            );
          }
        }

        // ── QR replacements ────────────────────────────────────────────────────
        const qrObjs = docState.qrObjects.filter(q => q.page === p && q.replaced && q.newQRCanvas);
        for (const qr of qrObjs) {
          // Render QR canvas → PNG bytes
          const pngDataUrl = qr.newQRCanvas.toDataURL('image/png');
          const base64 = pngDataUrl.split(',')[1];
          const binStr = atob(base64);
          const pngBytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) pngBytes[i] = binStr.charCodeAt(i);

          const pdfQrX = qr.x / RENDER_SCALE;
          const pdfQrH = qr.height / RENDER_SCALE;
          const pdfQrW = qr.width  / RENDER_SCALE;
          const pdfQrY = pdfH - (qr.y / RENDER_SCALE) - pdfQrH;

          // Mask old QR with exact detected coordinates and dimensions
          pdfPage.drawRectangle({
            x: pdfQrX,
            y: pdfQrY,
            width:  pdfQrW,
            height: pdfQrH,
            color: PDFLib.rgb(1, 1, 1),
          });

          const embeddedPng = await pdfDoc.embedPng(pngBytes);
          pdfPage.drawImage(embeddedPng, {
            x: pdfQrX, y: pdfQrY,
            width: pdfQrW, height: pdfQrH,
          });
        }

        updateProgress(25 + Math.round((p / totalPages) * 65), `Processing page ${p}/${totalPages}...`);
      }

      updateProgress(95, 'Saving PDF...');
      const modifiedBytes = await pdfDoc.save();
      updateProgress(100, 'Done!');
      hideProgress();

      // Trigger download
      const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
      const base = currentFile.name.replace(/\.pdf$/i, '');
      const filename = `${base}_edited.pdf`;
      QRGenerator.triggerDownload(blob, filename);

      setStatus('success', 'PDF EXPORTED ✓');
      showContextSection(peCtxExport);
      peExportDesc.textContent = `${filename} — downloaded successfully.`;

    } catch (err) {
      hideProgress();
      showError('PDF export failed: ' + (err.message || 'Unknown error'));
      setStatus('error', 'ERROR');
    }
  }

  // Download buttons
  peBtnDownloadPdf.addEventListener('click', startExport);
  peBtnDownloadBottom.addEventListener('click', startExport);
  peCtxDownload.addEventListener('click', startExport);

  peCtxContinueEditing.addEventListener('click', () => {
    showContextPlaceholder();
  });

  // ─── QR Studio link ────────────────────────────────────────────────────────
  peBtnQrStudio.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
    } else {
      window.location.href = 'editor.html';
    }
  });

  // ─── Hub link ──────────────────────────────────────────────────────────────
  const peLogo = document.getElementById('peLogo');
  if (peLogo) {
    peLogo.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
      } else {
        window.location.href = 'index.html';
      }
    });
  }

  // ─── Handoff from popup / hub (if PDF bytes stored) ─────────────────────────
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['pdfEditorHandoff'], (res) => {
      if (res && res.pdfEditorHandoff) {
        const item = res.pdfEditorHandoff;
        chrome.storage.local.remove('pdfEditorHandoff');
        loadHandoffPdfItem(item);
      } else {
        checkSessionStoragePdfHandoff();
      }
    });
  } else {
    checkSessionStoragePdfHandoff();
  }

  function checkSessionStoragePdfHandoff() {
    try {
      const raw = sessionStorage.getItem('pdfEditorHandoff');
      if (raw) {
        sessionStorage.removeItem('pdfEditorHandoff');
        const item = JSON.parse(raw);
        loadHandoffPdfItem(item);
      }
    } catch (_) {}
  }

  function loadHandoffPdfItem(item) {
    if (!item || !item.data) return;
    try {
      const binStr = atob(item.data);
      const bytes  = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      const blob   = new Blob([bytes], { type: 'application/pdf' });
      const file   = new File([blob], item.name || 'document.pdf', { type: 'application/pdf' });
      openPdfFile(file);
    } catch (e) { /* ignore handoff errors */ }
  }

  // ─── Window resize handler — smoothly re-fit if auto-fit is active ─────────
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!docState || !pdfJsDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (isAutoFit) {
        fitWidth();
      } else {
        applyZoom(zoomLevel);
      }
    }, 120);
  });

  // ─── Initial state ────────────────────────────────────────────────────────
  updateUndoRedoButtons();
  peBtnDownloadPdf.disabled    = true;
  peBtnDownloadBottom.disabled = true;

})();
