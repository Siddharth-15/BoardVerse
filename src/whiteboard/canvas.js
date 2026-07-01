import { emitDrawStroke, emitEndStroke, emitCursorMove, emitDeleteStroke } from '../services/socket';

let canvas = null;
let ctx = null;
let isDrawing = false;
let currentPoints = [];

// Local state config
let activeColor = '#ffffff';
let activeWidth = 5;
let activeTool = 'pencil'; // 'pencil' or 'eraser'
let activeSessionId = null;
let currentUserId = null;

// History of strokes and remote active strokes in progress
// A stroke is: { points: [{x, y}...], color, width, tool, userId }
let strokeHistory = [];
const remoteActiveStrokes = new Map(); // userId -> stroke

// Image selection & transform states
let selectedImageStroke = null;
let isDraggingImage = false;
let isResizingImage = false;
let dragStartOffset = { x: 0, y: 0 };
let hoverImageStroke = null;

// Throttling for cursor emission
let lastCursorEmitTime = 0;
const CURSOR_EMIT_INTERVAL = 45; // ms (approx 22fps, very smooth)

export function initWhiteboard(canvasElement, sessionId, userId) {
  canvas = canvasElement;
  ctx = canvas.getContext('2d');
  activeSessionId = sessionId;
  currentUserId = userId;

  // Clear previous states
  strokeHistory = [];
  remoteActiveStrokes.clear();
  selectedImageStroke = null;
  isDraggingImage = false;
  isResizingImage = false;
  hoverImageStroke = null;
  document.getElementById('cursors-overlay').innerHTML = '';

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Unify pointer events (mouse, touch, stylus)
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
}

export function cleanupWhiteboard() {
  window.removeEventListener('resize', resizeCanvas);
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  }
  canvas = null;
  ctx = null;
  strokeHistory = [];
  remoteActiveStrokes.clear();
  selectedImageStroke = null;
  isDraggingImage = false;
  isResizingImage = false;
  hoverImageStroke = null;
}

export function setTool(tool) {
  activeTool = tool;
}

export function setColor(color) {
  activeColor = color;
}

export function setBrushSize(size) {
  activeWidth = size;
}

export function getCanvas() {
  return canvas;
}

// Loads drawing history from server database
export function loadStrokeHistory(strokes) {
  strokeHistory = strokes || [];
  redrawCanvas();
  updateImageLayersHUD();
}

// Resizes canvas with backing store pixel ratio correction
function resizeCanvas() {
  if (!canvas || !ctx) return;
  
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  redrawCanvas();
}

// Clear local canvas
export function clearLocalCanvas() {
  if (!canvas || !ctx) return;
  strokeHistory = [];
  remoteActiveStrokes.clear();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateImageLayersHUD();
}

// Full screen redraw of history and active remote strokes
export function redrawCanvas() {
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw historical paths
  for (const stroke of strokeHistory) {
    drawStroke(stroke);
  }

  // 2. Draw remote paths currently in progress
  for (const stroke of remoteActiveStrokes.values()) {
    drawStroke(stroke);
  }

  // 3. Draw hover/selection borders for images when image tool is active
  if (activeTool === 'image') {
    const strokeToHighlight = selectedImageStroke || hoverImageStroke;
    if (strokeToHighlight) {
      const pt = strokeToHighlight.points[0];
      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.strokeStyle = '#06b6d4'; // Cyan primary branding color
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);

      const padding = 2;
      const pxX = pt.x * w - padding;
      const pxY = pt.y * h - padding;
      const pxW = pt.w * w + padding * 2;
      const pxH = pt.h * h + padding * 2;

      ctx.strokeRect(pxX, pxY, pxW, pxH);

      // Draw resize handle square at bottom-right corner
      ctx.fillStyle = '#06b6d4';
      ctx.setLineDash([]); // solid handle borders
      ctx.fillRect(pxX + pxW - 6, pxY + pxH - 6, 12, 12);
      ctx.restore();
    }
  }
}

// Caching image element to prevent flickering on redraw
const imageCache = new Map();

// Helper: draw single path
function drawStroke(stroke) {
  const { points, color, width, tool } = stroke;
  if (!points || points.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;

  // Render text
  if (tool === 'text') {
    const pt = points[0];
    const colorParts = color.split('|');
    const txtColor = colorParts[0];
    const fontName = colorParts[1] || 'Outfit';
    ctx.font = `${width}px '${fontName}', 'Inter', sans-serif`;
    ctx.fillStyle = txtColor;
    ctx.textBaseline = 'top';
    ctx.fillText(pt.text, pt.x * w, pt.y * h);
    return;
  }

  // Render base64 image
  if (tool === 'image') {
    const pt = points[0];
    let img = imageCache.get(pt.base64);
    if (!img) {
      img = new Image();
      img.src = pt.base64;
      img.onload = () => {
        imageCache.set(pt.base64, img);
        redrawCanvas();
        updateImageLayersHUD();
      };
      // Temporary border layout
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.strokeRect(pt.x * w, pt.y * h, pt.w * w, pt.h * h);
      return;
    }
    ctx.drawImage(img, pt.x * w, pt.y * h, pt.w * w, pt.h * h);
    return;
  }

  ctx.beginPath();
  // If eraser, draw background color to erase
  ctx.strokeStyle = tool === 'eraser' ? '#0d0d15' : color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.fillStyle = tool === 'eraser' ? '#0d0d15' : color;
    ctx.arc(points[0].x * w, points[0].y * h, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.moveTo(points[0].x * w, points[0].y * h);

  // Quadratic curve interpolation for smooth drawings
  for (let i = 1; i < points.length - 1; i++) {
    const xc = ((points[i].x + points[i + 1].x) / 2) * w;
    const yc = ((points[i].y + points[i + 1].y) / 2) * h;
    ctx.quadraticCurveTo(points[i].x * w, points[i].y * h, xc, yc);
  }

  // Draw last segment
  const lastIdx = points.length - 1;
  ctx.lineTo(points[lastIdx].x * w, points[lastIdx].y * h);
  ctx.stroke();
}

// Pointer Down Event
function onPointerDown(e) {
  if (e.button !== 0 && !e.touches) return; // Only allow left-clicks/touches

  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / canvas.clientWidth;
  const y = (e.clientY - rect.top) / canvas.clientHeight;

  // Intercept click if using Image tool to drag/resize existing images
  if (activeTool === 'image') {
    let hitImage = null;
    let hitHandle = false;

    // Scan backward to select topmost image first
    const imageStrokes = strokeHistory.filter(s => s.tool === 'image');
    for (let i = imageStrokes.length - 1; i >= 0; i--) {
      const s = imageStrokes[i];
      const pt = s.points[0];
      
      const right = pt.x + pt.w;
      const bottom = pt.y + pt.h;
      
      // Calculate normalized hover threshold coordinates (20px in physical space)
      const thresholdX = 20 / canvas.width;
      const thresholdY = 20 / canvas.height;

      // Check if click was close to bottom-right resize handle corner
      if (Math.abs(x - right) < thresholdX && Math.abs(y - bottom) < thresholdY) {
        hitImage = s;
        hitHandle = true;
        break;
      }

      // Check if click was inside image box
      if (x >= pt.x && x <= right && y >= pt.y && y <= bottom) {
        hitImage = s;
        hitHandle = false;
        break;
      }
    }

    if (hitImage) {
      selectedImageStroke = hitImage;
      canvas.setPointerCapture(e.pointerId);

      if (hitHandle) {
        isResizingImage = true;
        dragStartOffset = {
          w: hitImage.points[0].w,
          h: hitImage.points[0].h,
          clientX: e.clientX,
          clientY: e.clientY
        };
      } else {
        isDraggingImage = true;
        dragStartOffset = {
          x: x - hitImage.points[0].x,
          y: y - hitImage.points[0].y
        };
      }
      redrawCanvas();
      return;
    } else {
      // Clicked away, deselect active selected image
      selectedImageStroke = null;
      hoverImageStroke = null;
      redrawCanvas();
    }
  }

  // Intercept click if using Text tool
  if (activeTool === 'text') {
    const inputOverlay = document.getElementById('text-input-overlay');
    const textInput = document.getElementById('canvas-text-input');
    if (inputOverlay && textInput) {
      inputOverlay.style.left = `${e.clientX}px`;
      inputOverlay.style.top = `${e.clientY}px`;
      inputOverlay.style.display = 'block';
      textInput.value = '';
      textInput.dataset.normX = (e.clientX - rect.left) / canvas.clientWidth;
      textInput.dataset.normY = (e.clientY - rect.top) / canvas.clientHeight;
      setTimeout(() => textInput.focus(), 50);
    }
    return;
  }

  isDrawing = true;
  canvas.setPointerCapture(e.pointerId);
  
  const point = { x, y };
  currentPoints = [point];

  // Emit start stroke event to other users
  emitDrawStroke(activeSessionId, point, activeColor, activeWidth, activeTool, true);
  redrawCanvas();
}

// Pointer Move Event
function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / canvas.clientWidth;
  const y = (e.clientY - rect.top) / canvas.clientHeight;

  // Emit cursor position (throttled)
  const now = performance.now();
  if (now - lastCursorEmitTime > CURSOR_EMIT_INTERVAL) {
    emitCursorMove(activeSessionId, x, y, localStorage.getItem('boardverse_username') || 'Guest');
    lastCursorEmitTime = now;
  }

  // 1. Process active image transforms dragging/resizing
  if (activeTool === 'image' && selectedImageStroke) {
    const pt = selectedImageStroke.points[0];

    if (isDraggingImage) {
      pt.x = x - dragStartOffset.x;
      pt.y = y - dragStartOffset.y;
      
      // Emit real-time coordinate transformations
      emitDrawStroke(activeSessionId, pt, selectedImageStroke.color, 0, 'image', true);
    } else if (isResizingImage) {
      const deltaX = e.clientX - dragStartOffset.clientX;
      const deltaY = e.clientY - dragStartOffset.clientY;

      pt.w = Math.max(0.05, dragStartOffset.w + deltaX / canvas.clientWidth);
      pt.h = Math.max(0.05, dragStartOffset.h + deltaY / canvas.clientHeight);

      // Emit real-time scale changes
      emitDrawStroke(activeSessionId, pt, selectedImageStroke.color, 0, 'image', true);
    }
    redrawCanvas();
    return;
  }

  // 2. Scan for mouse hovers on images to highlight
  if (activeTool === 'image' && !isDrawing && !isDraggingImage && !isResizingImage) {
    let foundHover = null;
    const imageStrokes = strokeHistory.filter(s => s.tool === 'image');
    for (let i = imageStrokes.length - 1; i >= 0; i--) {
      const s = imageStrokes[i];
      const pt = s.points[0];
      if (x >= pt.x && x <= pt.x + pt.w && y >= pt.y && y <= pt.y + pt.h) {
        foundHover = s;
        break;
      }
    }
    if (foundHover !== hoverImageStroke) {
      hoverImageStroke = foundHover;
      redrawCanvas();
    }
  }

  if (!isDrawing) return;

  const point = { x, y };
  currentPoints.push(point);

  // Emit draw point to others
  emitDrawStroke(activeSessionId, point, activeColor, activeWidth, activeTool, false);
  redrawCanvas();
}

// Pointer Up Event
function onPointerUp(e) {
  // Save position modifications on pointer release
  if (activeTool === 'image' && selectedImageStroke) {
    canvas.releasePointerCapture(e.pointerId);

    // Save final coordinates to SQLite via socket emit
    emitEndStroke(activeSessionId, selectedImageStroke.points, selectedImageStroke.color, 0, 'image');

    isDraggingImage = false;
    isResizingImage = false;
    selectedImageStroke = null;
    redrawCanvas();
    return;
  }

  if (!isDrawing) return;
  isDrawing = false;
  canvas.releasePointerCapture(e.pointerId);

  // Save stroke locally
  const completedStroke = {
    points: currentPoints,
    color: activeColor,
    width: activeWidth,
    tool: activeTool,
    userId: currentUserId
  };
  strokeHistory.push(completedStroke);

  // Emit end stroke event to persist in SQLite DB
  emitEndStroke(activeSessionId, currentPoints, activeColor, activeWidth, activeTool);
  currentPoints = [];
  redrawCanvas();
}

// --- SOCKET STREAM HANDLERS ---

// Remote point received
export function handleRemoteDrawPoint({ userId, point, color, width, tool, isNewPath }) {
  // Support real-time dragging & resizing image transformations from other clients
  if (tool === 'image') {
    const existingIndex = strokeHistory.findIndex(s => s.tool === 'image' && s.color === color);
    if (existingIndex !== -1) {
      strokeHistory[existingIndex].points = [point];
      redrawCanvas();
      return;
    }
  }

  if (!remoteActiveStrokes.has(userId)) {
    remoteActiveStrokes.set(userId, { points: [], color, width, tool, userId });
  }

  const remoteStroke = remoteActiveStrokes.get(userId);
  if (isNewPath) {
    remoteStroke.points = [point];
    remoteStroke.color = color;
    remoteStroke.width = width;
    remoteStroke.tool = tool;
  } else {
    remoteStroke.points.push(point);
  }

  redrawCanvas();
}

// Remote stroke ends
export function handleRemoteEndStroke({ userId }) {
  const remoteStroke = remoteActiveStrokes.get(userId);
  if (remoteStroke) {
    strokeHistory.push({ ...remoteStroke });
    remoteActiveStrokes.delete(userId);
  }
  redrawCanvas();
}

// Remote cursor tracking overlays
export function handleRemoteCursorMove({ userId, username, x, y }) {
  if (userId === currentUserId) return;

  const container = document.getElementById('cursors-overlay');
  let cursorEl = document.getElementById(`cursor-${userId}`);

  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.id = `cursor-${userId}`;
    cursorEl.className = 'floating-cursor';
    
    // Choose custom cursor colors based on userId hash
    const colors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#eab308', '#10b981'];
    const charCodeSum = userId.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const color = colors[charCodeSum % colors.length];

    cursorEl.innerHTML = `
      <div class="cursor-pointer-dot" style="background-color: ${color};"></div>
      <div class="cursor-name-tag" style="background-color: ${color};">${username}</div>
    `;
    container.appendChild(cursorEl);
  }

  // Place floating element percentage-wise
  cursorEl.style.left = `${x * 100}%`;
  cursorEl.style.top = `${y * 100}%`;

  // Auto-fadeout cursor if user stops moving for 5 seconds
  clearTimeout(cursorEl.timeoutId);
  cursorEl.style.opacity = '1';
  cursorEl.timeoutId = setTimeout(() => {
    cursorEl.style.opacity = '0';
  }, 4000);
}

// Clean cursor elements when users disconnect
export function handleRemoveCursor({ userId }) {
  const cursorEl = document.getElementById(`cursor-${userId}`);
  if (cursorEl) {
    clearTimeout(cursorEl.timeoutId);
    cursorEl.remove();
  }
}

// Add local text stroke
export function addLocalText(text, x, y, fontStyle = 'Outfit', fontSize = 32) {
  const points = [{ x, y, text }];
  const compoundColor = `${activeColor}|${fontStyle}`;
  const completedStroke = {
    points,
    color: compoundColor,
    width: fontSize,
    tool: 'text',
    userId: currentUserId
  };
  strokeHistory.push(completedStroke);
  emitEndStroke(activeSessionId, points, compoundColor, fontSize, 'text');
  redrawCanvas();
}

// Add local image layer
export function addLocalImage(base64, x, y, w, h) {
  const imageId = 'img_' + Math.random().toString(36).substring(2, 9);
  const points = [{ x, y, w, h, base64 }];
  const completedStroke = {
    points,
    color: imageId, // Storing unique imageId in color field
    width: 0,
    tool: 'image',
    userId: currentUserId
  };
  strokeHistory.push(completedStroke);
  emitEndStroke(activeSessionId, points, imageId, 0, 'image');
  redrawCanvas();
  updateImageLayersHUD();
}

// Local image deletion
export function deleteLocalImage(imageId) {
  strokeHistory = strokeHistory.filter(s => s.color !== imageId);
  emitDeleteStroke(activeSessionId, imageId);
  redrawCanvas();
  updateImageLayersHUD();
}

// Socket deletion handler
export function handleRemoteDeleteStroke({ strokeId }) {
  strokeHistory = strokeHistory.filter(s => s.color !== strokeId);
  redrawCanvas();
  updateImageLayersHUD();
}

// Floating Image Manager GUI renderer
export function updateImageLayersHUD() {
  const listContainer = document.getElementById('room-active-images');
  const panel = document.getElementById('images-panel');
  if (!listContainer || !panel) return;

  const imageStrokes = strokeHistory.filter(s => s.tool === 'image');
  if (imageStrokes.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  listContainer.innerHTML = '';

  imageStrokes.forEach((stroke, index) => {
    const imgId = stroke.color;
    const name = `Image ${index + 1}`;
    
    const item = document.createElement('div');
    item.className = 'image-item';
    item.innerHTML = `
      <span>${name}</span>
      <button class="btn-delete-img" data-id="${imgId}" title="Remove image">
        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
      </button>
    `;

    item.querySelector('.btn-delete-img').addEventListener('click', () => {
      deleteLocalImage(imgId);
    });

    listContainer.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons();
}
