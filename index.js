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
});

server.listen(PORT, () => {
  console.log(`Voting App running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
