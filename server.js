const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
const rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        socket.join(data.roomCode);
        rooms[data.roomCode] = { host: socket.id, players: [data.playerName], readyCount: 0, scores: { mafia: 0, citizens: 0 }, defendedPlayers: [] };
        io.to(data.roomCode).emit('updatePlayers', rooms[data.roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        socket.join(data.roomCode);
        if (rooms[data.roomCode] && !rooms[data.roomCode].players.includes(data.playerName)) {
            rooms[data.roomCode].players.push(data.playerName);
        } else if (!rooms[data.roomCode]) {
            rooms[data.roomCode] = { host: null, players: [data.playerName], readyCount: 0, scores: { mafia:0, citizens:0 }, defendedPlayers: [] };
        }
        io.to(data.roomCode).emit('updatePlayers', rooms[data.roomCode].players);
    });

    socket.on('startGame', (data) => {
        rooms[data.roomCode].readyCount = 0;
        rooms[data.roomCode].defendedPlayers = [];
        io.to(data.roomCode).emit('gameStarted', data.assignments);
    });

    socket.on('playerReady', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].readyCount++;
            if (rooms[roomCode].readyCount === rooms[roomCode].players.length) {
                io.to(roomCode).emit('allReady');
                rooms[roomCode].readyCount = 0;
            }
        }
    });

    socket.on('changeTheme', (data) => io.to(data.roomCode).emit('setTheme', data.theme));
    socket.on('broadcastMessage', (data) => io.to(data.roomCode).emit('receiveMessage', data));
    socket.on('openRoleAction', (data) => io.to(data.roomCode).emit('promptAction', data));
    
    socket.on('submitAction', (data) => {
        if(rooms[data.roomCode]) io.to(rooms[data.roomCode].host).emit('actionReceived', data);
    });
    socket.on('closeAllActions', (roomCode) => io.to(roomCode).emit('closeActionUI'));
    
    socket.on('syncAlivePlayers', (data) => io.to(data.roomCode).emit('updateAlivePlayers', data.alivePlayers));
    socket.on('announceDead', (data) => io.to(data.roomCode).emit('showDeadPlayer', data));
    socket.on('sendToGraveyard', (data) => io.to(data.roomCode).emit('moveToGraveyard', data.target));

    socket.on('startDiscussion', (roomCode) => io.to(roomCode).emit('discussionPhase'));
    socket.on('startVoting', (data) => io.to(data.roomCode).emit('votingPhase', data.alivePlayers));
    
    socket.on('submitVote', (data) => {
        if(rooms[data.roomCode]) io.to(rooms[data.roomCode].host).emit('voteReceived', data);
    });
    socket.on('showVoteResults', (data) => io.to(data.roomCode).emit('animateVotes', data.tally));
    
    socket.on('startDefense', (data) => {
        if (!rooms[data.roomCode].defendedPlayers.includes(data.target)) {
            rooms[data.roomCode].defendedPlayers.push(data.target);
        }
        io.to(data.roomCode).emit('defensePhase', data.target);
    });

    socket.on('executePlayer', (data) => io.to(data.roomCode).emit('playerExecuted', data.target));
    socket.on('endGame', (data) => {
        if (rooms[data.roomCode]) {
            if (data.winner === 'mafia') rooms[data.roomCode].scores.mafia++;
            else rooms[data.roomCode].scores.citizens++;
            io.to(data.roomCode).emit('showVictory', { winner: data.winner, scores: rooms[data.roomCode].scores });
        }
    });
    socket.on('playAgain', (roomCode) => io.to(roomCode).emit('resetForNewGame', rooms[roomCode].scores));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر العالمي شغال على بورت ${PORT}`));