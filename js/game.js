// ============================================
// Game Board UI — Rendering & Interaction
// ============================================

// Session state
let roomCode = null;
let playerId = null;
let playerName = null;
let amHost = false;
let unsubRoom = null;
let currentGameState = null;
let currentRoomData = null;
let myHand = [];
let prevTurnPlayerId = null;
let chatInitialLoadDone = false;
let gameOverShown = false;
let timerInterval = null;
let lastTickSecond = -1;
let autoPassInProgress = false;
const TURN_DURATION = 30;

// ---- Sort Hand ----
function sortHand(hand) {
    const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
    const typeOrder = { number: 0, skip: 1, reverse: 2, draw2: 3, wild: 4, wild4: 5 };
    return [...hand].sort((a, b) => {
        const ca = colorOrder[a.color] ?? 5;
        const cb = colorOrder[b.color] ?? 5;
        if (ca !== cb) return ca - cb;
        const ta = typeOrder[a.type] ?? 6;
        const tb = typeOrder[b.type] ?? 6;
        if (ta !== tb) return ta - tb;
        return (a.value || 0) - (b.value || 0);
    });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    roomCode = sessionStorage.getItem('uno_room');
    playerId = sessionStorage.getItem('uno_player');
    playerName = sessionStorage.getItem('uno_name');
    amHost = sessionStorage.getItem('uno_host') === 'true';

    if (!roomCode || !playerId) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('gameRoomCode').textContent = roomCode;
    if (document.getElementById('playerSelfName')) {
        document.getElementById('playerSelfName').textContent = playerName || '';
    }

    // Listen to room state
    unsubRoom = FirebaseSync.listenToRoom(roomCode, {
        onRoomUpdate: handleRoomUpdate,
        onRoomDeleted: () => {
            showGameToast('Room was deleted', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
        }
    });

    // Setup presence
    FirebaseSync.setupPresence(roomCode, playerId);

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Listen to chat
    FirebaseSync.listenToChat(roomCode, (msg) => {
        renderChatMessage(msg);
    });
    setTimeout(() => { chatInitialLoadDone = true; }, 2000);

    // Listen to reactions
    FirebaseSync.listenToReactions(roomCode, (data) => {
        showFloatingEmoji(data);
    });

    // Chat enter key
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMsg();
    });
});

// ---- Room Update Handler ----
function handleRoomUpdate(room) {
    currentRoomData = room;

    if (room.status === 'waiting') {
        // Game ended, back to lobby
        return;
    }

    if (room.status === 'finished' || (room.gameState && room.gameState.winner)) {
        clearInterval(timerInterval);
        showGameOver(room);
        return;
    }

    if (room.status === 'playing' && room.gameState) {
        currentGameState = room.gameState;

        // Detect turn changes for sounds & notifications
        const _po = room.gameState.playerOrder
            ? (Array.isArray(room.gameState.playerOrder) ? room.gameState.playerOrder : Object.values(room.gameState.playerOrder))
            : [];
        const currentTurnPid = _po[room.gameState.currentPlayerIndex];
        if (prevTurnPlayerId !== null && prevTurnPlayerId !== currentTurnPid) {
            if (currentTurnPid === playerId) {
                UnoSounds.yourTurn();
                notifyMyTurn();
            }
        }
        prevTurnPlayerId = currentTurnPid;

        // Start turn timer
        if (room.gameState.turnStartedAt) {
            startTurnTimer(room.gameState.turnStartedAt);
        }

        // Get player order as array
        const playerOrder = room.gameState.playerOrder
            ? (Array.isArray(room.gameState.playerOrder) ? room.gameState.playerOrder : Object.values(room.gameState.playerOrder))
            : [];

        // Get my hand
        if (room.hands && room.hands[playerId]) {
            const rawHand = room.hands[playerId];
            myHand = Array.isArray(rawHand) ? rawHand : Object.values(rawHand);
            myHand = sortHand(myHand);
        } else {
            myHand = [];
        }

        renderTopBar(room);
        renderOpponents(room, playerOrder);
        renderDiscardPile(room);
        renderDrawPile(room);
        renderPlayerHand(room, playerOrder);
        renderUnoButton(room);
        handleActionLog(room);

        // Check if we need to show color picker
        if (room.gameState.mustChooseColor && room.gameState.pendingColorPlayer === playerId) {
            document.getElementById('colorPickerOverlay').classList.add('show');
        } else {
            document.getElementById('colorPickerOverlay').classList.remove('show');
        }
    }
}

// ---- Resolve player name (survives disconnects) ----
function getPlayerName(room, pid) {
    // Try live players first, fall back to stored names in gameState
    if (room.players && room.players[pid] && room.players[pid].name) {
        return room.players[pid].name;
    }
    if (room.gameState && room.gameState.playerNames && room.gameState.playerNames[pid]) {
        return room.gameState.playerNames[pid];
    }
    return 'Unknown';
}

// ---- Render Top Bar ----
function renderTopBar(room) {
    const gs = room.gameState;
    const playerOrder = Array.isArray(gs.playerOrder) ? gs.playerOrder : Object.values(gs.playerOrder);
    const currentPlayerId_ = playerOrder[gs.currentPlayerIndex];
    const currentPlayerName_ = getPlayerName(room, currentPlayerId_);

    document.getElementById('turnLabel').textContent = currentPlayerName_
        ? `Turn: ${currentPlayerName_}` : 'Turn: —';

    // Highlight top bar when it's my turn
    const topBar = document.querySelector('.top-bar');
    if (currentPlayerId_ === playerId) {
        topBar.classList.add('my-turn');
    } else {
        topBar.classList.remove('my-turn');
    }

    // Direction
    const dirEl = document.getElementById('directionIndicator');
    if (gs.direction === -1) {
        dirEl.classList.add('ccw');
    } else {
        dirEl.classList.remove('ccw');
    }

    // Current color dot
    const dot = document.getElementById('currentColorDot');
    dot.className = 'current-color-dot dot-' + gs.currentColor;
}

// ---- Render Opponents ----
function renderOpponents(room, playerOrder) {
    const area = document.getElementById('opponentsArea');
    area.innerHTML = '';
    const players = room.players || {};
    const presence = room.presence || {};

    playerOrder.forEach((pid, index) => {
        if (pid === playerId) return; // Skip self

        const pName = getPlayerName(room, pid);
        const livePlayer = players[pid];
        const isOnline = !!presence[pid];

        const slot = document.createElement('div');
        slot.className = 'opponent-slot';
        if (index === room.gameState.currentPlayerIndex) slot.classList.add('is-current-turn');
        if (!isOnline) slot.classList.add('is-offline');

        // Presence dot + Name row
        const nameRow = document.createElement('div');
        nameRow.className = 'opponent-name-row';
        const dot = document.createElement('span');
        dot.className = 'presence-dot ' + (isOnline ? 'online' : 'offline');
        nameRow.appendChild(dot);
        const name = document.createElement('div');
        name.className = 'opponent-name';
        if (index === room.gameState.currentPlayerIndex) name.classList.add('name-glow');
        name.textContent = pName;
        nameRow.appendChild(name);
        slot.appendChild(nameRow);

        // Turn indicator
        if (index === room.gameState.currentPlayerIndex) {
            const turnTag = document.createElement('div');
            turnTag.className = 'turn-indicator-tag';
            turnTag.textContent = '▶ Playing';
            slot.appendChild(turnTag);
        }

        // Card count (disconnect-safe)
        let count = 0;
        if (livePlayer && livePlayer.cardCount != null) {
            count = livePlayer.cardCount;
        } else if (room.hands && room.hands[pid]) {
            const h = room.hands[pid];
            count = Array.isArray(h) ? h.length : Object.keys(h).length;
        }

        // Mini cards
        const miniCards = document.createElement('div');
        miniCards.className = 'opponent-cards';
        const displayCount = Math.min(count, 10);
        for (let i = 0; i < displayCount; i++) {
            const mini = document.createElement('div');
            mini.className = 'mini-card';
            mini.appendChild(Object.assign(document.createElement('div'), { className: 'mini-card-inner' }));
            miniCards.appendChild(mini);
        }
        if (count > 10) {
            const more = document.createElement('div');
            more.className = 'opponent-card-count';
            more.textContent = `+${count - 10}`;
            more.style.marginLeft = '4px';
            miniCards.appendChild(more);
        }
        slot.appendChild(miniCards);

        const cardCountEl = document.createElement('div');
        cardCountEl.className = 'opponent-card-count';
        cardCountEl.textContent = count + (count === 1 ? ' card' : ' cards');
        slot.appendChild(cardCountEl);

        // UNO badge
        if (count === 1 || (room.gameState.unoCalledBy && room.gameState.unoCalledBy[pid])) {
            const badge = document.createElement('div');
            badge.className = 'opponent-uno-badge';
            badge.textContent = '🔥 UNO!';
            slot.appendChild(badge);
        }

        // Catch button (challenge opponent who didn't call UNO)
        const unoCalled = room.gameState.unoCalledBy && room.gameState.unoCalledBy[pid];
        if (count === 1 && !unoCalled) {
            const catchBtn = document.createElement('button');
            catchBtn.className = 'btn-catch';
            catchBtn.textContent = '🚨 Catch!';
            catchBtn.onclick = () => handleCatchUno(pid);
            slot.appendChild(catchBtn);
        }

        area.appendChild(slot);
    });
}

// ---- Render Discard Pile ----
function renderDiscardPile(room) {
    const container = document.getElementById('discardPile');
    const discardArr = room.discardPile
        ? (Array.isArray(room.discardPile) ? room.discardPile : Object.values(room.discardPile))
        : [];

    if (discardArr.length === 0) {
        container.innerHTML = '<div class="uno-card card-back pile-card"><div class="card-inner"></div></div>';
        return;
    }

    const topCard = discardArr[discardArr.length - 1];
    container.innerHTML = '';
    const cardEl = createCardElement(topCard, true);
    cardEl.classList.add('card-played');
    container.appendChild(cardEl);
}

// ---- Render Draw Pile ----
function renderDrawPile(room) {
    const drawArr = room.drawPile
        ? (Array.isArray(room.drawPile) ? room.drawPile : Object.values(room.drawPile))
        : [];
    document.getElementById('drawPileCount').textContent = drawArr.length;
}

// ---- Render Player Hand ----
function renderPlayerHand(room, playerOrder) {
    const container = document.getElementById('playerHand');
    container.innerHTML = '';

    const gs = room.gameState;
    const isMyTurn = playerOrder[gs.currentPlayerIndex] === playerId;
    const discardArr = room.discardPile
        ? (Array.isArray(room.discardPile) ? room.discardPile : Object.values(room.discardPile))
        : [];
    const topCard = discardArr.length > 0 ? discardArr[discardArr.length - 1] : null;

    // Your turn badge
    const badge = document.getElementById('yourTurnBadge');
    if (isMyTurn && !gs.mustChooseColor) {
        badge.classList.add('show');
    } else {
        badge.classList.remove('show');
    }

    // Card count
    document.getElementById('cardCountLabel').textContent = myHand.length + (myHand.length === 1 ? ' card' : ' cards');

    // Render cards
    myHand.forEach((card) => {
        const canPlay = isMyTurn && !gs.mustChooseColor && topCard && UnoEngine.canPlayCard(card, topCard, gs.currentColor);
        const cardEl = createCardElement(card, false);

        if (isMyTurn && canPlay) {
            cardEl.classList.add('playable');
            cardEl.onclick = () => handlePlayCard(card.id);
        } else {
            cardEl.classList.add('not-playable');
        }

        container.appendChild(cardEl);
    });

    // Pass button
    const btnPass = document.getElementById('btnPass');
    const hasDrawn = gs.playerHasDrawn || false;
    if (isMyTurn && hasDrawn) {
        btnPass.classList.add('show');
    } else {
        btnPass.classList.remove('show');
    }
}

// ---- Create Card DOM Element ----
function createCardElement(card, isPile) {
    const el = document.createElement('div');
    el.className = 'uno-card';

    if (isPile) el.classList.add('pile-card');

    // Color class
    if (card.type === 'wild' || card.type === 'wild4') {
        el.classList.add('card-wild');
    } else {
        el.classList.add('card-' + card.color);
    }

    // Inner ellipse
    const inner = document.createElement('div');
    inner.className = 'card-inner';
    el.appendChild(inner);

    // Wild cards
    if (card.type === 'wild' || card.type === 'wild4') {
        // Quadrant
        const quad = document.createElement('div');
        quad.className = 'wild-quadrant';
        ['q-red', 'q-blue', 'q-green', 'q-yellow'].forEach(cls => {
            const q = document.createElement('div');
            q.className = 'q ' + cls;
            quad.appendChild(q);
        });
        el.appendChild(quad);

        if (card.type === 'wild4') {
            const label = document.createElement('div');
            label.className = 'card-center wild4-label';
            label.textContent = '+4';
            el.appendChild(label);
        }

        // Corners
        const tl = document.createElement('div');
        tl.className = 'card-corner top-left';
        tl.textContent = card.type === 'wild4' ? '+4' : '✦';
        el.appendChild(tl);

        const br = document.createElement('div');
        br.className = 'card-corner bottom-right';
        br.textContent = card.type === 'wild4' ? '+4' : '✦';
        el.appendChild(br);

    } else {
        // Center label
        const center = document.createElement('div');
        center.className = 'card-center';

        if (card.type === 'skip') center.classList.add('action-skip');
        else if (card.type === 'reverse') center.classList.add('action-reverse');
        else if (card.type === 'draw2') center.classList.add('action-draw2');

        center.textContent = card.label;
        el.appendChild(center);

        // Corners
        const tl = document.createElement('div');
        tl.className = 'card-corner top-left';
        tl.textContent = card.label;
        el.appendChild(tl);

        const br = document.createElement('div');
        br.className = 'card-corner bottom-right';
        br.textContent = card.label;
        el.appendChild(br);
    }

    return el;
}

// ---- Play Card ----
async function handlePlayCard(cardId) {
    try {
        await FirebaseSync.playCardAction(roomCode, playerId, cardId);
    } catch (err) {
        showGameToast('Cannot play that card', 'error');
    }
}

// ---- Draw Card ----
async function handleDraw() {
    const gs = currentGameState;
    if (!gs) return;

    const playerOrder = Array.isArray(gs.playerOrder) ? gs.playerOrder : Object.values(gs.playerOrder);
    const isMyTurn = playerOrder[gs.currentPlayerIndex] === playerId;

    if (!isMyTurn) {
        showGameToast('Not your turn!', 'error');
        return;
    }

    if (gs.mustChooseColor) {
        showGameToast('Choose a color first!', 'error');
        return;
    }

    if (gs.playerHasDrawn) {
        showGameToast('Already drew this turn! Play a card or pass.', 'error');
        return;
    }

    try {
        await FirebaseSync.drawCardAction(roomCode, playerId);
    } catch (err) {
        showGameToast('Cannot draw right now', 'error');
    }
}

// ---- Pass Turn ----
async function handlePass() {
    try {
        await FirebaseSync.passTurnAction(roomCode, playerId);
    } catch (err) {
        showGameToast('Cannot pass right now', 'error');
    }
}

// ---- Color Choice ----
async function handleColorChoice(color) {
    try {
        await FirebaseSync.chooseColorAction(roomCode, playerId, color);
    } catch (err) {
        showGameToast('Failed to choose color', 'error');
    }
}

// ---- UNO Button ----
function renderUnoButton() {
    const btn = document.getElementById('btnUno');
    const gs = currentGameState;
    if (!gs) return;

    // Show UNO button when player has 2 cards (will have 1 after playing)
    if (myHand.length === 2 || myHand.length === 1) {
        const alreadyCalled = gs.unoCalledBy && gs.unoCalledBy[playerId];
        if (!alreadyCalled) {
            btn.classList.add('show');
        } else {
            btn.classList.remove('show');
        }
    } else {
        btn.classList.remove('show');
    }
}

async function handleUno() {
    try {
        await FirebaseSync.callUnoAction(roomCode, playerId);
        showGameToast('UNO! 🎉', 'success');
    } catch (err) {
        showGameToast('Cannot call UNO', 'error');
    }
}

// ---- Action Log ----
let lastLogAction = null;

function handleActionLog(room) {
    const gs = room.gameState;
    if (!gs || !gs.lastAction) return;

    const action = gs.lastAction;
    // Simple dedup
    const actionKey = JSON.stringify(action) + gs.turnNumber;
    if (actionKey === lastLogAction) return;
    lastLogAction = actionKey;

    // Play sound effects
    switch (action.type) {
        case 'play': UnoSounds.playCard(); break;
        case 'skip': UnoSounds.skip(); break;
        case 'reverse': UnoSounds.reverse(); break;
        case 'draw2': UnoSounds.draw2(); break;
        case 'wild': case 'wild4': UnoSounds.wild(); break;
        case 'draw': UnoSounds.drawCard(); break;
        case 'uno': UnoSounds.uno(); break;
    }

    const players = room.players || {};
    const getName = (id) => getPlayerName(room, id);

    let msg = '';
    switch (action.type) {
        case 'play':
            msg = `${getName(action.player)} played a card`;
            break;
        case 'skip':
            msg = `${getName(action.player)} skipped ${getName(action.skipped)}!`;
            break;
        case 'reverse':
            msg = `${getName(action.player)} reversed direction! 🔄`;
            break;
        case 'draw2':
            msg = `${getName(action.player)} made ${getName(action.victim)} draw 2! 😈`;
            break;
        case 'wild':
            msg = action.chosenColor
                ? `${getName(action.player)} played Wild → ${action.chosenColor.toUpperCase()}`
                : `${getName(action.player)} played Wild!`;
            break;
        case 'wild4':
            msg = action.chosenColor
                ? `${getName(action.player)} played +4 → ${action.chosenColor.toUpperCase()} (${getName(action.victim)} draws 4)`
                : `${getName(action.player)} played Wild +4! 💥`;
            break;
        case 'draw':
            msg = `${getName(action.player)} drew a card`;
            break;
        case 'pass':
            msg = `${getName(action.player)} passed`;
            break;
        case 'uno':
            msg = `${getName(action.player)} called UNO! 🔥`;
            break;
        case 'challenge-success':
            msg = `${getName(action.challenger)} caught ${getName(action.target)} → draws 2!`;
            break;
        case 'challenge-fail':
            msg = `${getName(action.challenger)} wrongly challenged → draws 2!`;
            break;
        case 'win':
            msg = `🏆 ${getName(action.player)} wins!`;
            break;
    }

    if (msg) addLogEntry(msg);
}

function addLogEntry(msg) {
    const log = document.getElementById('actionLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = msg;
    log.prepend(entry);

    // Keep max 10 entries
    while (log.children.length > 10) {
        log.removeChild(log.lastChild);
    }
}

// ---- Game Over ----
function showGameOver(room) {
    if (gameOverShown) return;
    gameOverShown = true;

    const overlay = document.getElementById('gameOverOverlay');
    overlay.classList.add('show');

    UnoSounds.win();
    launchConfetti();

    const players = room.players || {};
    const winnerId = room.gameState.winner;
    const winnerName = getPlayerName(room, winnerId);

    document.getElementById('winnerName').textContent = `🎉 ${winnerName} wins!`;

    // Calculate scores
    const hands = room.hands || {};
    const scores = UnoEngine.calculateScores(hands);

    const tbody = document.getElementById('scoresBody');
    tbody.innerHTML = '';

    // Sort by score (lower is better for losers, winner has 0)
    const entries = Object.entries(scores).sort((a, b) => a[1] - b[1]);

    entries.forEach(([pid, score]) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = getPlayerName(room, pid);
        if (pid === winnerId) tdName.textContent += ' 🏆';

        const tdScore = document.createElement('td');
        tdScore.className = 'score';
        tdScore.textContent = score + ' pts';

        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        tbody.appendChild(tr);
    });

    // Show play again only for host
    document.getElementById('btnPlayAgain').style.display = amHost ? 'block' : 'none';
}

async function handlePlayAgain() {
    try {
        gameOverShown = false;
        await FirebaseSync.playAgain(roomCode, playerId);
        document.getElementById('gameOverOverlay').classList.remove('show');
        // Will redirect back to lobby via room status change
        window.location.href = 'index.html';
    } catch (err) {
        showGameToast('Failed: ' + err.message, 'error');
    }
}

function handleBackToLobby() {
    sessionStorage.clear();
    window.location.href = 'index.html';
}

function handleLeave() {
    if (confirm('Leave the game?')) {
        FirebaseSync.leaveRoom(roomCode, playerId);
        sessionStorage.clear();
        window.location.href = 'index.html';
    }
}

function copyCode() {
    navigator.clipboard.writeText(roomCode).then(() => {
        showGameToast('Code copied!', 'success');
    });
}

// ---- Toast ----
function showGameToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================
// NEW FEATURES
// ============================================

// ---- Turn Timer ----
function startTurnTimer(turnStartedAt) {
    clearInterval(timerInterval);
    lastTickSecond = -1;
    autoPassInProgress = false;

    const timerEl = document.getElementById('turnTimer');
    const progressEl = document.getElementById('timerProgress');
    const textEl = document.getElementById('timerText');
    const circumference = 2 * Math.PI * 16;

    function update() {
        const gs = currentGameState;
        if (!gs) return;

        const elapsed = (Date.now() - turnStartedAt) / 1000;
        const remaining = Math.max(0, TURN_DURATION - elapsed);
        const sec = Math.ceil(remaining);

        // Update circle
        const fraction = remaining / TURN_DURATION;
        progressEl.style.strokeDashoffset = circumference * (1 - fraction);
        textEl.textContent = sec;

        // Warning state
        if (remaining <= 5) {
            timerEl.classList.add('timer-warning');
            if (sec !== lastTickSecond && sec > 0) {
                lastTickSecond = sec;
                UnoSounds.tick();
            }
        } else {
            timerEl.classList.remove('timer-warning');
        }

        // Auto-pass when expired (only if it's my turn)
        if (remaining <= 0 && !autoPassInProgress) {
            clearInterval(timerInterval);
            const playerOrder = Array.isArray(gs.playerOrder) ? gs.playerOrder : Object.values(gs.playerOrder);
            if (playerOrder[gs.currentPlayerIndex] === playerId) {
                autoPassTurn();
            }
        }
    }

    timerInterval = setInterval(update, 200);
    update();
}

async function autoPassTurn() {
    const gs = currentGameState;
    if (!gs || autoPassInProgress) return;
    autoPassInProgress = true;

    try {
        if (gs.mustChooseColor && gs.pendingColorPlayer === playerId) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            await FirebaseSync.chooseColorAction(roomCode, playerId, colors[Math.floor(Math.random() * 4)]);
        } else if (!gs.playerHasDrawn) {
            await FirebaseSync.drawCardAction(roomCode, playerId);
            // If drawn card is playable, we still need to pass
            setTimeout(async () => {
                try { await FirebaseSync.passTurnAction(roomCode, playerId); } catch (e) {}
                autoPassInProgress = false;
            }, 600);
            return;
        } else {
            await FirebaseSync.passTurnAction(roomCode, playerId);
        }
    } catch (e) {}
    autoPassInProgress = false;
}

// ---- Turn Notifications ----
function notifyMyTurn() {
    // Vibrate on mobile
    if ('vibrate' in navigator) {
        navigator.vibrate([150, 80, 150]);
    }
    // Browser notification when tab is hidden
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('UNO — Your Turn!', { body: 'It\'s your turn to play a card.', tag: 'uno-turn' });
        } catch (e) {}
    }
}

// ---- Sound Toggle ----
function toggleSound() {
    const on = UnoSounds.toggle();
    const btn = document.getElementById('btnSound');
    btn.textContent = on ? '🔊' : '🔇';
    btn.classList.toggle('muted', !on);
}

// ---- Share Room ----
function shareRoom() {
    const base = window.location.href.replace('game.html', 'index.html').split('?')[0];
    const url = base + '?join=' + roomCode;
    if (navigator.share) {
        navigator.share({ title: 'Join my UNO game!', text: 'Room code: ' + roomCode, url }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showGameToast('Share link copied!', 'success');
        }).catch(() => {
            showGameToast('Room: ' + roomCode, 'info');
        });
    }
}

// ---- Chat ----
let chatOpen = false;
let chatUnreadCount = 0;

function toggleChat() {
    chatOpen = !chatOpen;
    document.getElementById('chatPanel').classList.toggle('open', chatOpen);
    document.getElementById('chatOverlay').classList.toggle('show', chatOpen);
    if (chatOpen) {
        chatUnreadCount = 0;
        document.getElementById('chatUnread').classList.remove('show');
        document.getElementById('chatInput').focus();
    }
}

function sendChatMsg() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    FirebaseSync.sendChat(roomCode, playerId, playerName, msg);
}

function renderChatMessage(data) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-msg' + (data.senderId === playerId ? ' mine' : '');
    div.innerHTML = `<div class="chat-sender">${escapeHtml(data.name)}</div><div class="chat-text">${escapeHtml(data.text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (chatInitialLoadDone && !chatOpen && data.senderId !== playerId) {
        chatUnreadCount++;
        const badge = document.getElementById('chatUnread');
        badge.textContent = chatUnreadCount;
        badge.classList.add('show');
        UnoSounds.chat();
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Emoji Reactions ----
function sendEmoji(emoji) {
    FirebaseSync.sendReaction(roomCode, playerId, playerName, emoji);
    UnoSounds.emoji();
}

function showFloatingEmoji(data) {
    const container = document.getElementById('floatingEmojis');
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = data.emoji;
    el.style.left = (15 + Math.random() * 70) + '%';
    el.style.top = (25 + Math.random() * 40) + '%';
    container.appendChild(el);

    const label = document.createElement('div');
    label.className = 'floating-emoji-label';
    label.textContent = data.name;
    label.style.left = el.style.left;
    label.style.top = el.style.top;
    container.appendChild(label);

    if (data.senderId !== playerId) UnoSounds.emoji();
    setTimeout(() => { el.remove(); label.remove(); }, 2200);
}

// ---- Confetti ----
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#ED1C24', '#0072BC', '#00A651', '#FFD700', '#9B59B6', '#E67E22', '#fff'];
    const particles = [];

    for (let i = 0; i < 200; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * canvas.height * 0.5,
            w: 4 + Math.random() * 8,
            h: 3 + Math.random() * 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 6,
            vy: 2 + Math.random() * 4,
            rot: Math.random() * 360,
            rv: (Math.random() - 0.5) * 12,
            opacity: 1,
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.08;
            p.rot += p.rv;
            if (p.y > canvas.height + 50) p.opacity -= 0.03;
            if (p.opacity <= 0) return;
            alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        frame++;
        if (alive && frame < 300) {
            requestAnimationFrame(animate);
        } else {
            canvas.style.display = 'none';
        }
    }
    animate();
}

// ---- Catch UNO Challenge ----
async function handleCatchUno(targetId) {
    try {
        await FirebaseSync.challengeUnoAction(roomCode, playerId, targetId);
        showGameToast('You caught them! 🚨', 'success');
    } catch (err) {
        showGameToast('Challenge failed', 'error');
    }
}
