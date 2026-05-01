/**
 * DOM-Tools
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Toggle: click the floating button or press Cmd+Shift+K (Ctrl+Shift+K on Windows/Linux).
 * Click any element to copy its selector + text preview to clipboard.
 * Shift+click to multi-select — copies all selected sections together.
 * Hold Alt/Option for slot mode — green feedback shows insertion points, click copies slot location.
 * Press E to toggle edit mode — all text becomes editable in-place.
 */
(function() {
  let active = true;
  let hovered = null;
  let selected = []; // ordered list of {el, desc}
  let altHeld = false;
  let slotType = null; // 'before' | 'after' | 'left' | 'right' | 'inside'
  let editMode = false;
  const OUTLINE = '2px solid #0066ff';
  const BG = 'rgba(0, 102, 255, 0.08)';
  const SEL_OUTLINE = '2px solid #0066ff';
  const SEL_BG = 'rgba(0, 102, 255, 0.12)';
  const SLOT_OUTLINE = '2px solid #00a651';
  const SLOT_BG = 'rgba(0, 166, 81, 0.08)';

  // Slot indicator line
  const slotLine = document.createElement('div');
  Object.assign(slotLine.style, {
    position: 'fixed', left: '0', top: '0', height: '3px', width: '0',
    background: '#00a651', zIndex: '100001', pointerEvents: 'none',
    display: 'none', borderRadius: '2px',
    boxShadow: '0 0 6px rgba(0, 166, 81, 0.5)'
  });
  document.body.appendChild(slotLine);

  // Nudge animation style
  const nudgeStyle = document.createElement('style');
  nudgeStyle.textContent = `
    @keyframes inspector-nudge {
      0% { transform: translateY(0); }
      30% { transform: translateY(3px); }
      100% { transform: translateY(0); }
    }
    .inspector-nudge {
      animation: inspector-nudge 0.2s ease-out;
    }
  `;
  document.head.appendChild(nudgeStyle);

  // Edit-mode highlight style for text elements
  const editHighlightStyle = document.createElement('style');
  editHighlightStyle.textContent = `
    .inspector-edit-active p,
    .inspector-edit-active h1,
    .inspector-edit-active h2,
    .inspector-edit-active h3,
    .inspector-edit-active h4,
    .inspector-edit-active h5,
    .inspector-edit-active h6,
    .inspector-edit-active span,
    .inspector-edit-active a,
    .inspector-edit-active li,
    .inspector-edit-active td,
    .inspector-edit-active th,
    .inspector-edit-active label,
    .inspector-edit-active blockquote,
    .inspector-edit-active figcaption,
    .inspector-edit-active dt,
    .inspector-edit-active dd {
      background-color: rgba(230, 126, 0, 0.08) !important;
      outline: 1px dashed rgba(230, 126, 0, 0.25) !important;
      border-radius: 2px;
    }
    .inspector-edit-active p:hover,
    .inspector-edit-active h1:hover,
    .inspector-edit-active h2:hover,
    .inspector-edit-active h3:hover,
    .inspector-edit-active h4:hover,
    .inspector-edit-active h5:hover,
    .inspector-edit-active h6:hover,
    .inspector-edit-active span:hover,
    .inspector-edit-active a:hover,
    .inspector-edit-active li:hover,
    .inspector-edit-active td:hover,
    .inspector-edit-active th:hover,
    .inspector-edit-active label:hover,
    .inspector-edit-active blockquote:hover,
    .inspector-edit-active figcaption:hover,
    .inspector-edit-active dt:hover,
    .inspector-edit-active dd:hover {
      background-color: rgba(230, 126, 0, 0.15) !important;
      outline: 1px dashed rgba(230, 126, 0, 0.5) !important;
    }
  `;
  document.head.appendChild(editHighlightStyle);

  function nudge(el) {
    el.classList.remove('inspector-nudge');
    void el.offsetWidth; // force reflow
    el.classList.add('inspector-nudge');
    el.addEventListener('animationend', () => el.classList.remove('inspector-nudge'), { once: true });
  }

  // Toast
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#222', color: '#fff', padding: '8px 16px', borderRadius: '6px',
    fontSize: '13px', fontFamily: 'monospace', zIndex: '100000', display: 'none',
    transition: 'opacity 0.2s', whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis'
  });
  document.body.appendChild(toast);

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 200); }, 2000);
  }

  // Tooltip
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'fixed', background: '#222', color: '#fff', padding: '4px 8px',
    borderRadius: '4px', fontSize: '11px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '500', zIndex: '100001', pointerEvents: 'none', display: 'none',
    whiteSpace: 'nowrap', opacity: '0', transition: 'opacity 0.15s',
    letterSpacing: '0.2px'
  });
  document.body.appendChild(tooltip);
  let _tipTimer = null;
  function addTooltip(el, label) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(_tipTimer);
      _tipTimer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        tooltip.textContent = label;
        tooltip.style.display = 'block';
        // measure then position centered above the button
        const tw = tooltip.offsetWidth;
        tooltip.style.left = (r.left + r.width / 2 - tw / 2) + 'px';
        tooltip.style.top = (r.top - 28) + 'px';
        tooltip.style.opacity = '1';
      }, 400);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(_tipTimer);
      tooltip.style.opacity = '0';
      setTimeout(() => { tooltip.style.display = 'none'; }, 150);
    });
  }

  // Floating toggle button
  // Shared button style (no position/right — container handles layout)
  const btnStyle = {
    width: '40px', height: '40px', background: '#222', color: '#fff',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none',
    transition: 'background 0.15s', flexShrink: '0'
  };

  const btn = document.createElement('div');
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>';
  Object.assign(btn.style, btnStyle);
  btn.addEventListener('mouseenter', () => { if (!active) btn.style.background = '#444'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = active ? '#0066ff' : '#222'; });
  addTooltip(btn, 'Selector');

  const editBtn = document.createElement('div');
  editBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>';
  Object.assign(editBtn.style, btnStyle);
  editBtn.addEventListener('mouseenter', () => { if (!editMode) editBtn.style.background = '#444'; });
  editBtn.addEventListener('mouseleave', () => { editBtn.style.background = editMode ? '#e67e00' : '#222'; });
  editBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(editBtn); toggleEdit(); });
  addTooltip(editBtn, 'Edit Text');

  let cameraMode = false;
  const camBtn = document.createElement('div');
  camBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="3.2"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>';
  Object.assign(camBtn.style, btnStyle);
  camBtn.addEventListener('mouseenter', () => { if (!cameraMode) camBtn.style.background = '#444'; });
  camBtn.addEventListener('mouseleave', () => { camBtn.style.background = cameraMode ? '#cc3300' : '#222'; });
  camBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(camBtn); toggleCamera(); });
  addTooltip(camBtn, 'Screenshot');

  const fullPageBtn = document.createElement('div');
  fullPageBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
  Object.assign(fullPageBtn.style, btnStyle);
  fullPageBtn.addEventListener('mouseenter', () => { fullPageBtn.style.background = '#444'; });
  fullPageBtn.addEventListener('mouseleave', () => { fullPageBtn.style.background = '#222'; });
  fullPageBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(fullPageBtn); captureFullPage(); });

  let annotateMode = false;
  let annotateSub = 'sticky';
  const stickyNotes = [];
  const ANNOT_COLOR = '#7c3aed';
  const STICKY_BG = '#fef08a';
  const STICKY_BORDER = '#facc15';
  const PEN_COLOR = '#dc2626';
  const PEN_WIDTH = 2.5;

  const annotBtn = document.createElement('div');
  annotBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  Object.assign(annotBtn.style, btnStyle);
  annotBtn.addEventListener('mouseenter', () => { if (!annotateMode) annotBtn.style.background = '#444'; });
  annotBtn.addEventListener('mouseleave', () => { annotBtn.style.background = annotateMode ? ANNOT_COLOR : '#222'; });
  annotBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(annotBtn); toggleAnnotate('pen'); });
  addTooltip(annotBtn, 'Draw');

  let stickyMode = false;
  const stickyBtn = document.createElement('div');
  stickyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19 3H4.99c-1.1 0-1.98.9-1.98 2L3 19c0 1.1.89 2 1.99 2H15l6-6V5c0-1.1-.9-2-2-2zm-7 8H7v-2h5v2zm5-4H7V5h10v2zm-1 10v-4h4l-4 4z"/></svg>';
  Object.assign(stickyBtn.style, btnStyle);
  stickyBtn.addEventListener('mouseenter', () => { if (!stickyMode) stickyBtn.style.background = '#444'; });
  stickyBtn.addEventListener('mouseleave', () => { stickyBtn.style.background = stickyMode ? ANNOT_COLOR : '#222'; });
  stickyBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(stickyBtn); toggleAnnotate('sticky'); });
  addTooltip(stickyBtn, 'Sticky Note');

  const settingsBtn = document.createElement('div');
  settingsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>';
  Object.assign(settingsBtn.style, btnStyle);
  settingsBtn.addEventListener('mouseenter', () => { settingsBtn.style.background = '#444'; });
  settingsBtn.addEventListener('mouseleave', () => { settingsBtn.style.background = '#222'; });
  settingsBtn.addEventListener('click', function(e) { e.stopPropagation(); nudge(settingsBtn); showToast('Settings (coming soon)'); });
  addTooltip(settingsBtn, 'Settings');

  // Toolbar container — draggable
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: '6px', alignItems: 'center',
    zIndex: '100000', padding: '6px 8px',
    background: 'rgba(30,30,30,0.85)', borderRadius: '10px',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
  });

  // Drag handle (left side)
  const tbHandle = document.createElement('div');
  tbHandle.innerHTML = '⠿';
  Object.assign(tbHandle.style, {
    color: 'rgba(255,255,255,0.35)', fontSize: '14px', cursor: 'grab',
    userSelect: 'none', padding: '0 4px 0 2px', lineHeight: '1',
    letterSpacing: '1px'
  });
  toolbar.appendChild(tbHandle);

  // Add buttons in order: draw, sticky, camera, edit, inspector, settings
  [annotBtn, stickyBtn, camBtn, editBtn, btn, settingsBtn].forEach(b => toolbar.appendChild(b));
  document.body.appendChild(toolbar);
  btn.style.background = '#0066ff';
  document.body.style.cursor = 'crosshair';

  // Drag the toolbar via handle
  let tbDragging = false, tbDx = 0, tbDy = 0;
  tbHandle.addEventListener('mousedown', (e) => {
    tbDragging = true;
    const tbRect = toolbar.getBoundingClientRect();
    tbDx = e.clientX - tbRect.left;
    tbDy = e.clientY - tbRect.top;
    tbHandle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!tbDragging) return;
    toolbar.style.left = (e.clientX - tbDx) + 'px';
    toolbar.style.top = (e.clientY - tbDy) + 'px';
    toolbar.style.transform = 'none';
    toolbar.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (tbDragging) { tbDragging = false; tbHandle.style.cursor = 'grab'; }
  });

  // Drawing canvas overlay — absolute so it scrolls with the page
  const drawCanvas = document.createElement('canvas');
  Object.assign(drawCanvas.style, {
    position: 'absolute', top: '0', left: '0', zIndex: '99998', pointerEvents: 'none'
  });
  function resizeDrawCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const pageW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const oldData = drawCanvas.width > 0 ? drawCanvas.getContext('2d').getImageData(0, 0, drawCanvas.width, drawCanvas.height) : null;
    drawCanvas.width = pageW * dpr;
    drawCanvas.height = pageH * dpr;
    drawCanvas.style.width = pageW + 'px';
    drawCanvas.style.height = pageH + 'px';
    const ctx = drawCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (oldData) ctx.putImageData(oldData, 0, 0);
    ctx.strokeStyle = PEN_COLOR;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  resizeDrawCanvas();
  window.addEventListener('resize', resizeDrawCanvas);
  document.body.appendChild(drawCanvas);

  let isDrawing = false;
  drawCanvas.addEventListener('mousedown', (e) => {
    if (!annotateMode || annotateSub !== 'pen') return;
    isDrawing = true;
    const ctx = drawCanvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
  });
  drawCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const ctx = drawCanvas.getContext('2d');
    ctx.lineTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
    ctx.stroke();
  });
  drawCanvas.addEventListener('mouseup', () => { isDrawing = false; });
  drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; });

  // Selection box overlay for drag capture
  const selBox = document.createElement('div');
  Object.assign(selBox.style, {
    position: 'fixed', border: '2px dashed #cc3300', background: 'rgba(204, 51, 0, 0.08)',
    zIndex: '100001', pointerEvents: 'none', display: 'none', borderRadius: '2px'
  });
  document.body.appendChild(selBox);

  const CAM_OUTLINE = '2px solid #cc3300';
  const CAM_BG = 'rgba(204, 51, 0, 0.06)';
  let camDragging = false;
  let camStartX = 0, camStartY = 0;
  let camDidDrag = false;

  function toggleCamera() {
    if (cameraMode) {
      // Turn off camera, go back to selector
      deactivateAll();
      active = true;
      btn.style.background = '#0066ff';
      document.body.style.cursor = 'crosshair';
      showToast('Camera OFF');
    } else {
      // Turn on camera, turn off others
      deactivateAll();
      cameraMode = true;
      active = true; // keep active so onMove check passes for isInspectorUI
      camBtn.style.background = '#cc3300';
      document.body.style.cursor = 'crosshair';
      showToast('Camera ON — click element, drag area, or Cmd+Shift+S full page');
    }
  }

  async function loadH2C() {
    if (!window.html2canvas) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
  }

  // Camera shutter sound — preload to avoid delay on first play
  const _scriptDir = (document.currentScript?.src || '').replace(/[^/]*$/, '');
  const _shutterAudio = new Audio(_scriptDir + 'shutter.mp3');
  _shutterAudio.volume = 0.5;
  _shutterAudio.preload = 'auto';
  _shutterAudio.load();
  function playShutter() {
    try {
      const s = _shutterAudio.cloneNode();
      s.volume = 0.5;
      s.play();
    } catch (e) {}
  }

  // Screen flash on capture
  function flashScreen() {
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed', inset: '0', background: '#fff', zIndex: '100002',
      opacity: '0.6', pointerEvents: 'none', transition: 'opacity 0.3s'
    });
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 300);
    });
  }

  async function saveCapture(canvas, filename) {
    playShutter();
    flashScreen();
    try {
      const blobPromise = new Promise(r => canvas.toBlob(r, 'image/png'));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blobPromise })
      ]);
      showToast('Copied to clipboard');
    } catch (err) {
      try {
        const link = document.createElement('a');
        link.download = filename || 'screenshot.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Downloaded screenshot');
      } catch (e2) {
        showToast('Clipboard failed — requires HTTPS or localhost');
      }
    }
  }

  async function captureElement(el) {
    await loadH2C();
    // Strip inspector styles temporarily
    const oo = el.style.outline, ob = el.style.backgroundColor;
    el.style.outline = el._origOutline || '';
    el.style.backgroundColor = el._origBg || '';
    showToast('Capturing...');
    try {
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, logging: false });
      await saveCapture(canvas);
    } catch (e) { showToast('Capture failed'); }
    el.style.outline = oo;
    el.style.backgroundColor = ob;
  }

  async function captureRegion(x, y, w, h) {
    await loadH2C();
    showToast('Capturing...');
    try {
      // Capture full page then crop
      const scale = 2;
      const full = await html2canvas(document.documentElement, {
        backgroundColor: '#fff', scale: scale, logging: false,
        scrollX: 0, scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight
      });
      // Crop to selection (convert viewport coords to page coords)
      const sx = (x + window.scrollX) * scale;
      const sy = (y + window.scrollY) * scale;
      const sw = w * scale;
      const sh = h * scale;
      const crop = document.createElement('canvas');
      crop.width = sw;
      crop.height = sh;
      crop.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      await saveCapture(crop);
    } catch (e) { showToast('Capture failed'); }
  }

  async function captureFullPage() {
    await loadH2C();
    showToast('Capturing full page...');
    try {
      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#fff',
        scale: 2,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        ignoreElements: (el) => inspectorUI.has(el)
      });
      await saveCapture(canvas, 'full-page-screenshot.png');
    } catch (e) {
      showToast('Full page capture failed');
    }
  }

  // Annotation functions
  let _justPlacedNote = false; // true right after placing a note — next outside click deselects instead of creating

  function deleteStickyNote(note) {
    const idx = stickyNotes.indexOf(note);
    if (idx !== -1) stickyNotes.splice(idx, 1);
    inspectorUI.delete(note);
    note.remove();
  }

  function createStickyNote(x, y) {
    // Convert viewport coords to page coords so notes scroll with content
    const pageX = x + window.scrollX;
    const pageY = y + window.scrollY;
    const note = document.createElement('div');

    // Top bar: drag handle + delete button
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      height: '18px', background: STICKY_BORDER, borderRadius: '3px 3px 0 0',
      padding: '0 2px 0 0'
    });
    const handle = document.createElement('div');
    Object.assign(handle.style, {
      flex: '1', height: '100%', cursor: 'grab', userSelect: 'none'
    });
    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = '\u00d7';
    Object.assign(deleteBtn.style, {
      width: '16px', height: '16px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', cursor: 'pointer', fontSize: '13px',
      fontFamily: 'system-ui, sans-serif', color: '#666', borderRadius: '2px',
      lineHeight: '1', flexShrink: '0'
    });
    deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'rgba(0,0,0,0.1)'; deleteBtn.style.color = '#333'; });
    deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; deleteBtn.style.color = '#666'; });
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteStickyNote(note); });
    topBar.appendChild(handle);
    topBar.appendChild(deleteBtn);

    const body = document.createElement('div');
    body.contentEditable = 'true';
    body.textContent = 'Note';
    Object.assign(body.style, {
      padding: '6px 8px', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
      color: '#333', outline: 'none', minHeight: '24px', lineHeight: '1.4'
    });
    note.appendChild(topBar);
    note.appendChild(body);
    Object.assign(note.style, {
      position: 'absolute', left: pageX + 'px', top: pageY + 'px', width: '160px',
      background: STICKY_BG, border: '1px solid ' + STICKY_BORDER,
      borderRadius: '4px', zIndex: '99999',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'default'
    });
    document.body.appendChild(note);
    stickyNotes.push(note);
    inspectorUI.add(note);
    _justPlacedNote = true;
    setTimeout(() => { body.focus(); document.execCommand('selectAll'); }, 0);
    // Drag via handle (use page coords)
    let dragging = false, dx = 0, dy = 0;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      dragging = true;
      dx = (e.clientX + window.scrollX) - note.offsetLeft;
      dy = (e.clientY + window.scrollY) - note.offsetTop;
      handle.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      note.style.left = (e.clientX + window.scrollX - dx) + 'px';
      note.style.top = (e.clientY + window.scrollY - dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; handle.style.cursor = 'grab'; }
    });
    // Stop events from bubbling to inspector
    note.addEventListener('mousedown', (e) => e.stopPropagation());
    note.addEventListener('click', (e) => { e.stopPropagation(); _justPlacedNote = false; });
    note.addEventListener('keydown', (e) => e.stopPropagation());
  }

  function clearAnnotations() {
    stickyNotes.forEach(n => { inspectorUI.delete(n); n.remove(); });
    stickyNotes.length = 0;
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    showToast('Annotations cleared');
  }

  function toggleAnnotate(mode) {
    // If already in the requested mode, turn it off → back to selector
    if (annotateMode && annotateSub === mode) {
      deactivateAll();
      active = true;
      btn.style.background = '#0066ff';
      document.body.style.cursor = 'crosshair';
      showToast('Annotate off');
      return;
    }
    // Deactivate everything first, then enable annotate
    deactivateAll();
    annotateMode = true;
    annotateSub = mode;
    document.body.style.cursor = 'crosshair';
    if (mode === 'pen') {
      drawCanvas.style.pointerEvents = 'auto';
      annotBtn.style.background = ANNOT_COLOR;
      showToast('Draw mode (X=clear)');
    } else {
      stickyMode = true;
      stickyBtn.style.background = ANNOT_COLOR;
      showToast('Sticky notes (X=clear)');
    }
  }

  // Camera mousedown — start potential drag
  document.addEventListener('mousedown', function(e) {
    if (!cameraMode || isInspectorUI(e.target)) return;
    camDragging = true;
    camDidDrag = false;
    camStartX = e.clientX;
    camStartY = e.clientY;
  }, true);

  // Camera mousemove — if dragging, show selection box
  document.addEventListener('mousemove', function(e) {
    if (!cameraMode) return;
    if (camDragging) {
      const dx = Math.abs(e.clientX - camStartX);
      const dy = Math.abs(e.clientY - camStartY);
      if (dx > 4 || dy > 4) {
        camDidDrag = true;
        clearHover();
        const x = Math.min(e.clientX, camStartX);
        const y = Math.min(e.clientY, camStartY);
        Object.assign(selBox.style, {
          display: 'block', left: x + 'px', top: y + 'px',
          width: dx + 'px', height: dy + 'px'
        });
      }
      return;
    }
    // Not dragging — show DOM hover like selector, but in red
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
    if (hovered && hovered !== el) {
      hovered.style.outline = hovered._origOutline || '';
      hovered.style.backgroundColor = hovered._origBg || '';
    }
    if (el !== hovered) {
      el._origOutline = el._origOutline ?? el.style.outline;
      el._origBg = el._origBg ?? el.style.backgroundColor;
    }
    el.style.outline = CAM_OUTLINE;
    el.style.backgroundColor = CAM_BG;
    hovered = el;
  }, true);

  // Camera mouseup — either capture element or region
  document.addEventListener('mouseup', function(e) {
    if (!cameraMode || !camDragging) return;
    camDragging = false;

    if (camDidDrag) {
      // Drag capture
      const x = Math.min(e.clientX, camStartX);
      const y = Math.min(e.clientY, camStartY);
      const w = Math.abs(e.clientX - camStartX);
      const h = Math.abs(e.clientY - camStartY);
      selBox.style.display = 'none';
      if (w > 4 && h > 4) {
        captureRegion(x, y, w, h);
      }
    } else {
      // Click capture — capture hovered element
      const el = e.target;
      if (!isInspectorUI(el) && el !== document.body && el !== document.documentElement) {
        nudge(el);
        captureElement(el);
      }
    }
    camDidDrag = false;
  }, true);

  // Set of UI elements to ignore
  const inspectorUI = new Set([toast, tooltip, toolbar, tbHandle, btn, editBtn, camBtn, fullPageBtn, annotBtn, stickyBtn, settingsBtn, drawCanvas, slotLine, selBox]);

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el !== document.body) {
      let seg = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        seg += '.' + el.className.trim().split(/\s+/).join('.');
      }
      path.unshift(seg);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function getContext(el) {
    const sel = getSelector(el);
    const text = el.textContent.trim().substring(0, 80);
    let desc = sel;
    if (text) desc += ' | "' + text + (el.textContent.trim().length > 80 ? '...' : '') + '"';
    return desc;
  }

  function clearHover() {
    if (hovered) {
      // Restore to selected state if in selection, otherwise to original
      const idx = selected.findIndex(s => s.el === hovered);
      if (idx !== -1) {
        hovered.style.outline = SEL_OUTLINE;
        hovered.style.backgroundColor = SEL_BG;
      } else {
        hovered.style.outline = hovered._origOutline || '';
        hovered.style.backgroundColor = hovered._origBg || '';
      }
      hovered = null;
    }
  }

  function clearSelection() {
    selected.forEach(s => {
      s.el.style.outline = s.el._origOutline || '';
      s.el.style.backgroundColor = s.el._origBg || '';
      if (s.badge) s.badge.remove();
    });
    selected = [];
  }

  function addBadge(el, num) {
    const badge = document.createElement('div');
    badge.textContent = num;
    Object.assign(badge.style, {
      position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px',
      background: '#0066ff', color: '#fff', borderRadius: '50%', fontSize: '11px',
      fontWeight: '700', fontFamily: 'system-ui, sans-serif', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '99999',
      boxShadow: '0 1px 4px rgba(0,0,0,0.25)', pointerEvents: 'none'
    });
    // Ensure parent is positioned
    const pos = getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    return badge;
  }

  function refreshBadges() {
    selected.forEach((s, i) => {
      if (s.badge) s.badge.textContent = i + 1;
    });
  }

  function getSlotType(el, mouseX, mouseY) {
    const rect = el.getBoundingClientRect();
    const relX = (mouseX - rect.left) / rect.width;
    const relY = (mouseY - rect.top) / rect.height;
    // Edge zone thickness (25% from each edge)
    const edge = 0.25;
    const inXCenter = relX >= edge && relX <= (1 - edge);
    const inYCenter = relY >= edge && relY <= (1 - edge);
    // If deep inside the center, it's "inside"
    if (inXCenter && inYCenter) return 'inside';
    // Find which edge is closest
    const dTop = relY, dBottom = 1 - relY, dLeft = relX, dRight = 1 - relX;
    const min = Math.min(dTop, dBottom, dLeft, dRight);
    if (min === dTop) return 'before';
    if (min === dBottom) return 'after';
    if (min === dLeft) return 'left';
    return 'right';
  }

  function updateSlotLine(el, type) {
    const rect = el.getBoundingClientRect();
    if (type === 'inside') {
      slotLine.style.display = 'none';
      return;
    }
    if (type === 'before' || type === 'after') {
      const y = type === 'before' ? rect.top : rect.bottom;
      Object.assign(slotLine.style, {
        display: 'block',
        top: (y - 1) + 'px',
        left: rect.left + 'px',
        width: rect.width + 'px',
        height: '3px'
      });
    } else {
      const x = type === 'left' ? rect.left : rect.right;
      Object.assign(slotLine.style, {
        display: 'block',
        top: rect.top + 'px',
        left: (x - 1) + 'px',
        width: '3px',
        height: rect.height + 'px'
      });
    }
  }

  function getSlotDescription(el, type) {
    const sel = getSelector(el);
    const text = el.textContent.trim().substring(0, 60);
    const textPreview = text ? ' | "' + text + (el.textContent.trim().length > 60 ? '...' : '') + '"' : '';
    if (type === 'before') return 'Insert before: ' + sel + textPreview;
    if (type === 'after') return 'Insert after: ' + sel + textPreview;
    if (type === 'left') return 'Insert to the left of: ' + sel + textPreview;
    if (type === 'right') return 'Insert to the right of: ' + sel + textPreview;
    return 'Insert inside: ' + sel + ' (as child)' + textPreview;
  }

  function isInspectorUI(el) {
    let node = el;
    while (node) {
      if (inspectorUI.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function onMove(e) {
    if (!active || editMode || cameraMode || annotateMode) return;
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
    if (hovered && hovered !== el) clearHover();
    if (el !== hovered) {
      el._origOutline = el._origOutline ?? el.style.outline;
      el._origBg = el._origBg ?? el.style.backgroundColor;
    }
    if (altHeld) {
      slotType = getSlotType(el, e.clientX, e.clientY);
      el.style.outline = SLOT_OUTLINE;
      el.style.backgroundColor = slotType === 'inside' ? SLOT_BG : (el._origBg || '');
      updateSlotLine(el, slotType);
    } else {
      slotLine.style.display = 'none';
      el.style.outline = OUTLINE;
      el.style.backgroundColor = BG;
    }
    hovered = el;
  }

  function onClick(e) {
    if ((!active && !annotateMode) || editMode) return;
    const el = e.target;
    if (isInspectorUI(el)) return;
    // Allow copy-box buttons to work natively on the index page
    if (el.closest && el.closest('.copy-box')) return;

    if (annotateMode && annotateSub === 'sticky') {
      e.preventDefault();
      e.stopPropagation();
      if (_justPlacedNote) {
        // Click outside a note after placing — just deselect, ready for next placement
        _justPlacedNote = false;
        if (document.activeElement && document.activeElement.isContentEditable) {
          document.activeElement.blur();
        }
        return;
      }
      createStickyNote(e.clientX, e.clientY);
      return;
    }
    if (annotateMode) return; // pen mode handles its own events on canvas

    e.preventDefault();
    e.stopPropagation();

    if (cameraMode) return;

    nudge(el);

    if (e.altKey && slotType) {
      // Slot mode: copy insertion point description
      const slotDesc = getSlotDescription(el, slotType);
      slotLine.style.display = 'none';
      navigator.clipboard.writeText(slotDesc).then(() => {
        showToast('Slot copied: ' + slotDesc);
      }).catch(() => showToast(slotDesc));
    } else if (e.shiftKey) {
      // Multi-select: toggle element in/out of selection
      const desc = getContext(el);
      const idx = selected.findIndex(s => s.el === el);
      if (idx !== -1) {
        el.style.outline = el._origOutline || '';
        el.style.backgroundColor = el._origBg || '';
        if (selected[idx].badge) selected[idx].badge.remove();
        selected.splice(idx, 1);
        refreshBadges();
      } else {
        el.style.outline = SEL_OUTLINE;
        el.style.backgroundColor = SEL_BG;
        const badge = addBadge(el, selected.length + 1);
        selected.push({ el, desc, badge });
      }
      if (selected.length) {
        const combined = selected.map((s, i) => `[${i + 1}] ${s.desc}`).join('\n');
        navigator.clipboard.writeText(combined).then(() => {
          showToast(`Copied ${selected.length} selection${selected.length > 1 ? 's' : ''}`);
        }).catch(() => showToast(combined));
      } else {
        showToast('Selection cleared');
      }
    } else {
      // Single click: clear previous selection, copy this one
      const desc = getContext(el);
      clearSelection();
      navigator.clipboard.writeText(desc).then(() => {
        showToast('Copied: ' + desc);
      }).catch(() => showToast(desc));
    }
  }

  // Deactivate all tools and reset visuals
  function deactivateAll() {
    active = false;
    editMode = false;
    cameraMode = false;
    camDragging = false;
    annotateMode = false;
    isDrawing = false;
    drawCanvas.style.pointerEvents = 'none';
    document.designMode = 'off';
    document.documentElement.classList.remove('inspector-edit-active');
    clearHover();
    clearSelection();
    slotLine.style.display = 'none';
    selBox.style.display = 'none';
    btn.style.background = '#222';
    editBtn.style.background = '#222';
    camBtn.style.background = '#222';
    annotBtn.style.background = '#222';
    stickyBtn.style.background = '#222';
    stickyMode = false;
    document.body.style.cursor = '';
  }

  function toggleEdit() {
    if (editMode) {
      // Turn off edit
      deactivateAll();
      active = true;
      btn.style.background = '#0066ff';
      document.body.style.cursor = 'crosshair';
      showToast('Edit mode OFF');
    } else {
      // Turn on edit, turn off others
      deactivateAll();
      editMode = true;
      document.designMode = 'on';
      document.documentElement.classList.add('inspector-edit-active');
      document.body.style.cursor = 'text';
      editBtn.style.background = '#e67e00';
      showToast('Edit mode ON — click anywhere to edit text');
    }
  }

  function toggle() {
    if (active && !editMode && !cameraMode) {
      // Turn off selector
      deactivateAll();
      showToast('Inspector OFF');
    } else {
      // Turn on selector, turn off others
      deactivateAll();
      active = true;
      btn.style.background = '#0066ff';
      document.body.style.cursor = 'crosshair';
      showToast('Inspector ON — click to copy, Shift multi-select, Alt for slots');
    }
  }

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    nudge(btn);
    toggle();
  });
  function onMouseDown(e) {
    if (!active) return;
    if (e.shiftKey || e.altKey) {
      e.preventDefault();
    }
  }

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseleave', clearHover, true);
  document.addEventListener('click', onClick, true);
  let lastEsc = 0;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Alt') {
      e.preventDefault();
      altHeld = true;
      if (active && hovered) {
        const rect = hovered.getBoundingClientRect();
        slotType = getSlotType(hovered, rect.left + rect.width / 2, rect.top + rect.height / 2);
        hovered.style.outline = SLOT_OUTLINE;
        hovered.style.backgroundColor = slotType === 'inside' ? SLOT_BG : (hovered._origBg || '');
        updateSlotLine(hovered, slotType);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggle();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      captureFullPage();
    }
    // Annotate sub-mode keys: N=sticky notes, D=draw, X=clear
    if (annotateMode && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      toggleAnnotate('sticky');
    }
    if (annotateMode && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toggleAnnotate('pen');
    }
    if (annotateMode && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      clearAnnotations();
    }
    if (e.key === 'Escape') {
      if (annotateMode) {
        e.preventDefault();
        toggleAnnotate();
        return;
      }
      if (editMode) {
        e.preventDefault();
        toggleEdit();
        return;
      }
      const now = Date.now();
      if (now - lastEsc < 400) {
        toggle();
        lastEsc = 0;
      } else {
        lastEsc = now;
      }
    }
  });
  document.addEventListener('keyup', function(e) {
    if (e.key === 'Alt') {
      altHeld = false;
      slotType = null;
      slotLine.style.display = 'none';
      if (active && hovered) {
        hovered.style.outline = OUTLINE;
        hovered.style.backgroundColor = BG;
      }
    }
  });

})();
