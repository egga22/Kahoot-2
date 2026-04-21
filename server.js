const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── In-memory game store ──────────────────────────────────────────────────────
const games = {}; // pin -> gameState

const DEFAULT_QUESTIONS = [
  {
    text: 'What is the capital of France?',
    options: ['London', 'Paris', 'Berlin', 'Madrid'],
    correct: 1,
    time: 20,
  },
  {
    text: 'What is 7 × 8?',
    options: ['54', '56', '58', '62'],
    correct: 1,
    time: 20,
  },
  {
    text: 'Which planet is closest to the Sun?',
    options: ['Venus', 'Earth', 'Mercury', 'Mars'],
    correct: 2,
    time: 20,
  },
  {
    text: 'What is the largest ocean on Earth?',
    options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    correct: 3,
    time: 20,
  },
  {
    text: "Who wrote 'Romeo and Juliet'?",
    options: ['Dickens', 'Shakespeare', 'Tolstoy', 'Homer'],
    correct: 1,
    time: 20,
  },
  {
    text: 'How many sides does a hexagon have?',
    options: ['5', '6', '7', '8'],
    correct: 1,
    time: 20,
  },
  {
    text: 'What is the chemical symbol for Gold?',
    options: ['Go', 'Gd', 'Au', 'Ag'],
    correct: 2,
    time: 20,
  },
  {
    text: 'What year did World War II end?',
    options: ['1943', '1944', '1945', '1946'],
    correct: 2,
    time: 20,
  },
  {
    text: 'What is the speed of light (approx)?',
    options: ['300 km/s', '3,000 km/s', '300,000 km/s', '3,000,000 km/s'],
    correct: 2,
    time: 20,
  },
  {
    text: 'Which element has the atomic number 1?',
    options: ['Helium', 'Oxygen', 'Carbon', 'Hydrogen'],
    correct: 3,
    time: 20,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (games[pin]);
  return pin;
}

function calcScore(timeMs, totalTimeMs) {
  const fraction = Math.max(0, 1 - timeMs / totalTimeMs);
  return Math.round(500 + 500 * fraction); // 500–1000 pts
}

function getLeaderboard(game) {
  return Object.values(game.players)
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ name: p.name, score: p.score }));
}

// ── HTTP routes ───────────────────────────────────────────────────────────────
app.get('/join/:pin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'player.html'))
);

app.post('/api/create-game', async (req, res) => {
  const pin = generatePin();
  const questions =
    Array.isArray(req.body.questions) && req.body.questions.length > 0
      ? req.body.questions
      : DEFAULT_QUESTIONS;

  games[pin] = {
    pin,
    hostSocketId: null,
    players: {}, // socketId -> { name, score, answered }
    questions,
    currentQuestion: -1,
    state: 'lobby', // lobby | question | answer_review | ended
    timer: null,
    questionStartTime: null,
    currentAnswers: {},
  };

  const joinUrl = `${req.protocol}://${req.get('host')}/join/${pin}`;
  const qrCode = await QRCode.toDataURL(joinUrl, { width: 256, margin: 2 });

  res.json({ pin, qrCode, joinUrl });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Host registers after game creation
  socket.on('host:register', ({ pin }) => {
    const game = games[pin];
    if (!game) return;
    game.hostSocketId = socket.id;
    socket.join(`game:${pin}`);
    socket.join(`host:${pin}`);
    socket.data.isHost = true;
    socket.data.pin = pin;
    socket.emit('host:state', {
      state: game.state,
      players: getLeaderboard(game),
    });
  });

  // Player joins the lobby
  socket.on('player:join', ({ pin, name }) => {
    const game = games[pin];
    if (!game) {
      socket.emit('join:error', { message: 'Game not found. Check the PIN and try again.' });
      return;
    }
    if (game.state !== 'lobby') {
      socket.emit('join:error', { message: 'This game has already started.' });
      return;
    }
    const trimmed = (name || '').trim();
    if (!trimmed) {
      socket.emit('join:error', { message: 'Please enter a name.' });
      return;
    }

    game.players[socket.id] = { name: trimmed, score: 0, answered: false };
    socket.join(`game:${pin}`);
    socket.join(`players:${pin}`);
    socket.data.pin = pin;
    socket.data.name = trimmed;

    socket.emit('player:joined', { name: trimmed });
    io.to(`host:${pin}`).emit('player:list', { players: getLeaderboard(game) });
  });

  // Host starts the game
  socket.on('host:start', ({ pin }) => {
    const game = games[pin];
    if (!game || game.state !== 'lobby') return;
    if (Object.keys(game.players).length === 0) return;
    game.currentQuestion = 0;
    game.state = 'question';
    showQuestion(pin);
  });

  // Host advances to next question
  socket.on('host:next', ({ pin }) => {
    const game = games[pin];
    if (!game) return;
    game.currentQuestion++;
    if (game.currentQuestion >= game.questions.length) {
      endGame(pin);
    } else {
      game.state = 'question';
      showQuestion(pin);
    }
  });

  // Player submits an answer
  socket.on('player:answer', ({ answer }) => {
    const pin = socket.data.pin;
    if (!pin) return;
    const game = games[pin];
    if (!game || game.state !== 'question') return;

    const player = game.players[socket.id];
    if (!player || player.answered) return;

    player.answered = true;
    const timeMs = Date.now() - game.questionStartTime;
    const q = game.questions[game.currentQuestion];
    const isCorrect = answer === q.correct;
    let pointsEarned = 0;
    if (isCorrect) {
      pointsEarned = calcScore(timeMs, q.time * 1000);
      player.score += pointsEarned;
    }

    game.currentAnswers[socket.id] = { answer, timeMs, isCorrect };

    socket.emit('player:answer-result', {
      correct: isCorrect,
      points: pointsEarned,
      correctAnswer: q.correct,
      totalScore: player.score,
    });

    const totalPlayers = Object.keys(game.players).length;
    const answered = Object.values(game.players).filter((p) => p.answered).length;

    io.to(`host:${pin}`).emit('host:answer-count', { answered, total: totalPlayers });

    if (answered === totalPlayers) {
      clearTimeout(game.timer);
      endQuestion(pin);
    }
  });

  socket.on('disconnect', () => {
    const pin = socket.data && socket.data.pin;
    if (pin && games[pin] && !socket.data.isHost) {
      delete games[pin].players[socket.id];
      io.to(`host:${pin}`).emit('player:list', {
        players: getLeaderboard(games[pin]),
      });
    }
  });
});

// ── Game flow helpers ─────────────────────────────────────────────────────────
function showQuestion(pin) {
  const game = games[pin];
  const q = game.questions[game.currentQuestion];

  game.currentAnswers = {};
  Object.values(game.players).forEach((p) => {
    p.answered = false;
  });
  game.questionStartTime = Date.now();

  const payload = {
    index: game.currentQuestion,
    total: game.questions.length,
    text: q.text,
    options: q.options,
    time: q.time,
  };

  io.to(`host:${pin}`).emit('question:show', { ...payload, isHost: true });
  io.to(`players:${pin}`).emit('question:show', payload);

  game.timer = setTimeout(() => endQuestion(pin), q.time * 1000);
}

function endQuestion(pin) {
  const game = games[pin];
  if (!game || game.state !== 'question') return;
  game.state = 'answer_review';

  const q = game.questions[game.currentQuestion];
  io.to(`game:${pin}`).emit('question:ended', {
    correctAnswer: q.correct,
    leaderboard: getLeaderboard(game),
    isLastQuestion: game.currentQuestion === game.questions.length - 1,
  });
}

function endGame(pin) {
  const game = games[pin];
  if (!game) return;
  game.state = 'ended';
  io.to(`game:${pin}`).emit('game:ended', { leaderboard: getLeaderboard(game) });
  // Clean up after 30 min
  setTimeout(() => delete games[pin], 30 * 60 * 1000);
}

server.listen(PORT, () => {
  console.log(`Kahoot-2 running → http://localhost:${PORT}`);
});
