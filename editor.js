/**
 * Full-Screen Workspace Controller - editor.js
 * Handles large high-res image manipulation, multi-QR detection,
 * zooming, side-by-side comparison, regeneration, auto-verification,
 * and high-fidelity replacement export.
 */

(function() {
  'use strict';

  // State
  let currentFile = null;
  let originalImage = null; // High-res HTMLImageElement
  let detectedQRCodes = [];
  let selectedQRIndex = 0;
  let generatedQRCanvas = null;
  let replacedCanvas = null;
  let oldQRCanvas = null;

  // PDF State
  let isPdfMode = false;
  let loadedPdfDoc = null;
  let loadedPdfBytes = null;
  let pdfNumPages = 0;
  let pdfCurrentPage = 1;
  let replacedPdfBytes = null;

  // Mode & PDF Text Editor State
  let currentEditorMode = 'qr'; // 'qr' | 'text'
  let detectedTextLines = [];
  let selectedTextLine = null;
  let textReplacements = [];

  // Viewport Zoom & Mode State
  let zoomLevel = 1.0;
  let currentViewMode = 'result'; // 'result' | 'original' | 'split'

  // DOM Elements - Navigation & Viewport
  const statusBar = document.getElementById('statusBar');
  const statusLabel = document.getElementById('statusLabel');
  const btnNewImage = document.getElementById('btnNewImage');

  const viewport = document.getElementById('viewport');
  const viewportToolbar = document.getElementById('viewportToolbar');
  const btnModeQR = document.getElementById('btnModeQR');
  const btnModeText = document.getElementById('btnModeText');
  const qrToolGroup = document.getElementById('qrToolGroup');
  const textOverlayLayer = document.getElementById('textOverlayLayer');

  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomFit = document.getElementById('btnZoomFit');
  const zoomLevelText = document.getElementById('zoomLevelText');
  const btnSelectArea = document.getElementById('btnSelectArea');

  const pdfToolbarControls = document.getElementById('pdfToolbarControls');
  const pdfToolbarDivider = document.getElementById('pdfToolbarDivider');
  const btnPdfPrev = document.getElementById('btnPdfPrev');
  const btnPdfNext = document.getElementById('btnPdfNext');
  const pdfPageIndicator = document.getElementById('pdfPageIndicator');

  const compareControls = document.getElementById('compareControls');
  const btnToggleCompare = document.getElementById('btnToggleCompare');
  const btnViewOriginal = document.getElementById('btnViewOriginal');
  const btnSideBySide = document.getElementById('btnSideBySide');

  const emptyState = document.getElementById('emptyState');
  const emptyDropzone = document.getElementById('emptyDropzone');
  const fileInput = document.getElementById('fileInput');
  const btnBrowseFile = document.getElementById('btnBrowseFile');

  const canvasStage = document.getElementById('canvasStage');
  const canvasContainer = document.getElementById('canvasContainer');
  const mainCanvas = document.getElementById('mainCanvas');
  const bboxOverlay = document.getElementById('bboxOverlay');
  const bboxTag = document.getElementById('bboxTag');
  const selectionRect = document.getElementById('selectionRect');

  const splitStage = document.getElementById('splitStage');
  const origSplitCanvas = document.getElementById('origSplitCanvas');
  const newSplitCanvas = document.getElementById('newSplitCanvas');

  // DOM Elements - Sidebar Panels
  const panelMeta = document.getElementById('panelMeta');
  const fileFormatPill = document.getElementById('fileFormatPill');
  const valFilename = document.getElementById('valFilename');
  const valDimensions = document.getElementById('valDimensions');
  const valSize = document.getElementById('valSize');
  const valStatus = document.getElementById('valStatus');
  const btnScanImage = document.getElementById('btnScanImage');
  const btnDeepScan = document.getElementById('btnDeepScan');

  const panelDetection = document.getElementById('panelDetection');
  const detTypeBadge = document.getElementById('detTypeBadge');
  const qrTabs = document.getElementById('qrTabs');
  const metricCoords = document.getElementById('metricCoords');
  const metricSize = document.getElementById('metricSize');
  const decodedText = document.getElementById('decodedText');
  const btnOpenUrl = document.getElementById('btnOpenUrl');
  const btnCopyData = document.getElementById('btnCopyData');
  const btnStartEdit = document.getElementById('btnStartEdit');

  const panelEdit = document.getElementById('panelEdit');
  const editText = document.getElementById('editText');
  const settingPadding = document.getElementById('settingPadding');
  const valPaddingText = document.getElementById('valPaddingText');
  const settingEC = document.getElementById('settingEC');
  const btnGenerate = document.getElementById('btnGenerate');

  const verificationBox = document.getElementById('verificationBox');
  const verifyBadge = document.getElementById('verifyBadge');
  const verifyBadgeIcon = document.getElementById('verifyBadgeIcon');
  const verifyBadgeText = document.getElementById('verifyBadgeText');
  const oldQrFrame = document.getElementById('oldQrFrame');
  const newQrFrame = document.getElementById('newQrFrame');
  const btnApply = document.getElementById('btnApply');
  const btnCancelEdit = document.getElementById('btnCancelEdit');

  const panelExport = document.getElementById('panelExport');
  const calloutResolution = document.getElementById('calloutResolution');
  const btnDownloadDefault = document.getElementById('btnDownloadDefault');
  const btnDownloadAlt = document.getElementById('btnDownloadAlt');
  const btnStartOver = document.getElementById('btnStartOver');

  // Text Editor DOM Elements
  const panelTextEdit = document.getElementById('panelTextEdit');
  const textCountBadge = document.getElementById('textCountBadge');
  const selectedTextOriginal = document.getElementById('selectedTextOriginal');
  const selectedTextNew = document.getElementById('selectedTextNew');
  const textFontFamily = document.getElementById('textFontFamily');
  const textFontSize = document.getElementById('textFontSize');
  const textColor = document.getElementById('textColor');
  const textMaskPadding = document.getElementById('textMaskPadding');
  const btnApplyTextEdit = document.getElementById('btnApplyTextEdit');
  const btnCancelTextEdit = document.getElementById('btnCancelTextEdit');
  const replacementsContainer = document.getElementById('replacementsContainer');
  const replacementsList = document.getElementById('replacementsList');
  const replacementCount = document.getElementById('replacementCount');
  const btnDownloadTextPdf = document.getElementById('btnDownloadTextPdf');

  const errorBox = document.getElementById('errorBox');
  const errorText = document.getElementById('errorText');
  const btnDismissError = document.getElementById('btnDismissError');

  // Status & Error Management
  function setStatus(state, label) {
    statusBar.className = `status-indicator ${state}`;
    statusLabel.textContent = label;
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.style.display = 'flex';
    setStatus('error', 'ERROR');
  }

  function hideError() {
    errorBox.style.display = 'none';
  }

  btnDismissError.addEventListener('click', hideError);

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // Padding slider live update
  settingPadding.addEventListener('input', (e) => {
    valPaddingText.textContent = `${e.target.value}px`;
  });

  // File Selection and Drag & Drop
  btnBrowseFile.addEventListener('click', () => fileInput.click());
  btnNewImage.addEventListener('click', () => fileInput.click());

  emptyDropzone.addEventListener('click', (e) => {
    if (e.target !== btnBrowseFile) fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadFile(e.target.files[0]);
    }
  });

  ['dragenter', 'dragover'].forEach(name => {
    document.body.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      emptyDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    document.body.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      emptyDropzone.classList.remove('dragover');
    });
  });

  document.body.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      loadFile(dt.files[0]);
    }
  });

  const SUPPORTED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

  function loadFile(file) {
    hideError();
    const ext = file.name.split('.').pop().toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) {
      showError('Please select a JPG, JPEG, PNG, WEBP image or a PDF document.');
      return;
    }

    currentFile = file;

    if (PDFProcessor.isPDF(file)) {
      handlePdfFile(file);
      return;
    }

    isPdfMode = false;
    if (pdfToolbarControls) pdfToolbarControls.style.display = 'none';
    if (pdfToolbarDivider) pdfToolbarDivider.style.display = 'none';

    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        initializeWorkspace();
      };
      img.onerror = () => showError('Failed to load image. File may be corrupted.');
      img.src = e.target.result;
    };

    reader.readAsDataURL(file);
  }

  async function handlePdfFile(file) {
    isPdfMode = true;
    setStatus('scanning', 'LOADING PDF...');
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const loaded = await PDFProcessor.loadPDF(arrayBuffer);
        loadedPdfDoc = loaded.pdfDoc;
        loadedPdfBytes = loaded.originalBytes;
        pdfNumPages = loaded.numPages;
        pdfCurrentPage = 1;
        await renderAndDisplayPdfPage(1);
      } catch (err) {
        showError('Failed to load PDF: ' + (err.message || 'Unknown error'));
      }
    };

    reader.onerror = () => showError('Failed to read PDF file.');
    reader.readAsArrayBuffer(file);
  }

  async function renderAndDisplayPdfPage(pageNum) {
    pdfCurrentPage = pageNum;
    if (btnPdfPrev) btnPdfPrev.disabled = (pdfCurrentPage <= 1);
    if (btnPdfNext) btnPdfNext.disabled = (pdfCurrentPage >= pdfNumPages);
    if (pdfPageIndicator) pdfPageIndicator.textContent = `Page ${pdfCurrentPage} of ${pdfNumPages}`;

    if (pdfToolbarControls) pdfToolbarControls.style.display = pdfNumPages > 1 ? 'flex' : 'none';
    if (pdfToolbarDivider) pdfToolbarDivider.style.display = pdfNumPages > 1 ? 'block' : 'none';

    // Reset page-level text items
    detectedTextLines = [];
    selectedTextLine = null;
    textReplacements = [];
    updateReplacementsListUI();

    setStatus('scanning', `RENDERING PAGE ${pageNum}...`);
    try {
      const renderedCanvas = await PDFProcessor.renderPageToCanvas(loadedPdfDoc, pageNum, 2.0);
      originalImage = renderedCanvas;
      initializeWorkspace();

      if (currentEditorMode === 'text') {
        loadAndRenderPageText();
      }
    } catch (err) {
      showError(`Failed to render PDF page ${pageNum}: ` + (err.message || 'Unknown error'));
    }
  }

  if (btnPdfPrev) {
    btnPdfPrev.addEventListener('click', () => {
      if (isPdfMode && pdfCurrentPage > 1) {
        renderAndDisplayPdfPage(pdfCurrentPage - 1);
      }
    });
  }

  if (btnPdfNext) {
    btnPdfNext.addEventListener('click', () => {
      if (isPdfMode && pdfCurrentPage < pdfNumPages) {
        renderAndDisplayPdfPage(pdfCurrentPage + 1);
      }
    });
  }

  // Initialize Workspace with Loaded Image
  function initializeWorkspace() {
    emptyState.style.display = 'none';
    canvasStage.style.display = 'flex';
    splitStage.style.display = 'none';
    viewportToolbar.style.display = 'flex';
    compareControls.style.display = 'none';

    panelMeta.style.display = 'flex';
    panelDetection.style.display = 'none';
    panelEdit.style.display = 'none';
    panelExport.style.display = 'none';

    const ext = currentFile.name.split('.').pop().toUpperCase();
    fileFormatPill.textContent = ext;
    valFilename.textContent = currentFile.name;
    const imgW = originalImage.naturalWidth || originalImage.width;
    const imgH = originalImage.naturalHeight || originalImage.height;
    valDimensions.textContent = `${imgW} × ${imgH} px`;
    valSize.textContent = formatBytes(currentFile.size);
    valStatus.textContent = isPdfMode ? `PDF Page ${pdfCurrentPage} loaded` : 'Image loaded';

    // Render original image on mainCanvas
    renderToMainCanvas(originalImage);
    fitToViewport();

    setStatus('ready', 'READY');

    // Automatically trigger scan for smooth user experience
    triggerScan();
  }

  function renderToMainCanvas(source) {
    mainCanvas.width = source.naturalWidth || source.width;
    mainCanvas.height = source.naturalHeight || source.height;
    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctx.drawImage(source, 0, 0);
  }

  // Zoom and Pan Handlers
  function applyZoom(newZoom) {
    zoomLevel = Math.max(0.1, Math.min(newZoom, 4.0));
    zoomLevelText.textContent = `${Math.round(zoomLevel * 100)}%`;

    const imgW = originalImage.naturalWidth || originalImage.width || mainCanvas.width;
    const imgH = originalImage.naturalHeight || originalImage.height || mainCanvas.height;
    const displayW = Math.round(imgW * zoomLevel);
    const displayH = Math.round(imgH * zoomLevel);

    mainCanvas.style.width = `${displayW}px`;
    mainCanvas.style.height = `${displayH}px`;

    updateBboxOverlay();
    renderTextOverlay();
  }

  btnZoomIn.addEventListener('click', () => applyZoom(zoomLevel * 1.25));
  btnZoomOut.addEventListener('click', () => applyZoom(zoomLevel / 1.25));

  function fitToViewport() {
    if (!originalImage) return;
    const imgW = originalImage.naturalWidth || originalImage.width;
    const imgH = originalImage.naturalHeight || originalImage.height;
    const availW = viewport.clientWidth - 80;
    const availH = viewport.clientHeight - 100;
    const scale = Math.min(availW / imgW, availH / imgH, 1.0);
    applyZoom(scale);
  }

  btnZoomFit.addEventListener('click', fitToViewport);

  // Scan QR Codes with Deep Multi-Scale Analysis
  btnScanImage.addEventListener('click', () => triggerScan(false));
  btnDeepScan.addEventListener('click', () => triggerScan(true));

  async function triggerScan(deep = true) {
    if (!originalImage) return;
    hideError();
    setStatus('scanning', deep ? 'SCANNING (DEEP PASS)...' : 'SCANNING...');
    valStatus.textContent = deep ? 'Deep multi-scale scanning...' : 'Scanning...';

    await new Promise(r => setTimeout(r, 40));

    try {
      detectedQRCodes = await QRScanner.scanQRCode(originalImage, { deepScan: deep });

      if (!detectedQRCodes || detectedQRCodes.length === 0) {
        setStatus('error', 'NO QR DETECTED');
        valStatus.textContent = 'No QR found';
        bboxOverlay.style.display = 'none';
        showError('No QR code detected. Tip: Use "🔍 Scan Selected Area" in the top bar to drag a box directly over small QR codes.');
        return;
      }

      selectedQRIndex = 0;
      setStatus('detected', 'QR DETECTED ✓');
      valStatus.textContent = `${detectedQRCodes.length} QR Code(s) Detected`;
      displayQRDetails();
    } catch (err) {
      showError('Scanning failed: ' + (err.message || 'Unknown error'));
    }
  }

  // Interactive Area Selection / ROI Scan for Tiny QR Codes
  let isSelecting = false;
  let startX = 0, startY = 0;
  let selectionActive = false;

  btnSelectArea.addEventListener('click', () => {
    selectionActive = !selectionActive;
    btnSelectArea.classList.toggle('active-tool', selectionActive);
    canvasContainer.classList.toggle('selecting', selectionActive);

    if (selectionActive) {
      setStatus('ready', 'DRAG BOX OVER QR TO SCAN');
      showError('Selection Mode Active: Click and drag a box directly around the small QR code.');
    } else {
      hideError();
      selectionRect.style.display = 'none';
    }
  });

  canvasContainer.addEventListener('mousedown', (e) => {
    if (!selectionActive) return;
    const rect = canvasContainer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isSelecting = true;

    selectionRect.style.left = `${startX}px`;
    selectionRect.style.top = `${startY}px`;
    selectionRect.style.width = '0px';
    selectionRect.style.height = '0px';
    selectionRect.style.display = 'block';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isSelecting || !selectionActive) return;
    const rect = canvasContainer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    selectionRect.style.left = `${x}px`;
    selectionRect.style.top = `${y}px`;
    selectionRect.style.width = `${w}px`;
    selectionRect.style.height = `${h}px`;
  });

  window.addEventListener('mouseup', async (e) => {
    if (!isSelecting || !selectionActive) return;
    isSelecting = false;
    selectionActive = false;
    btnSelectArea.classList.remove('active-tool');
    canvasContainer.classList.remove('selecting');

    const selW = parseInt(selectionRect.style.width, 10) || 0;
    const selH = parseInt(selectionRect.style.height, 10) || 0;
    const selX = parseInt(selectionRect.style.left, 10) || 0;
    const selY = parseInt(selectionRect.style.top, 10) || 0;
    selectionRect.style.display = 'none';

    if (selW < 8 || selH < 8) return;

    hideError();
    setStatus('scanning', 'MAGNIFYING & SCANNING SELECTION...');
    valStatus.textContent = 'Scanning selection...';

    // Map screen display coordinates back to high-res native image coordinates
    const scaleFactor = originalImage.naturalWidth / parseInt(mainCanvas.style.width, 10);
    const cropBox = {
      x: selX * scaleFactor,
      y: selY * scaleFactor,
      width: selW * scaleFactor,
      height: selH * scaleFactor
    };

    try {
      const results = await QRScanner.scanRegion(originalImage, cropBox);
      if (results && results.length > 0) {
        detectedQRCodes = results;
        selectedQRIndex = 0;
        setStatus('detected', 'QR DETECTED IN SELECTION ✓');
        valStatus.textContent = 'Decoded successfully from selection';
        displayQRDetails();
      } else {
        setStatus('error', 'NO QR IN SELECTION');
        showError('Could not decode a QR code in the selected area. Try zooming in and selecting closely around the QR code.');
      }
    } catch (err) {
      showError('Selection scan error: ' + err.message);
    }
  });

  // Display QR Details
  function displayQRDetails() {
    panelDetection.style.display = 'flex';
    panelEdit.style.display = 'none';
    panelExport.style.display = 'none';

    // Multi-QR selector tabs
    if (detectedQRCodes.length > 1) {
      qrTabs.style.display = 'flex';
      qrTabs.innerHTML = '';
      detectedQRCodes.forEach((qr, idx) => {
        const tab = document.createElement('button');
        tab.className = `qr-tab ${idx === selectedQRIndex ? 'active' : ''}`;
        tab.textContent = `QR #${idx + 1} (${qr.type})`;
        tab.addEventListener('click', () => {
          selectedQRIndex = idx;
          displayQRDetails();
        });
        qrTabs.appendChild(tab);
      });
    } else {
      qrTabs.style.display = 'none';
    }

    const currentQR = detectedQRCodes[selectedQRIndex];
    detTypeBadge.textContent = currentQR.type;
    metricCoords.textContent = `Pos: (${currentQR.x}, ${currentQR.y})`;
    metricSize.textContent = `Size: ${currentQR.width} × ${currentQR.height} px`;
    decodedText.value = currentQR.data;

    // Show/hide Open URL button
    if (currentQR.type === 'URL') {
      btnOpenUrl.style.display = 'inline-flex';
    } else {
      btnOpenUrl.style.display = 'none';
    }

    updateBboxOverlay();
    extractOldQRThumbnail(currentQR);
  }

  function updateBboxOverlay() {
    if (!detectedQRCodes || detectedQRCodes.length === 0 || !originalImage) {
      bboxOverlay.style.display = 'none';
      return;
    }

    const currentQR = detectedQRCodes[selectedQRIndex];
    const left = Math.round(currentQR.x * zoomLevel);
    const top = Math.round(currentQR.y * zoomLevel);
    const width = Math.round(currentQR.width * zoomLevel);
    const height = Math.round(currentQR.height * zoomLevel);

    bboxOverlay.style.left = `${left}px`;
    bboxOverlay.style.top = `${top}px`;
    bboxOverlay.style.width = `${width}px`;
    bboxOverlay.style.height = `${height}px`;
    bboxTag.textContent = `QR #${selectedQRIndex + 1}`;
    bboxOverlay.style.display = 'block';
  }

  function extractOldQRThumbnail(bbox) {
    const canvas = document.createElement('canvas');
    canvas.width = bbox.width;
    canvas.height = bbox.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      originalImage,
      bbox.x, bbox.y, bbox.width, bbox.height,
      0, 0, bbox.width, bbox.height
    );
    oldQRCanvas = canvas;
    oldQrFrame.innerHTML = '';
    oldQrFrame.appendChild(canvas);
  }

  // Open URL explicitly on user action
  btnOpenUrl.addEventListener('click', () => {
    const url = decodedText.value.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  });

  // Copy Data
  btnCopyData.addEventListener('click', () => {
    const text = decodedText.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btnCopyData.innerHTML;
      btnCopyData.innerHTML = '<span>Copied!</span>';
      setTimeout(() => { btnCopyData.innerHTML = orig; }, 1500);
    });
  });

  // Edit Mode
  btnStartEdit.addEventListener('click', () => {
    const currentQR = detectedQRCodes[selectedQRIndex];
    if (!currentQR) return;

    setStatus('editing', 'EDITING');
    panelEdit.style.display = 'flex';
    verificationBox.style.display = 'none';
    editText.value = currentQR.data;
    editText.focus();
  });

  btnCancelEdit.addEventListener('click', () => {
    panelEdit.style.display = 'none';
    verificationBox.style.display = 'none';
    setStatus('detected', 'QR DETECTED ✓');
  });

  // Generate & Verify New QR
  btnGenerate.addEventListener('click', async () => {
    const newText = editText.value.trim();
    if (!newText) {
      showError('QR data cannot be empty.');
      return;
    }

    hideError();
    setStatus('generating', 'GENERATING...');

    await new Promise(r => setTimeout(r, 40));

    try {
      const currentQR = detectedQRCodes[selectedQRIndex];
      const ecLevel = settingEC.value;

      // Generate crisp QR canvas
      const qrCanvas = QRGenerator.generateQRCanvas(
        newText,
        currentQR.width,
        currentQR.height,
        { errorCorrectionLevel: ecLevel, marginModules: 4 }
      );

      // Verification step
      setStatus('verifying', 'VERIFYING...');
      const verifyRes = await QRGenerator.verifyQRCode(qrCanvas, newText);

      if (verifyRes.success) {
        generatedQRCanvas = qrCanvas;
        verifyBadge.className = 'verify-badge';
        verifyBadgeIcon.textContent = '✓';
        verifyBadgeText.textContent = 'New QR verified ✓';
        btnApply.disabled = false;

        newQrFrame.innerHTML = '';
        newQrFrame.appendChild(qrCanvas);

        verificationBox.style.display = 'flex';
        setStatus('ready', 'PREVIEW READY');
      } else {
        verifyBadge.className = 'verify-badge error';
        verifyBadgeIcon.textContent = '✗';
        verifyBadgeText.textContent = verifyRes.error || 'Unable to verify generated QR';
        btnApply.disabled = true;
        verificationBox.style.display = 'flex';
        showError('New QR verification failed: ' + (verifyRes.error || 'The replacement was cancelled.'));
      }
    } catch (err) {
      showError('Generation Error: ' + (err.message || 'Unknown error'));
    }
  });

  // Apply Replacement
  btnApply.addEventListener('click', async () => {
    if (!originalImage || !generatedQRCanvas) {
      showError('No verified replacement QR code ready.');
      return;
    }

    try {
      const currentQR = detectedQRCodes[selectedQRIndex];
      const padding = parseInt(settingPadding.value, 10) || 3;

      if (isPdfMode) {
        setStatus('generating', 'UPDATING PDF...');
        const canvasDims = {
          width: originalImage.naturalWidth || originalImage.width,
          height: originalImage.naturalHeight || originalImage.height
        };

        replacedPdfBytes = await PDFProcessor.replaceQROnPDF(
          loadedPdfBytes,
          pdfCurrentPage,
          currentQR,
          generatedQRCanvas,
          canvasDims,
          { padding }
        );

        replacedCanvas = QRGenerator.replaceQRCodeOnCanvas(
          originalImage,
          currentQR,
          generatedQRCanvas,
          { padding, maskColor: '#ffffff' }
        );

        setupCompareCanvases();
        renderToMainCanvas(replacedCanvas);
        bboxOverlay.style.display = 'none';

        compareControls.style.display = 'flex';
        setCompareMode('result');

        panelEdit.style.display = 'none';
        panelExport.style.display = 'flex';
        setStatus('success', 'PDF QR REPLACED ✓');

        calloutResolution.textContent = `PDF Page ${pdfCurrentPage} updated. Original vector and document quality preserved.`;
        btnDownloadDefault.textContent = 'Download Modified PDF';
        btnDownloadAlt.textContent = 'Download Current Page as PNG';
        return;
      }

      // Full native resolution replacement
      replacedCanvas = QRGenerator.replaceQRCodeOnCanvas(
        originalImage,
        currentQR,
        generatedQRCanvas,
        { padding, maskColor: '#ffffff' }
      );

      // Setup side-by-side comparison canvases
      setupCompareCanvases();

      // Switch to modified view on main canvas
      renderToMainCanvas(replacedCanvas);
      bboxOverlay.style.display = 'none';

      // Show comparison toolbar and export panel
      compareControls.style.display = 'flex';
      setCompareMode('result');

      panelEdit.style.display = 'none';
      panelExport.style.display = 'flex';
      setStatus('success', 'REPLACEMENT COMPLETE ✓');

      const isPng = currentFile.name.toLowerCase().endsWith('.png');
      calloutResolution.textContent = `Original ${replacedCanvas.width} × ${replacedCanvas.height} px resolution preserved.`;

      btnDownloadDefault.textContent = isPng ? 'Download PNG (Native Quality)' : 'Download JPG (Native Quality)';
      btnDownloadAlt.textContent = isPng ? 'Download as JPG' : 'Download as PNG';
    } catch (err) {
      showError('Replacement failed: ' + (err.message || 'Unknown replacement error'));
    }
  });

  // Comparison Canvases Setup
  function setupCompareCanvases() {
    origSplitCanvas.width = originalImage.naturalWidth || originalImage.width;
    origSplitCanvas.height = originalImage.naturalHeight || originalImage.height;
    const origCtx = origSplitCanvas.getContext('2d');
    origCtx.drawImage(originalImage, 0, 0);

    newSplitCanvas.width = replacedCanvas.width;
    newSplitCanvas.height = replacedCanvas.height;
    const newCtx = newSplitCanvas.getContext('2d');
    newCtx.drawImage(replacedCanvas, 0, 0);
  }

  function setCompareMode(mode) {
    currentViewMode = mode;
    [btnToggleCompare, btnViewOriginal, btnSideBySide].forEach(btn => {
      btn.classList.toggle('active-tab', btn.dataset.mode === mode);
    });

    if (mode === 'split') {
      canvasStage.style.display = 'none';
      splitStage.style.display = 'flex';
    } else {
      splitStage.style.display = 'none';
      canvasStage.style.display = 'flex';
      if (mode === 'original') {
        renderToMainCanvas(originalImage);
        updateBboxOverlay();
      } else {
        renderToMainCanvas(replacedCanvas);
        bboxOverlay.style.display = 'none';
      }
    }
  }

  btnToggleCompare.addEventListener('click', () => setCompareMode('result'));
  btnViewOriginal.addEventListener('click', () => setCompareMode('original'));
  btnSideBySide.addEventListener('click', () => setCompareMode('split'));

  // Download Handlers
  btnDownloadDefault.addEventListener('click', () => {
    if (isPdfMode && replacedPdfBytes) {
      const blob = new Blob([replacedPdfBytes], { type: 'application/pdf' });
      const filename = QRGenerator.getEditedFilename(currentFile.name, 'pdf');
      QRGenerator.triggerDownload(blob, filename);
      return;
    }
    if (!replacedCanvas) return;
    const isPng = currentFile.name.toLowerCase().endsWith('.png');
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const filename = QRGenerator.getEditedFilename(currentFile.name);

    QRGenerator.exportCanvasAsBlob(replacedCanvas, mime, 0.95).then(blob => {
      QRGenerator.triggerDownload(blob, filename);
    }).catch(err => showError('Download failed: ' + err.message));
  });

  btnDownloadAlt.addEventListener('click', () => {
    if (isPdfMode && replacedCanvas) {
      QRGenerator.exportCanvasAsBlob(replacedCanvas, 'image/png', 0.95).then(blob => {
        const base = currentFile.name.replace(/\.pdf$/i, '');
        const filename = QRGenerator.getEditedFilename(`${base}_page${pdfCurrentPage}`, 'png');
        QRGenerator.triggerDownload(blob, filename);
      }).catch(err => showError('Download failed: ' + err.message));
      return;
    }
    if (!replacedCanvas) return;
    const isPng = currentFile.name.toLowerCase().endsWith('.png');
    const mime = isPng ? 'image/jpeg' : 'image/png';
    const ext = isPng ? 'jpg' : 'png';
    const filename = QRGenerator.getEditedFilename(currentFile.name, ext);

    QRGenerator.exportCanvasAsBlob(replacedCanvas, mime, 0.95).then(blob => {
      QRGenerator.triggerDownload(blob, filename);
    }).catch(err => showError('Download failed: ' + err.message));
  });

  // Start Over
  function resetAll() {
    currentFile = null;
    originalImage = null;
    detectedQRCodes = [];
    selectedQRIndex = 0;
    generatedQRCanvas = null;
    replacedCanvas = null;
    oldQRCanvas = null;

    isPdfMode = false;
    loadedPdfDoc = null;
    loadedPdfBytes = null;
    pdfNumPages = 0;
    pdfCurrentPage = 1;
    replacedPdfBytes = null;

    currentEditorMode = 'qr';
    if (btnModeQR) btnModeQR.classList.add('active-tab');
    if (btnModeText) btnModeText.classList.remove('active-tab');
    detectedTextLines = [];
    selectedTextLine = null;
    textReplacements = [];

    if (textOverlayLayer) {
      textOverlayLayer.innerHTML = '';
      textOverlayLayer.style.display = 'none';
    }
    if (panelTextEdit) panelTextEdit.style.display = 'none';
    if (qrToolGroup) qrToolGroup.style.display = 'flex';

    if (pdfToolbarControls) pdfToolbarControls.style.display = 'none';
    if (pdfToolbarDivider) pdfToolbarDivider.style.display = 'none';

    fileInput.value = '';
    emptyState.style.display = 'flex';
    canvasStage.style.display = 'none';
    splitStage.style.display = 'none';
    viewportToolbar.style.display = 'none';
    compareControls.style.display = 'none';

    panelMeta.style.display = 'none';
    panelDetection.style.display = 'none';
    panelEdit.style.display = 'none';
    panelExport.style.display = 'none';
    bboxOverlay.style.display = 'none';

    hideError();
    setStatus('ready', 'READY');
  }

  btnStartOver.addEventListener('click', resetAll);

  // ==========================================
  // PDF Text Editor Mode & Handlers
  // ==========================================

  function setEditorMode(mode) {
    currentEditorMode = mode;
    if (btnModeQR) btnModeQR.classList.toggle('active-tab', mode === 'qr');
    if (btnModeText) btnModeText.classList.toggle('active-tab', mode === 'text');

    if (mode === 'text') {
      if (!isPdfMode) {
        showError('PDF Text Editor is available for PDF documents. Please upload a PDF.');
        setEditorMode('qr');
        return;
      }
      bboxOverlay.style.display = 'none';
      if (qrToolGroup) qrToolGroup.style.display = 'none';
      panelDetection.style.display = 'none';
      panelEdit.style.display = 'none';
      panelExport.style.display = 'none';
      panelMeta.style.display = 'none';
      if (panelTextEdit) panelTextEdit.style.display = 'flex';
      if (textOverlayLayer) textOverlayLayer.style.display = 'block';

      loadAndRenderPageText();
    } else {
      if (textOverlayLayer) textOverlayLayer.style.display = 'none';
      if (panelTextEdit) panelTextEdit.style.display = 'none';
      panelMeta.style.display = 'flex';
      if (qrToolGroup) qrToolGroup.style.display = 'flex';
      if (detectedQRCodes.length > 0) {
        panelDetection.style.display = 'flex';
        updateBboxOverlay();
      }
    }
  }

  if (btnModeQR) btnModeQR.addEventListener('click', () => setEditorMode('qr'));
  if (btnModeText) btnModeText.addEventListener('click', () => setEditorMode('text'));

  async function loadAndRenderPageText() {
    if (!loadedPdfDoc) return;
    setStatus('scanning', `EXTRACTING TEXT (PAGE ${pdfCurrentPage})...`);
    const canvasDims = {
      width: originalImage.naturalWidth || originalImage.width,
      height: originalImage.naturalHeight || originalImage.height
    };

    try {
      detectedTextLines = await PDFTextProcessor.extractTextLines(loadedPdfDoc, pdfCurrentPage, canvasDims);
      if (textCountBadge) {
        textCountBadge.textContent = `${detectedTextLines.length} Line${detectedTextLines.length === 1 ? '' : 's'}`;
      }
      renderTextOverlay();
      setStatus('ready', 'TEXT READY FOR EDITING');
    } catch (err) {
      showError('Text extraction error: ' + (err.message || 'Unknown error'));
    }
  }

  function renderTextOverlay() {
    if (!textOverlayLayer) return;
    textOverlayLayer.innerHTML = '';
    if (currentEditorMode !== 'text') return;

    detectedTextLines.forEach(line => {
      const box = document.createElement('div');
      box.className = 'text-block-highlight';
      box.dataset.id = line.id;
      box.title = `Click to edit: "${line.text}"`;

      if (textReplacements.some(r => r.id === line.id)) {
        box.classList.add('modified');
      }

      if (selectedTextLine && selectedTextLine.id === line.id) {
        box.classList.add('selected');
      }

      box.style.left = `${Math.round(line.canvasX * zoomLevel)}px`;
      box.style.top = `${Math.round(line.canvasY * zoomLevel)}px`;
      box.style.width = `${Math.round(line.canvasW * zoomLevel)}px`;
      box.style.height = `${Math.round(line.canvasH * zoomLevel)}px`;

      box.addEventListener('click', (e) => {
        e.stopPropagation();
        selectTextLine(line);
      });

      textOverlayLayer.appendChild(box);
    });
  }

  function selectTextLine(line) {
    selectedTextLine = line;
    if (selectedTextOriginal) selectedTextOriginal.value = line.text;

    const existing = textReplacements.find(r => r.id === line.id);
    if (selectedTextNew) selectedTextNew.value = existing ? existing.newText : line.text;
    if (textFontSize) textFontSize.value = Math.round(line.fontSize || 12);
    if (btnApplyTextEdit) btnApplyTextEdit.disabled = false;
    if (selectedTextNew) selectedTextNew.focus();

    renderTextOverlay();
  }

  if (btnApplyTextEdit) {
    btnApplyTextEdit.addEventListener('click', () => {
      if (!selectedTextLine) return;
      const newText = selectedTextNew.value;

      const hexColor = textColor ? textColor.value : '#000000';
      const r = parseInt(hexColor.slice(1, 3), 16) / 255;
      const g = parseInt(hexColor.slice(3, 5), 16) / 255;
      const b = parseInt(hexColor.slice(5, 7), 16) / 255;

      const replacement = {
        id: selectedTextLine.id,
        bbox: {
          x: selectedTextLine.canvasX,
          y: selectedTextLine.canvasY,
          width: selectedTextLine.canvasW,
          height: selectedTextLine.canvasH
        },
        originalText: selectedTextLine.text,
        newText: newText,
        fontFamily: textFontFamily ? textFontFamily.value : 'Helvetica',
        fontSize: parseFloat(textFontSize ? textFontSize.value : 12) || selectedTextLine.fontSize,
        color: { r, g, b },
        padding: parseInt(textMaskPadding ? textMaskPadding.value : 2, 10) || 2
      };

      const idx = textReplacements.findIndex(r => r.id === selectedTextLine.id);
      if (idx >= 0) {
        textReplacements[idx] = replacement;
      } else {
        textReplacements.push(replacement);
      }

      // Live update canvas preview
      liveDrawTextReplacement(replacement);

      updateReplacementsListUI();
      renderTextOverlay();
      setStatus('success', 'TEXT CHANGE APPLIED ✓');
    });
  }

  function liveDrawTextReplacement(rep) {
    const ctx = mainCanvas.getContext('2d');
    const b = rep.bbox;
    const pad = rep.padding || 2;

    // Mask original text with clean white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);

    // Draw replacement text
    const fontFam = rep.fontFamily === 'Courier' ? 'monospace' :
                    rep.fontFamily === 'TimesRoman' ? 'serif' : 'sans-serif';
    ctx.font = `${rep.fontSize || 12}px ${fontFam}`;
    ctx.fillStyle = textColor ? textColor.value : '#000000';
    ctx.textBaseline = 'top';
    ctx.fillText(rep.newText, b.x, b.y);
  }

  function updateReplacementsListUI() {
    if (!replacementsContainer) return;
    replacementsContainer.style.display = textReplacements.length > 0 ? 'flex' : 'none';
    if (replacementCount) replacementCount.textContent = textReplacements.length;
    if (!replacementsList) return;
    replacementsList.innerHTML = '';

    textReplacements.forEach((rep, index) => {
      const row = document.createElement('div');
      row.className = 'replacement-item';
      row.innerHTML = `
        <span class="replacement-text" title="${rep.originalText} → ${rep.newText}">"${rep.originalText}" → "<b>${rep.newText}</b>"</span>
        <button type="button" class="btn-remove-replacement" title="Revert">&times;</button>
      `;
      row.querySelector('.btn-remove-replacement').addEventListener('click', () => {
        textReplacements.splice(index, 1);
        renderToMainCanvas(originalImage);
        textReplacements.forEach(r => liveDrawTextReplacement(r));
        updateReplacementsListUI();
        renderTextOverlay();
      });
      replacementsList.appendChild(row);
    });
  }

  if (btnCancelTextEdit) {
    btnCancelTextEdit.addEventListener('click', () => {
      selectedTextLine = null;
      if (selectedTextOriginal) selectedTextOriginal.value = '';
      if (selectedTextNew) selectedTextNew.value = '';
      if (btnApplyTextEdit) btnApplyTextEdit.disabled = true;
      renderTextOverlay();
    });
  }

  if (btnDownloadTextPdf) {
    btnDownloadTextPdf.addEventListener('click', async () => {
      if (!loadedPdfBytes || textReplacements.length === 0) {
        showError('No text changes to compile.');
        return;
      }

      try {
        setStatus('generating', 'COMPILING MODIFIED PDF...');
        const canvasDims = {
          width: originalImage.naturalWidth || originalImage.width,
          height: originalImage.naturalHeight || originalImage.height
        };

        const modifiedBytes = await PDFTextProcessor.replaceTextOnPDF(
          loadedPdfBytes,
          pdfCurrentPage,
          textReplacements,
          canvasDims
        );

        const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
        const baseName = currentFile.name.replace(/\.pdf$/i, '');
        const filename = QRGenerator.getEditedFilename(`${baseName}_text_edited`, 'pdf');
        QRGenerator.triggerDownload(blob, filename);
        setStatus('success', 'MODIFIED PDF DOWNLOADED ✓');
      } catch (err) {
        showError('PDF text compile error: ' + (err.message || 'Unknown error'));
      }
    });
  }

  // Check for Handoff from Popup on Tab Load
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['handoffImage', 'handoffQRs'], (res) => {
      if (res && res.handoffImage) {
        const item = res.handoffImage;
        const img = new Image();
        img.onload = () => {
          originalImage = img;
          currentFile = {
            name: item.filename || 'image.png',
            size: item.size || 0,
            type: item.type || 'image/png'
          };
          // Clear handoff so refresh won't get stuck
          chrome.storage.local.remove(['handoffImage', 'handoffQRs']);
          initializeWorkspace();
        };
        img.src = item.dataUrl;
      }
    });
  }

})();
