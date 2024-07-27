const express = require('express');
const http = require('http');
const { send } = require('process');
const WebSocket = require('ws');

const PORT_NUMBER = 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let playersSockets = {}; // {'name': theirSocket}
let playersSettings = {}; // {'name': {time, increment, color}}
let matches = {}; // match ... 'name1': 'name2', 'name2': 'name1'
let activeNames = [];
let games = {};

function createGame(whiteName, blackName, startClockMillis, incrementMillis, color) {
    const game = {        
        moveStartTimestamp: null,
        whiteName: whiteName,
        blackName: blackName,
        color: color,
        duration: {
            initial: startClockMillis,
            white: startClockMillis,
            black: startClockMillis
        },
        increment: incrementMillis,
        whiteClock: startClockMillis,
        blackClock: startClockMillis,
        isWhiteTurn: true,
        intervalId: null
    };

    games[whiteName] = game;
    games[blackName] = game;

    return game;
}

function sendClockUpdate(game) {
    const clockUpdateMessageStr = JSON.stringify({clockUpdate:{
        white: game.whiteClock,
        black: game.blackClock
    }});

    if (playersSockets[game.whiteName] !== undefined
        && playersSockets[game.blackName] !== undefined
    ) {
        playersSockets[game.whiteName].send(clockUpdateMessageStr);
        playersSockets[game.blackName].send(clockUpdateMessageStr);
    }
}

function sendMatchAttributes(whiteName) {
    const {blackName, duration, color} = games[whiteName];

    playersSockets[whiteName].send(JSON.stringify({matchAttributes: {
        'opponentName': blackName,
        'yourColor': 'white',
        'time': duration.initial,
        'gameColorType': color
    }}));

    playersSockets[blackName].send(JSON.stringify({matchAttributes: {
        'opponentName': whiteName,
        'yourColor': 'black',
        'time': duration.initial,
        'gameColorType': color
    }}));
}

function startGameClock(game) {
    game.intervalId = setInterval(() => {
        if (game.isWhiteTurn) {
            game.whiteClock = game.duration.white - (new Date().getTime() - game.moveStartTimestamp);
        } else {
            game.blackClock = game.duration.black - (new Date().getTime() - game.moveStartTimestamp);
        }

        if (game.whiteClock <= 0 || game.blackClock <= 0) {
            clearInterval(game.intervalId);
            sendClockUpdate(game);
            return;
        }

        sendClockUpdate(game);

    }, 1000);    
}

function pressGameClock(move) {
    const game = games[move.by];
    game.isWhiteTurn = !game.isWhiteTurn;
    game.moveStartTimestamp = new Date().getTime();

    if (move.isFirst) {
        startGameClock(game);
    }
    
    game.duration.white = game.whiteClock;
    game.duration.black = game.blackClock;

    game[game.isWhiteTurn ? 'blackClock' : 'whiteClock'] += game.increment;
    sendClockUpdate(game);
}

function restartGame(restartInitiatorName) {
    const game = games[restartInitiatorName];
    const {intervalId, whiteName, blackName, duration, increment, color} = game;
    clearInterval(intervalId);

    let newWhiteName = whiteName;
    let newBlackName = blackName;
    if (color === 'random') {
        newWhiteName = blackName;
        newBlackName = whiteName;
    }

    const newGame = createGame(newWhiteName, newBlackName, duration.initial, increment, color);
    sendClockUpdate(newGame);
}

function notifyOpponent(message, by) {
    playersSockets[matches[by]].send(JSON.stringify({notification: message}));
}

function handleClientDisconnect(name) {
    const opponent = matches[name];
    if (playersSockets[opponent] !== undefined) {
        console.log(`<${name}> disconnected, notifying <${opponent}>.`);
        notifyOpponent('opponent disconnected', name);
    }

    if (games[name]) {
        clearInterval(games[name].intervalId);
        delete games[name];
    }
    
    delete playersSockets[name];
    delete playersSettings[name];
    delete matches[name];
    removeName(name);

    if (opponent === undefined) {
        sendOutAvailableOpponents();
    }
}

function sendOutAvailableOpponents() {
    const availableOpponents = activeNames.filter((name) => {
        return matches[name] === undefined && playersSockets[name] !== undefined;
    }).map((opponentName) => {
        return {name: opponentName, settings: playersSettings[opponentName]};
    });

    activeNames.forEach((toName) => {
        sendOpponentsList(toName, availableOpponents);
    });
}

function sendOpponentsList(toName, opponentsList) {
    playersSockets[toName].send(JSON.stringify({
        availableOpponents: opponentsList
    }));
}

function pickWhitename(nameToJoin, by, settings) {
    const {color} = settings;
    if (color === 'random') {
        return Math.random() < 1 / 2 ? nameToJoin : by;
    }

    return color === 'white' ? nameToJoin : by;
}

wss.on('connection', (ws) => {
    console.log(`A new client connected`);
    ws.on('message', (message) => {     
        const strMessage = message.toString();
        const objMessage = JSON.parse(strMessage);    
        if (objMessage.name !== undefined) {
            const {name, settings} = objMessage;
            if (activeNames.includes(name)) {
                ws.send(JSON.stringify({notification: 'duplicate'}));
                return;
            }
           
            playersSockets[name] = ws;
            playersSettings[name] = settings;
            activeNames.push(name);

            sendOutAvailableOpponents();
    
        } else if (objMessage.joinRequest !== undefined) {
            const {nameToJoin, by} = objMessage.joinRequest;
            if (matches[nameToJoin] === undefined && playersSockets[nameToJoin] !== undefined) {
                matches[nameToJoin] = by;
                matches[by] = nameToJoin;

                const gameSettings = playersSettings[nameToJoin];
                const whiteName = pickWhitename(nameToJoin, by, gameSettings);
                createGame(whiteName, matches[whiteName], 
                    gameSettings.time, gameSettings.increment, gameSettings.color);

                sendMatchAttributes(whiteName)
                sendOutAvailableOpponents();
            }

        } else if (objMessage.move !== undefined) {
            const {move} = objMessage;
            pressGameClock(move);
            playersSockets[matches[move.by]].send(strMessage);

        } else if (objMessage.notification !== undefined) {
            const {message, by} = objMessage.notification;
            if (message === 'resign') {
                restartGame(by);
                notifyOpponent(message, by);

            } else if (message === 'game ended') {
                const game = games[by];
                if (game !== undefined) {
                    clearInterval(game.intervalId);
                }

            } else if (message === 'draw offer') {
                const {moveCount} = objMessage.notification;
                notifyOpponent({drawOfferOnMove: moveCount}, by);
            
            } else if (message === 'draw accepted') {
                notifyOpponent(message, by);
                const game = games[by];
                if (game !== undefined) {
                    clearInterval(game.intervalId);
                }

            } else if (message === 'draw declined') {
                notifyOpponent(message, by);
            }
        }
    });

    ws.on('close', () => {
        for (let i = 0; i < activeNames.length; i++) {
            const name = activeNames[i];
            if (playersSockets[name] === ws) {
                console.log(`Client <${name}> disconnected.`);
                handleClientDisconnect(name);
                break;
            }
        }

        // Logs
        console.log('Matches:');
        console.log(matches);
        console.log('Active Players:');
        for (const name in playersSockets) {
            console.log(name);
        }
    });
});

function removeName(name) {
    const indexToRemove = activeNames.indexOf(name);
    if (indexToRemove >= 0) {
        activeNames.splice(indexToRemove, 1);
    }
}

const PORT = process.env.PORT || PORT_NUMBER;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

const shutdown = () => {
    console.log('Shutting down server...');
    wss.close(() => {
        console.log('WebSocket server closed');
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);