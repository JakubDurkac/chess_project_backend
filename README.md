# moodychess (backend)
A backend solution for the moodychess web app.
- **backend** server written in **Javascript** using **Node.js**, **Express** and **WebSocket**, deployed using [Render](https://render.com/)
- for **frontend** look [here](https://github.com/JakubDurkac/chess_project)

### Features
- manages and stores connected players info
- matches up players based on their requests, sends them match attributes
- sends out clock updates, clocks for each game are centralized on the server
- sends out updates of available opponents list to everyone when a change happens (player connects, disconnects, matches up with other player)
- acts as a middleman between two matched up players, forwarding moves, chat messages, resignations, disconnections, draw offers and answers to such offers, etc.

### To run server locally
- clone the repository
```
git clone https://github.com/JakubDurkac/chess_project_backend.git
```
- in the root directory, install the dependencies for a Node.js project using:
```
npm install
```
- run server
```
node server.js
```
- make sure clients are connecting using the right address
- example connection from client.js:
```
let socket = new WebSocket('ws://localhost:3000');
```
