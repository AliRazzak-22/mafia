const socket = io(); 

let playerName = ""; let roomCode = ""; let isHost = false;
let connectedPlayers = []; let gameRoles = {}; let myRole = ""; let isAlive = true;
let alivePlayers = [];
let nightResults = {}; let hostTally = {}; let defenseTarget = null;

// --- نظام قراءة الملفات الصوتية الخاصة بك ---
function playSound(soundName) {
    try {
        let audio = new Audio(`sounds/${soundName}.mp3`);
        audio.play().catch(e => console.log("الصوت غير متوفر مؤقتاً:", soundName));
    } catch(e) {}
}

function showScreen(screenId) {
    if(!isAlive && screenId !== 'graveyard-screen' && screenId !== 'victory-screen') return; // منع الميت من رؤية الشاشات
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

function createGame() {
    playerName = document.getElementById("player-name").value.trim();
    if (!playerName) return alert("أدخل اسمك!");
    isHost = true; roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    socket.emit('createRoom', { roomCode, playerName });
    setupWaitingRoom();
}
function joinGame() {
    playerName = document.getElementById("player-name").value.trim();
    roomCode = document.getElementById("room-code-input").value.trim().toUpperCase();
    if (!playerName || !roomCode) return alert("أدخل بياناتك!");
    isHost = false;
    socket.emit('joinRoom', { roomCode, playerName });
    setupWaitingRoom();
}
function setupWaitingRoom() {
    showScreen("waiting-room-screen");
    document.getElementById("display-room-code").innerText = roomCode;
    if (isHost) {
        document.getElementById("host-start-btn").classList.remove("hidden");
        document.getElementById("waiting-msg").classList.add("hidden");
    }
}

socket.on('updatePlayers', (playersArray) => {
    connectedPlayers = playersArray;
    const list = document.getElementById("players-list"); list.innerHTML = "";
    connectedPlayers.forEach(p => { const li = document.createElement("li"); li.innerText = p; list.appendChild(li); });
    document.getElementById("player-count").innerText = connectedPlayers.length;
});

function goToRoleSelection() { showScreen("lobby-screen"); }

function distributeRoles() {
    let count = connectedPlayers.length; let rolesArray = [];
    let numMafia = count >= 10 ? 3 : (count >= 6 ? 2 : 1);
    for(let i=0; i<numMafia; i++) rolesArray.push("مافيا");
    if (document.getElementById("role-doctor").checked) rolesArray.push("الطبيب");
    if (document.getElementById("role-detective").checked) rolesArray.push("المحقق");
    if (document.getElementById("role-sniper").checked) rolesArray.push("القناص");
    if (document.getElementById("role-wronged").checked) rolesArray.push("الفتى المظلوم");
    while(rolesArray.length < count) rolesArray.push("مواطن");
    rolesArray = rolesArray.sort(() => Math.random() - 0.5);
    
    let assignments = {};
    connectedPlayers.forEach((p, index) => { assignments[p] = rolesArray[index]; });
    socket.emit('startGame', { roomCode, assignments });
}

socket.on('gameStarted', (assignments) => {
    gameRoles = assignments; myRole = assignments[playerName]; 
    alivePlayers = Object.keys(gameRoles); isAlive = true;
    
    document.getElementById("victory-screen").classList.add("hidden");
    document.getElementById("doctor-shield").classList.add("hidden");
    
    showScreen("gameplay-screen");
    document.getElementById("system-message").innerText = "السلام عليكم ورحمة الله وبركاته، اللعبة من تطوير علي رزاق ويتمنى لكم وقتاً ممتعاً";
    playSound('intro');
    
    setTimeout(() => {
        showScreen("role-reveal-screen");
        document.getElementById("role-name").innerText = myRole;
        document.getElementById("player-card").classList.remove("flipped");
    }, 10000); // انتظار 10 ثواني للرسالة الترحيبية
});

function flipCard() {
    const card = document.getElementById("player-card");
    if (!card.classList.contains("flipped")) {
        card.classList.add("flipped"); 
        setTimeout(() => document.getElementById("ready-btn").classList.remove("hidden"), 1000);
    }
}
function playerReady() { document.getElementById("ready-btn").classList.add("hidden"); socket.emit('playerReady', roomCode); }
socket.on('allReady', () => { if(isHost) startNightPhase(); });

// ==========================================
// الليل والانتظار اللانهائي
// ==========================================
async function startNightPhase() {
    socket.emit('changeTheme', { roomCode, theme: 'night' });
    nightResults = { mafiaBoss: null, mafiaKill: null, docSave: null, sniperKill: null };

    await broadcastAndWait("الجميع يغمض العينين ويخلد إلى النوم.", 'sleep');
    
    let mafias = alivePlayers.filter(p => gameRoles[p] === 'مافيا');
    if(mafias.length > 0) nightResults.mafiaBoss = mafias[0];

    if (nightResults.mafiaBoss) {
        await broadcastAndWait("المافيا يفتح عينه. كبير المافيا إختر شخصاً لقتله", 'mafia_wake');
        nightResults.mafiaKill = await executeRoleTurn('مافيا_قتل', nightResults.mafiaBoss);
        await broadcastAndWait("المافيا إغلقوا أعينكم", 'mafia_close');
    }
    if (alivePlayers.some(p => gameRoles[p] === 'المحقق')) {
        await broadcastAndWait("المحقق إفتح عينيك وإختر شخص تسأل عنه", 'detective_wake');
        await executeRoleTurn('المحقق', null);
        await broadcastAndWait("المحقق أغلق عينك", 'detective_close');
    }
    if (alivePlayers.some(p => gameRoles[p] === 'الطبيب')) {
        await broadcastAndWait("الطبيب إفتح عينك وإختر شخص تحميه", 'doctor_wake');
        nightResults.docSave = await executeRoleTurn('الطبيب', null);
        await broadcastAndWait("الطبيب أغلق عينيك", 'doctor_close');
    }
    if (alivePlayers.some(p => gameRoles[p] === 'القناص')) {
        await broadcastAndWait("القناص إفتح عينيك وأختر شخص", 'sniper_wake');
        nightResults.sniperKill = await executeRoleTurn('القناص', null);
        await broadcastAndWait("القناص أغلق عينيك", 'sniper_close');
    }

    await broadcastAndWait("الجميع يفتح عينه", 'wake_up');
    calculateMorningResults();
}

function broadcastAndWait(text, soundFile) {
    return new Promise(resolve => { 
        socket.emit('broadcastMessage', { roomCode, text, soundFile }); 
        setTimeout(resolve, 10000); // 10 ثواني كاملة لا تختفي الرسالة قبلها
    });
}

// دالة التنفيذ بدون مؤقت (تنتظر للأبد حتى يختار اللاعب)
function executeRoleTurn(actionType, specificPlayer) {
    return new Promise(resolve => {
        socket.emit('openRoleAction', { roomCode, actionType, specificPlayer, alivePlayers });
        const actionListener = (data) => {
            socket.off('actionReceived', actionListener); 
            socket.emit('closeAllActions', roomCode); 
            resolve(data.target);
        };
        socket.on('actionReceived', actionListener);
    });
}

socket.on('promptAction', (data) => {
    if(!isAlive) return; // الميت لا يرى أزرار التفاعل
    document.getElementById("detective-result").classList.add("hidden");
    const { actionType, specificPlayer, alivePlayers: currentAlives } = data;
    let shouldShow = false; let targets = [...currentAlives];

    if (actionType === 'مافيا_قتل' && playerName === specificPlayer) { shouldShow = true; targets = targets.filter(p => gameRoles[p] !== 'مافيا'); } 
    else if (actionType === 'المحقق' && myRole === 'المحقق') { shouldShow = true; targets = targets.filter(p => p !== playerName); }
    else if (actionType === 'الطبيب' && myRole === 'الطبيب') { shouldShow = true; }
    else if (actionType === 'القناص' && myRole === 'القناص') { shouldShow = true; targets = targets.filter(p => p !== playerName); }
    else if (actionType === 'مظلوم_انتقام' && playerName === specificPlayer) { shouldShow = true; targets = targets.filter(p => p !== playerName); }

    if (shouldShow) {
        document.getElementById("action-area").classList.remove("hidden");
        const list = document.getElementById("target-list"); list.innerHTML = "";
        targets.forEach(p => {
            const btn = document.createElement("button"); btn.className = "target-btn"; btn.innerText = p;
            btn.onclick = () => submitAction(p, actionType); list.appendChild(btn);
        });
        document.getElementById("skip-action-btn").classList.remove("hidden");
        if(actionType === 'مظلوم_انتقام') document.getElementById("skip-action-btn").classList.add("hidden"); // المظلوم مجبر يختار
    }
});

function submitAction(target, actionType) {
    document.getElementById("action-area").classList.add("hidden");
    if (actionType === 'المحقق' && target !== 'skip') {
        const resDiv = document.getElementById("detective-result"); resDiv.classList.remove("hidden");
        resDiv.innerText = (gameRoles[target] === 'مافيا') ? `${target} هو مافيا!` : `${target} ليس مافيا.`;
        resDiv.style.color = (gameRoles[target] === 'مافيا') ? "red" : "green";
    }
    socket.emit('submitAction', { roomCode, target });
}
socket.on('closeActionUI', () => document.getElementById("action-area").classList.add("hidden"));

// ==========================================
// الصباح، الموت، والفتى المظلوم
// ==========================================
async function calculateMorningResults() {
    socket.emit('changeTheme', { roomCode, theme: 'day' });
    let deadThisNight = []; let wasSaved = false;

    if (nightResults.mafiaKill && nightResults.mafiaKill !== 'skip') {
        if (nightResults.mafiaKill !== nightResults.docSave) deadThisNight.push(nightResults.mafiaKill); else wasSaved = true;
    }
    if (nightResults.sniperKill && nightResults.sniperKill !== 'skip') {
        if (nightResults.sniperKill !== nightResults.docSave) {
            deadThisNight.push(nightResults.sniperKill);
            if (gameRoles[nightResults.sniperKill] !== 'مافيا') {
                let sniperName = Object.keys(gameRoles).find(p => gameRoles[p] === 'القناص');
                if (sniperName && !deadThisNight.includes(sniperName)) deadThisNight.push(sniperName);
            }
        } else wasSaved = true;
    }

    deadThisNight = [...new Set(deadThisNight)];
    
    // بروتوكول الفتى المظلوم
    let wrongedBoyDead = deadThisNight.find(p => gameRoles[p] === 'الفتى المظلوم');
    if (wrongedBoyDead) {
        await broadcastAndWait("الفتى المظلوم قُتل! وهو الآن يختار شخصاً ليأخذه معه إلى القبر...", 'wronged_boy');
        let companion = await executeRoleTurn('مظلوم_انتقام', wrongedBoyDead);
        if (companion && companion !== 'skip') {
            deadThisNight.push(companion);
        }
    }

    // تطبيق الوفيات
    alivePlayers = alivePlayers.filter(p => !deadThisNight.includes(p));
    socket.emit('syncAlivePlayers', { roomCode, alivePlayers });
    deadThisNight.forEach(p => socket.emit('sendToGraveyard', { roomCode, target: p }));

    if (wasSaved && alivePlayers.some(p => gameRoles[p] === 'الطبيب')) {
        document.getElementById("doctor-shield").classList.remove("hidden");
        setTimeout(()=> document.getElementById("doctor-shield").classList.add("hidden"), 4000);
    }

    let msg = deadThisNight.length > 0 ? "في الليلة الماضية تمت إراقة دماء..." : "مرت الليلة بسلام! محاولة إغتيال فاشلة تمت حماية الضحية.";
    let sfx = deadThisNight.length > 0 ? 'morning_blood' : 'morning_peace';
    socket.emit('broadcastMessage', { roomCode, text: msg, soundFile: sfx });

    setTimeout(() => {
        if (deadThisNight.length > 0) {
            deadThisNight.forEach(p => {
                let r = gameRoles[p]; if (['الطبيب', 'المحقق', 'القناص'].includes(r)) r = "مواطن";
                socket.emit('announceDead', { roomCode, deadPlayer: p, roleToShow: r });
            });
        }
        setTimeout(() => {
            checkWinCondition(() => { if(isHost) socket.emit('startDiscussion', roomCode); });
        }, deadThisNight.length > 0 ? 6000 : 2000); // إعطاء وقت لرؤية البطاقات الدوارة
    }, 10000);
}

// عرض رسائل النظام والصوت للجميع
socket.on('setTheme', (t) => document.body.className = t === 'night' ? 'night-theme' : 'day-theme');
socket.on('receiveMessage', (data) => { 
    if(isAlive) showScreen("gameplay-screen"); 
    document.getElementById("system-message").innerText = data.text;
    if(data.soundFile) playSound(data.soundFile);
});
socket.on('updateAlivePlayers', (alives) => { alivePlayers = alives; });

socket.on('moveToGraveyard', (target) => {
    if (playerName === target) {
        isAlive = false;
        showScreen('graveyard-screen');
    }
});

socket.on('showDeadPlayer', (data) => {
    if(!isAlive) return;
    showScreen("gameplay-screen");
    playSound('stamp'); // مؤثر الطرد أو الموت
    const msg = document.getElementById("system-message");
    msg.innerHTML = `ضحية الليلة: <br><div class="card-container flipped" style="margin-top:20px; width:150px; height:200px;"><div class="card flipped"><div class="card-back glass-panel" style="border-color:red;"><h3 style="font-size:1.2rem">${data.deadPlayer}</h3><h2 class="blood-title" style="font-size:1.5rem">${data.roleToShow}</h2></div></div></div>`;
});

// ==========================================
// النقاش، التصويت، والفتى المظلوم بالنهار
// ==========================================
socket.on('discussionPhase', () => {
    if(!isAlive) return;
    showScreen("gameplay-screen");
    document.getElementById("system-message").innerText = "حان وقت النقاش! استنتجوا من هو المافيا.";
    playSound('discussion');
    if (isHost) document.getElementById("host-day-controls").classList.remove("hidden");
});

function triggerDiscussion() {
    document.getElementById("host-day-controls").classList.add("hidden");
    socket.emit('startVoting', { roomCode, alivePlayers });
}

socket.on('votingPhase', (alives) => {
    if(!isAlive) return;
    showScreen("voting-screen"); 
    const list = document.getElementById("voting-list"); list.innerHTML = "";
    alives.forEach(p => {
        if (p !== playerName) { // لا يظهر اسمه ليصوت على نفسه
            const btn = document.createElement("div"); btn.className = "vote-card"; btn.innerText = p;
            btn.onclick = () => submitVote(p); list.appendChild(btn);
        }
    });
    if (isHost) document.getElementById("host-end-vote-btn").classList.remove("hidden");
});

function submitVote(target) {
    document.getElementById("voting-list").innerHTML = "<h3 class='yellow-text'>تم تسجيل صوتك، بانتظار البقية...</h3>";
    socket.emit('submitVote', { roomCode, target });
}

socket.on('voteReceived', (data) => {
    if(data.target !== 'skip') hostTally[data.target] = (hostTally[data.target] || 0) + 1;
});

function tallyAndShowVotes() {
    document.getElementById("host-end-vote-btn").classList.add("hidden");
    socket.emit('showVoteResults', { roomCode, tally: hostTally });
    hostTally = {}; 
}

socket.on('animateVotes', async (tally) => {
    if(!isAlive) return;
    showScreen("vote-results-screen");
    document.getElementById("host-defense-controls").classList.add("hidden");
    document.getElementById("defense-area").classList.add("hidden");
    
    const container = document.getElementById("tally-container"); container.innerHTML = "";
    let maxVotes = 0; let maxPlayer = null; let isTie = false;

    Object.keys(tally).forEach(p => { container.innerHTML += `<div class="tally-card" id="tally-${p}"><p>${p}</p><span class="vote-num" id="count-${p}">0</span></div>`; });

    for (let p in tally) {
        let countElem = document.getElementById(`count-${p}`);
        for (let i = 1; i <= tally[p]; i++) {
            await new Promise(r => setTimeout(r, 600)); 
            playSound('thud'); 
            countElem.innerText = i; countElem.classList.add('bounce');
            if (i >= 4) countElem.style.color = 'red'; else if (i >= 2) countElem.style.color = 'orange';
            setTimeout(()=> countElem.classList.remove('bounce'), 200);
        }
        if (tally[p] > maxVotes) { maxVotes = tally[p]; maxPlayer = p; isTie = false; }
        else if (tally[p] === maxVotes) { isTie = true; }
    }

    setTimeout(() => {
        if (!isTie && maxPlayer) { socket.emit('startDefense', { roomCode, target: maxPlayer }); } 
        else {
            showScreen("gameplay-screen"); document.getElementById("system-message").innerText = "حدث تعادل في الأصوات، لا إعدام اليوم.";
            playSound('tie');
            setTimeout(() => { if (isHost) startNightPhase(); }, 5000);
        }
    }, 1500);
});

// التبرير والإعدام
socket.on('defensePhase', (target) => {
    if(!isAlive) return;
    defenseTarget = target;
    document.getElementById("defense-area").classList.remove("hidden");
    document.getElementById("defense-target").innerText = target;
    
    const fill = document.getElementById("timer-fill"); fill.style.width = "100%";
    setTimeout(() => fill.style.width = "0%", 100);

    if (isHost) document.getElementById("host-defense-controls").classList.remove("hidden");
});

async function hostDecideDefense(decision) {
    if (decision === 'execute') {
        let deadPlayer = defenseTarget;
        socket.emit('executePlayer', { roomCode, target: deadPlayer });
        
        // التحقق من الفتى المظلوم في النهار
        if (gameRoles[deadPlayer] === 'الفتى المظلوم') {
            await broadcastAndWait("لقد أعدمتم الفتى المظلوم! سيختار شخصاً ليأخذه معه...", 'wronged_boy');
            let companion = await executeRoleTurn('مظلوم_انتقام', deadPlayer);
            if (companion && companion !== 'skip') {
                socket.emit('executePlayer', { roomCode, target: companion });
            }
        }
    } else {
        socket.emit('startVoting', { roomCode, alivePlayers });
    }
}

socket.on('playerExecuted', (target) => {
    if(!isAlive && playerName !== target) return;
    const stamp = document.getElementById("execution-stamp");
    stamp.classList.remove("hidden");
    playSound('stamp'); 
    
    alivePlayers = alivePlayers.filter(x => x !== target);
    socket.emit('syncAlivePlayers', { roomCode, alivePlayers });
    
    setTimeout(() => {
        stamp.classList.add("hidden");
        socket.emit('sendToGraveyard', { roomCode, target: target });
        
        let r = gameRoles[target]; if (['الطبيب', 'المحقق', 'القناص'].includes(r)) r = "مواطن";
        if(isAlive) socket.emit('announceDead', { roomCode, deadPlayer: target, roleToShow: r });
        
        setTimeout(() => checkWinCondition(() => { if(isHost) startNightPhase(); }), 4000);
    }, 2000);
});

// ==========================================
// الفوز وإعادة اللعب
// ==========================================
function checkWinCondition(continueCallback) {
    let mafiaCount = alivePlayers.filter(p => gameRoles[p] === 'مافيا').length;
    let citizenCount = alivePlayers.length - mafiaCount;

    if (mafiaCount === 0) { if (isHost) socket.emit('endGame', { roomCode, winner: 'citizens' }); } 
    else if (mafiaCount >= citizenCount) { if (isHost) socket.emit('endGame', { roomCode, winner: 'mafia' }); } 
    else { continueCallback(); }
}

socket.on('showVictory', (data) => {
    showScreen("victory-screen");
    const vs = document.getElementById("victory-screen");
    if (data.winner === 'mafia') {
        vs.className = "screen active mafia-win"; document.getElementById("victory-title").innerText = "المافيا تنتصر!";
    } else {
        vs.className = "screen active citizen-win"; document.getElementById("victory-title").innerText = "المواطنون ينتصرون!";
    }
    document.getElementById("final-mafia-score").innerText = data.scores.mafia;
    document.getElementById("final-citizens-score").innerText = data.scores.citizens;
    
    if (isHost) document.getElementById("play-again-btn").classList.remove("hidden");
});

function requestPlayAgain() { socket.emit('playAgain', roomCode); }

socket.on('resetForNewGame', (scores) => {
    document.getElementById("lobby-scoreboard").classList.remove("hidden");
    document.getElementById("score-mafia").innerText = scores.mafia;
    document.getElementById("score-citizens").innerText = scores.citizens;
    setupWaitingRoom();
});