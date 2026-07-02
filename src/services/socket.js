import { io } from 'socket.io-client';
import { getServerUrl } from './api';

let lastSessionId = null;
let lastUserId = null;
let lastUsername = null;
let reconnectHandler = null;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  if (socket && socket.connected) return socket;

  const serverUrl = getServerUrl();
  console.log('Connecting socket to:', serverUrl);
  
  socket = io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 20000,
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[SOCKET] CONNECTED, ID:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] DISCONNECTED');
  });

  socket.on('reconnect', (attempt) => {
    console.log('[SOCKET] RECONNECTED after ' + attempt + ' attempts');
    if (lastSessionId && lastUserId && lastUsername) {
      socket.emit('join-room', { 
        sessionId: lastSessionId, 
        userId: lastUserId, 
        username: lastUsername 
      });
      if (reconnectHandler) {
        reconnectHandler();
      }
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('[SOCKET] DISCONNECTED (Manual)');
  }
}

export function onReconnect(callback) {
  reconnectHandler = callback;
}

// Emits
export function joinRoom(sessionId, userId, username) {
  lastSessionId = sessionId;
  lastUserId = userId;
  lastUsername = username;
  if (!socket) connectSocket();
  socket.emit('join-room', { sessionId, userId, username });
}

export function emitDrawStroke(sessionId, point, color, width, tool, isNewPath) {
  if (socket) {
    socket.emit('draw-stroke', { sessionId, point, color, width, tool, isNewPath });
  }
}

export function emitEndStroke(sessionId, points, color, width, tool) {
  if (socket) {
    socket.emit('end-stroke', { sessionId, points, color, width, tool });
  }
}

export function emitCursorMove(sessionId, x, y, username) {
  if (socket) {
    socket.emit('cursor-move', { sessionId, x, y, username });
  }
}

export function emitClearCanvas(sessionId) {
  if (socket) {
    socket.emit('clear-canvas', { sessionId });
  }
}

// Receivers / Listeners
export function onDrawStroke(callback) {
  if (!socket) return;
  socket.off('draw-stroke'); // Clean up existing listener
  socket.on('draw-stroke', callback);
}

export function onEndStroke(callback) {
  if (!socket) return;
  socket.off('end-stroke');
  socket.on('end-stroke', callback);
}

export function onCursorMove(callback) {
  if (!socket) return;
  socket.off('cursor-move');
  socket.on('cursor-move', callback);
}

export function onClearCanvas(callback) {
  if (!socket) return;
  socket.off('clear-canvas');
  socket.on('clear-canvas', callback);
}

export function onUserListUpdate(callback) {
  if (!socket) return;
  socket.off('user-list-update');
  socket.on('user-list-update', callback);
}

export function onUserLeft(callback) {
  if (!socket) return;
  socket.off('user-left');
  socket.on('user-left', callback);
}

export function emitDeleteStroke(sessionId, strokeId) {
  if (socket) {
    socket.emit('delete-stroke', { sessionId, strokeId });
  }
}

export function onDeleteStroke(callback) {
  if (!socket) return;
  socket.off('delete-stroke');
  socket.on('delete-stroke', callback);
}

export function onSessionDetailsUpdate(callback) {
  if (!socket) return;
  socket.off('session-details-update');
  socket.on('session-details-update', callback);
}
