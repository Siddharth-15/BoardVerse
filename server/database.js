const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'database.sqlite');

console.log("================================");
console.log("SQLite Database Path:", dbPath);
console.log("================================");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('==============================');
    console.log('Database path:', dbPath);
    console.log('Database object:', db);
    console.log('==============================');
    initSchema();
  }
});

function initSchema() {
  db.serialize(() => {
    // 1. Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        topic TEXT,
        member_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(host_id) REFERENCES users(id)
      )
    `);

    // Alter table commands for migrations in case the database file already exists
    db.run(`ALTER TABLE sessions ADD COLUMN topic TEXT`, (err) => {
      // Safety callback: ignore error if column already exists
    });
    db.run(`ALTER TABLE sessions ADD COLUMN member_count INTEGER DEFAULT 0`, (err) => {
      // Safety callback: ignore error if column already exists
    });

    // 3. Drawing strokes table
    db.run(`
      CREATE TABLE IF NOT EXISTS strokes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        points TEXT NOT NULL,
        color TEXT NOT NULL,
        width INTEGER NOT NULL,
        tool TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      )
    `);

    // 4. Whiteboard clear tracker
    db.run(`
      CREATE TABLE IF NOT EXISTS cleared_sessions (
        session_id TEXT PRIMARY KEY,
        cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

// Promise wrappers for clean async/await code
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll
};
