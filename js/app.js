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

// ---- Avatars ----
const AVATARS = [
    { emoji: '🦊', color: '#E67E22', name: 'Fox' },
    { emoji: '🐺', color: '#607D8B', name: 'Wolf' },
    { emoji: '🦁', color: '#FFD700', name: 'Lion' },
    { emoji: '🐸', color: '#00A651', name: 'Frog' },
    { emoji: '🦉', color: '#795548', name: 'Owl' },
    { emoji: '🐙', color: '#9B59B6', name: 'Octopus' },
    { emoji: '🦄', color: '#E91E63', name: 'Unicorn' },
    { emoji: '🐲', color: '#0072BC', name: 'Dragon' },
];

let selectedCreateAvatar = 0;
let selectedJoinAvatar = 0;

// ---- Persistent Name & Avatar (localStorage) ----
function loadSavedProfile() {
    const savedName = localStorage.getItem('uno_saved_name');
    const savedAvatar = localStorage.getItem('uno_saved_avatar');
    if (savedName) {
        const createInput = document.getElementById('createName');
        const joinInput = document.getElementById('joinName');
        if (createInput) createInput.value = savedName;
        if (joinInput) joinInput.value = savedName;
    }
    if (savedAvatar != null) {
        const idx = parseInt(savedAvatar) || 0;
        selectedCreateAvatar = idx;
        selectedJoinAvatar = idx;
    }
}

function saveProfile(name, avatarIdx) {
    localStorage.setItem('uno_saved_name', name);
    localStorage.setItem('uno_saved_avatar', String(avatarIdx));
}

function populateAvatarPicker(containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const savedIdx = (type === 'create') ? selectedCreateAvatar : selectedJoinAvatar;
    AVATARS.forEach((av, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'avatar-option' + (i === savedIdx ? ' selected' : '');
        btn.style.background = av.color;
        btn.textContent = av.emoji;
        btn.title = av.name;
        btn.onclick = () => {
            container.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (type === 'create') selectedCreateAvatar = i;
            else selectedJoinAvatar = i;
        };
        container.appendChild(btn);
    });
}

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
        const { code, playerId } = await FirebaseSync.createRoom(name, selectedCreateAvatar);
        currentRoom = code;
        currentPlayerId = playerId;
        currentPlayerName = name;
        isHost = true;

        // Save to session
        sessionStorage.setItem('uno_room', code);
        sessionStorage.setItem('uno_player', playerId);
        sessionStorage.setItem('uno_name', name);
        sessionStorage.setItem('uno_host', 'true');
        sessionStorage.setItem('uno_avatar', String(selectedCreateAvatar));

        saveProfile(name, selectedCreateAvatar);
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
        const { playerId } = await FirebaseSync.joinRoom(code, name, selectedJoinAvatar);
        currentRoom = code;
        currentPlayerId = playerId;
        currentPlayerName = name;
        isHost = false;

        sessionStorage.setItem('uno_room', code);
        sessionStorage.setItem('uno_player', playerId);
        sessionStorage.setItem('uno_name', name);
        sessionStorage.setItem('uno_host', 'false');
        sessionStorage.setItem('uno_avatar', String(selectedJoinAvatar));

        saveProfile(name, selectedJoinAvatar);
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

    // Host migration in lobby: if host left, first player promotes
    if (room.host && !players[room.host] && count > 0) {
        if (playerIds[0] === currentPlayerId) {
            FirebaseSync.promoteHost(currentRoom, currentPlayerId).then(() => {
                isHost = true;
                sessionStorage.setItem('uno_host', 'true');
                showToast('You are now the host 👑', 'info');
            }).catch(() => {});
        }
    }

    // Update local host status if room.host changed to us
    if (room.host === currentPlayerId && !isHost) {
        isHost = true;
        sessionStorage.setItem('uno_host', 'true');
    }

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
        const avIdx = (player.avatar != null) ? player.avatar : (index % AVATARS.length);
        const av = AVATARS[avIdx] || AVATARS[0];
        avatar.style.background = av.color;
        avatar.textContent = av.emoji;

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

// ---- Share Invite Link ----
function shareLobbyLink() {
    const code = currentRoom;
    if (!code) return;
    const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'index.html?join=' + code;
    if (navigator.share) {
        navigator.share({
            title: 'Join my UNO game!',
            text: 'Come play UNO with me! Room code: ' + code,
            url: url
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showToast('Invite link copied!', 'success');
        }).catch(() => {
            showToast(url, 'info');
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
    // Load saved name & avatar from localStorage
    loadSavedProfile();

    // Populate avatar pickers
    populateAvatarPicker('createAvatarPicker', 'create');
    populateAvatarPicker('joinAvatarPicker', 'join');

    // Auto-fill join code from URL
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
        document.getElementById('joinCode').value = joinCode.toUpperCase();
        document.getElementById('joinName').focus();
        // Scroll join panel into view
        const joinPanel = document.querySelector('.panel.join');
        if (joinPanel) joinPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
