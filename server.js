const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST_CODE = process.env.HOST_CODE || 'PREPWORK-HOST';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'prep-work.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

function seedData() {
  const hostPassword = hashPassword('host1234');
  return {
    users: [
      {
        id: 'user_host_demo',
        name: 'Prep Work Host',
        email: 'host@prepwork.test',
        passwordHash: hostPassword,
        role: 'host',
        createdAt: nowIso()
      }
    ],
    sessions: [],
    tests: [
      {
        id: 'test_jee_physics_foundations',
        title: 'JEE Physics Foundations Mock',
        subject: 'Physics',
        durationMinutes: 45,
        difficulty: 'Medium',
        published: true,
        createdBy: 'user_host_demo',
        updatedAt: nowIso(),
        questions: [
          {
            id: 'q1',
            text: 'A particle starts from rest and moves with constant acceleration 2 m/s². What is its speed after 5 seconds?',
            options: ['2 m/s', '5 m/s', '10 m/s', '20 m/s'],
            answerIndex: 2,
            explanation: 'Use v = u + at = 0 + 2 × 5 = 10 m/s.',
            topic: 'Kinematics'
          },
          {
            id: 'q2',
            text: 'The SI unit of electric potential is:',
            options: ['Ampere', 'Volt', 'Ohm', 'Coulomb'],
            answerIndex: 1,
            explanation: 'Electric potential is measured in volts.',
            topic: 'Electrostatics'
          },
          {
            id: 'q3',
            text: 'Which physical quantity remains conserved in an elastic collision?',
            options: ['Only kinetic energy', 'Only momentum', 'Both momentum and kinetic energy', 'Neither momentum nor kinetic energy'],
            answerIndex: 2,
            explanation: 'Elastic collisions conserve total momentum and total kinetic energy.',
            topic: 'Laws of Motion'
          }
        ]
      },
      {
        id: 'test_jee_chemistry_quick',
        title: 'JEE Chemistry Quick Check',
        subject: 'Chemistry',
        durationMinutes: 30,
        difficulty: 'Easy',
        published: true,
        createdBy: 'user_host_demo',
        updatedAt: nowIso(),
        questions: [
          {
            id: 'q1',
            text: 'The atomic number of carbon is:',
            options: ['4', '6', '8', '12'],
            answerIndex: 1,
            explanation: 'Carbon has 6 protons, so its atomic number is 6.',
            topic: 'Atomic Structure'
          },
          {
            id: 'q2',
            text: 'Which bond is formed by sharing electron pairs?',
            options: ['Ionic bond', 'Metallic bond', 'Covalent bond', 'Hydrogen bond'],
            answerIndex: 2,
            explanation: 'Covalent bonds form when atoms share electron pairs.',
            topic: 'Chemical Bonding'
          }
        ]
      }
    ],
    attempts: []
  };
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seedData(), null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const [key, ...valueParts] = part.split('=');
      cookies[key] = decodeURIComponent(valueParts.join('='));
      return cookies;
    }, {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function sanitizeTest(test, includeAnswers = false) {
  return {
    id: test.id,
    title: test.title,
    subject: test.subject,
    durationMinutes: test.durationMinutes,
    difficulty: test.difficulty,
    published: Boolean(test.published),
    updatedAt: test.updatedAt,
    questionCount: test.questions.length,
    questions: test.questions.map((question) => ({
      id: question.id,
      text: question.text,
      options: question.options,
      topic: question.topic,
      ...(includeAnswers
        ? { answerIndex: question.answerIndex, explanation: question.explanation }
        : {})
    }))
  };
}

function getUserFromSession(req, db) {
  const { sid } = parseCookies(req);
  if (!sid) return null;
  const session = db.sessions.find((item) => item.id === sid && Date.parse(item.expiresAt) > Date.now());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function setSession(res, db, userId) {
  const session = {
    id: id('sess'),
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  db.sessions = db.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now());
  db.sessions.push(session);
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSession(req, res, db) {
  const { sid } = parseCookies(req);
  db.sessions = db.sessions.filter((item) => item.id !== sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function requireUser(req, res, db) {
  const user = getUserFromSession(req, db);
  if (!user) {
    sendError(res, 401, 'Please log in to continue.');
    return null;
  }
  return user;
}

function requireHost(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (user.role !== 'host') {
    sendError(res, 403, 'Host access is required.');
    return null;
  }
  return user;
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Add at least one question.');
  }
  return questions.map((question, index) => {
    const options = Array.isArray(question.options) ? question.options.map(String).filter(Boolean) : [];
    const answerIndex = Number(question.answerIndex);
    if (!String(question.text || '').trim()) throw new Error(`Question ${index + 1} needs text.`);
    if (options.length < 2) throw new Error(`Question ${index + 1} needs at least two options.`);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
      throw new Error(`Question ${index + 1} needs a valid answer index.`);
    }
    return {
      id: question.id || id('q'),
      text: String(question.text).trim(),
      options,
      answerIndex,
      explanation: String(question.explanation || '').trim(),
      topic: String(question.topic || 'General').trim()
    };
  });
}

function normalizeTestPayload(payload, userId, existing = {}) {
  const title = String(payload.title || '').trim();
  const subject = String(payload.subject || '').trim();
  if (!title) throw new Error('Test title is required.');
  if (!subject) throw new Error('Subject is required.');
  return {
    ...existing,
    id: existing.id || id('test'),
    title,
    subject,
    durationMinutes: Math.max(1, Number(payload.durationMinutes || 60)),
    difficulty: String(payload.difficulty || 'Medium').trim(),
    published: Boolean(payload.published),
    createdBy: existing.createdBy || userId,
    updatedAt: nowIso(),
    questions: normalizeQuestions(payload.questions)
  };
}

function gradeAttempt(test, answers, secondsSpent) {
  const answerMap = answers && typeof answers === 'object' ? answers : {};
  let correct = 0;
  const topicStats = {};
  const review = test.questions.map((question) => {
    const selectedIndex = Number(answerMap[question.id]);
    const isCorrect = selectedIndex === Number(question.answerIndex);
    if (isCorrect) correct += 1;
    const topic = question.topic || 'General';
    topicStats[topic] ||= { correct: 0, total: 0 };
    topicStats[topic].total += 1;
    if (isCorrect) topicStats[topic].correct += 1;
    return {
      questionId: question.id,
      selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : null,
      correctIndex: question.answerIndex,
      isCorrect,
      topic,
      explanation: question.explanation
    };
  });
  const total = test.questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, secondsSpent: Number(secondsSpent || 0), topicStats, review };
}

function buildProfile(user, db) {
  const attempts = db.attempts
    .filter((attempt) => attempt.userId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const average = attempts.length
    ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.percent, 0) / attempts.length)
    : 0;
  const best = attempts.length ? Math.max(...attempts.map((attempt) => attempt.percent)) : 0;
  const recent = attempts.slice(0, 5);
  const topicTotals = {};
  attempts.forEach((attempt) => {
    Object.entries(attempt.topicStats || {}).forEach(([topic, stat]) => {
      topicTotals[topic] ||= { correct: 0, total: 0 };
      topicTotals[topic].correct += stat.correct;
      topicTotals[topic].total += stat.total;
    });
  });
  const topics = Object.entries(topicTotals).map(([topic, stat]) => ({
    topic,
    correct: stat.correct,
    total: stat.total,
    percent: stat.total ? Math.round((stat.correct / stat.total) * 100) : 0
  }));
  const trend = attempts.slice(0, 3).map((attempt) => attempt.percent).reverse();
  const trendBoost = trend.length >= 2 ? trend[trend.length - 1] - trend[0] : 0;
  const predictedPerformance = attempts.length
    ? Math.max(0, Math.min(100, Math.round(average + trendBoost * 0.35)))
    : 0;
  return {
    user: sanitizeUser(user),
    stats: {
      attempts: attempts.length,
      average,
      best,
      predictedPerformance,
      readiness: predictedPerformance >= 80 ? 'JEE-ready momentum' : predictedPerformance >= 55 ? 'Improving with focused revision' : 'Needs fundamentals practice'
    },
    topics,
    recent: recent.map((attempt) => ({
      id: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.testTitle,
      subject: attempt.subject,
      correct: attempt.correct,
      total: attempt.total,
      percent: attempt.percent,
      createdAt: attempt.createdAt,
      secondsSpent: attempt.secondsSpent
    }))
  };
}

async function handleApi(req, res, pathname) {
  const db = readDb();
  const method = req.method;

  try {
    if (pathname === '/api/signup' && method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!name || !email || password.length < 6) {
        return sendError(res, 400, 'Name, email, and a 6+ character password are required.');
      }
      if (db.users.some((user) => user.email === email)) {
        return sendError(res, 409, 'An account with this email already exists.');
      }
      const role = body.role === 'host' && body.hostCode === HOST_CODE ? 'host' : 'student';
      const user = { id: id('user'), name, email, passwordHash: hashPassword(password), role, createdAt: nowIso() };
      db.users.push(user);
      setSession(res, db, user.id);
      writeDb(db);
      return sendJson(res, 201, { user: sanitizeUser(user) });
    }

    if (pathname === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const user = db.users.find((item) => item.email === email);
      if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
        return sendError(res, 401, 'Invalid email or password.');
      }
      setSession(res, db, user.id);
      writeDb(db);
      return sendJson(res, 200, { user: sanitizeUser(user) });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      clearSession(req, res, db);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/me' && method === 'GET') {
      const user = getUserFromSession(req, db);
      return sendJson(res, 200, { user: sanitizeUser(user) });
    }

    if (pathname === '/api/profile' && method === 'GET') {
      const user = requireUser(req, res, db);
      if (!user) return;
      return sendJson(res, 200, buildProfile(user, db));
    }

    if (pathname === '/api/tests' && method === 'GET') {
      const user = getUserFromSession(req, db);
      const tests = db.tests
        .filter((test) => test.published || user?.role === 'host')
        .map((test) => sanitizeTest(test, user?.role === 'host'));
      return sendJson(res, 200, { tests });
    }

    if (pathname === '/api/tests' && method === 'POST') {
      const user = requireHost(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const test = normalizeTestPayload(body, user.id);
      db.tests.push(test);
      writeDb(db);
      return sendJson(res, 201, { test: sanitizeTest(test, true) });
    }

    const testMatch = pathname.match(/^\/api\/tests\/([^/]+)$/);
    if (testMatch && method === 'GET') {
      const user = getUserFromSession(req, db);
      const test = db.tests.find((item) => item.id === testMatch[1]);
      if (!test || (!test.published && user?.role !== 'host')) return sendError(res, 404, 'Test not found.');
      return sendJson(res, 200, { test: sanitizeTest(test, user?.role === 'host') });
    }

    if (testMatch && method === 'PUT') {
      const user = requireHost(req, res, db);
      if (!user) return;
      const index = db.tests.findIndex((item) => item.id === testMatch[1]);
      if (index === -1) return sendError(res, 404, 'Test not found.');
      const body = await readBody(req);
      db.tests[index] = normalizeTestPayload(body, user.id, db.tests[index]);
      writeDb(db);
      return sendJson(res, 200, { test: sanitizeTest(db.tests[index], true) });
    }

    if (testMatch && method === 'DELETE') {
      const user = requireHost(req, res, db);
      if (!user) return;
      db.tests = db.tests.filter((item) => item.id !== testMatch[1]);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/attempts' && method === 'POST') {
      const user = requireUser(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const test = db.tests.find((item) => item.id === body.testId && item.published);
      if (!test) return sendError(res, 404, 'Published test not found.');
      const graded = gradeAttempt(test, body.answers, body.secondsSpent);
      const attempt = {
        id: id('attempt'),
        userId: user.id,
        testId: test.id,
        testTitle: test.title,
        subject: test.subject,
        createdAt: nowIso(),
        ...graded
      };
      db.attempts.push(attempt);
      writeDb(db);
      return sendJson(res, 201, { attempt, profile: buildProfile(user, db) });
    }

    return sendError(res, 404, 'API route not found.');
  } catch (error) {
    return sendError(res, 400, error.message || 'Request failed.');
  }
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, 'Forbidden');
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, fallback) => {
        if (fallbackError) return sendError(res, 404, 'Page not found.');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallback);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(contents);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`Prep Work is running at http://localhost:${PORT}`);
  console.log(`Demo host login: host@prepwork.test / host1234`);
});
