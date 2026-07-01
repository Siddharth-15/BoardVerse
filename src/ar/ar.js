import * as THREE from 'three';
import { getCanvas } from '../whiteboard/canvas';

let scene, camera, renderer;
let planeMesh, canvasTexture;
let videoElement, arCanvas;

// Camera Media stream handle
let cameraStream = null;

// Transformation state parameters
let boardPosition = { x: 0, y: 0, z: -15 }; // Default position in 3D
let boardRotation = { x: 0, y: 0, z: 0 };
let boardScale = 1.0;

// Mouse drag state tracking
let isDragging = false;
let previousPointerPosition = { x: 0, y: 0 };

// Gyro Lock states
let isGyroLocked = false;
let initialOrientation = null;

export function initAR(videoTag, canvasTag) {
  videoElement = videoTag;
  arCanvas = canvasTag;

  // 1. Set up Camera Media Stream
  startCameraStream();

  // 2. Set up Three.js Scene
  initThreeJS();

  // 3. Set up Input Listeners
  initInputListeners();

  // 4. Start Render Animation Loop
  animate();

  window.addEventListener('resize', handleARResize);
}

export function stopAR() {
  window.removeEventListener('resize', handleARResize);

  // Stop Camera feed
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (videoElement) {
    videoElement.srcObject = null;
  }

  // Remove Event Listeners
  if (arCanvas) {
    arCanvas.removeEventListener('pointerdown', onPointerDown);
    arCanvas.removeEventListener('pointermove', onPointerMove);
    arCanvas.removeEventListener('pointerup', onPointerUp);
    arCanvas.removeEventListener('wheel', onWheel);
  }

  // Disable Gyro Lock
  if (isGyroLocked) {
    toggleGyroLock(false);
  }

  // Clean up Three.js objects
  if (renderer) {
    renderer.dispose();
  }
  if (planeMesh) {
    planeMesh.geometry.dispose();
    planeMesh.material.dispose();
  }
  if (canvasTexture) {
    canvasTexture.dispose();
  }

  scene = null;
  camera = null;
  renderer = null;
  planeMesh = null;
  canvasTexture = null;
}

function startCameraStream() {
  const constraints = {
    audio: false,
    video: {
      facingMode: 'environment', // Request back camera if on mobile
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      cameraStream = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
      }
    })
    .catch(err => {
      console.warn('Unable to access camera. Running in simulated fallback backdrop:', err);
      // Renders standard space-dark background if camera is blocked/unavailable
      if (videoElement) {
        videoElement.style.background = 'radial-gradient(circle, #181432 0%, #06060c 100%)';
      }
    });
}

function initThreeJS() {
  const rect = arCanvas.getBoundingClientRect();

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.1, 1000);
  camera.position.set(0, 0, 0); // Position at origin

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: arCanvas,
    alpha: true, // Transparent so video stream behind shows
    antialias: true
  });
  renderer.setSize(rect.width, rect.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Ambient Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  // Directional Lighting
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
  dirLight.position.set(0, 10, 10);
  scene.add(dirLight);

  // 3D Whiteboard Plane geometry setup
  const whiteboard2D = getCanvas();
  let aspect = 1.6; // Standard fallback aspect ratio (16:10)
  if (whiteboard2D) {
    aspect = whiteboard2D.width / whiteboard2D.height;
  }

  // Width is dynamic relative to aspect, height is pinned to 8.0 units in 3D
  const planeHeight = 8.0;
  const planeWidth = planeHeight * aspect;

  const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

  // Create CanvasTexture mapping the active 2D Canvas context
  if (whiteboard2D) {
    canvasTexture = new THREE.CanvasTexture(whiteboard2D);
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
  }

  // Material setup: glowing translucent glass whiteboard look
  const material = new THREE.MeshBasicMaterial({
    map: canvasTexture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
  });

  planeMesh = new THREE.Mesh(geometry, material);
  
  // Set initial transforms
  planeMesh.position.set(boardPosition.x, boardPosition.y, boardPosition.z);
  planeMesh.rotation.set(boardRotation.x, boardRotation.y, boardRotation.z);
  planeMesh.scale.setScalar(boardScale);
  
  scene.add(planeMesh);
}

function initInputListeners() {
  arCanvas.addEventListener('pointerdown', onPointerDown);
  arCanvas.addEventListener('pointermove', onPointerMove);
  arCanvas.addEventListener('pointerup', onPointerUp);
  arCanvas.addEventListener('pointercancel', onPointerUp);
  arCanvas.addEventListener('wheel', onWheel);

  // Connect configuration UI sliders
  const rotSlider = document.getElementById('ar-slider-rotate');
  const scaleSlider = document.getElementById('ar-slider-scale');
  const depthSlider = document.getElementById('ar-slider-depth');
  const btnReset = document.getElementById('btn-ar-reset');
  const btnGyro = document.getElementById('btn-ar-gyro');

  if (rotSlider) {
    rotSlider.addEventListener('input', (e) => {
      const angle = parseFloat(e.target.value);
      updateRotation(angle);
    });
  }

  if (scaleSlider) {
    scaleSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      updateScale(val);
    });
  }

  if (depthSlider) {
    depthSlider.addEventListener('input', (e) => {
      const val = -parseFloat(e.target.value) / 10;
      updateDepth(val);
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      resetTransforms();
    });
  }

  if (btnGyro) {
    btnGyro.addEventListener('click', () => {
      requestGyroAccess();
    });
  }
}

// Viewport Resize Handler
function handleARResize() {
  if (!arCanvas || !camera || !renderer) return;
  const rect = arCanvas.getBoundingClientRect();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height);
}

// Sliders and interaction mutations
export function updateRotation(deg) {
  boardRotation.y = THREE.MathUtils.degToRad(deg);
  if (planeMesh) {
    planeMesh.rotation.y = boardRotation.y;
  }
  const display = document.getElementById('ar-rot-val');
  if (display) display.textContent = `${Math.round(deg)}°`;

  const slider = document.getElementById('ar-slider-rotate');
  if (slider) slider.value = deg;
}

export function updateScale(val) {
  boardScale = val;
  if (planeMesh) {
    planeMesh.scale.setScalar(boardScale);
  }
  const display = document.getElementById('ar-scale-val');
  if (display) display.textContent = `${Math.round(val * 100)}%`;

  const slider = document.getElementById('ar-slider-scale');
  if (slider) slider.value = val * 100;
}

export function updateDepth(val) {
  boardPosition.z = val;
  if (planeMesh) {
    planeMesh.position.z = boardPosition.z;
  }
  const display = document.getElementById('ar-depth-val');
  if (display) display.textContent = `${Math.abs(val).toFixed(1)}m`;

  const slider = document.getElementById('ar-slider-depth');
  if (slider) slider.value = Math.abs(val) * 10;
}

function resetTransforms() {
  boardPosition = { x: 0, y: 0, z: -15 };
  boardRotation = { x: 0, y: 0, z: 0 };
  boardScale = 1.0;

  if (planeMesh) {
    planeMesh.position.set(boardPosition.x, boardPosition.y, boardPosition.z);
    planeMesh.rotation.set(boardRotation.x, boardRotation.y, boardRotation.z);
    planeMesh.scale.setScalar(boardScale);
  }

  updateRotation(0);
  updateScale(1.0);
  updateDepth(-15);
  
  if (camera) {
    camera.rotation.set(0, 0, 0);
  }
}

// Pointer Event Handlers for Dragging
function onPointerDown(e) {
  isDragging = true;
  previousPointerPosition = {
    x: e.clientX,
    y: e.clientY
  };
  arCanvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!isDragging || !planeMesh) return;

  const deltaX = e.clientX - previousPointerPosition.x;
  const deltaY = e.clientY - previousPointerPosition.y;

  // Sensitivity scaler mapping 2D drag movements to 3D units
  // Closer depth requires less sensitivity
  const depthFactor = Math.abs(planeMesh.position.z) / 40;
  const sensitivity = 0.03 * depthFactor;

  boardPosition.x += deltaX * sensitivity;
  boardPosition.y -= deltaY * sensitivity; // Invert Y axis

  planeMesh.position.set(boardPosition.x, boardPosition.y, boardPosition.z);

  previousPointerPosition = {
    x: e.clientX,
    y: e.clientY
  };
}

function onPointerUp(e) {
  if (!isDragging) return;
  isDragging = false;
  arCanvas.releasePointerCapture(e.pointerId);
}

// Scroll Wheel changes scale
function onWheel(e) {
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  const nextScale = Math.max(0.1, Math.min(3.0, boardScale + delta));
  updateScale(nextScale);
}

// --- GYROSCOPE AND DEVICE ORIENTATION ---

async function requestGyroAccess() {
  if (typeof DeviceOrientationEvent === 'undefined') {
    showToast('Gyroscope orientation not supported on this device', 'error');
    return;
  }

  // iOS 13+ requires permission handshake
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState === 'granted') {
        toggleGyroLock(!isGyroLocked);
      } else {
        showToast('Camera orientation permission denied', 'error');
      }
    } catch (error) {
      console.error(error);
      showToast('Error requesting gyroscope permission', 'error');
    }
  } else {
    // Non-iOS devices (Chrome Android)
    toggleGyroLock(!isGyroLocked);
  }
}

function toggleGyroLock(enable) {
  isGyroLocked = enable;
  const btn = document.getElementById('btn-ar-gyro');
  
  if (isGyroLocked) {
    if (btn) btn.classList.add('active');
    initialOrientation = null;
    window.addEventListener('deviceorientation', handleDeviceOrientation);
    showToast('Gyro Lock Enabled (Simulating Spatial Tracking)', 'success');
  } else {
    if (btn) btn.classList.remove('active');
    window.removeEventListener('deviceorientation', handleDeviceOrientation);
    if (camera) {
      camera.rotation.set(0, 0, 0); // Restore camera looking forward
    }
    showToast('Gyro Lock Disabled', 'info');
  }
}

function handleDeviceOrientation(e) {
  if (!camera) return;

  // Euler angles from sensor:
  // alpha: z-axis rotation [0, 360] (heading)
  // beta: x-axis rotation [-180, 180] (tilt front/back)
  // gamma: y-axis rotation [-90, 90] (tilt left/right)
  const { alpha, beta, gamma } = e;

  if (alpha === null || beta === null || gamma === null) return;

  // Save base calibration orient parameters on initial loop
  if (!initialOrientation) {
    initialOrientation = { alpha, beta, gamma };
    return;
  }

  // Relative rotation changes in radians
  const deltaAlpha = THREE.MathUtils.degToRad(alpha - initialOrientation.alpha);
  const deltaBeta = THREE.MathUtils.degToRad(beta - initialOrientation.beta);
  const deltaGamma = THREE.MathUtils.degToRad(gamma - initialOrientation.gamma);

  // Bind camera rotation counter-opposed to user phone movements.
  // This simulates the board staying in a static 3D placement when panning!
  // WebXR uses complex quaternions, but Euler offsets look very convincing!
  camera.rotation.set(-deltaBeta, deltaAlpha, -deltaGamma);
}

// Toast helper proxy
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'alert-triangle';

  toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  
  // Render lucide icon in newly added node
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: { class: 'lucide-icon' },
      nameAttr: 'data-lucide'
    });
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// Render Animation Loop
function animate() {
  if (!renderer || !scene || !camera) return;

  requestAnimationFrame(animate);

  // Synchronize 3D plane texture with active 2D Canvas drawing strokes in real-time
  if (canvasTexture) {
    canvasTexture.needsUpdate = true;
  }

  renderer.render(scene, camera);
}
