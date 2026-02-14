// ============================================
// Firebase Sync — Room & Game State Management
// ============================================

const FirebaseSync = (() => {

    // ---- Generate Room Code ----
    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // ---- Generate Player ID ----
    function generatePlayerId() {
        return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    }

    // ---- Create Room ----
    async function createRoom(hostName) {
        const code = generateRoomCode();
        const playerId = generatePlayerId();
        const roomRef = db.ref('rooms/' + code);

        // Check if code already exists
        const snapshot = await roomRef.once('value');
        if (snapshot.exists()) {
            // Extremely unlikely collision — try once more
            return createRoom(hostName);
        }

        const roomData = {
            host: playerId,
            status: 'waiting',
            maxPlayers: 8,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            players: {
                [playerId]: {
                    name: hostName,
                    cardCount: 0,
                    isReady: true,
                    hasCalledUno: false,
                    joinedAt: firebase.database.ServerValue.TIMESTAMP
                }
            }
        };

        await roomRef.set(roomData);

        // Set up disconnect cleanup
        setupDisconnectHandler(code, playerId);

        return { code, playerId };
    }

    // ---- Join Room ----
    async function joinRoom(code, playerName) {
        const roomRef = db.ref('rooms/' + code);
        const snapshot = await roomRef.once('value');

        if (!snapshot.exists()) {
            throw new Error('Room not found');
        }

        const room = snapshot.val();

        if (room.status !== 'waiting') {
            throw new Error('Game already in progress');
        }

        const playerCount = room.players ? Object.keys(room.players).length : 0;
        if (playerCount >= room.maxPlayers) {
            throw new Error('Room is full');
        }

        const playerId = generatePlayerId();
        await roomRef.child('players/' + playerId).set({
            name: playerName,
            cardCount: 0,
            isReady: true,
            hasCalledUno: false,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });

        setupDisconnectHandler(code, playerId);

        return { code, playerId };
    }

    // ---- Disconnect Handler ----
    function setupDisconnectHandler(code, playerId) {
        const playerRef = db.ref('rooms/' + code + '/players/' + playerId);
        playerRef.onDisconnect().remove();
    }

    // ---- Start Game ----
    async function startGame(code, playerId) {
        const roomRef = db.ref('rooms/' + code);
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();

        if (room.host !== playerId) {
            throw new Error('Only the host can start the game');
        }

        const playerIds = Object.keys(room.players);
        if (playerIds.length < 2) {
            throw new Error('Need at least 2 players');
        }

        const gameState = UnoEngine.initializeGame(playerIds);

        // Build the data to write
        const updates = {};
        updates['status'] = 'playing';
        updates['gameState'] = {
            currentPlayerIndex: gameState.currentPlayerIndex,
            direction: gameState.direction,
            currentColor: gameState.currentColor,
            turnNumber: gameState.turnNumber,
            winner: null,
            lastAction: null,
            mustChooseColor: false,
            playerOrder: gameState.playerOrder,
            unoCalledBy: gameState.unoCalledBy || {},
            playerHasDrawn: false,
            playerNames: {},
            turnStartedAt: firebase.database.ServerValue.TIMESTAMP,
        };

        // Store player names in gameState so they survive disconnects
        for (const pid of playerIds) {
            updates['gameState']['playerNames'][pid] = room.players[pid].name;
        }

        // Store hands
        updates['hands'] = {};
        for (const [pid, hand] of Object.entries(gameState.hands)) {
            updates['hands'][pid] = hand;
        }

        // Store piles
        updates['drawPile'] = gameState.drawPile;
        updates['discardPile'] = gameState.discardPile;

        // Update player card counts
        for (const pid of playerIds) {
            updates['players/' + pid + '/cardCount'] = gameState.hands[pid].length;
        }

        await roomRef.update(updates);
    }

    // ---- Play Card ----
    async function playCardAction(code, playerId, cardId) {
        const roomRef = db.ref('rooms/' + code);

        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            // Reconstruct game state
            const gameState = reconstructGameState(room);
            const result = UnoEngine.playCard(gameState, playerId, cardId);

            if (!result.success) return; // Abort transaction

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Choose Color ----
    async function chooseColorAction(code, playerId, color) {
        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            const gameState = reconstructGameState(room);
            const result = UnoEngine.chooseColor(gameState, playerId, color);

            if (!result.success) return;

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Draw Card ----
    async function drawCardAction(code, playerId) {
        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            const gameState = reconstructGameState(room);
            const result = UnoEngine.drawCard(gameState, playerId);

            if (!result.success) return;

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Pass Turn ----
    async function passTurnAction(code, playerId) {
        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            const gameState = reconstructGameState(room);
            const result = UnoEngine.passTurn(gameState, playerId);

            if (!result.success) return;

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Call UNO ----
    async function callUnoAction(code, playerId) {
        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            const gameState = reconstructGameState(room);
            const result = UnoEngine.callUno(gameState, playerId);

            if (!result.success) return;

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Challenge UNO ----
    async function challengeUnoAction(code, challengerId, targetId) {
        return db.ref('rooms/' + code).transaction((room) => {
            if (!room || room.status !== 'playing') return room;

            const gameState = reconstructGameState(room);
            const result = UnoEngine.challengeUno(gameState, challengerId, targetId);

            if (!result.success) return;

            applyGameState(room, result.state);
            return room;
        });
    }

    // ---- Play Again (reset game) ----
    async function playAgain(code, playerId) {
        const roomRef = db.ref('rooms/' + code);
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();

        if (room.host !== playerId) {
            throw new Error('Only the host can restart');
        }

        // Reset to waiting
        const updates = {
            status: 'waiting',
            gameState: null,
            hands: null,
            drawPile: null,
            discardPile: null,
        };

        // Reset player card counts
        if (room.players) {
            for (const pid of Object.keys(room.players)) {
                updates['players/' + pid + '/cardCount'] = 0;
                updates['players/' + pid + '/hasCalledUno'] = false;
            }
        }

        await roomRef.update(updates);
    }

    // ---- Leave Room ----
    async function leaveRoom(code, playerId) {
        const playerRef = db.ref('rooms/' + code + '/players/' + playerId);
        await playerRef.remove();

        // Check if room is empty and delete
        const roomRef = db.ref('rooms/' + code);
        const snap = await roomRef.child('players').once('value');
        if (!snap.exists() || !snap.val()) {
            await roomRef.remove();
        }
    }

    // ---- Listeners ----
    function listenToRoom(code, callbacks) {
        const roomRef = db.ref('rooms/' + code);

        roomRef.on('value', (snapshot) => {
            const room = snapshot.val();
            if (!room) {
                if (callbacks.onRoomDeleted) callbacks.onRoomDeleted();
                return;
            }
            if (callbacks.onRoomUpdate) callbacks.onRoomUpdate(room);
        });

        return () => roomRef.off();
    }

    function listenToHand(code, playerId, callback) {
        const handRef = db.ref('rooms/' + code + '/hands/' + playerId);

        handRef.on('value', (snapshot) => {
            const hand = snapshot.val();
            callback(hand ? Object.values(hand) : []);
        });

        return () => handRef.off();
    }

    // ---- Helpers ----
    function reconstructGameState(room) {
        return {
            hands: room.hands || {},
            drawPile: room.drawPile ? (Array.isArray(room.drawPile) ? room.drawPile : Object.values(room.drawPile)) : [],
            discardPile: room.discardPile ? (Array.isArray(room.discardPile) ? room.discardPile : Object.values(room.discardPile)) : [],
            currentPlayerIndex: room.gameState.currentPlayerIndex,
            direction: room.gameState.direction,
            currentColor: room.gameState.currentColor,
            playerOrder: room.gameState.playerOrder ? (Array.isArray(room.gameState.playerOrder) ? room.gameState.playerOrder : Object.values(room.gameState.playerOrder)) : [],
            turnNumber: room.gameState.turnNumber,
            winner: room.gameState.winner,
            lastAction: room.gameState.lastAction,
            mustChooseColor: room.gameState.mustChooseColor || false,
            pendingColorPlayer: room.gameState.pendingColorPlayer || null,
            pendingWild4: room.gameState.pendingWild4 || false,
            unoCalledBy: room.gameState.unoCalledBy || {},
            playerHasDrawn: room.gameState.playerHasDrawn || false,
            turnStartedAt: room.gameState.turnStartedAt || Date.now(),
        };
    }

    function applyGameState(room, state) {
        const prevPlayerIndex = room.gameState.currentPlayerIndex;
        room.gameState.currentPlayerIndex = state.currentPlayerIndex;
        room.gameState.direction = state.direction;
        room.gameState.currentColor = state.currentColor;
        room.gameState.turnNumber = state.turnNumber;
        room.gameState.winner = state.winner || null;
        room.gameState.lastAction = state.lastAction || null;
        room.gameState.mustChooseColor = state.mustChooseColor || false;
        room.gameState.pendingColorPlayer = state.pendingColorPlayer || null;
        room.gameState.pendingWild4 = state.pendingWild4 || false;
        room.gameState.unoCalledBy = state.unoCalledBy || {};
        room.gameState.playerHasDrawn = state.playerHasDrawn || false;
        if (prevPlayerIndex !== state.currentPlayerIndex) {
            room.gameState.turnStartedAt = Date.now();
        }
        room.hands = state.hands;
        room.drawPile = state.drawPile;
        room.discardPile = state.discardPile;

        // Update card counts
        if (room.players) {
            for (const pid of Object.keys(room.players)) {
                if (state.hands[pid]) {
                    room.players[pid].cardCount = Array.isArray(state.hands[pid])
                        ? state.hands[pid].length
                        : Object.keys(state.hands[pid]).length;
                }
            }
        }
    }

    // ---- Chat ----
    function sendChat(code, senderId, senderName, text) {
        db.ref('rooms/' + code + '/chat').push({
            senderId,
            name: senderName,
            text: text.substring(0, 100),
            ts: firebase.database.ServerValue.TIMESTAMP
        });
    }

    function listenToChat(code, callback) {
        const ref = db.ref('rooms/' + code + '/chat');
        ref.orderByChild('ts').limitToLast(30).on('child_added', (snap) => {
            const msg = snap.val();
            if (msg) callback(msg);
        });
        return () => ref.off();
    }

    // ---- Reactions ----
    function sendReaction(code, senderId, senderName, emoji) {
        db.ref('rooms/' + code + '/reactions').push({
            senderId,
            name: senderName,
            emoji,
            ts: firebase.database.ServerValue.TIMESTAMP
        });
    }

    function listenToReactions(code, callback) {
        const ref = db.ref('rooms/' + code + '/reactions');
        const startTime = Date.now();
        ref.orderByChild('ts').startAt(startTime).on('child_added', (snap) => {
            const data = snap.val();
            if (data) callback(data);
            setTimeout(() => snap.ref.remove(), 5000);
        });
        return () => ref.off();
    }

    // ---- Presence ----
    function setupPresence(code, pid) {
        const connRef = db.ref('.info/connected');
        const presRef = db.ref('rooms/' + code + '/presence/' + pid);
        connRef.on('value', (snap) => {
            if (snap.val() === true) {
                presRef.set(true);
                presRef.onDisconnect().remove();
            }
        });
    }

    // ---- Stale Room Cleanup ----
    async function cleanupStaleRooms() {
        try {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const snap = await db.ref('rooms').orderByChild('createdAt').endAt(cutoff).limitToFirst(5).once('value');
            if (snap.val()) {
                const updates = {};
                Object.keys(snap.val()).forEach(c => { updates['rooms/' + c] = null; });
                await db.ref().update(updates);
            }
        } catch (e) {}
    }

    // ---- Public API ----
    return {
        createRoom,
        joinRoom,
        startGame,
        playCardAction,
        chooseColorAction,
        drawCardAction,
        passTurnAction,
        callUnoAction,
        challengeUnoAction,
        playAgain,
        leaveRoom,
        listenToRoom,
        listenToHand,
        generatePlayerId,
        sendChat,
        listenToChat,
        sendReaction,
        listenToReactions,
        setupPresence,
        cleanupStaleRooms,
    };

})();
