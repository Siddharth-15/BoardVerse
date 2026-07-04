import './style.css';
import { initWhiteboard, cleanupWhiteboard, setTool, setColor, setBrushSize, loadStrokeHistory, clearLocalCanvas, handleRemoteDrawPoint, handleRemoteEndStroke, handleRemoteCursorMove, handleRemoveCursor, addLocalText, addLocalImage, handleRemoteDeleteStroke } from './whiteboard/canvas';
import { initAR, stopAR } from './ar/ar';
import * as api from './services/api';
import * as socketService from './services/socket';

// SPA View State switching
let currentView = 'auth';
let activeSession = null; // Stores current active session data { id, name, hostName, hostId }

// Utility: converts database UTC timestamps without suffixes to standard JS ISO strings with timezone suffixes
// so that the browser automatically parses and renders them in the user's local timezone (e.g. Indian Standard Time +5:30).
function parseUTCDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr.includes('T') || dateStr.endsWith('Z')) {
    return new Date(dateStr);
  }
  // Convert "YYYY-MM-DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SSZ" (UTC ISO standard)
  const formatted = dateStr.replace(' ', 'T') + 'Z';
  return new Date(formatted);
}

// Handle backend health verification (handling Render cold start)
async function performHealthCheck() {
  const overlay = document.getElementById('health-overlay');
  if (!overlay) return;

  const statusText = document.getElementById('health-status-text');
  const attemptText = document.getElementById('health-attempt-text');
  const retryBtn = document.getElementById('btn-health-retry');
  const spinner = overlay.querySelector('.spinner');

  const maxRetries = 8;
  const retryDelay = 5000;
  const serverUrl = api.getServerUrl();

  overlay.classList.add('active');
  retryBtn.style.display = 'none';
  if (spinner) spinner.style.display = 'block';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    statusText.textContent = 'Connecting to backend service...';
    attemptText.textContent = `Attempt ${attempt} of ${maxRetries} (Render cold starts can take up to 40 seconds)`;
    console.log(`[HEALTH] Pinging backend at ${serverUrl}/health, attempt ${attempt}/${maxRetries}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${serverUrl}/health`, {
        signal: controller.signal,
        mode: 'cors'
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok') {
          console.log('[HEALTH] Backend is ready!');
          overlay.classList.remove('active');
          checkAuthState();
          return;
        }
      }
    } catch (err) {
      console.warn(`[HEALTH] Attempt ${attempt} failed:`, err.message);
    }

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  // If we reach here, all retries failed
  console.error('[HEALTH] Backend unreachable after 8 attempts.');
  statusText.textContent = 'Backend server connection failed';
  attemptText.textContent = 'The server is currently unreachable. Click retry to attempt connecting again.';
  if (spinner) spinner.style.display = 'none';
  retryBtn.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Bind health retry button
  const retryBtn = document.getElementById('btn-health-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', performHealthCheck);
  }

  // Run backend health check before entering app views
  performHealthCheck();

  // Setup DOM Listeners
  setupAuthListeners();
  setupDashboardListeners();
  setupRoomListeners();
  setupSettingsListeners();
  setupV3Listeners();
});

// --- AUTH ROUTING STATES ---
function checkAuthState() {
  const user = api.getUserInfo();
  if (user) {
    showView('dashboard');
    loadDashboardData();
  } else {
    showView('auth');
  }
}

function showView(viewId) {
  currentView = viewId;
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });
  
  const activeSection = document.getElementById(`view-${viewId}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }
}

// Show alerts/toasts
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
  }, 3500);
}

// --- AUTHENTICATION INTERACTION ---
function setupAuthListeners() {
  const form = document.getElementById('auth-form');
  const toggleLink = document.getElementById('link-toggle-auth');
  const toggleText = document.getElementById('auth-toggle-text');
  const btnSubmit = document.getElementById('btn-auth-submit');
  const btnGuest = document.getElementById('btn-guest-login');
  const btnLogout = document.getElementById('btn-logout');

  let isRegistering = false;

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegistering = !isRegistering;
    if (isRegistering) {
      toggleText.textContent = 'Already have an account?';
      toggleLink.textContent = 'Login';
      btnSubmit.textContent = 'Register Account';
    } else {
      toggleText.textContent = "Don't have an account?";
      toggleLink.textContent = 'Register';
      btnSubmit.textContent = 'Sign In';
    }
  });

  form.addEventListener('submit', async () => {
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;

    try {
      btnSubmit.disabled = true;
      btnSubmit.textContent = isRegistering ? 'Registering...' : 'Signing in...';

      if (isRegistering) {
        await api.register(username, password);
        showToast('Account created successfully!', 'success');
      } else {
        await api.login(username, password);
        showToast('Logged in successfully!', 'success');
      }

      // Save credentials state and switch view
      localStorage.setItem('boardverse_username', username);
      showView('dashboard');
      loadDashboardData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = isRegistering ? 'Register Account' : 'Sign In';
    }
  });

  btnGuest.addEventListener('click', async () => {
    try {
      btnGuest.disabled = true;
      btnGuest.textContent = 'Connecting...';
      
      const randNum = Math.floor(1000 + Math.random() * 9000);
      const guestName = `Guest-${randNum}`;
      
      await api.loginAsGuest(guestName);
      localStorage.setItem('boardverse_username', guestName);
      
      showToast(`Logged in as guest: ${guestName}`, 'success');
      showView('dashboard');
      loadDashboardData();
    } catch (err) {
      showToast('Failed to join as guest: ' + err.message, 'error');
    } finally {
      btnGuest.disabled = false;
      btnGuest.textContent = 'Join as Guest';
    }
  });

  btnLogout.addEventListener('click', () => {
    api.logout();
    localStorage.removeItem('boardverse_username');
    showToast('Logged out', 'info');
    showView('auth');
  });
}

// --- DASHBOARD INTERACTION ---
let activeDashboardTab = 'hosted'; // 'hosted' or 'joined'

function setupDashboardListeners() {
  const btnCreate = document.getElementById('btn-create-session');
  const btnJoin = document.getElementById('btn-join-session');
  const tabHosted = document.getElementById('tab-hosted-sessions');
  const tabJoined = document.getElementById('tab-joined-sessions');

  tabHosted.addEventListener('click', () => {
    activeDashboardTab = 'hosted';
    tabHosted.classList.add('active');
    tabJoined.classList.remove('active');
    renderSessionsList();
  });

  tabJoined.addEventListener('click', () => {
    activeDashboardTab = 'joined';
    tabJoined.classList.add('active');
    tabHosted.classList.remove('active');
    renderSessionsList();
  });

  btnCreate.addEventListener('click', async () => {
    const inputName = document.getElementById('create-room-name');
    const name = inputName.value.trim();

    if (!name) {
      showToast('Please enter a session name', 'error');
      return;
    }

    // Guests cannot host persistent sessions
    const user = api.getUserInfo();
    if (user.isGuest) {
      showToast('Guest accounts cannot host. Register or log in to create rooms!', 'error');
      return;
    }

    try {
      btnCreate.disabled = true;
      btnCreate.textContent = 'Creating...';

      const session = await api.createSession(name);
      showToast(`Room "${name}" created!`, 'success');
      
      inputName.value = '';
      enterRoom(session.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnCreate.disabled = false;
      btnCreate.textContent = 'Host Session';
    }
  });

  btnJoin.addEventListener('click', () => {
    const inputCode = document.getElementById('join-room-code');
    const code = inputCode.value.trim().toUpperCase();

    if (code.length !== 6) {
      showToast('Please enter a valid 6-character code', 'error');
      return;
    }

    enterRoom(code);
  });
}

let hostedSessionsList = [];

async function loadDashboardData() {
  const user = api.getUserInfo();
  if (!user) return;

  // Set Profile UI details
  document.getElementById('user-avatar').textContent = user.username.charAt(0).toUpperCase();
  document.getElementById('user-display-name').textContent = user.username;
  document.getElementById('user-status-role').textContent = user.isGuest ? 'Guest Observer' : 'Collaborative Host';

  // Toggle create-room button disabled for guests
  document.getElementById('btn-create-session').disabled = user.isGuest;

  if (user.isGuest) {
    hostedSessionsList = [];
    activeDashboardTab = 'joined';
    document.getElementById('tab-hosted-sessions').style.display = 'none';
    document.getElementById('tab-joined-sessions').classList.add('active');
  } else {
    document.getElementById('tab-hosted-sessions').style.display = 'block';
    try {
      hostedSessionsList = await api.getMySessions();
    } catch (err) {
      console.error('Error fetching hosted sessions:', err);
    }
  }

  renderSessionsList();
}

function renderSessionsList() {
  const container = document.getElementById('sessions-history-list');
  container.innerHTML = '';

  let list = [];
  if (activeDashboardTab === 'hosted') {
    list = hostedSessionsList;
  } else {
    list = api.getJoinedSessionsHistory();
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-open" style="width:48px; height:48px;"></i>
        <p>No boards found. ${activeDashboardTab === 'hosted' ? 'Create a room to start drawing!' : 'Enter an invite code to join a board.'}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  list.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';
    
    // Convert creation date to nice display text in local timezone (e.g. IST)
    const dateText = parseUTCDate(session.created_at || session.joinedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    item.innerHTML = `
      <div class="session-info-main">
        <span class="session-name">${session.name}</span>
        <div class="session-meta-line">
          <span>Code: <span class="session-code">${session.id}</span></span>
          <span>•</span>
          <span>Host: ${session.host_name || session.hostName || 'You'}</span>
          <span>•</span>
          <span>${dateText}</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-icon btn-share" data-id="${session.id}" title="Copy Invite Link" style="width: 36px; height: 36px; border-radius: 8px; padding: 0;">
          <i data-lucide="share-2" style="width: 16px; height: 16px; color: var(--accent-cyan);"></i>
        </button>
        <button class="btn-resume" data-id="${session.id}">Resume</button>
      </div>
    `;

    // Hook click action to resume button
    item.querySelector('.btn-resume').addEventListener('click', () => {
      enterRoom(session.id);
    });

    // Hook click action to share link copy button
    item.querySelector('.btn-share').addEventListener('click', (e) => {
      e.stopPropagation();
      const inviteUrl = `${window.location.origin}?join=${session.id}`;
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showToast(`Invite link for "${session.name}" copied!`, 'success');
      }).catch(() => {
        showToast('Failed to copy invite link', 'error');
      });
    });

    container.appendChild(item);
  });
}

// --- WHITEBOARD BOARD ROOM INTERACTION ---
async function enterRoom(sessionId) {
  const user = api.getUserInfo();
  if (!user) return;

  try {
    showToast(`Connecting to Room ${sessionId}...`, 'info');
    
    // Fetch board state from SQLite backend
    const sessionDetails = await api.getSession(sessionId);
    activeSession = sessionDetails;

    // Cache to local storage history if user is a viewer joining
    if (sessionDetails.hostId !== user.userId) {
      api.addJoinedSessionToHistory(sessionDetails);
    }

    // Switch View
    showView('room');

    // 1. Initialize drawing canvas
    const canvasEl = document.getElementById('whiteboard');
    initWhiteboard(canvasEl, sessionId, user.userId);

    // Load initial vector coordinates
    loadStrokeHistory(sessionDetails.strokes);

    // Update Header HUD
    document.getElementById('room-session-name').textContent = sessionDetails.name;
    document.getElementById('room-host-indicator').textContent = `Host: ${sessionDetails.hostName}`;
    document.getElementById('room-invite-tag').textContent = `CODE: ${sessionDetails.id}`;

    // Toggle Details edit button display based on Host permissions
    const clearBtn = document.getElementById('btn-clear-board');
    const detailsBtn = document.getElementById('btn-edit-session-details');
    if (String(sessionDetails.hostId) === String(user.userId)) {
      if (clearBtn) clearBtn.style.display = 'flex';
      if (detailsBtn) detailsBtn.style.display = 'flex';
    } else {
      if (clearBtn) clearBtn.style.display = 'none';
      if (detailsBtn) detailsBtn.style.display = 'none';
    }

    // 2. Set up Socket listeners FIRST to prevent race conditions
  socketService.onDrawStroke((data) => {
    console.log("[MAIN] draw packet", data);
    
    const {
        point,
        color,
        width,
        tool,
        isNewPath,
        userId
    } = data;
  
    handleRemoteDrawPoint({
        userId,
        point,
        color,
        width,
        tool,
        isNewPath
    });
  });

    socketService.onEndStroke(({ userId }) => {
      handleRemoteEndStroke({ userId });
    });

    socketService.onCursorMove(({ x, y, username, userId }) => {
      handleRemoteCursorMove({ userId, username, x, y });
    });

    socketService.onClearCanvas(() => {
      clearLocalCanvas();
      showToast('Whiteboard was cleared by host', 'info');
    });

    socketService.onDeleteStroke(({ strokeId }) => {
      handleRemoteDeleteStroke({ strokeId });
    });

    socketService.onSessionDetailsUpdate(({ name, topic, memberCount }) => {
      if (name) {
        activeSession.name = name;
        document.getElementById('room-session-name').textContent = name;
      }
      if (topic !== undefined) {
        activeSession.topic = topic;
      }
      if (memberCount !== undefined) {
        activeSession.memberCount = memberCount;
        const countVal = document.getElementById('val-member-count');
        if (countVal) countVal.textContent = memberCount;
      }
    });

    socketService.onUserListUpdate((activeUsers) => {
      updateActiveMembersHUD(activeUsers);
    });

    socketService.onUserLeft(({ userId }) => {
      handleRemoveCursor({ userId });
    });

    // 3. Establish Real-Time Socket Connection
    const socket = socketService.connectSocket();
    
    // Connection stability UI overlays
    const healthOverlay = document.getElementById('health-overlay');
    const healthStatusText = document.getElementById('health-status-text');
    const healthAttemptText = document.getElementById('health-attempt-text');
    const healthRetryBtn = document.getElementById('btn-health-retry');
    const healthSpinner = healthOverlay ? healthOverlay.querySelector('.spinner') : null;

    socket.off('disconnect'); // Clean up existing listeners to avoid duplicates
    socket.off('connect_error');
    socket.off('connect');

    socket.on('disconnect', (reason) => {
      console.warn('[SOCKET] DISCONNECTED:', reason);
      if (healthOverlay) {
        healthStatusText.textContent = 'Server connection lost. Reconnecting...';
        healthAttemptText.textContent = 'Verifying server status. Please wait...';
        if (healthSpinner) healthSpinner.style.display = 'block';
        if (healthRetryBtn) healthRetryBtn.style.display = 'none';
        healthOverlay.classList.add('active');
      }
    });

    socket.on('connect_error', (error) => {
      console.warn('[SOCKET] CONNECTION ERROR:', error.message);
      if (healthOverlay) {
        healthStatusText.textContent = 'Server connection failed';
        healthAttemptText.textContent = 'Attempting automatic recovery...';
        if (healthSpinner) healthSpinner.style.display = 'block';
        if (healthRetryBtn) healthRetryBtn.style.display = 'none';
        healthOverlay.classList.add('active');
      }
    });

    socket.on('connect', () => {
      console.log('[SOCKET] CONNECTED successfully!');
      if (healthOverlay) healthOverlay.classList.remove('active');
      socketService.joinRoom(sessionId, user.userId, user.username);
    });

    // Reconnect State Recovery Sync
    socketService.onReconnect(async () => {
      console.log('[SOCKET] RECONNECTED. Restoring session state...');
      showToast('Connection restored! Re-syncing board state...', 'success');
      if (healthOverlay) healthOverlay.classList.remove('active');

      try {
        // Fetch fresh database stroke history
        const sessionData = await api.getSession(sessionId);
        
        // Re-load stroke history & redraw the board (syncStrokeHistory)
        loadStrokeHistory(sessionData.strokes || []);
        console.log('[SOCKET] SYNCED session state successfully.');
      } catch (err) {
        console.error('[SOCKET] Re-sync failed:', err);
        showToast('Failed to sync canvas state on reconnect', 'error');
      }
    });

    // If socket is already connected, join immediately
    if (socket.connected) {
      if (healthOverlay) healthOverlay.classList.remove('active');
      socketService.joinRoom(sessionId, user.userId, user.username);
    }

  } catch (err) {
    showToast(err.message, 'error');
    console.error(err);
  }
}

// Bind events properly
function initWhiteboardSync() {
  // Simple check to resolve dependencies on late packets
}

function updateActiveMembersHUD(users) {
  const container = document.getElementById('room-active-members-list');
  if (!container) return;
  container.innerHTML = '';

  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'member-item';
    
    // Safety string casting to ensure comparison works for both guest pseudonyms and database integer IDs
    const isHost = activeSession && String(activeSession.hostId) === String(u.userId);
    const roleTag = isHost ? ' (Host)' : '';
    
    item.innerHTML = `
      <div class="member-dot ${isHost ? 'host' : ''}"></div>
      <span>${u.username}${roleTag}</span>
    `;
    container.appendChild(item);
  });

  const activeCount = document.getElementById('active-members-count');
  if (activeCount) activeCount.textContent = users.length;
}

function setupRoomListeners() {
  const btnLeave = document.getElementById('btn-leave-room');
  const btnClear = document.getElementById('btn-clear-board');
  const btnEnterAR = document.getElementById('btn-enter-ar');
  const btnInvite = document.getElementById('room-invite-tag');

  // Leave room
  btnLeave.addEventListener('click', () => {
    cleanupWhiteboard();
    socketService.disconnectSocket();
    activeSession = null;
    
    showView('dashboard');
    loadDashboardData();
    showToast('Left the room', 'info');
  });

  // Master clear canvas (Host only)
  btnClear.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the whiteboard for all participants?')) {
      socketService.emitClearCanvas(activeSession.id);
    }
  });

  // Copy room invite ID to clipboard
  btnInvite.addEventListener('click', () => {
    if (!activeSession) return;
    const inviteLink = `${window.location.origin}?join=${activeSession.id}`;
    
    // Fallback clip text
    navigator.clipboard.writeText(activeSession.id).then(() => {
      showToast(`Session code "${activeSession.id}" copied to clipboard!`, 'success');
    }).catch(err => {
      showToast('Failed to copy session code', 'error');
    });
  });

  // Toolbar Tools selection
  const toolPencil = document.getElementById('tool-pencil');
  const toolEraser = document.getElementById('tool-eraser');
  const toolText = document.getElementById('tool-text');
  const toolImage = document.getElementById('tool-image');
  const imageInput = document.getElementById('image-upload-input');

  toolPencil.addEventListener('click', () => {
    setTool('pencil');
    toolPencil.classList.add('active');
    toolEraser.classList.remove('active');
    toolText.classList.remove('active');
    toolImage.classList.remove('active');
    document.querySelectorAll('.text-tool-only').forEach(el => el.style.display = 'none');
  });

  toolText.addEventListener('click', () => {
    setTool('text');
    toolText.classList.add('active');
    toolPencil.classList.remove('active');
    toolEraser.classList.remove('active');
    toolImage.classList.remove('active');
    document.querySelectorAll('.text-tool-only').forEach(el => el.style.display = 'flex');
    showToast('Click anywhere on the board to write text', 'info');
  });

  toolImage.addEventListener('click', () => {
    setTool('image');
    toolImage.classList.add('active');
    toolPencil.classList.remove('active');
    toolEraser.classList.remove('active');
    toolText.classList.remove('active');
    document.querySelectorAll('.text-tool-only').forEach(el => el.style.display = 'none');
    imageInput.click();
  });

  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      compressAndUploadImage(file);
    }
    imageInput.value = '';
  });

  toolEraser.addEventListener('click', () => {
    setTool('eraser');
    toolEraser.classList.add('active');
    toolPencil.classList.remove('active');
    toolText.classList.remove('active');
    toolImage.classList.remove('active');
    document.querySelectorAll('.text-tool-only').forEach(el => el.style.display = 'none');
  });

  // Toolbar Color picker swatches
  document.querySelectorAll('.color-picker-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.color-picker-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      setColor(e.target.dataset.color);
      
      // Auto-toggle back to pencil if they select a color while erasing
      setTool('pencil');
      toolPencil.classList.add('active');
      toolEraser.classList.remove('active');
      toolText.classList.remove('active');
      toolImage.classList.remove('active');
      document.querySelectorAll('.text-tool-only').forEach(el => el.style.display = 'none');
    });
  });

  // Brush Size slider
  const sizeSlider = document.getElementById('brush-size');
  const sizeVal = document.getElementById('brush-size-val');
  sizeSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    setBrushSize(val);
    sizeVal.textContent = `${val}px`;
  });

  // Transition into AR View
  btnEnterAR.addEventListener('click', () => {
    showView('ar');
    
    const arVideo = document.getElementById('ar-video');
    const arCanvas = document.getElementById('ar-canvas');
    
    initAR(arVideo, arCanvas);
  });

  // AR Exit controls
  const btnExitAR = document.getElementById('btn-exit-ar');
  btnExitAR.addEventListener('click', () => {
    stopAR();
    showView('room');
  });

  // Host Details Modal Edit controls
  const detailsBtn = document.getElementById('btn-edit-session-details');
  const detailsModal = document.getElementById('modal-session-details');
  const closeDetailsBtn = document.getElementById('btn-close-session-details');
  const saveDetailsBtn = document.getElementById('btn-save-session-details');

  detailsBtn.addEventListener('click', () => {
    if (!activeSession) return;
    document.getElementById('edit-session-name').value = activeSession.name;
    document.getElementById('edit-session-topic').value = activeSession.topic || '';
    document.getElementById('val-member-count').textContent = activeSession.memberCount || 0;
    
    const creationDate = activeSession.created_at ? parseUTCDate(activeSession.created_at).toLocaleString() : '--';
    document.getElementById('val-created-at').textContent = creationDate;

    detailsModal.classList.add('active');
  });

  closeDetailsBtn.addEventListener('click', () => {
    detailsModal.classList.remove('active');
  });

  saveDetailsBtn.addEventListener('click', async () => {
    const editName = document.getElementById('edit-session-name').value.trim();
    const editTopic = document.getElementById('edit-session-topic').value.trim();

    if (!editName) {
      showToast('Session topic name is required', 'error');
      return;
    }

    try {
      saveDetailsBtn.disabled = true;
      saveDetailsBtn.textContent = 'Saving...';
      
      await api.updateSessionDetails(activeSession.id, { name: editName, topic: editTopic });
      showToast('Session details updated!', 'success');
      
      activeSession.name = editName;
      activeSession.topic = editTopic;
      document.getElementById('room-session-name').textContent = editName;

      detailsModal.classList.remove('active');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      saveDetailsBtn.disabled = false;
      saveDetailsBtn.textContent = 'Save Session details';
    }
  });
}

// --- SERVER SETTINGS CONFIG MODAL ---
function setupSettingsListeners() {
  const modal = document.getElementById('modal-settings');
  const btnOpen = document.getElementById('btn-open-settings');
  const btnOpenDash = document.getElementById('btn-dash-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnSave = document.getElementById('btn-save-settings');
  const inputUrl = document.getElementById('settings-server-url');

  const openSettings = () => {
    inputUrl.value = api.getServerUrl();
    modal.classList.add('active');
  };

  btnOpen.addEventListener('click', openSettings);
  btnOpenDash.addEventListener('click', openSettings);

  const closeSettings = () => {
    modal.classList.remove('active');
  };

  btnClose.addEventListener('click', closeSettings);
  
  btnSave.addEventListener('click', () => {
    const url = inputUrl.value.trim();
    if (!url) {
      showToast('Server URL cannot be empty', 'error');
      return;
    }
    api.setServerUrl(url);
    showToast('Server URL configuration saved!', 'success');
    closeSettings();

    // Reset sockets if url changed
    socketService.disconnectSocket();
  });
}

function setupV3Listeners() {
  const textInput = document.getElementById('canvas-text-input');
  const textOverlay = document.getElementById('text-input-overlay');
  
  if (textInput && textOverlay) {
    const commitText = () => {
      if (textOverlay.style.display === 'none') return;
      const text = textInput.value.trim();
      if (text) {
        const x = parseFloat(textInput.dataset.normX);
        const y = parseFloat(textInput.dataset.normY);
        
        const fontStyle = document.getElementById('font-style-select').value;
        const fontSize = parseInt(document.getElementById('font-size-select').value);
        
        addLocalText(text, x, y, fontStyle, fontSize);
      }
      textOverlay.style.display = 'none';
      textInput.value = '';
    };

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitText();
      }
    });

    textInput.addEventListener('blur', () => {
      setTimeout(commitText, 150);
    });
  }

  // Active members dropdown toggle click binders
  const toggleMembersBtn = document.getElementById('btn-active-members-toggle');
  const membersDropdown = document.getElementById('active-members-dropdown');
  
  if (toggleMembersBtn && membersDropdown) {
    toggleMembersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = membersDropdown.style.display === 'none';
      membersDropdown.style.display = isHidden ? 'flex' : 'none';
    });

    // Auto-close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (membersDropdown.style.display === 'flex' && !membersDropdown.contains(e.target) && e.target !== toggleMembersBtn) {
        membersDropdown.style.display = 'none';
      }
    });
  }

  // Window paste listener for screenshots import
  window.addEventListener('paste', (e) => {
    if (currentView !== 'room') return;
    // Don't intercept if user is typing in form inputs
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        const file = item.getAsFile();
        compressAndUploadImage(file);
        showToast('Processing pasted image...', 'info');
        break;
      }
    }
  });

  // Query parameter auto-joinees check
  const params = new URLSearchParams(window.location.search);
  const autoJoinCode = params.get('join');
  if (autoJoinCode) {
    const joinInput = document.getElementById('join-room-code');
    if (joinInput) {
      joinInput.value = autoJoinCode.toUpperCase();
      showToast(`Detected invite code: ${autoJoinCode.toUpperCase()}`, 'info');
      // Wait to check auth state first
      setTimeout(() => {
        if (api.getUserInfo()) {
          enterRoom(autoJoinCode.toUpperCase());
          // Clean URL params to prevent re-join loop on reload
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }, 800);
    }
  }
}

// Client image downscaler helper
function compressAndUploadImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      const maxDim = 800; // max size bound
      let w = img.width;
      let h = img.height;

      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(img, 0, 0, w, h);
      
      const base64 = tempCanvas.toDataURL('image/jpeg', 0.82);

      const whiteboard = document.getElementById('whiteboard');
      const aspect = w / h;
      const canvasAspect = whiteboard.width / whiteboard.height;

      // Normalise placement sizing
      const normW = 0.4; // 40% width
      const normH = (normW / aspect) * canvasAspect;
      const normX = 0.5 - normW / 2;
      const normY = 0.5 - normH / 2;

      addLocalImage(base64, normX, normY, normW, normH);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
