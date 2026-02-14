// ============================================
// Firebase Configuration for UNO Online
// ============================================
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use existing)
// 3. Go to Project Settings → General → Your apps → Web app
// 4. Copy your config object and paste below
// 5. Enable Realtime Database in the Firebase console
// 6. Set database rules to allow read/write (for development):
//    { "rules": { ".read": true, ".write": true } }
// ============================================

const firebaseConfig = {
    apiKey: "AIzaSyCqbvILhoMe-fQjs-1TVss0OxrfyQToGaQ",
    authDomain: "uno-agy.firebaseapp.com",
    databaseURL: "https://uno-agy-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "uno-agy",
    storageBucket: "uno-agy.firebasestorage.app",
    messagingSenderId: "554249087937",
    appId: "1:554249087937:web:e52edd5acece38d96e1d40"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
