const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.json');
const onlineUsers = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const defaultData = { users: [], messages: [] };

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
    return { ...defaultData };
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function authRequired(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'ورود لازم است' });

  const user = readDb().users.find((u) => u.token === token);
  if (!user) return res.status(401).json({ error: 'توکن نامعتبر است' });

  req.user = user;
  next();
}

function emitPresence() {
  const list = [...onlineUsers.values()].map(({ id, name, username }) => ({ id, name, username }));
  io.to('family').emit('presence', list);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'khanvadeh messenger' });
});

app.post('/api/register', (req, res) => {
  const { name, username, password } = req.body || {};

  if (!name || !username || !password) {
    return res.status(400).json({ error: 'همه فیلدها را پر کنید' });
  }

  const db = readDb();
  const cleanName = String(name).trim();
  const cleanUsername = String(username).trim().toLowerCase();

  if (!cleanName || !cleanUsername || String(password).length < 3) {
    return res.status(400).json({ error: 'نام و نام‌کاربری معتبر باشد و رمز عبور حداقل 3 کاراکتر باشد' });
  }

  const exists = db.users.some((user) => user.username === cleanUsername);
  if (exists) {
    return res.status(409).json({ error: 'این نام‌کاربری قبلا ثبت شده است' });
  }

  const user = {
    id: crypto.randomUUID(),
    name: cleanName,
    username: cleanUsername,
    password: hash(password),
    token: generateToken(),
  };

  db.users.push(user);
  saveDb(db);

  res.json({
    token: user.token,
    user: { id: user.id, name: user.name, username: user.username },
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUsername = String(username || '').trim().toLowerCase();

  const db = readDb();
  const user = db.users.find(
    (entry) => entry.username === cleanUsername && entry.password === hash(password || '')
  );

  if (!user) {
    return res.status(401).json({ error: 'نام‌کاربری یا رمز عبور اشتباه است' });
  }

  user.token = generateToken();
  saveDb(db);

  res.json({
    token: user.token,
    user: { id: user.id, name: user.name, username: user.username },
  });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, username: req.user.username });
});

app.get('/api/messages', authRequired, (req, res) => {
  const messages = readDb().messages.slice(-300);
  res.json(messages);
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = readDb().users.find((entry) => entry.token === token);

  if (!user) {
    return next(new Error('احراز هویت ناموفق'));
  }

  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  socket.join('family');

  onlineUsers.set(socket.user.id, {
    id: socket.user.id,
    name: socket.user.name,
    username: socket.user.username,
  });

  emitPresence();

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.user.id);
    emitPresence();
  });

  socket.on('sendMessage', (text) => {
    const messageText = String(text || '').trim();
    if (!messageText || messageText.length > 2000) return;

    const db = readDb();
    const message = {
      id: crypto.randomUUID(),
      userId: socket.user.id,
      name: socket.user.name,
      text: messageText,
      createdAt: new Date().toISOString(),
    };

    db.messages.push(message);
    saveDb(db);
    io.to('family').emit('newMessage', message);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Messenger running on http://localhost:${PORT}`);
});
