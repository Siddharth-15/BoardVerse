const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbRun, dbGet, dbAll } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Allows connections from anywhere (development setup)
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'BOARDVERSE_SUPER_SECRET_KEY_2026_VITE_V2';

// Middleware
app.use(cors());
app.use(express.json());

// Helper: Generate Unique Session ID (6 capital letters/numbers)
function generateSessionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// --- AUTHENTICATION API ---

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username.trim(), hashedPassword]
    );
    
    const token = jwt.sign({ userId: result.id, username: username.trim() }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, username: username.trim() });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Database registration error' });
    }
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database login error' });
  }
});

// Guest Sign-in Token Provider
app.post('/api/auth/guest', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const guestId = 'guest_' + Math.random().toString(36).substring(2, 9);
  const token = jwt.sign(
    { userId: guestId, username: username.trim(), isGuest: true },
    JWT_SECRET,
    { expiresIn: '1d' } // Guest tokens expire in 24 hours
  );

  res.json({ token, username: username.trim(), userId: guestId });
});


// Get Current User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, username, created_at FROM users WHERE id = ?', [req.user.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Database verification error' });
  }
});

// --- SESSION API ---

// Create Session
app.post('/api/sessions/create', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Session name is required' });

  try {
    let sessionId = generateSessionId();
    // Ensure uniqueness
    let exists = await dbGet('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    while (exists) {
      sessionId = generateSessionId();
      exists = await dbGet('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    }

    await dbRun(
      'INSERT INTO sessions (id, name, host_id) VALUES (?, ?, ?)',
      [sessionId, name.trim(), req.user.userId]
    );

    res.status(201).json({ id: sessionId, name: name.trim(), hostId: req.user.userId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database session creation error' });
  }
});

// List Hosted Sessions (by current user)
app.get('/api/sessions/my', authenticateToken, async (req, res) => {
  try {
    const sessions = await dbAll(
      'SELECT s.*, u.username as host_name FROM sessions s JOIN users u ON s.host_id = u.id WHERE s.host_id = ? ORDER BY s.created_at DESC',
      [req.user.userId]
    );
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Database fetch error' });
  }
});

// Get Specific Session Data (Checking presence, returns history details)
app.get('/api/sessions/:id', async (req, res) => {
  const sessionId = req.params.id.toUpperCase();

  try {
    const session = await dbGet(
      'SELECT s.*, u.username as host_name FROM sessions s JOIN users u ON s.host_id = u.id WHERE s.id = ?',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Fetch last cleared timestamp
    const cleared = await dbGet('SELECT cleared_at FROM cleared_sessions WHERE session_id = ?', [sessionId]);
    const clearTime = cleared ? cleared.cleared_at : '1970-01-01 00:00:00';

    // Retrieve active strokes (strokes added after clear time)
    const strokes = await dbAll(
      'SELECT * FROM strokes WHERE session_id = ? AND created_at > ? ORDER BY id ASC',
      [sessionId, clearTime]
    );

    // Format strokes
    const formattedStrokes = strokes.map(s => ({
      points: JSON.parse(s.points),
      color: s.color,
      width: s.width,
      tool: s.tool,
      userId: s.user_id
    }));

    res.json({
      id: session.id,
      name: session.name,
      topic: session.topic || '',
      memberCount: session.member_count || 0,
      hostId: session.host_id,
      hostName: session.host_name,
      strokes: formattedStrokes
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database session fetch error' });
  }
});

// Update Session Details (Host only)
app.put('/api/sessions/:id', authenticateToken, async (req, res) => {
  const sessionId = req.params.id.toUpperCase();
  const { name, topic } = req.body;

  if (!name) return res.status(400).json({ error: 'Session name is required' });

  try {
    const session = await dbGet('SELECT host_id FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    if (session.host_id !== req.user.userId) {
      return res.status(403).json({ error: 'Only the host can modify session details' });
    }

    await dbRun(
      'UPDATE sessions SET name = ?, topic = ? WHERE id = ?',
      [name.trim(), topic ? topic.trim() : null, sessionId]
    );

    // Broadcast session update details to all clients in that room
    io.to(sessionId).emit('session-details-update', { name: name.trim(), topic: topic ? topic.trim() : '' });

    res.json({ message: 'Session details updated successfully', name, topic });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database update error' });
  }
});

// Diagnostics endpoint to debug directory layouts in production
app.get('/api/debug', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const dPath = path.join(__dirname, '../dist');
  
  const rootFiles = fs.readdirSync(path.join(__dirname, '..'));
  let distExists = fs.existsSync(dPath);
  let distFiles = [];
  if (distExists) {
    distFiles = fs.readdirSync(dPath);
  }

  res.json({
    dirname: __dirname,
    distPath: dPath,
    distExists,
    distFiles,
    rootFiles
  });
});

// --- SOCKET.IO REALTIME EVENTS ---

// Track active users globally
// roomUsersMap: sessionId -> Array of { socketId, userId, username }
const roomUsersMap = new Map();
// Track unique users who ever joined (for persistence count)
const uniqueUsersMap = new Map();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 1. Join Room
  socket.on('join-room', ({ sessionId, userId, username }) => {
    const sId = sessionId.toUpperCase();
    socket.join(sId);

    // Track active user
    if (!roomUsersMap.has(sId)) {
      roomUsersMap.set(sId, []);
    }
    const users = roomUsersMap.get(sId);
    
    // Remove duplication if reconnecting
    const index = users.findIndex(u => u.userId === userId);
    if (index !== -1) {
      users.splice(index, 1);
    }
    
    const newUser = { socketId: socket.id, userId, username };
    users.push(newUser);
    
    // Associate room on the socket object for disconnect cleanup
    socket.roomSessionId = sId;
    socket.roomUserId = userId;

    console.log(`User ${username} (${userId}) joined room ${sId}`);

    // Manage Unique Member Counter with Database sync
    if (!uniqueUsersMap.has(sId)) {
      uniqueUsersMap.set(sId, new Set());
      // Initialize Set from database count to maintain continuity
      dbGet('SELECT member_count FROM sessions WHERE id = ?', [sId]).then(row => {
        const count = row ? row.member_count : 0;
        const uUsers = uniqueUsersMap.get(sId);
        while (uUsers.size < count) {
          uUsers.add('migrated_user_' + uUsers.size);
        }
        uUsers.add(userId);
        dbRun('UPDATE sessions SET member_count = ? WHERE id = ?', [uUsers.size, sId])
          .then(() => {
            // Emit updated details to room including active users list
            io.to(sId).emit('user-list-update', users);
            io.to(sId).emit('session-details-update', { memberCount: uUsers.size });
          });
      }).catch(err => console.error(err));
    } else {
      const uUsers = uniqueUsersMap.get(sId);
      const isNew = !uUsers.has(userId);
      uUsers.add(userId);

      if (isNew) {
        dbRun('UPDATE sessions SET member_count = ? WHERE id = ?', [uUsers.size, sId])
          .then(() => {
            io.to(sId).emit('user-list-update', users);
            io.to(sId).emit('session-details-update', { memberCount: uUsers.size });
          }).catch(err => console.error(err));
      } else {
        io.to(sId).emit('user-list-update', users);
      }
    }
  });

  // 2. Real-time stroke transmission (broadcasting coordinate queues)
  socket.on('draw-stroke', ({ sessionId, point, color, width, tool, isNewPath }) => {
    const sId = sessionId.toUpperCase();
    socket.to(sId).emit('draw-stroke', { point, color, width, tool, isNewPath, userId: socket.roomUserId });
  });

  // 3. Persist Stroke on finish
  socket.on('end-stroke', async ({ sessionId, points, color, width, tool }) => {
    const sId = sessionId.toUpperCase();
    const userId = socket.roomUserId || 'anonymous';
    
    // Broadcast end stroke trigger
    socket.to(sId).emit('end-stroke', { userId });

    // Store in SQLite database (Upsert logic for moved/scaled images)
    try {
      if (tool === 'image') {
        const existing = await dbGet('SELECT id FROM strokes WHERE session_id = ? AND color = ? AND tool = "image"', [sId, color]);
        if (existing) {
          await dbRun(
            'UPDATE strokes SET points = ? WHERE id = ?',
            [JSON.stringify(points), existing.id]
          );
          return;
        }
      }

      await dbRun(
        'INSERT INTO strokes (session_id, user_id, points, color, width, tool) VALUES (?, ?, ?, ?, ?, ?)',
        [sId, userId, JSON.stringify(points), color, width, tool]
      );
    } catch (err) {
      console.error('Failed to save stroke to DB:', err);
    }
  });

  // 4. Live Cursor Broadcast
  socket.on('cursor-move', ({ sessionId, x, y, username }) => {
    const sId = sessionId.toUpperCase();
    socket.to(sId).emit('cursor-move', { x, y, username, userId: socket.roomUserId });
  });

  // 5. Clear Canvas Trigger
  socket.on('clear-canvas', async ({ sessionId }) => {
    const sId = sessionId.toUpperCase();
    
    // Broadcast clear event
    io.to(sId).emit('clear-canvas');

    try {
      // Record clearance timestamp
      const timeStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await dbRun(
        'INSERT INTO cleared_sessions (session_id, cleared_at) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET cleared_at = excluded.cleared_at',
        [sId, timeStr]
      );
      
      // Clean up past strokes for that session
      await dbRun('DELETE FROM strokes WHERE session_id = ?', [sId]);
    } catch (err) {
      console.error('Failed to clear canvas record in DB:', err);
    }
  });

  // 5.5. Delete Stroke Trigger (for text/images)
  socket.on('delete-stroke', async ({ sessionId, strokeId }) => {
    const sId = sessionId.toUpperCase();
    socket.to(sId).emit('delete-stroke', { strokeId });

    try {
      // In our design, color stores the unique imageId for tool: 'image'
      await dbRun('DELETE FROM strokes WHERE session_id = ? AND color = ?', [sId, strokeId]);
    } catch (err) {
      console.error('Failed to delete stroke from DB:', err);
    }
  });

  // 6. Handle Disconnection
  socket.on('disconnect', () => {
    const sId = socket.roomSessionId;
    const userId = socket.roomUserId;
    console.log(`Socket disconnected: ${socket.id}`);

    if (sId && roomUsersMap.has(sId)) {
      const users = roomUsersMap.get(sId);
      const filteredUsers = users.filter(u => u.socketId !== socket.id);
      
      if (filteredUsers.length === 0) {
        roomUsersMap.delete(sId);
      } else {
        roomUsersMap.set(sId, filteredUsers);
        // Broadcast new member list
        io.to(sId).emit('user-list-update', filteredUsers);
      }
      
      // Notify details
      io.to(sId).emit('user-left', { userId });
    }
  });
});

// Serve production Vite build statically
const path = require('path');
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// SPA fallback routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('BoardVerse API Server is active.');
    }
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`BoardVerse Backend running on http://localhost:${PORT}`);
});
