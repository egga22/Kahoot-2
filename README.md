# Kahoot-2

A fun, real-time multiplayer quiz game inspired by Kahoot — players scan a QR code to join from their phones and answer questions live.

## Features

- 🎮 **Host a game** — create a quiz, display a QR code & PIN on a big screen
- 📱 **Players join from phones** — scan the QR code or enter the PIN to join
- ⏱️ **Live timer** — 20 seconds per question with countdown
- 🏆 **Scoring** — faster correct answers earn more points (500–1000 pts)
- 📊 **Leaderboard** — shown after every question and at the end
- 📝 **Custom questions** — add your own questions via the host setup screen

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v16+

### Install & Run

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## How to Play

1. **Host** opens `http://localhost:3000` on a big screen and clicks **Host a Game**
2. Host reviews/edits questions, then clicks **Create Game**
3. A **6-digit PIN** and **QR code** are shown on screen
4. **Players** scan the QR code with their phones (or go to the join URL manually)
5. Each player enters their name and joins the lobby
6. Host clicks **Start Game** once everyone is in
7. Questions appear on the host screen — players answer from their phones
8. Scores update after each question; the winner is revealed at the end!

## Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **QR codes**: `qrcode` npm package
- **Frontend**: Vanilla HTML/CSS/JS (no framework needed)
