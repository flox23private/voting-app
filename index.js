const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const quizzes = {};

const AWARD_QUESTIONS = [
  "Move the Needle Award — for the biggest improvement",
  "Mic Drop Award — for the best pitch performance",
  "AI to the bone Award — for strongest AI infusion",
];

const AWARD_TEAMS = [
  "AI & Pro Code on Databricks: Vojta Novy",
  "Custom Derived Data Product: Stefan Treichel & Harun Behroz",
  "SAP Data Products: Oliver Loesch",
  "Custom Primary Data Products: Holger Brasch",
  "Feed My Application: Sujit Kumar",
  "Fuel My Agent: Mirko Link & Markus Brugger",
  "Self-Service Insights: Jonas Fritsch & Maria Chiricotto",
  "Enterprise Analytics: Olivia Wrese & Mahesh Ganti",
  "Seamless Planning: Jan Gutzeit",
];

const awardEvents = {};

app.post("/api/quiz", (req, res) => {
  const { questions } = req.body;
  const id = crypto.randomBytes(4).toString("hex");
  quizzes[id] = {
    id,
    questions,
    currentQuestionIndex: 0,
    state: "waiting",
    votes: [0, 0, 0],
    voterChoices: {},
  };
  res.json({ id, link: `/play/${id}` });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/play/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

app.get("/holiday", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "holiday-admin.html"));
});

app.get("/holiday/play/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "holiday-player.html"));
});

app.get("/explainer", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "explainer.html"));
});

app.get("/christmas", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "christmas-admin.html"));
});

app.get("/christmas/play/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "christmas-player.html"));
});

app.post("/api/award", (req, res) => {
  const id = crypto.randomBytes(4).toString("hex");
  awardEvents[id] = {
    id,
    state: "waiting",
    sessions: {
      A: { votes: Array.from({ length: 3 }, () => new Array(9).fill(0)), voterChoices: {} },
      B: { votes: Array.from({ length: 3 }, () => new Array(9).fill(0)), voterChoices: {} },
    },
  };
  res.json({ id, linkA: `/awards/vote/A/${id}`, linkB: `/awards/vote/B/${id}` });
});

app.get("/api/award/:id/results", (req, res) => {
  const event = awardEvents[req.params.id];
  if (!event) return res.status(404).json({ error: "Not found" });

  const rankTeams = (votes) => {
    const sorted = votes.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
    const ranks = new Array(9).fill(0);
    sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
    return ranks;
  };

  const results = AWARD_QUESTIONS.map((question, qIdx) => {
    const votesA = event.sessions.A.votes[qIdx];
    const votesB = event.sessions.B.votes[qIdx];
    const combined = votesA.map((v, i) => v + votesB[i]);
    return {
      question,
      votesA,
      votesB,
      combined,
      rankA: rankTeams(votesA),
      rankB: rankTeams(votesB),
      rankCombined: rankTeams(combined),
    };
  });

  res.json({ teams: AWARD_TEAMS, results });
});

app.get("/awards", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "awards-admin.html"));
});

app.get("/awards/vote/:session/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "awards-player.html"));
});

app.get("/api/quiz/:id", (req, res) => {
  const quiz = quizzes[req.params.id];
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  res.json({ id: quiz.id, state: quiz.state });
});

app.get("/api/quiz/:id/results", (req, res) => {
  const quiz = quizzes[req.params.id];
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  const q = quiz.questions[quiz.currentQuestionIndex];
  res.json({
    votes: quiz.votes,
    correctIndex: q.correctIndex,
    question: q.text,
    options: q.options,
    questionIndex: quiz.currentQuestionIndex,
    totalQuestions: quiz.questions.length,
  });
});

function startAwardQuestion(event, qIdx) {
  event.state = `q${qIdx}`;
  event.sessions.A.voterChoices = {};
  event.sessions.B.voterChoices = {};

  const payload = { questionIndex: qIdx, text: AWARD_QUESTIONS[qIdx], teams: AWARD_TEAMS };
  io.to(`${event.id}-A`).emit("award-question", payload);
  io.to(`${event.id}-B`).emit("award-question", payload);
  io.to(`${event.id}-admin`).emit("award-question", payload);

  setTimeout(() => {
    if (qIdx < AWARD_QUESTIONS.length - 1) {
      startAwardQuestion(event, qIdx + 1);
    } else {
      event.state = "done";
      io.to(`${event.id}-A`).emit("award-done");
      io.to(`${event.id}-B`).emit("award-done");
      io.to(`${event.id}-admin`).emit("award-done");
    }
  }, 20000);
}

io.on("connection", (socket) => {
  socket.on("join-quiz", (quizId) => {
    socket.join(quizId);
    socket.quizId = quizId;
    const quiz = quizzes[quizId];
    if (!quiz) return;

    const q = quiz.questions[quiz.currentQuestionIndex];

    if (quiz.state === "playing") {
      socket.emit("new-question", {
        text: q.text,
        options: q.options,
        questionIndex: quiz.currentQuestionIndex,
        totalQuestions: quiz.questions.length,
      });
    } else if (quiz.state === "finished") {
      socket.emit("reveal", {
        correctIndex: q.correctIndex,
        votes: quiz.votes,
        question: q.text,
        options: q.options,
        questionIndex: quiz.currentQuestionIndex,
        totalQuestions: quiz.questions.length,
      });
    } else {
      socket.emit("quiz-state", { state: quiz.state });
    }
  });

  socket.on("start-quiz", (quizId) => {
    const quiz = quizzes[quizId];
    if (!quiz || quiz.state !== "waiting") return;
    quiz.state = "playing";
    quiz.votes = [0, 0, 0];
    quiz.voterChoices = {};

    const q = quiz.questions[quiz.currentQuestionIndex];

    io.to(quizId).emit("new-question", {
      text: q.text,
      options: q.options,
      questionIndex: quiz.currentQuestionIndex,
      totalQuestions: quiz.questions.length,
    });

    setTimeout(() => {
      quiz.state = "finished";
      io.to(quizId).emit("reveal", {
        correctIndex: q.correctIndex,
        votes: quiz.votes,
        question: q.text,
        options: q.options,
        questionIndex: quiz.currentQuestionIndex,
        totalQuestions: quiz.questions.length,
      });
      console.log(`Quiz ${quizId} Q${quiz.currentQuestionIndex + 1} finished. Votes: [${quiz.votes}]`);
    }, 18000);
  });

  socket.on("next-question", (quizId) => {
    const quiz = quizzes[quizId];
    if (!quiz || quiz.state !== "finished") return;
    if (quiz.currentQuestionIndex >= quiz.questions.length - 1) return;

    quiz.currentQuestionIndex++;
    quiz.state = "playing";
    quiz.votes = [0, 0, 0];
    quiz.voterChoices = {};

    const q = quiz.questions[quiz.currentQuestionIndex];

    io.to(quizId).emit("new-question", {
      text: q.text,
      options: q.options,
      questionIndex: quiz.currentQuestionIndex,
      totalQuestions: quiz.questions.length,
    });

    setTimeout(() => {
      quiz.state = "finished";
      io.to(quizId).emit("reveal", {
        correctIndex: q.correctIndex,
        votes: quiz.votes,
        question: q.text,
        options: q.options,
        questionIndex: quiz.currentQuestionIndex,
        totalQuestions: quiz.questions.length,
      });
      console.log(`Quiz ${quizId} Q${quiz.currentQuestionIndex + 1} finished. Votes: [${quiz.votes}]`);
    }, 18000);
  });

  socket.on("submit-vote", ({ quizId, answerIndex }) => {
    const quiz = quizzes[quizId];
    if (!quiz || quiz.state !== "playing") return;

    const prevChoice = quiz.voterChoices[socket.id];
    if (prevChoice !== undefined) {
      quiz.votes[prevChoice]--;
    }

    quiz.voterChoices[socket.id] = answerIndex;
    quiz.votes[answerIndex]++;
    console.log(`Vote in quiz ${quizId}: option ${answerIndex}, totals now [${quiz.votes}]`);

    io.to(quizId).emit("vote-count", { total: quiz.votes.reduce((a, b) => a + b, 0) });
  });

  socket.on("join-award", ({ eventId, session }) => {
    socket.awardEventId = eventId;
    socket.awardSession = session;
    if (session === "admin") {
      socket.join(`${eventId}-admin`);
    } else {
      socket.join(`${eventId}-${session}`);
    }

    const event = awardEvents[eventId];
    if (!event) return;
    if (event.state === "waiting") {
      socket.emit("award-state", { state: "waiting" });
    } else if (event.state === "done") {
      socket.emit("award-done");
    } else {
      const qIdx = parseInt(event.state[1]);
      socket.emit("award-question", { questionIndex: qIdx, text: AWARD_QUESTIONS[qIdx], teams: AWARD_TEAMS });
    }
  });

  socket.on("start-award", (eventId) => {
    const event = awardEvents[eventId];
    if (!event || event.state !== "waiting") return;
    startAwardQuestion(event, 0);
  });

  socket.on("submit-award-vote", ({ eventId, session, teamIndex }) => {
    const event = awardEvents[eventId];
    if (!event || !event.state.startsWith("q")) return;
    const qIdx = parseInt(event.state[1]);
    const sess = event.sessions[session];
    if (!sess) return;

    const prevChoice = sess.voterChoices[socket.id];
    if (prevChoice !== undefined) sess.votes[qIdx][prevChoice]--;
    sess.voterChoices[socket.id] = teamIndex;
    sess.votes[qIdx][teamIndex]++;

    const total = sess.votes[qIdx].reduce((a, b) => a + b, 0);
    io.to(`${eventId}-admin`).emit("award-vote-count", { session, questionIndex: qIdx, total });
  });
});

server.listen(PORT, () => {
  console.log(`Voting App running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Christmas: http://localhost:${PORT}/christmas`);
});
