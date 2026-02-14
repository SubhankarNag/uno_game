# 🎴 UNO Online — Play with Friends

A real-time multiplayer UNO card game that runs entirely in the browser. Create a room, share the code, and play with 2-8 friends!

## 🚀 Setup

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (disable Google Analytics if you want)
3. Go to **Project Settings** → **General** → **Your apps** → click **Web** (`</>`)
4. Register your app and copy the config object

### 2. Enable Realtime Database
1. In Firebase Console, go to **Build** → **Realtime Database**
2. Click **Create Database** → choose your region → Start in **test mode**
3. Your database URL will look like: `https://your-project-default-rtdb.firebaseio.com`

### 3. Add Config
Open `js/firebase-config.js` and replace the placeholder values with your Firebase config.

### 4. Deploy to GitHub Pages
1. Push this folder to a GitHub repository
2. Go to **Settings** → **Pages** → **Source**: Deploy from `main` branch
3. Your game is live at `https://<username>.github.io/<repo-name>/`

## 🎮 How to Play
1. Enter your name
2. **Create a Room** or **Join** with a room code
3. Share the room code with friends (2-8 players)
4. Host clicks **Start Game** when everyone's ready
5. Match cards by color, number, or symbol
6. Don't forget to press **UNO** when you have 2 cards!

## 🃏 Card Types
| Card | Effect |
|------|--------|
| Number (0-9) | Match by color or number |
| Skip ⊘ | Next player loses their turn |
| Reverse ⟳ | Reverses play direction |
| Draw Two +2 | Next player draws 2 and is skipped |
| Wild W | Choose the next color |
| Wild +4 | Choose color + next player draws 4 |

## 🛠️ Tech Stack
- Vanilla HTML/CSS/JS (no build tools needed)
- Firebase Realtime Database (free tier)
- GitHub Pages hosting (free)
