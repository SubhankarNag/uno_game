// ============================================
// Game Board UI — Rendering & Interaction
// ============================================

// Avatars
const GAME_AVATARS = [
    { emoji: '🦊', color: '#E67E22' },
    { emoji: '🐺', color: '#607D8B' },
    { emoji: '🦁', color: '#FFD700' },
    { emoji: '🐸', color: '#00A651' },
    { emoji: '🦉', color: '#795548' },
    { emoji: '🐙', color: '#9B59B6' },
    { emoji: '🦄', color: '#E91E63' },
    { emoji: '🐲', color: '#0072BC' },
];

// Rate limiting for chat / emoji / taunts (max 1 per 1.5s)
let lastSendTimestamp = 0;
const SEND_COOLDOWN_MS = 1500;
function canSendNow() {
    const now = Date.now();
    if (now - lastSendTimestamp < SEND_COOLDOWN_MS) {
        showGameToast('Slow down! Wait a moment.', 'warning');
        return false;
    }
    lastSendTimestamp = now;
    return true;
}

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
let lastHandFingerprint = '';
let lastTurnIdx = -1;
let chatInitialLoadDone = false;
let gameOverShown = false;
let timerInterval = null;
let lastTickSecond = -1;
let autoPassInProgress = false;
const TURN_DURATION = 30;
let prevDirection = 1;
let unoPressedThisTurn = false;
let sortMode = localStorage.getItem('uno_sort_mode') || 'color'; // 'color' or 'type'

// ---- Sort Hand ----
function sortHand(hand) {
    const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
    const typeOrder = { number: 0, skip: 1, reverse: 2, draw2: 3, wild: 4, wild4: 5 };
    return [...hand].sort((a, b) => {
        if (sortMode === 'type') {
            const ta = typeOrder[a.type] ?? 6;
            const tb = typeOrder[b.type] ?? 6;
            if (ta !== tb) return ta - tb;
            const ca = colorOrder[a.color] ?? 5;
            const cb = colorOrder[b.color] ?? 5;
            if (ca !== cb) return ca - cb;
            return (a.value || 0) - (b.value || 0);
        }
        // Default: sort by color
        const ca = colorOrder[a.color] ?? 5;
        const cb = colorOrder[b.color] ?? 5;
        if (ca !== cb) return ca - cb;
        const ta = typeOrder[a.type] ?? 6;
        const tb = typeOrder[b.type] ?? 6;
        if (ta !== tb) return ta - tb;
        return (a.value || 0) - (b.value || 0);
    });
}

function toggleSortMode() {
    sortMode = sortMode === 'color' ? 'type' : 'color';
    localStorage.setItem('uno_sort_mode', sortMode);
    // Re-sort & re-render hand
    if (currentRoomData) {
        const playerOrder = currentGameState && currentGameState.playerOrder
            ? (Array.isArray(currentGameState.playerOrder) ? currentGameState.playerOrder : Object.values(currentGameState.playerOrder))
            : [];
        myHand = sortHand(myHand);
        renderPlayerHand(currentRoomData, playerOrder);
    }
    updateSortButton();
    showGameToast('Sort: ' + (sortMode === 'color' ? '🎨 Color' : '🔤 Type'), 'info');
}

function updateSortButton() {
    const btn = document.getElementById('btnSortToggle');
    if (btn) btn.textContent = sortMode === 'color' ? '🎨' : '🔤';
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
        const avIdx = parseInt(sessionStorage.getItem('uno_avatar') || '0');
        const av = GAME_AVATARS[avIdx] || GAME_AVATARS[0];
        document.getElementById('playerSelfName').textContent = av.emoji + ' ' + (playerName || '');
    }

    updateSortButton();

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

    // Reconnection recovery
    setupReconnectionHandler();

    // Chat enter key
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMsg();
    });
});

// ---- Room Update Handler ----
function handleRoomUpdate(room) {
    currentRoomData = room;

    // Host migration: if host is gone, promote next player
    if (room.status === 'playing' && room.host) {
        const players = room.players || {};
        const hostGone = !players[room.host];
        if (hostGone) {
            // Find the next alive player in order to become host
            const order = room.gameState && room.gameState.playerOrder
                ? (Array.isArray(room.gameState.playerOrder) ? room.gameState.playerOrder : Object.values(room.gameState.playerOrder))
                : Object.keys(players);
            const alivePlayers = order.filter(pid => !!players[pid]);
            if (alivePlayers.length > 0 && alivePlayers[0] === playerId) {
                // I'm the candidate — promote myself
                migrateHost(roomCode, playerId);
            }
        }
    }

    if (room.status === 'waiting') {
        // Game ended, back to lobby
        return;
    }

    if (room.status === 'finished' || (room.gameState && room.gameState.winner)) {
        clearInterval(timerInterval);
        // Check if someone left
        if (room.gameState && room.gameState.lastAction && room.gameState.lastAction.type === 'player-left') {
            showGameOverPlayerLeft(room);
        } else {
            showGameOver(room);
        }
        return;
    }

    if (room.status === 'playing' && room.gameState) {
        // Dismiss game-over overlay on rematch restart
        if (gameOverShown && !room.gameState.winner) {
            gameOverShown = false;
            document.getElementById('gameOverOverlay').classList.remove('show');
            const btn = document.getElementById('btnPlayAgain');
            btn.disabled = false;
            btn.textContent = 'Rematch 🔄';
        }

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

// ---- Resolve player avatar ----
function getPlayerAvatar(room, pid) {
    if (room.players && room.players[pid] && room.players[pid].avatar != null) {
        return room.players[pid].avatar;
    }
    if (room.gameState && room.gameState.playerAvatars && room.gameState.playerAvatars[pid] != null) {
        return room.gameState.playerAvatars[pid];
    }
    return 0;
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

    // Direction arrow
    const arrowSvg = document.getElementById('directionArrowSvg');
    const arrowWrap = document.getElementById('directionArrowWrap');
    if (arrowSvg) {
        if (gs.direction === -1) {
            arrowSvg.classList.add('ccw');
        } else {
            arrowSvg.classList.remove('ccw');
        }
        // Pulse when direction changed
        if (prevDirection !== gs.direction) {
            arrowWrap.classList.remove('anim-pulse');
            void arrowWrap.offsetWidth; // force reflow
            arrowWrap.classList.add('anim-pulse');
            prevDirection = gs.direction;
        }
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
        slot.dataset.playerId = pid;
        if (index === room.gameState.currentPlayerIndex) slot.classList.add('is-current-turn');
        if (!isOnline) slot.classList.add('is-offline');

        // Presence dot + Name row
        const nameRow = document.createElement('div');
        nameRow.className = 'opponent-name-row';
        const dot = document.createElement('span');
        dot.className = 'presence-dot ' + (isOnline ? 'online' : 'offline');
        nameRow.appendChild(dot);

        const avIdx = getPlayerAvatar(room, pid);
        const av = GAME_AVATARS[avIdx] || GAME_AVATARS[0];
        const avatarEl = document.createElement('span');
        avatarEl.className = 'opponent-avatar';
        avatarEl.textContent = av.emoji;
        nameRow.appendChild(avatarEl);

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
        // Card count badge colors based on danger level
        if (count <= 1) {
            cardCountEl.classList.add('count-danger');
        } else if (count <= 3) {
            cardCountEl.classList.add('count-warning');
        } else {
            cardCountEl.classList.add('count-safe');
        }
        cardCountEl.textContent = count + (count === 1 ? ' card' : ' cards');
        slot.appendChild(cardCountEl);

        // UNO badge
        if (count === 1 || (room.gameState.unoCalledBy && room.gameState.unoCalledBy[pid])) {
            const badge = document.createElement('div');
            badge.className = 'opponent-uno-badge';
            badge.textContent = '🔥 UNO!';
            slot.appendChild(badge);
        }

        // Taunt button - send targeted emoji
        const tauntBtn = document.createElement('button');
        tauntBtn.className = 'btn-taunt';
        tauntBtn.textContent = '😜';
        tauntBtn.title = 'Send taunt to ' + pName;
        tauntBtn.onclick = (e) => {
            e.stopPropagation();
            sendTargetedTaunt(pid, pName);
        };
        slot.appendChild(tauntBtn);

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

    container.innerHTML = '';

    // Show up to 3 fanned cards
    const fanCount = Math.min(discardArr.length, 3);
    const fanAngles = [-6, 0, 6];
    const fanOffsets = [-8, 0, 8];
    const startIdx = discardArr.length - fanCount;

    for (let i = 0; i < fanCount; i++) {
        const card = discardArr[startIdx + i];
        const cardEl = createCardElement(card, true);
        const isTop = (i === fanCount - 1);
        if (isTop) {
            cardEl.classList.add('card-played');
            cardEl.classList.add('card-flip');
        }
        cardEl.style.position = i === 0 ? 'relative' : 'absolute';
        cardEl.style.transform = `rotate(${fanAngles[i + (3 - fanCount)]}deg) translateX(${fanOffsets[i + (3 - fanCount)]}px)`;
        cardEl.style.zIndex = i;
        if (!isTop) cardEl.style.opacity = '0.6';
        container.appendChild(cardEl);
    }

    // Wild color glow on discard pile
    const gs = room.gameState;
    const topCard = discardArr[discardArr.length - 1];
    container.classList.remove('glow-red', 'glow-blue', 'glow-green', 'glow-yellow');
    if (topCard && (topCard.type === 'wild' || topCard.type === 'wild4') && gs.currentColor) {
        container.classList.add('glow-' + gs.currentColor);
    }

    // Last-player pill
    let pill = document.getElementById('lastPlayerPill');
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'lastPlayerPill';
        pill.className = 'last-player-pill';
        container.parentElement.appendChild(pill);
    }
    if (gs.lastAction && gs.lastAction.player) {
        const pName = getPlayerName(room, gs.lastAction.player);
        const avIdx = getPlayerAvatar(room, gs.lastAction.player);
        const av = GAME_AVATARS[avIdx] || GAME_AVATARS[0];
        pill.textContent = av.emoji + ' ' + pName;
        pill.style.display = 'block';
    } else {
        pill.style.display = 'none';
    }
}

// ---- Render Draw Pile ----
function renderDrawPile(room) {
    const drawArr = room.drawPile
        ? (Array.isArray(room.drawPile) ? room.drawPile : Object.values(room.drawPile))
        : [];
    const countEl = document.getElementById('drawPileCount');
    countEl.textContent = drawArr.length;
    // Visual warning when draw pile is low
    const pileEl = document.getElementById('drawPile');
    if (drawArr.length === 0) {
        pileEl.style.opacity = '0.4';
        countEl.style.color = '#ff4444';
    } else if (drawArr.length <= 10) {
        pileEl.style.opacity = '0.7';
        countEl.style.color = '#ffaa00';
    } else {
        pileEl.style.opacity = '1';
        countEl.style.color = '';
    }

    // Draw pile glow when no playable cards
    const gs = room.gameState;
    const playerOrder = Array.isArray(gs.playerOrder) ? gs.playerOrder : Object.values(gs.playerOrder);
    const isMyTurn = playerOrder[gs.currentPlayerIndex] === playerId;
    const discardArr = room.discardPile
        ? (Array.isArray(room.discardPile) ? room.discardPile : Object.values(room.discardPile))
        : [];
    const topCard = discardArr.length > 0 ? discardArr[discardArr.length - 1] : null;

    if (isMyTurn && !gs.mustChooseColor && !gs.playerHasDrawn && topCard) {
        const playable = UnoEngine.getPlayableCards(myHand, topCard, gs.currentColor, gs.pendingDrawAmount || 0, gs.pendingDrawType || null);
        if (playable.length === 0) {
            pileEl.classList.add('draw-glow');
        } else {
            pileEl.classList.remove('draw-glow');
        }
    } else {
        pileEl.classList.remove('draw-glow');
    }

    // Stacking indicator
    const pending = room.gameState.pendingDrawAmount || 0;
    let stackBadge = document.getElementById('stackBadge');
    if (pending > 0) {
        if (!stackBadge) {
            stackBadge = document.createElement('div');
            stackBadge.id = 'stackBadge';
            stackBadge.className = 'stack-badge';
            pileEl.appendChild(stackBadge);
        }
        stackBadge.textContent = '+' + pending;
        stackBadge.classList.add('show');
    } else if (stackBadge) {
        stackBadge.classList.remove('show');
    }
}

// ---- Render Player Hand ----
function renderPlayerHand(room, playerOrder) {
    const container = document.getElementById('playerHand');

    const gs = room.gameState;
    const isMyTurn = playerOrder[gs.currentPlayerIndex] === playerId;
    const turnIdx = gs.currentPlayerIndex;

    // Build a fingerprint to skip redundant DOM rebuilds
    const fp = myHand.map(c => c.id).join(',') + '|' + turnIdx + '|' + (gs.mustChooseColor ? 1 : 0) + '|' + (gs.currentColor || '') + '|' + (gs.pendingDrawAmount || 0);
    if (fp === lastHandFingerprint) return;
    lastHandFingerprint = fp;

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
        const pending = gs.pendingDrawAmount || 0;
        const pendingType = gs.pendingDrawType || null;
        const canPlay = isMyTurn && !gs.mustChooseColor && topCard && UnoEngine.canPlayCard(card, topCard, gs.currentColor, pending, pendingType);
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
        const gs = currentGameState;
        // UNO penalty check: if player has exactly 2 cards and plays one
        // without having pressed UNO, they get auto-penalized
        if (gs && myHand.length === 2) {
            const alreadyCalled = gs.unoCalledBy && gs.unoCalledBy[playerId];
            if (!alreadyCalled && !unoPressedThisTurn) {
                // Play the card first (will go to 1 card)
                await FirebaseSync.playCardAction(roomCode, playerId, cardId);
                // Then auto-challenge self (draws 2 penalty cards)
                try {
                    await FirebaseSync.challengeUnoAction(roomCode, playerId, playerId);
                    showGameToast('Forgot UNO! +2 penalty! 😱', 'error');
                    showActionSplash('+2 PENALTY!', 'draw2');
                } catch (e) {}
                return;
            }
        }

        // Optimistic UI: remove card from hand immediately
        const cardIdx = myHand.findIndex(c => c.id === cardId);
        if (cardIdx !== -1) {
            const playedCard = myHand[cardIdx];
            myHand.splice(cardIdx, 1);
            // Immediately re-render hand for snappy feel
            if (currentRoomData) {
                const playerOrder = gs.playerOrder
                    ? (Array.isArray(gs.playerOrder) ? gs.playerOrder : Object.values(gs.playerOrder))
                    : [];
                renderPlayerHand(currentRoomData, playerOrder);
            }
        }

        await FirebaseSync.playCardAction(roomCode, playerId, cardId);
        unoPressedThisTurn = false; // Reset after playing
    } catch (err) {
        showGameToast('Cannot play that card', 'error');
        // On failure, Firebase update will restore correct state
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

    // Show UNO button when player has exactly 2 cards (must press before playing to go to 1)
    // Also show when they have 1 card and haven't called yet (late call chance)
    if (myHand.length === 2) {
        const alreadyCalled = gs.unoCalledBy && gs.unoCalledBy[playerId];
        if (!alreadyCalled) {
            btn.classList.add('show');
        } else {
            btn.classList.remove('show');
        }
    } else if (myHand.length === 1) {
        const alreadyCalled = gs.unoCalledBy && gs.unoCalledBy[playerId];
        if (!alreadyCalled) {
            btn.classList.add('show');
        } else {
            btn.classList.remove('show');
        }
    } else {
        btn.classList.remove('show');
        unoPressedThisTurn = false; // Reset when hand > 2
    }
}

async function handleUno() {
    try {
        unoPressedThisTurn = true;
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

    // Play sound effects + visual animations
    switch (action.type) {
        case 'play': UnoSounds.playCard(); break;
        case 'skip':
            UnoSounds.skip();
            showActionSplash('SKIP!', 'skip');
            break;
        case 'reverse':
            UnoSounds.reverse();
            showActionSplash('REVERSE!', 'reverse');
            break;
        case 'draw2':
            UnoSounds.draw2();
            showActionSplash('+' + (action.stacked || 2), 'draw2');
            break;
        case 'wild':
            UnoSounds.wild();
            showActionSplash('WILD!', 'wild');
            break;
        case 'wild4':
            UnoSounds.wild();
            showActionSplash('+' + (action.stacked || 4), 'draw4');
            break;
        case 'draw':
            UnoSounds.drawCard();
            // Animate card draw for self
            if (action.player === playerId) {
                animateCardFly(playerId, 1, 'draw');
            }
            break;
        case 'draw-stack':
            UnoSounds.draw2();
            showActionSplash('+' + (action.count || 0), 'draw2');
            animateCardFly(action.player, Math.min(action.count || 0, 8), 'draw2');
            break;
        case 'uno': UnoSounds.uno(); showActionSplash('UNO!', 'uno'); break;
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

    // Win streak tracking
    let streak = parseInt(localStorage.getItem('uno_win_streak') || '0');
    let totalWins = parseInt(localStorage.getItem('uno_total_wins') || '0');
    let totalGames = parseInt(localStorage.getItem('uno_total_games') || '0');
    totalGames++;
    if (winnerId === playerId) {
        streak++;
        totalWins++;
    } else {
        streak = 0;
    }
    localStorage.setItem('uno_win_streak', String(streak));
    localStorage.setItem('uno_total_wins', String(totalWins));
    localStorage.setItem('uno_total_games', String(totalGames));

    const winnerText = winnerId === playerId
        ? `🎉 You win!${streak > 1 ? ' 🔥 ' + streak + '-streak!' : ''}`
        : `🎉 ${winnerName} wins!`;
    document.getElementById('winnerName').textContent = winnerText;

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
        const avIdx = getPlayerAvatar(room, pid);
        const av = GAME_AVATARS[avIdx] || GAME_AVATARS[0];
        tdName.textContent = av.emoji + ' ' + getPlayerName(room, pid);
        if (pid === winnerId) tdName.textContent += ' 🏆';

        const tdScore = document.createElement('td');
        tdScore.className = 'score';
        tdScore.textContent = score + ' pts';

        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        tbody.appendChild(tr);
    });

    // Post-game stats
    let statsRow = document.getElementById('postGameStats');
    if (!statsRow) {
        statsRow = document.createElement('div');
        statsRow.id = 'postGameStats';
        statsRow.className = 'post-game-stats';
        document.querySelector('.game-over-card').insertBefore(statsRow, document.getElementById('btnPlayAgain'));
    }
    const gs = room.gameState;
    const totalTurns = gs.turnNumber || 0;
    const myCards = myHand.length;
    statsRow.innerHTML = `
        <div class="stat-item"><span class="stat-val">${totalTurns}</span><span class="stat-label">Turns</span></div>
        <div class="stat-item"><span class="stat-val">${Object.keys(players).length}</span><span class="stat-label">Players</span></div>
        <div class="stat-item"><span class="stat-val">${myCards}</span><span class="stat-label">Cards Left</span></div>
        <div class="stat-item"><span class="stat-val">${totalWins}/${totalGames}</span><span class="stat-label">Win Rate</span></div>
        ${streak > 1 ? `<div class="stat-item streak"><span class="stat-val">🔥 ${streak}</span><span class="stat-label">Streak</span></div>` : ''}
    `;

    // Show play again for all players
    const btnPlayAgain = document.getElementById('btnPlayAgain');
    btnPlayAgain.style.display = 'block';
    btnPlayAgain.textContent = amHost ? 'Rematch 🔄' : 'Vote Rematch 🔄';

    // Show rematch votes if any
    const voteCount = room.rematchVotes ? Object.keys(room.rematchVotes).length : 0;
    const totalPlayers = room.players ? Object.keys(room.players).length : 0;
    let voteInfo = document.getElementById('rematchVoteInfo');
    if (!voteInfo) {
        voteInfo = document.createElement('p');
        voteInfo.id = 'rematchVoteInfo';
        voteInfo.className = 'rematch-vote-info';
        btnPlayAgain.parentElement.insertBefore(voteInfo, btnPlayAgain.nextSibling);
    }
    if (voteCount > 0) {
        voteInfo.textContent = `${voteCount}/${totalPlayers} voted for rematch`;
        voteInfo.style.display = 'block';
    } else {
        voteInfo.style.display = 'none';
    }

    // Auto-rematch if all players voted (and we're host)
    if (amHost && voteCount >= totalPlayers - 1 && voteCount > 0 && totalPlayers >= 2) {
        gameOverShown = false;
        btnPlayAgain.disabled = true;
        btnPlayAgain.textContent = 'Starting...';
        FirebaseSync.rematch(roomCode, playerId).catch(() => {});
    }
}

async function handlePlayAgain() {
    try {
        const btn = document.getElementById('btnPlayAgain');
        if (amHost) {
            btn.disabled = true;
            btn.textContent = 'Starting...';
            gameOverShown = false;
            await FirebaseSync.rematch(roomCode, playerId);
            document.getElementById('gameOverOverlay').classList.remove('show');
        } else {
            // Non-host: cast a rematch vote
            btn.disabled = true;
            btn.textContent = 'Voted ✓';
            try {
                await FirebaseSync.voteRematch(roomCode, playerId);
                showGameToast('Rematch vote cast! ✓', 'info');
            } catch (e) {
                showGameToast('Vote failed', 'error');
                btn.disabled = false;
                btn.textContent = 'Rematch 🔄';
            }
        }
    } catch (err) {
        showGameToast('Failed: ' + err.message, 'error');
        const btn = document.getElementById('btnPlayAgain');
        btn.disabled = false;
        btn.textContent = 'Rematch 🔄';
    }
}

// ---- Game Over: Player Left ----
function showGameOverPlayerLeft(room) {
    if (gameOverShown) return;
    gameOverShown = true;

    const overlay = document.getElementById('gameOverOverlay');
    overlay.classList.add('show');

    const action = room.gameState.lastAction;
    const leftName = action.playerName || 'A player';

    document.getElementById('winnerName').textContent = `${leftName} left the game`;
    document.getElementById('winnerName').style.color = 'var(--uno-red)';

    const tbody = document.getElementById('scoresBody');
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.textContent = 'Game ended — a player left';
    td.style.textAlign = 'center';
    td.style.color = 'var(--text-secondary)';
    tr.appendChild(td);
    tbody.appendChild(tr);

    const btnPlayAgain = document.getElementById('btnPlayAgain');
    btnPlayAgain.style.display = amHost ? 'block' : 'none';
    btnPlayAgain.textContent = 'Rematch 🔄';
}

function handleBackToLobby() {
    sessionStorage.clear();
    window.location.href = 'index.html';
}

// ---- Host Migration ----
async function migrateHost(code, newHostId) {
    try {
        await FirebaseSync.promoteHost(code, newHostId);
        amHost = true;
        sessionStorage.setItem('uno_host', 'true');
        showGameToast('You are now the host 👑', 'info');
    } catch (e) {
        // Another player may have already promoted themselves
    }
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

// ---- Rules Modal ----
function toggleRules() {
    const overlay = document.getElementById('rulesOverlay');
    overlay.classList.toggle('show');
}

// ---- Reconnection Recovery ----
function setupReconnectionHandler() {
    const connRef = db.ref('.info/connected');
    let wasDisconnected = false;

    connRef.on('value', (snap) => {
        if (snap.val() === true) {
            if (wasDisconnected) {
                showGameToast('Reconnected! 🔗', 'success');
                // Re-register presence
                FirebaseSync.setupPresence(roomCode, playerId);
                // Re-register disconnect handler
                const playerRef = db.ref('rooms/' + roomCode + '/players/' + playerId);
                playerRef.onDisconnect().remove();
            }
            wasDisconnected = false;
        } else {
            wasDisconnected = true;
            showGameToast('Connection lost... reconnecting', 'error');
        }
    });
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
    if (!canSendNow()) return;
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
    if (!canSendNow()) return;
    FirebaseSync.sendReaction(roomCode, playerId, playerName, emoji);
    UnoSounds.emoji();
}

function sendQuickPhrase(phrase) {
    if (!canSendNow()) return;
    FirebaseSync.sendChat(roomCode, playerId, playerName, phrase);
    UnoSounds.chat();
    showGameToast('Sent: ' + phrase, 'info');
}

function sendTargetedTaunt(targetId, targetName) {
    if (!canSendNow()) return;
    const taunts = ['😜', '🤣', '💩', '🫵', '👀', '🤡'];
    const emoji = taunts[Math.floor(Math.random() * taunts.length)];
    FirebaseSync.sendReaction(roomCode, playerId, playerName, emoji + ' → ' + targetName);
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

// ---- Action Splash (SKIP! / REVERSE! / +2 / +4 / UNO!) ----
function showActionSplash(text, cssClass) {
    const container = document.getElementById('actionSplash');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'splash-text' + (cssClass ? ' splash-' + cssClass : '');
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 1200);
}

// ---- Card Fly Animation (+2 / +4 cards flying to victim) ----
function animateCardFly(victimId, cardCount, type) {
    const container = document.getElementById('cardFlyContainer');
    if (!container) return;

    // Source: draw pile position
    const drawPile = document.querySelector('.draw-pile-container');
    if (!drawPile) return;
    const srcRect = drawPile.getBoundingClientRect();

    // Target: opponent slot or own hand
    let targetEl = null;
    const opponentSlots = document.querySelectorAll('.opponent-slot');
    opponentSlots.forEach(slot => {
        if (slot.dataset && slot.dataset.playerId === victimId) {
            targetEl = slot;
        }
    });
    // Fallback: if victim is self, target the hand area
    if (!targetEl && victimId === playerId) {
        targetEl = document.querySelector('.player-hand-area');
    }
    if (!targetEl) return;
    const tgtRect = targetEl.getBoundingClientRect();

    const flyClass = type === 'draw4' ? 'fly-draw4' : 'fly-draw2';

    for (let i = 0; i < cardCount; i++) {
        const card = document.createElement('div');
        card.className = 'fly-card ' + flyClass;

        const back = document.createElement('div');
        back.className = 'fly-card-back';
        card.appendChild(back);

        // Start at draw pile center
        card.style.left = (srcRect.left + srcRect.width / 2 - 20) + 'px';
        card.style.top = (srcRect.top + srcRect.height / 2 - 30) + 'px';

        container.appendChild(card);

        // Animate to target with stagger
        setTimeout(() => {
            const dx = (tgtRect.left + tgtRect.width / 2 - 20) - (srcRect.left + srcRect.width / 2 - 20);
            const dy = (tgtRect.top + tgtRect.height / 2 - 30) - (srcRect.top + srcRect.height / 2 - 30);
            card.style.transform = `translate(${dx}px, ${dy}px) rotate(${15 * (i - 1)}deg)`;
            card.style.opacity = '0';
        }, 100 + i * 150);

        // Remove after animation
        setTimeout(() => { card.remove(); }, 900 + i * 150);
    }
}
