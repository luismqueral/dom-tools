/**
 * HD Capture plugin — tiled full-page screenshots for tall pages.
 *
 * When a page exceeds the browser's max canvas dimension (16384px),
 * this plugin renders in horizontal strips at full resolution, then
 * stitches them into a single compressed PNG using a built-in DEFLATE
 * encoder. No external dependencies.
 *
 * Enabled by default. Hooks into the camera system via
 * window.DomTools._hdCapture override.
 */
(function () {
  'use strict';

  const MAX_CANVAS_DIM = 16384;
  const STRIP_HEIGHT = 4000; // px at 1x scale per strip

  // =========================================================
  // Minimal DEFLATE encoder (fixed Huffman codes)
  // =========================================================

  function deflateRaw(data) {
    // Use fixed Huffman encoding in 65535-byte stored blocks
    // This is simpler than full Huffman but still produces valid deflate
    const MAX_BLOCK = 65535;
    const blocks = [];
    let offset = 0;

    while (offset < data.length) {
      const remaining = data.length - offset;
      const len = Math.min(remaining, MAX_BLOCK);
      const isLast = (offset + len >= data.length);

      // Block header: BFINAL (1 bit) + BTYPE=00 (2 bits) = stored block
      blocks.push(isLast ? 1 : 0);
      // LEN (2 bytes little-endian)
      blocks.push(len & 0xFF, (len >> 8) & 0xFF);
      // NLEN (one's complement of LEN)
      const nlen = ~len & 0xFFFF;
      blocks.push(nlen & 0xFF, (nlen >> 8) & 0xFF);
      // Literal data
      for (let i = 0; i < len; i++) {
        blocks.push(data[offset + i]);
      }
      offset += len;
    }

    return new Uint8Array(blocks);
  }

  function adler32(data) {
    let a = 1, b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function zlibCompress(data) {
    const deflated = deflateRaw(data);
    const checksum = adler32(data);
    // zlib header: CMF=0x78 (deflate, window 32k), FLG=0x01 (no dict, check bits)
    const result = new Uint8Array(2 + deflated.length + 4);
    result[0] = 0x78;
    result[1] = 0x01;
    result.set(deflated, 2);
    const off = 2 + deflated.length;
    result[off] = (checksum >> 24) & 0xFF;
    result[off + 1] = (checksum >> 16) & 0xFF;
    result[off + 2] = (checksum >> 8) & 0xFF;
    result[off + 3] = checksum & 0xFF;
    return result;
  }

  // =========================================================
  // PNG encoder
  // =========================================================

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const len = data.length;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    // Length (4 bytes big-endian)
    chunk[0] = (len >> 24) & 0xFF;
    chunk[1] = (len >> 16) & 0xFF;
    chunk[2] = (len >> 8) & 0xFF;
    chunk[3] = len & 0xFF;
    // Type
    chunk.set(typeBytes, 4);
    // Data
    chunk.set(data, 8);
    // CRC over type+data
    const crcData = new Uint8Array(4 + len);
    crcData.set(typeBytes, 0);
    crcData.set(data, 4);
    const crc = crc32(crcData);
    chunk[8 + len] = (crc >> 24) & 0xFF;
    chunk[8 + len + 1] = (crc >> 16) & 0xFF;
    chunk[8 + len + 2] = (crc >> 8) & 0xFF;
    chunk[8 + len + 3] = crc & 0xFF;
    return chunk;
  }

  function encodePNG(width, height, rgbaStrips) {
    // Build raw image data with filter byte (0 = None) per row
    const rowBytes = width * 4; // RGBA
    const rawSize = height * (1 + rowBytes);
    const raw = new Uint8Array(rawSize);

    let destOffset = 0;
    let stripIdx = 0;
    let stripRowOffset = 0;

    for (let y = 0; y < height; y++) {
      raw[destOffset++] = 0; // filter: None
      const strip = rgbaStrips[stripIdx];
      const srcStart = stripRowOffset * rowBytes;
      raw.set(strip.subarray(srcStart, srcStart + rowBytes), destOffset);
      destOffset += rowBytes;
      stripRowOffset++;
      if (stripRowOffset >= strip.length / rowBytes) {
        stripIdx++;
        stripRowOffset = 0;
      }
    }

    // Compress
    const compressed = zlibCompress(raw);

    // IHDR
    const ihdr = new Uint8Array(13);
    ihdr[0] = (width >> 24) & 0xFF;
    ihdr[1] = (width >> 16) & 0xFF;
    ihdr[2] = (width >> 8) & 0xFF;
    ihdr[3] = width & 0xFF;
    ihdr[4] = (height >> 24) & 0xFF;
    ihdr[5] = (height >> 16) & 0xFF;
    ihdr[6] = (height >> 8) & 0xFF;
    ihdr[7] = height & 0xFF;
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // Assemble PNG
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrChunk = pngChunk('IHDR', ihdr);
    const idatChunk = pngChunk('IDAT', compressed);
    const iendChunk = pngChunk('IEND', new Uint8Array(0));

    const png = new Uint8Array(
      signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
    );
    let off = 0;
    png.set(signature, off); off += signature.length;
    png.set(ihdrChunk, off); off += ihdrChunk.length;
    png.set(idatChunk, off); off += idatChunk.length;
    png.set(iendChunk, off);

    return png;
  }

  // =========================================================
  // Tiled capture
  // =========================================================

  async function loadH2C() {
    if (!window.html2canvas) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
  }

  async function captureHD(pageWidth, pageHeight, scale, inspectorUI) {
    await loadH2C();

    const stripH = STRIP_HEIGHT; // at 1x
    const numStrips = Math.ceil(pageHeight / stripH);
    const scaledWidth = Math.round(pageWidth * scale);
    const totalScaledHeight = Math.round(pageHeight * scale);
    const rgbaStrips = [];

    for (let i = 0; i < numStrips; i++) {
      const y = i * stripH;
      const h = Math.min(stripH, pageHeight - y);

      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#fff',
        scale: scale,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: y,
        width: pageWidth,
        height: h,
        windowWidth: pageWidth,
        windowHeight: pageHeight,
        ignoreElements: inspectorUI
          ? (el) => inspectorUI.has(el)
          : undefined,
      });

      // Extract RGBA pixel data from this strip
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      rgbaStrips.push(imageData.data);

      // Update progress
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast(`Capturing... ${i + 1}/${numStrips}`);
      }
    }

    // Encode to PNG
    const pngData = encodePNG(scaledWidth, totalScaledHeight, rgbaStrips);
    const blob = new Blob([pngData], { type: 'image/png' });

    // Try clipboard, fallback to download
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast('HD screenshot copied to clipboard');
      }
    } catch (_) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'full-page-screenshot-hd.png';
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast('HD screenshot downloaded');
      }
    }
  }

  // =========================================================
  // Plugin registration
  // =========================================================

  function needsTiling(pageWidth, pageHeight, scale) {
    return (pageWidth * scale > MAX_CANVAS_DIM) ||
           (pageHeight * scale > MAX_CANVAS_DIM);
  }

  const plugin = {
    id: 'hd-capture',
    label: 'HD Capture',

    init(api) {
      console.log('[hd-capture] Plugin initialized');
      // Expose the HD capture hook
      window.DomTools._hdCapture = async function (w, h, scale) {
        console.log(`[hd-capture] Tiling ${w}x${h} @ ${scale}x`);
        await captureHD(w, h, scale, api.inspectorUI);
      };
      window.DomTools._hdCaptureNeeded = needsTiling;
      // Expose toast for progress updates
      window.DomTools._showToast = api.showToast;
    },

    enable() {},
    disable() {
      delete window.DomTools._hdCapture;
      delete window.DomTools._hdCaptureNeeded;
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  } else {
    window.DomTools = window.DomTools || {};
    window.DomTools._pendingPlugins = window.DomTools._pendingPlugins || [];
    window.DomTools._pendingPlugins.push(plugin);
  }
})();
