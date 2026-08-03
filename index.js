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
    question: questions[0],
    state: "waiting",
    votes: [0, 0, 0],
    voters: new Set(),
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
  res.json({
    votes: quiz.votes,
    correctIndex: quiz.question.correctIndex,
    question: quiz.question.text,
    options: quiz.question.options,
  });
});

io.on("connection", (socket) => {
  socket.on("join-quiz", (quizId) => {
    socket.join(quizId);
    socket.quizId = quizId;
    const quiz = quizzes[quizId];
    if (!quiz) return;

    if (quiz.state === "playing") {
      socket.emit("new-question", {
        text: quiz.question.text,
        options: quiz.question.options,
      });
    } else if (quiz.state === "finished") {
      socket.emit("reveal", {
        correctIndex: quiz.question.correctIndex,
        votes: quiz.votes,
        question: quiz.question.text,
        options: quiz.question.options,
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
    quiz.voters = new Set();

    io.to(quizId).emit("new-question", {
      text: quiz.question.text,
      options: quiz.question.options,
    });

    setTimeout(() => {
      quiz.state = "finished";
      io.to(quizId).emit("reveal", {
        correctIndex: quiz.question.correctIndex,
        votes: quiz.votes,
        question: quiz.question.text,
        options: quiz.question.options,
      });
      console.log(`Quiz ${quizId} finished. Votes: [${quiz.votes}]`);
    }, 10000);
  });

  socket.on("submit-vote", ({ quizId, answerIndex }) => {
    const quiz = quizzes[quizId];
    if (!quiz || quiz.state !== "playing") return;
    if (quiz.voters.has(socket.id)) return;

    quiz.voters.add(socket.id);
    quiz.votes[answerIndex]++;
    console.log(`Vote in quiz ${quizId}: option ${answerIndex}, totals now [${quiz.votes}]`);

    io.to(quizId).emit("vote-count", { total: quiz.votes.reduce((a, b) => a + b, 0) });
  });
});

server.listen(PORT, () => {
  console.log(`Voting App running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
