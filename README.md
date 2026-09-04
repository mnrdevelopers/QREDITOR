# QR Code Scanner, Editor, Generator & Replacer (Images & PDFs)

A clean, professional, privacy-first Google Chrome Extension (Manifest V3) built with HTML5, CSS3, and Vanilla JavaScript. It allows users to detect, decode, edit, regenerate, and seamlessly replace QR codes inside images and multi-page PDF documents directly in the browser with client-side processing—preserving 100% of original image resolution and PDF vector quality.

---

## 🌟 Key Features

- **100% Client-Side Processing**: Zero server communication. No analytics, no API calls, no remote scripts. Completely functional offline.
- **Image & PDF Format Support**: Full support for `JPG`, `JPEG`, `PNG`, `WEBP`, and multi-page `PDF` documents.
- **Multi-Page PDF Processing**:
  - Render any page of a PDF document at high fidelity (~150 DPI) for instant QR code detection.
  - Seamless page navigation controls (`← Prev Page`, `Page X of Y`, `Next Page →`).
  - Lossless QR replacement directly inside the PDF using `pdf-lib` without rasterizing other pages or vector elements.
  - Download the modified document as a complete multi-page `.pdf` or export the edited page as a high-res `.png`.
- **PDF Text Detection, OCR & In-Place Editing**:
  - Automatically extract and cluster text lines from vector/digital PDF pages with exact bounding box coordinates and font metrics.
  - Interactive clickable text overlay directly on the canvas viewport.
  - Sidebar text editor with font selection (`Helvetica`, `Times Roman`, `Courier`), font size (pt), custom color picker, and background mask padding.
  - Real-time live canvas preview of replaced text.
  - Lossless PDF text replacement via `pdf-lib` vector text drawing with instant download.
- **Multi-Pass & Deep QR Detection**: Automatic detection using `jsQR` with automated fallback enhancement passes (native Chromium BarcodeDetector, contrast stretching, unsharp mask sharpening, 2x/3x tile upscaling, and user-drawn ROI selection for tiny QR codes).
- **Multiple QR Architecture**: Scans and indexes multiple QR codes on a single document or photo with quick selector tabs (`QR #1`, `QR #2`).
- **Content Type Classification**: Automatically detects and categorizes QR payload types:
  - **URL** (`http://`, `https://`) with safe explicit user action to open in a new tab
  - **Wi-Fi** configurations (`WIFI:`)
  - **vCard** contacts (`BEGIN:VCARD`)
  - **JSON** objects/arrays
  - **Email** addresses (`mailto:`)
  - **Telephone** numbers (`tel:`)
  - **SMS** messages (`sms:`)
  - **Plain Text**
- **In-Browser QR Regeneration**: Crisp integer-module scaling with standard quiet zone margin and configurable error correction levels (`L`, `M`, `Q`, `H`).
- **Automated Verification Loop**: Automatically verifies newly generated QR codes with `jsQR` before replacement to guarantee real-world smartphone scannability.
- **Exact Coordinate Replacement**: Padded masking overlay cleanly covers the previous QR code and embeds the new QR code at the exact bounding box.
- **Side-by-Side Comparison**: Visual comparison before final export (Side-by-Side split view, Original view, and Modified view).
- **Zero Quality Loss**: Native image resolution and PDF vector structures are preserved.
- **Dual Interface**: Compact popup for quick scanning + dedicated full-screen workspace for advanced editing and region selection.

---

## 📁 Extension Structure

```
qr-editor-extension/
│
├── manifest.json              # Chrome Extension Manifest V3 configuration
│
├── popup.html                 # Compact popup user interface
├── popup.css                  # Popup styling & layout
├── popup.js                   # Popup workflow logic & tab handoff
│
├── editor.html                # Full-screen workspace interface
├── editor.css                 # Editor styling, split viewport, dark theme
├── editor.js                  # Workspace zoom, multi-QR, comparison & export
│
├── scanner/
│   ├── qr-scanner.js          # QR detector, multi-pass preprocessing & tiled scanning
│   ├── qr-generator.js        # QR generator, quiet zone, auto-verification & canvas replacer
│   ├── pdf-processor.js       # Client-side PDF page renderer & lossless PDF QR replacer
│   └── pdf-text-processor.js  # PDF text extraction, clustering & in-place text replacer
│
├── lib/
│   ├── jsQR.js                # Vendored pure JS QR code decoder (offline)
│   ├── qrcode.js              # Vendored pure JS QR code generator (offline)
│   ├── pdf.min.js             # Mozilla PDF.js client-side PDF document parser (offline)
│   ├── pdf.worker.min.js      # Mozilla PDF.js web worker (offline)
│   └── pdf-lib.min.js         # Pure JS PDF modifier and binary manipulator (offline)
│
├── assets/
│   ├── icon16.png             # 16x16 extension icon
│   ├── icon48.png             # 48x48 extension icon
│   └── icon128.png            # 128x128 extension icon
│
└── README.md                  # Complete documentation & usage guide
```

---

## 🚀 How to Install in Google Chrome

1. Open **Google Chrome** (or any Chromium browser such as Edge, Brave, or Vivaldi).
2. Navigate to the extensions page by typing `chrome://extensions` in the address bar.
3. Toggle on **Developer mode** in the top right corner.
4. Click the **Load unpacked** button in the top left corner.
5. Select the project directory:
   ```
   d:\PROJECTS\qr code detecter and replacer
   ```
6. The extension **QR Code Scanner, Editor & Replacer** will now appear in your browser toolbar!

---

## 🛠️ How to Use

### Quick Workflow (Popup)
1. Click the extension icon in the Chrome toolbar.
2. Drag and drop any `JPG`, `PNG`, `WEBP` image or `PDF` document into the drop zone (or click **Choose File**).
3. If uploading a multi-page PDF, use `←` and `→` to navigate between pages.
4. Click **Scan QR**. The QR code bounding box will appear over the page or image, and decoded data will be displayed.
5. Click **Edit** to alter the data (e.g., change URL parameters).
6. Click **Generate New QR**. The extension automatically self-verifies the newly generated QR code.
7. Click **Apply Replacement** to substitute the old QR with the new one.
8. Click **Download** to save `<original_filename>_qr_edited.pdf` or `<original_filename>_qr_edited.png/jpg`.

### Full Workspace Workflow (Editor Tab)
1. Click **Full Editor** in the popup header (or open `editor.html` directly).
2. Drag and drop high-resolution documents, multi-page PDFs, or photos (e.g. 4000 × 3000 posters or invoices).
3. Use the **Zoom**, **Fit**, and **PDF Page Navigation** controls in the top toolbar.
4. If multiple QR codes exist, navigate between them via the tabs (`QR #1`, `QR #2`).
5. Fine-tune the **Replacement Mask Padding** (slider 0–12px) and **Error Correction Level**.
6. Compare changes using **Side-by-Side View**, **Original View**, and **Modified View**.
7. Export the modified PDF directly, or download individual high-res PNG/JPG images.

---

## 📦 Third-Party Libraries (Vendored Locally)

To guarantee offline functionality and strict compliance with Manifest V3 policies prohibiting remote code execution:
1. **jsQR** (`lib/jsQR.js`): Pure JavaScript QR code reading library. Takes raw Canvas `ImageData` and extracts decoded strings and corner coordinate locations.
2. **qrcode-generator** (`lib/qrcode.js`): Pure JavaScript QR code matrix generator. Supports byte encoding, auto version selection (1-40), and error correction levels L, M, Q, and H.
3. **PDF.js** (`lib/pdf.min.js` & `lib/pdf.worker.min.js`): Mozilla's client-side PDF rendering engine. Renders vector PDF pages directly onto Canvas with high DPI.
4. **pdf-lib** (`lib/pdf-lib.min.js`): Pure JavaScript PDF creation and modification library. Embeds replacement PNGs, draws coordinate-mapped masks, and saves modified PDF documents without rasterizing untouched vector pages.

---

## 🔒 Privacy & Security Explanation

- **Client-Side Only**: All image parsing, QR decoding, QR rendering, and canvas modifications happen purely inside your browser memory.
- **No Data Collection**: No browsing history, cookies, files, or scanned URLs are tracked, collected, or transmitted.
- **Untrusted Input Protection**: Decoded QR text is rendered with `textContent` / input values and never evaluated as raw HTML/DOM scripts.
- **Explicit URL Navigation**: Opening detected URLs requires an explicit, deliberate user click; links are never automatically opened.

---

## ⚠️ Known Limitations (V1)

- **Rotated/Skewed Perspective QR Codes**: Severe 3D affine perspective distortions or severe tilt angles beyond 45° may require manual alignment or perspective correction.
- **Inverted QR Codes**: White-on-black QR codes are supported via the inversion preprocessing pass; however, extremely low-contrast colored QR codes (e.g. yellow on beige) may fail to decode.
- **Memory on Mobile/Extremely Large Canvas**: Chrome limits canvas dimensions to approximately 16,384 × 16,384 px. Standard document resolutions (e.g. 4000 × 3000) are fully supported.

---

## 🗺️ Future PDF Support (V2 Roadmap)

V1 is built with decoupled image processing functions so that V2 can add PDF capabilities seamlessly:
- **PDF Ingestion**: Integrate local `pdf.js` to render document pages onto an internal canvas.
- **Page Selection**: Page navigator to select which page to scan.
- **Vector / High-DPI Replacement**: Render page at 300 DPI, detect QR, replace region, and reconstruct a multi-page PDF using a local client-side PDF synthesizer (e.g. `pdf-lib`).
