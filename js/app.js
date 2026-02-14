// ============================================
// Landing Page & Lobby Logic
// ============================================

// Session state
let currentRoom = null;
let currentPlayerId = null;
let currentPlayerName = null;
let isHost = false;
let roomListener = null;

// ---- Avatar Colors ----
const AVATAR_COLORS = [
    '#ED1C24', '#0072BC', '#00A651', '#FFD700',
    '#9B59B6', '#E67E22', '#1ABC9C', '#E91E63'
];

// ---- Toast ----
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---- Create Room ----
async function handleCreate() {
    const name = document.getElementById('createName').value.trim();
    if (!name) {
        showToast('Please enter your name', 'error');
        return;
    }
    if (name.length < 1 || name.length > 15) {
        showToast('Name must be 1-15 characters', 'error');
        return;
    }

    const btn = document.getElementById('btnCreate');
    btn.disabled = true;
    btn.innerHTML = 'Creating... <span class="spinner"></span>';

    try {
        const { code, playerId } = await FirebaseSync.createRoom(name);
        currentRoom = code;
        currentPlayerId = playerId;
        currentPlayerName = name;
        isHost = true;

        // Save to session
        sessionStorage.setItem('uno_room', code);
        sessionStorage.setItem('uno_player', playerId);
        sessionStorage.setItem('uno_name', name);
        sessionStorage.setItem('uno_host', 'true');

        showLobby(code);
        showToast('Room created!', 'success');
    } catch (err) {
        showToast('Failed to create room: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Room';
    }
}

// ---- Join Room ----
async function handleJoin() {
    const name = document.getElementById('joinName').value.trim();
    const code = document.getElementById('joinCode').value.trim().toUpperCase();

    if (!name) {
        showToast('Please enter your name', 'error');
        return;
    }
    if (!code || code.length !== 6) {
        showToast('Enter a valid 6-character room code', 'error');
        return;
    }

    const btn = document.getElementById('btnJoin');
    btn.disabled = true;
    btn.innerHTML = 'Joining... <span class="spinner"></span>';

    try {
        const { playerId } = await FirebaseSync.joinRoom(code, name);
        currentRoom = code;
        currentPlayerId = playerId;
        currentPlayerName = name;
        isHost = false;

        sessionStorage.setItem('uno_room', code);
        sessionStorage.setItem('uno_player', playerId);
        sessionStorage.setItem('uno_name', name);
        sessionStorage.setItem('uno_host', 'false');

        showLobby(code);
        showToast('Joined room!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Join Room';
    }
}

// ---- Show Lobby ----
function showLobby(code) {
    document.getElementById('landingPage').classList.add('hidden');
    document.getElementById('lobbyPage').classList.add('active');
    document.getElementById('lobbyRoomCode').childNodes[0].textContent = code;

    // Listen for room changes
    roomListener = FirebaseSync.listenToRoom(code, {
        onRoomUpdate: (room) => {
            updateLobbyUI(room);

            // If game started, redirect to game page
            if (room.status === 'playing') {
                window.location.href = 'game.html';
            }
        },
        onRoomDeleted: () => {
            showToast('Room was deleted', 'error');
            backToLanding();
        }
    });
}

// ---- Update Lobby UI ----
function updateLobbyUI(room) {
    const players = room.players || {};
    const playerIds = Object.keys(players);
    const count = playerIds.length;

    document.getElementById('playerCount').textContent = `${count} / ${room.maxPlayers} players`;

    const list = document.getElementById('playerList');
    list.innerHTML = '';

    playerIds.forEach((pid, index) => {
        const player = players[pid];
        const li = document.createElement('li');

        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name';

        const avatar = document.createElement('div');
        avatar.className = 'player-avatar';
        avatar.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
        avatar.textContent = player.name.charAt(0).toUpperCase();

        const nameSpan = document.createElement('span');
        nameSpan.textContent = player.name;

        nameDiv.appendChild(avatar);
        nameDiv.appendChild(nameSpan);
        li.appendChild(nameDiv);

        if (pid === room.host) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            badge.textContent = '👑 Host';
            li.appendChild(badge);
        }

        if (pid === currentPlayerId) {
            li.style.borderColor = 'rgba(255, 215, 0, 0.3)';
            li.style.background = 'rgba(255, 215, 0, 0.05)';
        }

        list.appendChild(li);
    });

    // Show/hide start button
    const btnStart = document.getElementById('btnStart');
    const waitingMsg = document.getElementById('waitingMsg');

    if (isHost) {
        btnStart.style.display = 'block';
        btnStart.disabled = count < 2;
        waitingMsg.style.display = 'none';

        if (count < 2) {
            btnStart.textContent = 'Need at least 2 players';
        } else {
            btnStart.textContent = `Start Game (${count} players)`;
        }
    } else {
        btnStart.style.display = 'none';
        waitingMsg.style.display = 'block';
    }
}

// ---- Start Game ----
async function handleStart() {
    const btn = document.getElementById('btnStart');
    btn.disabled = true;
    btn.innerHTML = 'Starting... <span class="spinner"></span>';

    try {
        await FirebaseSync.startGame(currentRoom, currentPlayerId);
    } catch (err) {
        showToast('Failed to start: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Start Game';
    }
}

// ---- Copy Room Code ----
function copyRoomCode() {
    const code = currentRoom;
    if (code) {
        navigator.clipboard.writeText(code).then(() => {
            showToast('Room code copied!', 'success');
        }).catch(() => {
            showToast('Code: ' + code, 'info');
        });
    }
}

// ---- Go Back ----
function backToLanding() {
    if (roomListener) roomListener();
    document.getElementById('lobbyPage').classList.remove('active');
    document.getElementById('landingPage').classList.remove('hidden');
    sessionStorage.clear();
    currentRoom = null;
    currentPlayerId = null;
    isHost = false;
}

// ---- Enter key support ----
document.addEventListener('DOMContentLoaded', () => {
    // Auto-fill join code from URL
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
        document.getElementById('joinCode').value = joinCode.toUpperCase();
        document.getElementById('joinName').focus();
    }

    // Cleanup stale rooms
    FirebaseSync.cleanupStaleRooms();

    document.getElementById('createName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleCreate();
    });

    document.getElementById('joinCode').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleJoin();
    });

    // Auto uppercase room code
    document.getElementById('joinCode').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
});
