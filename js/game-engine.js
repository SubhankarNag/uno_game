// ============================================
// UNO Game Engine — Pure Logic (No Firebase)
// ============================================

const UnoEngine = (() => {

    const COLORS = ['red', 'blue', 'green', 'yellow'];
    const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ACTION_TYPES = ['skip', 'reverse', 'draw2'];

    // ---- Deck Creation ----

    function createDeck() {
        const deck = [];
        let id = 0;

        // Number cards: one 0 per color, two of 1-9 per color
        for (const color of COLORS) {
            // One zero
            deck.push({ id: id++, color, value: 0, type: 'number', label: '0' });
            // Two of each 1-9
            for (let n = 1; n <= 9; n++) {
                deck.push({ id: id++, color, value: n, type: 'number', label: String(n) });
                deck.push({ id: id++, color, value: n, type: 'number', label: String(n) });
            }
        }

        // Action cards: two of each per color
        for (const color of COLORS) {
            for (const action of ACTION_TYPES) {
                const label = action === 'skip' ? '⊘' : action === 'reverse' ? '⟳' : '+2';
                deck.push({ id: id++, color, value: null, type: action, label });
                deck.push({ id: id++, color, value: null, type: action, label });
            }
        }

        // Wild cards: 4
        for (let i = 0; i < 4; i++) {
            deck.push({ id: id++, color: 'wild', value: null, type: 'wild', label: 'W' });
        }

        // Wild Draw Four: 4
        for (let i = 0; i < 4; i++) {
            deck.push({ id: id++, color: 'wild', value: null, type: 'wild4', label: '+4' });
        }

        return deck; // 108 cards total
    }

    // ---- Shuffle (Fisher-Yates) ----

    function shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ---- Deal Cards ----

    function dealCards(deck, playerIds, count = 7) {
        const hands = {};
        const remaining = [...deck];

        for (const pid of playerIds) {
            hands[pid] = remaining.splice(0, count);
        }

        return { hands, drawPile: remaining };
    }

    // ---- Find a valid starting card (must be a number card) ----

    function findStartingCard(drawPile) {
        // Find first number card to start the discard pile
        for (let i = 0; i < drawPile.length; i++) {
            if (drawPile[i].type === 'number') {
                const card = drawPile.splice(i, 1)[0];
                return { startCard: card, drawPile };
            }
        }
        // Fallback: just take the top card
        return { startCard: drawPile.shift(), drawPile };
    }

    // ---- Initialize Game State ----

    function initializeGame(playerIds) {
        // Use 2 decks for 5+ players to prevent card shortage
        let deck;
        if (playerIds.length >= 5) {
            const deck1 = createDeck();
            const deck2 = createDeck();
            // Re-ID second deck to avoid duplicates
            const offset = deck1.length;
            deck2.forEach(card => { card.id = card.id + offset; });
            deck = shuffle([...deck1, ...deck2]);
        } else {
            deck = shuffle(createDeck());
        }
        const { hands, drawPile } = dealCards(deck, playerIds);
        const { startCard, drawPile: updatedPile } = findStartingCard(drawPile);

        return {
            hands,
            drawPile: updatedPile,
            discardPile: [startCard],
            currentPlayerIndex: 0,
            direction: 1, // 1 = clockwise, -1 = counter-clockwise
            currentColor: startCard.color,
            playerOrder: [...playerIds],
            turnNumber: 0,
            winner: null,
            lastAction: null,
            pendingDraw: 0,
            pendingDrawAmount: 0, // accumulated stacked +2/+4 cards
            pendingDrawType: null, // 'draw2' or 'wild4' — what type is being stacked
            mustChooseColor: false,
            unoCalledBy: {},
            playerHasDrawn: false,
        };
    }

    // ---- Card Playability ----

    function canPlayCard(card, topCard, currentColor, pendingDrawAmount, pendingDrawType) {
        // If there's a pending stacked draw, only same type can be stacked
        if (pendingDrawAmount > 0) {
            if (pendingDrawType === 'draw2' && card.type === 'draw2') return true;
            if (pendingDrawType === 'wild4' && card.type === 'wild4') return true;
            return false; // Must draw if you can't stack
        }
        // Wild cards can always be played
        if (card.type === 'wild' || card.type === 'wild4') return true;
        // Match color
        if (card.color === currentColor) return true;
        // Match number
        if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
        // Match action type
        if (card.type !== 'number' && card.type === topCard.type) return true;
        return false;
    }

    function getPlayableCards(hand, topCard, currentColor, pendingDrawAmount, pendingDrawType) {
        return hand.filter(card => canPlayCard(card, topCard, currentColor, pendingDrawAmount, pendingDrawType));
    }

    // ---- Next Player ----

    function getNextPlayerIndex(currentIndex, direction, playerCount) {
        return ((currentIndex + direction) % playerCount + playerCount) % playerCount;
    }

    // ---- Play Card ----

    function playCard(gameState, playerId, cardId) {
        const state = JSON.parse(JSON.stringify(gameState));
        state.playerHasDrawn = false;
        const playerIndex = state.playerOrder.indexOf(playerId);

        // Must be current player's turn
        if (playerIndex !== state.currentPlayerIndex) {
            return { success: false, error: 'Not your turn' };
        }

        // Find card in hand
        const hand = state.hands[playerId];
        const cardIndex = hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) {
            return { success: false, error: 'Card not in hand' };
        }

        const card = hand[cardIndex];
        const topCard = state.discardPile[state.discardPile.length - 1];

        // Validate play (pass stacking context)
        if (!canPlayCard(card, topCard, state.currentColor, state.pendingDrawAmount || 0, state.pendingDrawType || null)) {
            return { success: false, error: 'Cannot play this card' };
        }

        // Remove from hand, add to discard
        hand.splice(cardIndex, 1);
        state.discardPile.push(card);
        state.turnNumber++;

        // Check win
        if (hand.length === 0) {
            state.winner = playerId;
            state.lastAction = { type: 'win', player: playerId, card };
            return { success: true, state, action: 'win' };
        }

        // Reset UNO call status
        if (hand.length !== 1) {
            state.unoCalledBy[playerId] = false;
        }

        // Apply card effects
        const playerCount = state.playerOrder.length;
        let action = 'play';

        switch (card.type) {
            case 'number':
                state.currentColor = card.color;
                state.currentPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
                state.lastAction = { type: 'play', player: playerId, card };
                break;

            case 'skip':
                state.currentColor = card.color;
                // Skip next player
                const skippedIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
                state.currentPlayerIndex = getNextPlayerIndex(skippedIndex, state.direction, playerCount);
                action = 'skip';
                state.lastAction = { type: 'skip', player: playerId, skipped: state.playerOrder[skippedIndex], card };
                break;

            case 'reverse':
                state.currentColor = card.color;
                state.direction *= -1;
                if (playerCount === 2) {
                    // In 2-player, reverse acts as skip — current player goes again
                    const nextIdx = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
                    state.currentPlayerIndex = getNextPlayerIndex(nextIdx, state.direction, playerCount);
                } else {
                    state.currentPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
                }
                action = 'reverse';
                state.lastAction = { type: 'reverse', player: playerId, card };
                break;

            case 'draw2':
                state.currentColor = card.color;
                // Stack: accumulate pending draw, advance to next player to let them stack or draw
                state.pendingDrawAmount = (state.pendingDrawAmount || 0) + 2;
                state.pendingDrawType = 'draw2';
                state.currentPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
                action = 'draw2';
                {
                    const nextVictim = state.playerOrder[state.currentPlayerIndex];
                    state.lastAction = { type: 'draw2', player: playerId, victim: nextVictim, card, stacked: state.pendingDrawAmount };
                }
                break;

            case 'wild':
                // Color will be chosen by the player separately
                state.mustChooseColor = true;
                state.pendingColorPlayer = playerId;
                // Don't advance turn yet — wait for color choice
                action = 'wild';
                state.lastAction = { type: 'wild', player: playerId, card };
                break;

            case 'wild4':
                state.mustChooseColor = true;
                state.pendingColorPlayer = playerId;
                state.pendingWild4 = true;
                // Stack: accumulate pending draw
                state.pendingDrawAmount = (state.pendingDrawAmount || 0) + 4;
                state.pendingDrawType = 'wild4';
                action = 'wild4';
                state.lastAction = { type: 'wild4', player: playerId, card, stacked: state.pendingDrawAmount };
                break;
        }

        return { success: true, state, action };
    }

    // ---- Choose Color (after Wild) ----

    function chooseColor(gameState, playerId, color) {
        const state = JSON.parse(JSON.stringify(gameState));

        if (!state.mustChooseColor || state.pendingColorPlayer !== playerId) {
            return { success: false, error: 'Not waiting for your color choice' };
        }

        state.currentColor = color;
        state.mustChooseColor = false;
        state.playerHasDrawn = false;
        delete state.pendingColorPlayer;

        const playerCount = state.playerOrder.length;

        if (state.pendingWild4) {
            // With stacking: advance to next player, they can stack another +4 or draw
            const victimIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
            const victimId = state.playerOrder[victimIndex];
            state.currentPlayerIndex = victimIndex;
            delete state.pendingWild4;
            state.lastAction = { ...state.lastAction, chosenColor: color, victim: victimId, stacked: state.pendingDrawAmount || 4 };
        } else {
            // Regular wild — just advance turn
            state.currentPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.direction, playerCount);
            state.lastAction = { ...state.lastAction, chosenColor: color };
        }

        return { success: true, state };
    }

    // ---- Draw Card ----

    function drawCard(gameState, playerId) {
        const state = JSON.parse(JSON.stringify(gameState));
        const playerIndex = state.playerOrder.indexOf(playerId);

        if (playerIndex !== state.currentPlayerIndex) {
            return { success: false, error: 'Not your turn' };
        }

        if (state.mustChooseColor) {
            return { success: false, error: 'Must choose a color first' };
        }

        if (state.playerHasDrawn) {
            return { success: false, error: 'Already drew a card this turn' };
        }

        // If there are stacked pending draws (+2/+4), draw all of them and skip turn
        const pending = state.pendingDrawAmount || 0;
        if (pending > 0) {
            for (let i = 0; i < pending; i++) {
                if (state.drawPile.length === 0) reshuffleDiscardPile(state);
                if (state.drawPile.length > 0) {
                    state.hands[playerId].push(state.drawPile.pop());
                }
            }
            state.pendingDrawAmount = 0;
            state.pendingDrawType = null;
            state.currentPlayerIndex = getNextPlayerIndex(
                state.currentPlayerIndex, state.direction, state.playerOrder.length
            );
            state.playerHasDrawn = false;
            state.turnNumber++;
            state.lastAction = { type: 'draw-stack', player: playerId, count: pending };
            return { success: true, state, drawnCard: null, canPlay: false };
        }

        if (state.drawPile.length === 0) reshuffleDiscardPile(state);

        if (state.drawPile.length === 0) {
            // Truly no cards left — auto-skip turn so game doesn't deadlock
            state.currentPlayerIndex = getNextPlayerIndex(
                state.currentPlayerIndex, state.direction, state.playerOrder.length
            );
            state.playerHasDrawn = false;
            state.lastAction = { type: 'pass', player: playerId };
            state.turnNumber++;
            return { success: true, state, drawnCard: null, canPlay: false };
        }

        const drawnCard = state.drawPile.pop();
        state.hands[playerId].push(drawnCard);
        state.playerHasDrawn = true;
        state.turnNumber++;

        // Check if drawn card can be played
        const topCard = state.discardPile[state.discardPile.length - 1];
        const canPlay = canPlayCard(drawnCard, topCard, state.currentColor, 0, null);

        if (!canPlay) {
            // Advance turn
            state.currentPlayerIndex = getNextPlayerIndex(
                state.currentPlayerIndex, state.direction, state.playerOrder.length
            );
            state.playerHasDrawn = false;
        }
        // If can play, player keeps their turn to optionally play the drawn card

        state.lastAction = { type: 'draw', player: playerId, drawnCard, canPlay };

        return { success: true, state, drawnCard, canPlay };
    }

    // ---- Pass Turn (after drawing a playable card but choosing not to play it) ----

    function passTurn(gameState, playerId) {
        const state = JSON.parse(JSON.stringify(gameState));
        const playerIndex = state.playerOrder.indexOf(playerId);

        if (playerIndex !== state.currentPlayerIndex) {
            return { success: false, error: 'Not your turn' };
        }

        if (!state.playerHasDrawn) {
            return { success: false, error: 'You must draw before passing' };
        }

        state.currentPlayerIndex = getNextPlayerIndex(
            state.currentPlayerIndex, state.direction, state.playerOrder.length
        );
        state.playerHasDrawn = false;
        state.lastAction = { type: 'pass', player: playerId };

        return { success: true, state };
    }

    // ---- Reshuffle discard pile into draw pile ----

    function reshuffleDiscardPile(state) {
        if (state.discardPile.length <= 1) return;
        const topCard = state.discardPile.pop();
        state.drawPile = shuffle(state.discardPile);
        state.discardPile = [topCard];
    }

    // ---- UNO Call ----

    function callUno(gameState, playerId) {
        const state = JSON.parse(JSON.stringify(gameState));
        if (state.hands[playerId] && state.hands[playerId].length <= 2) {
            state.unoCalledBy[playerId] = true;
            state.lastAction = { type: 'uno', player: playerId };
            return { success: true, state };
        }
        return { success: false, error: 'You have more than 2 cards' };
    }

    function challengeUno(gameState, challengerId, targetId) {
        const state = JSON.parse(JSON.stringify(gameState));
        const targetHand = state.hands[targetId];

        if (!targetHand || targetHand.length !== 1) {
            return { success: false, error: 'Cannot challenge — target does not have exactly 1 card' };
        }

        if (state.unoCalledBy[targetId]) {
            // They called UNO, challenge fails — challenger draws 2
            for (let i = 0; i < 2; i++) {
                if (state.drawPile.length === 0) reshuffleDiscardPile(state);
                if (state.drawPile.length > 0) {
                    state.hands[challengerId].push(state.drawPile.pop());
                }
            }
            state.lastAction = { type: 'challenge-fail', challenger: challengerId, target: targetId };
            return { success: true, state, result: 'fail' };
        } else {
            // They didn't call UNO — target draws 2
            for (let i = 0; i < 2; i++) {
                if (state.drawPile.length === 0) reshuffleDiscardPile(state);
                if (state.drawPile.length > 0) {
                    state.hands[targetId].push(state.drawPile.pop());
                }
            }
            state.lastAction = { type: 'challenge-success', challenger: challengerId, target: targetId };
            return { success: true, state, result: 'success' };
        }
    }

    // ---- Scoring ----

    function calculateScores(hands) {
        const scores = {};
        for (const [pid, hand] of Object.entries(hands)) {
            let total = 0;
            for (const card of hand) {
                if (card.type === 'number') total += card.value;
                else if (card.type === 'skip' || card.type === 'reverse' || card.type === 'draw2') total += 20;
                else if (card.type === 'wild' || card.type === 'wild4') total += 50;
            }
            scores[pid] = total;
        }
        return scores;
    }

    // ---- Public API ----

    return {
        COLORS,
        createDeck,
        shuffle,
        initializeGame,
        canPlayCard,
        getPlayableCards,
        playCard,
        chooseColor,
        drawCard,
        passTurn,
        callUno,
        challengeUno,
        calculateScores,
        getNextPlayerIndex,
    };

})();

// Export for Node.js testing (optional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnoEngine;
}
