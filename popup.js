/**
 * QR Editor & Scanner - Popup Logic
 * Handles image upload, drag & drop, client-side canvas processing,
 * QR detection, editing, regeneration, auto-verification, and replacement.
 */

(function() {
  'use strict';

  // State
  let currentFile = null;
  let loadedImage = null; // HTMLImageElement or rendered HTMLCanvasElement
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

  // DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const dropPrompt = document.getElementById('dropPrompt');
  const btnChooseFile = document.getElementById('btnChooseFile');
  const previewContainer = document.getElementById('previewContainer');
  const previewCanvas = document.getElementById('previewCanvas');
  const qrOverlayBox = document.getElementById('qrOverlayBox');
  const canvasWrapper = document.getElementById('canvasWrapper');

  const pdfPageBar = document.getElementById('pdfPageBar');
  const btnPdfPrev = document.getElementById('btnPdfPrev');
  const btnPdfNext = document.getElementById('btnPdfNext');
  const pdfPageIndicator = document.getElementById('pdfPageIndicator');

  const metaFilename = document.getElementById('metaFilename');
  const metaDimensions = document.getElementById('metaDimensions');
  const metaSize = document.getElementById('metaSize');

  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');

  const btnScan = document.getElementById('btnScan');
  const btnClear = document.getElementById('btnClear');
  const btnOpenEditorTab = document.getElementById('btnOpenEditorTab');
  const btnOpenPdfEditor = document.getElementById('btnOpenPdfEditor');

  // Result Card
  const resultCard = document.getElementById('resultCard');
  const detectedBadge = document.getElementById('detectedBadge');
  const typeBadge = document.getElementById('typeBadge');
  const qrCountLabel = document.getElementById('qrCountLabel');
  const qrSelector = document.getElementById('qrSelector');
  const decodedDataText = document.getElementById('decodedDataText');
  const btnOpenUrl = document.getElementById('btnOpenUrl');
  const btnCopyData = document.getElementById('btnCopyData');
  const btnToggleEdit = document.getElementById('btnToggleEdit');

  // Edit Card
  const editCard = document.getElementById('editCard');
  const editDataText = document.getElementById('editDataText');
  const btnGenerateQR = document.getElementById('btnGenerateQR');
  const btnCancelEdit = document.getElementById('btnCancelEdit');

  // Preview Card
  const qrPreviewCard = document.getElementById('qrPreviewCard');
  const verificationStatus = document.getElementById('verificationStatus');
  const verificationText = document.getElementById('verificationText');
  const oldQrThumb = document.getElementById('oldQrThumb');
  const newQrThumb = document.getElementById('newQrThumb');
  const btnApplyReplacement = document.getElementById('btnApplyReplacement');

  // Success Card
  const successCard = document.getElementById('successCard');
  const resolutionNote = document.getElementById('resolutionNote');
  const btnDownloadDefault = document.getElementById('btnDownloadDefault');
  const btnDownloadAlt = document.getElementById('btnDownloadAlt');
  const btnStartNew = document.getElementById('btnStartNew');

  // Error Banner
  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');
  const btnDismissError = document.getElementById('btnDismissError');

  // Status updates
  function setStatus(state, message) {
    statusBar.className = `status-bar ${state}`;
    statusText.textContent = message;
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.style.display = 'flex';
    setStatus('error', 'ERROR');
  }

  function hideError() {
    errorBanner.style.display = 'none';
  }

  btnDismissError.addEventListener('click', hideError);

  // Progress Bar & Laser Scanline Elements
  const popupProgressCard = document.getElementById('popupProgressCard');
  const popupProgressText = document.getElementById('popupProgressText');
  const popupProgressPercent = document.getElementById('popupProgressPercent');
  const popupProgressFill = document.getElementById('popupProgressFill');
  const popupScanline = document.getElementById('popupScanline');

  function showPopupProgress(percent, text) {
    if (!popupProgressCard) return;
    popupProgressCard.style.display = 'block';
    updatePopupProgress(percent, text);
  }

  function updatePopupProgress(percent, text) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (popupProgressFill) popupProgressFill.style.width = `${clamped}%`;
    if (popupProgressPercent) popupProgressPercent.textContent = `${clamped}%`;
    if (text && popupProgressText) popupProgressText.textContent = text;
  }

  function hidePopupProgress() {
    if (!popupProgressCard) return;
    setTimeout(() => {
      popupProgressCard.style.display = 'none';
    }, 450);
  }

  function setPopupScanline(active) {
    if (popupScanline) {
      popupScanline.style.display = active ? 'block' : 'none';
    }
  }

  // File type validation
  const SUPPORTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

  function isValidFileType(file) {
    if (!file) return false;
    if (SUPPORTED_TYPES.includes(file.type)) return true;
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.pdf');
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // File Drop & Selection Handlers
  dropZone.addEventListener('click', (e) => {
    // Only open dialog if clicking dropPrompt or Choose File button
    if (!loadedImage || e.target.closest('#dropPrompt') || e.target === btnChooseFile) {
      fileInput.click();
    }
  });

  btnChooseFile.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag and drop events
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      handleFile(dt.files[0]);
    }
  });

  // Open Full Studio (QR editor) in a new tab
  if (btnOpenEditorTab) {
    btnOpenEditorTab.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
      } else {
        window.open('editor.html', '_blank');
      }
    });
  }

  // Open PDF Text & QR Editor in a new tab
  // Optionally hands off the currently loaded PDF bytes
  if (btnOpenPdfEditor) {
    btnOpenPdfEditor.addEventListener('click', async () => {
      if (isPdfMode && currentFile && typeof chrome !== 'undefined' && chrome.storage) {
        try {
          const ab = await currentFile.arrayBuffer();
          const uint8 = new Uint8Array(ab);
          // Convert to base64 in chunks to avoid stack overflow on large files
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < uint8.length; i += chunkSize) {
            binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
          }
          const b64 = btoa(binary);
          chrome.storage.local.set({
            pdfEditorHandoff: { data: b64, name: currentFile.name }
          }, () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('pdf-editor.html') });
          });
          return;
        } catch (_) { /* fall through to plain open */ }
      }
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('pdf-editor.html') });
      } else {
        window.open('pdf-editor.html', '_blank');
      }
    });
  }

  function handleFile(file) {
    hideError();
    if (!isValidFileType(file)) {
      showError('Please select a JPG, JPEG, PNG, WEBP image or a PDF document.');
      return;
    }

    currentFile = file;

    if (PDFProcessor.isPDF(file)) {
      handlePdfFile(file);
      return;
    }

    isPdfMode = false;
    if (pdfPageBar) pdfPageBar.style.display = 'none';
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        loadedImage = img;
        displayLoadedImage();
        scanCurrentSource();
      };
      img.onerror = () => {
        showError('Unable to load image file. It may be corrupted.');
      };
      img.src = e.target.result;
    };

    reader.onerror = () => {
      showError('Failed to read image file.');
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
        await renderAndScanPdfPage(1);
      } catch (err) {
        showError('Failed to load PDF: ' + (err.message || 'Unknown error'));
      }
    };

    reader.onerror = () => {
      showError('Failed to read PDF file.');
    };

    reader.readAsArrayBuffer(file);
  }

  async function renderAndScanPdfPage(pageNum) {
    pdfCurrentPage = pageNum;
    if (btnPdfPrev) btnPdfPrev.disabled = (pdfCurrentPage <= 1);
    if (btnPdfNext) btnPdfNext.disabled = (pdfCurrentPage >= pdfNumPages);
    if (pdfPageIndicator) pdfPageIndicator.textContent = `Page ${pdfCurrentPage} of ${pdfNumPages}`;
    if (pdfPageBar) pdfPageBar.style.display = pdfNumPages > 1 ? 'flex' : 'none';

    setStatus('scanning', `RENDERING PAGE ${pageNum}...`);
    showPopupProgress(30, `Rendering PDF Page ${pageNum}...`);
    try {
      const renderedCanvas = await PDFProcessor.renderPageToCanvas(loadedPdfDoc, pageNum, 2.75);
      loadedImage = renderedCanvas;
      updatePopupProgress(80, `Page ${pageNum} rendered`);
      displayLoadedImage();
      await scanCurrentSource();
    } catch (err) {
      hidePopupProgress();
      showError(`Failed to render PDF page ${pageNum}: ` + (err.message || 'Unknown error'));
    }
  }

  if (btnPdfPrev) {
    btnPdfPrev.addEventListener('click', () => {
      if (isPdfMode && pdfCurrentPage > 1) {
        renderAndScanPdfPage(pdfCurrentPage - 1);
      }
    });
  }

  if (btnPdfNext) {
    btnPdfNext.addEventListener('click', () => {
      if (isPdfMode && pdfCurrentPage < pdfNumPages) {
        renderAndScanPdfPage(pdfCurrentPage + 1);
      }
    });
  }

  function displayLoadedImage() {
    dropPrompt.style.display = 'none';
    previewContainer.style.display = 'flex';
    qrOverlayBox.style.display = 'none';
    resultCard.style.display = 'none';
    editCard.style.display = 'none';
    qrPreviewCard.style.display = 'none';
    successCard.style.display = 'none';

    const natW = loadedImage.naturalWidth || loadedImage.width;
    const natH = loadedImage.naturalHeight || loadedImage.height;

    metaFilename.textContent = currentFile.name;
    metaDimensions.textContent = `${natW} × ${natH} px`;
    metaSize.textContent = formatBytes(currentFile.size);

    // Draw to preview canvas
    renderToPreviewCanvas(loadedImage);
    setStatus('ready', 'READY');
  }

  function renderToPreviewCanvas(source) {
    const ctx = previewCanvas.getContext('2d');
    const origW = source.naturalWidth || source.width;
    const origH = source.naturalHeight || source.height;

    // Compute display size to fit within 380 x 200 without distortion
    const maxW = 380;
    const maxH = 200;
    const scale = Math.min(maxW / origW, maxH / origH, 1);

    previewCanvas.width = Math.round(origW * scale);
    previewCanvas.height = Math.round(origH * scale);

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(source, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function updateOverlayBox(bbox) {
    if (!bbox || !loadedImage) {
      qrOverlayBox.style.display = 'none';
      return;
    }

    const natW = loadedImage.naturalWidth || loadedImage.width;
    const natH = loadedImage.naturalHeight || loadedImage.height;
    const scaleX = previewCanvas.width / natW;
    const scaleY = previewCanvas.height / natH;

    const left = Math.round(bbox.x * scaleX);
    const top = Math.round(bbox.y * scaleY);
    const width = Math.round(bbox.width * scaleX);
    const height = Math.round(bbox.height * scaleY);

    qrOverlayBox.style.left = `${left}px`;
    qrOverlayBox.style.top = `${top}px`;
    qrOverlayBox.style.width = `${width}px`;
    qrOverlayBox.style.height = `${height}px`;
    qrOverlayBox.style.display = 'block';
  }

  // Scan QR Action with Deep Scan for Small QR Codes
  async function scanCurrentSource() {
    if (!loadedImage) {
      showError('Please upload an image or PDF first.');
      return;
    }

    hideError();
    setStatus('scanning', 'SCANNING...');
    setPopupScanline(true);
    showPopupProgress(25, 'Analyzing image channels...');

    // Small delay to permit UI repaint
    await new Promise(r => setTimeout(r, 50));

    try {
      updatePopupProgress(60, 'Evaluating contrast & Otsu binarization...');
      await new Promise(r => setTimeout(r, 40));

      detectedQRCodes = await QRScanner.scanQRCode(loadedImage, { deepScan: true });
      updatePopupProgress(100, detectedQRCodes.length > 0 ? `${detectedQRCodes.length} QR Code(s) Detected!` : 'Scan completed');
      setPopupScanline(false);
      hidePopupProgress();

      if (!detectedQRCodes || detectedQRCodes.length === 0) {
        setStatus('error', 'NO QR DETECTED');
        qrOverlayBox.style.display = 'none';
        resultCard.style.display = 'none';
        if (isPdfMode) {
          showError(`No QR code detected on page ${pdfCurrentPage}. Try navigating to another page or using the Full Editor.`);
        } else {
          showError('No QR code was detected. If the QR is very small or low contrast, try opening the Full Editor for zoomed region selection.');
        }
        return;
      }

      selectedQRIndex = 0;
      setStatus('detected', 'QR DETECTED ✓');
      displayQRResults();
    } catch (err) {
      setPopupScanline(false);
      hidePopupProgress();
      showError('Detection failed: ' + (err.message || 'Unknown scanning error'));
    }
  }

  btnScan.addEventListener('click', scanCurrentSource);

  function displayQRResults() {
    resultCard.style.display = 'flex';
    editCard.style.display = 'none';
    qrPreviewCard.style.display = 'none';
    successCard.style.display = 'none';

    // Multi-QR selector
    if (detectedQRCodes.length > 1) {
      qrSelector.style.display = 'flex';
      qrSelector.innerHTML = '';
      detectedQRCodes.forEach((qr, idx) => {
        const pill = document.createElement('button');
        pill.className = `qr-pill ${idx === selectedQRIndex ? 'active' : ''}`;
        pill.textContent = `QR #${idx + 1} (${qr.type})`;
        pill.addEventListener('click', () => {
          selectedQRIndex = idx;
          displayQRResults();
        });
        qrSelector.appendChild(pill);
      });
      qrCountLabel.textContent = `${detectedQRCodes.length} QR Codes Found`;
    } else {
      qrSelector.style.display = 'none';
      qrCountLabel.textContent = 'QR #1';
    }

    const currentQR = detectedQRCodes[selectedQRIndex];
    typeBadge.textContent = currentQR.type;
    decodedDataText.value = currentQR.data;

    // Show/hide Open URL button
    if (currentQR.type === 'URL') {
      btnOpenUrl.style.display = 'inline-flex';
    } else {
      btnOpenUrl.style.display = 'none';
    }

    // Highlight bounding box on preview canvas
    updateOverlayBox(currentQR);

    // Extract old QR thumbnail for side-by-side comparison
    extractOldQRThumb(currentQR);
  }

  function extractOldQRThumb(bbox) {
    const canvas = document.createElement('canvas');
    canvas.width = bbox.width;
    canvas.height = bbox.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      loadedImage,
      bbox.x, bbox.y, bbox.width, bbox.height,
      0, 0, bbox.width, bbox.height
    );
    oldQRCanvas = canvas;
    oldQrThumb.innerHTML = '';
    oldQrThumb.appendChild(canvas);
  }

  // Open URL explicitly on user click
  btnOpenUrl.addEventListener('click', () => {
    const url = decodedDataText.value.trim();
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
    const text = decodedDataText.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const origText = btnCopyData.innerHTML;
      btnCopyData.innerHTML = '<span>Copied!</span>';
      setTimeout(() => {
        btnCopyData.innerHTML = origText;
      }, 1500);
    }).catch(() => {
      decodedDataText.select();
      document.execCommand('copy');
    });
  });

  // Toggle Edit Mode
  btnToggleEdit.addEventListener('click', () => {
    const currentQR = detectedQRCodes[selectedQRIndex];
    if (!currentQR) return;

    setStatus('editing', 'EDITING');
    editCard.style.display = 'flex';
    qrPreviewCard.style.display = 'none';
    editDataText.value = currentQR.data;
    editDataText.focus();
  });

  btnCancelEdit.addEventListener('click', () => {
    editCard.style.display = 'none';
    qrPreviewCard.style.display = 'none';
    setStatus('detected', 'QR DETECTED ✓');
  });

  // Generate New QR & Auto-Verify
  btnGenerateQR.addEventListener('click', async () => {
    const newText = editDataText.value.trim();
    if (!newText) {
      showError('Please enter data for the QR code.');
      return;
    }

    hideError();
    setStatus('generating', 'GENERATING...');
    showPopupProgress(35, 'Generating QR matrix...');

    await new Promise(r => setTimeout(r, 40));

    try {
      const currentQR = detectedQRCodes[selectedQRIndex];
      // Generate crisp QR canvas
      const qrCanvas = QRGenerator.generateQRCanvas(
        newText,
        currentQR.width,
        currentQR.height,
        { marginModules: 4, errorCorrectionLevel: 'M' }
      );

      // Verification step
      setStatus('verifying', 'VERIFYING...');
      updatePopupProgress(75, 'Verifying checksum...');
      const verifyRes = await QRGenerator.verifyQRCode(qrCanvas, newText);

      updatePopupProgress(100, verifyRes.success ? 'Checksum verified ✓' : 'Verification failed');
      hidePopupProgress();

      if (verifyRes.success) {
        generatedQRCanvas = qrCanvas;
        verificationStatus.className = 'verification-status';
        verificationStatus.querySelector('.status-icon').textContent = '✓';
        verificationText.textContent = 'New QR verified ✓';
        btnApplyReplacement.disabled = false;

        // Render new QR thumbnail
        newQrThumb.innerHTML = '';
        newQrThumb.appendChild(qrCanvas);

        qrPreviewCard.style.display = 'flex';
        setStatus('ready', 'PREVIEW READY');
      } else {
        verificationStatus.className = 'verification-status error';
        verificationStatus.querySelector('.status-icon').textContent = '✗';
        verificationText.textContent = verifyRes.error || 'Unable to verify generated QR';
        btnApplyReplacement.disabled = true;
        qrPreviewCard.style.display = 'flex';
        showError('New QR verification failed: ' + (verifyRes.error || 'The replacement was cancelled.'));
      }
    } catch (err) {
      hidePopupProgress();
      showError('QR Generation Error: ' + (err.message || 'Unknown error'));
    }
  });

  // Apply Replacement
  btnApplyReplacement.addEventListener('click', async () => {
    if (!loadedImage || !generatedQRCanvas) {
      showError('No verified QR code to replace.');
      return;
    }

    try {
      const currentQR = detectedQRCodes[selectedQRIndex];
      showPopupProgress(50, isPdfMode ? 'Embedding into PDF document...' : 'Applying high-res replacement...');

      if (isPdfMode) {
        setStatus('generating', 'UPDATING PDF...');
        const canvasDims = {
          width: loadedImage.naturalWidth || loadedImage.width,
          height: loadedImage.naturalHeight || loadedImage.height
        };

        replacedPdfBytes = await PDFProcessor.replaceQROnPDF(
          loadedPdfBytes,
          pdfCurrentPage,
          currentQR,
          generatedQRCanvas,
          canvasDims,
          { padding: 3 }
        );

        // Also render modified version onto preview canvas
        replacedCanvas = QRGenerator.replaceQRCodeOnCanvas(
          loadedImage,
          currentQR,
          generatedQRCanvas,
          { padding: 3, maskColor: '#ffffff' }
        );

        renderToPreviewCanvas(replacedCanvas);
        qrOverlayBox.style.display = 'none';

        updatePopupProgress(100, 'PDF Replaced Successfully!');
        hidePopupProgress();
        setStatus('success', 'PDF QR REPLACED ✓');
        qrPreviewCard.style.display = 'none';
        editCard.style.display = 'none';
        successCard.style.display = 'flex';

        resolutionNote.textContent = `PDF Page ${pdfCurrentPage} updated. Original vector and document quality preserved.`;
        btnDownloadDefault.textContent = 'Download PDF';
        btnDownloadAlt.textContent = 'Download Page as PNG';
        return;
      }

      // Perform replacement onto full native resolution canvas
      replacedCanvas = QRGenerator.replaceQRCodeOnCanvas(
        loadedImage,
        currentQR,
        generatedQRCanvas,
        { padding: 3, maskColor: '#ffffff' }
      );

      // Update preview canvas with replaced image
      renderToPreviewCanvas(replacedCanvas);
      qrOverlayBox.style.display = 'none';

      updatePopupProgress(100, 'QR Replaced Successfully!');
      hidePopupProgress();
      setStatus('success', 'QR REPLACED SUCCESSFULLY ✓');
      qrPreviewCard.style.display = 'none';
      editCard.style.display = 'none';
      successCard.style.display = 'flex';

      const isPng = currentFile.name.toLowerCase().endsWith('.png');
      resolutionNote.textContent = `Original ${replacedCanvas.width} × ${replacedCanvas.height} px resolution preserved.`;
      btnDownloadDefault.textContent = isPng ? 'Download PNG (Original Quality)' : 'Download JPG (Original Quality)';
      btnDownloadAlt.textContent = isPng ? 'Download as JPG' : 'Download as PNG';
    } catch (err) {
      hidePopupProgress();
      showError('Replacement failed: ' + (err.message || 'Unknown replacement error'));
    }
  });

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
    // Alternate format
    const mime = isPng ? 'image/jpeg' : 'image/png';
    const ext = isPng ? 'jpg' : 'png';
    const filename = QRGenerator.getEditedFilename(currentFile.name, ext);

    QRGenerator.exportCanvasAsBlob(replacedCanvas, mime, 0.95).then(blob => {
      QRGenerator.triggerDownload(blob, filename);
    }).catch(err => showError('Download failed: ' + err.message));
  });

  // Clear / Start New
  function resetEditor() {
    currentFile = null;
    loadedImage = null;
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
    if (pdfPageBar) pdfPageBar.style.display = 'none';

    fileInput.value = '';
    dropPrompt.style.display = 'flex';
    previewContainer.style.display = 'none';
    resultCard.style.display = 'none';
    editCard.style.display = 'none';
    qrPreviewCard.style.display = 'none';
    successCard.style.display = 'none';
    qrOverlayBox.style.display = 'none';
    hideError();
    setStatus('ready', 'READY');
  }

  btnClear.addEventListener('click', resetEditor);
  btnStartNew.addEventListener('click', resetEditor);

  // Full Editor Tab Handoff
  btnOpenEditorTab.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      // If we have an active image in popup, store it temporarily in chrome.storage.local
      if (loadedImage && currentFile) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = loadedImage.naturalWidth;
          tempCanvas.height = loadedImage.naturalHeight;
          const ctx = tempCanvas.getContext('2d');
          ctx.drawImage(loadedImage, 0, 0);
          const dataUrl = tempCanvas.toDataURL(currentFile.type || 'image/png');

          chrome.storage.local.set({
            handoffImage: {
              dataUrl: dataUrl,
              filename: currentFile.name,
              size: currentFile.size,
              type: currentFile.type
            },
            handoffQRs: detectedQRCodes
          }, () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          });
          return;
        } catch (e) {
          // Large image dataUrl storage quota fallback: just open editor.html
        }
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
    } else {
      window.open('editor.html', '_blank');
    }
  });

})();
