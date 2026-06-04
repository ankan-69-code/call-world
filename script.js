// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAv4YOIRpkgDZCJznrmCBF0YQhQJtCAY88",
  authDomain: "call-world-bdbe6.firebaseapp.com",
  projectId: "call-world-bdbe6",
  storageBucket: "call-world-bdbe6.firebasestorage.app",
  messagingSenderId: "417335991997",
  appId: "1:417335991997:web:81983e3cad0b69484721d4",
  measurementId: "G-YTXB18QFJ6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- DOM Elements ---
const views = {
    auth: document.getElementById('auth-view'),
    dashboard: document.getElementById('dashboard-view'),
    meeting: document.getElementById('meeting-view')
};
const inputs = {
    link: document.getElementById('meeting-link')
};
const linkContainer = document.getElementById('link-container');
const joinNowBtn = document.getElementById('join-now-btn');
const videoGrid = document.getElementById('video-grid');

let currentRoom = "";
const myUserId = Math.random().toString(36).substring(2, 12); 
const peerConnections = {}; 
let localStream = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

const mediaConstraints = {
    audio: { echoCancellation: true, noiseSuppression: true },
    video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }
};

// ==========================================
//   AUTHENTICATION & ROUTING (NATIVE)
// ==========================================

// Firebase automatically checks if the user is already logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        // 1. User is logged in -> Check if they clicked a meeting link
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');

        if (roomParam) {
            currentRoom = roomParam;
            showView(views.meeting);
            startGroupCall();
        } else {
            showView(views.dashboard);
        }
    } else {
        // 2. User is logged out -> Show Login Screen
        showView(views.auth);
    }
});

// Manual Login Trigger
document.getElementById('google-signin-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((err) => {
        console.error("Auth Error:", err);
        alert("Sign-In failed. Make sure you enabled Google Auth in Firebase Console.");
    });
});

// Logout Logic
document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth).then(() => {
        // Reset URL and refresh to show login screen
        window.location.href = window.location.origin + window.location.pathname;
    });
});

// ==========================================
//   UI & MEETING LOGIC
// ==========================================

function showView(activeView) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    activeView.classList.remove('hidden');
}

document.getElementById('generate-link-btn').addEventListener('click', () => {
    currentRoom = `room-${Math.random().toString(36).substring(2, 11)}`;
    inputs.link.value = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
    linkContainer.classList.remove('hidden');
    joinNowBtn.classList.remove('hidden');
});

document.getElementById('copy-btn').addEventListener('click', () => {
    inputs.link.select();
    navigator.clipboard.writeText(inputs.link.value);
    alert("Meeting link copied!");
});

joinNowBtn.addEventListener('click', () => {
    showView(views.meeting);
    startGroupCall();
});

function updateLayout() {
    const localVideo = document.getElementById('local-video');
    if (!localVideo) return;
    const remoteVideoCount = videoGrid.querySelectorAll('video').length;
    localVideo.classList.toggle('pip', remoteVideoCount > 0);
}

async function startGroupCall() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Hardware/Browser mismatch for video.");
        }

        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        const localVideo = document.createElement('video');
        localVideo.id = 'local-video';
        localVideo.srcObject = localStream;
        localVideo.autoplay = true;
        localVideo.muted = true;
        localVideo.playsInline = true;
        document.querySelector('.video-container').appendChild(localVideo);
        updateLayout();

        const roomRef = doc(db, 'rooms', currentRoom);
        
        // Listen for signals
        onSnapshot(collection(roomRef, `inbox_${myUserId}`), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') processIncomingSignal(change.doc.data());
            });
        });

        // Call existing participants
        const existingUsers = await getDocs(collection(roomRef, 'participants'));
        existingUsers.forEach(userDoc => {
            if (userDoc.id !== myUserId) initiateCallToUser(userDoc.id);
        });

        // Add self to participants
        await setDoc(doc(collection(roomRef, 'participants'), myUserId), { joinedAt: Date.now() });

    } catch (error) {
        console.error("Camera error:", error);
        alert("Camera access denied.");
    }
}

function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[targetUserId] = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = e => {
        if (e.candidate) sendSignal(targetUserId, { type: 'candidate', candidate: e.candidate.toJSON(), sender: myUserId });
    };

    pc.ontrack = e => {
        if (!document.getElementById(`video-${targetUserId}`)) {
            const remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${targetUserId}`;
            remoteVideo.srcObject = e.streams[0];
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            videoGrid.appendChild(remoteVideo);
            updateLayout();
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
            document.getElementById(`video-${targetUserId}`)?.remove();
            delete peerConnections[targetUserId];
            updateLayout();
        }
    };
    return pc;
}

async function initiateCallToUser(targetUserId) {
    const pc = createPeerConnection(targetUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetUserId, { type: 'offer', sdp: offer.sdp, sender: myUserId });
}

async function processIncomingSignal(data) {
    const { sender, type, sdp, candidate } = data;
    if (type === 'bye') {
        document.getElementById(`video-${sender}`)?.remove();
        peerConnections[sender]?.close();
        delete peerConnections[sender];
        updateLayout();
        return;
    }
    const pc = peerConnections[sender] || createPeerConnection(sender);
    if (type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(sender, { type: 'answer', sdp: answer.sdp, sender: myUserId });
    } else if (type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
    } else if (type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

async function sendSignal(targetUserId, message) {
    await addDoc(collection(db, 'rooms', currentRoom, `inbox_${targetUserId}`), message);
}

// --- Video Controls ---
document.getElementById('toggle-mic-btn').addEventListener('click', () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    document.getElementById('mic-icon').innerText = track.enabled ? 'mic' : 'mic_off';
});

document.getElementById('toggle-cam-btn').addEventListener('click', () => {
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    document.getElementById('cam-icon').innerText = track.enabled ? 'videocam' : 'videocam_off';
});

document.getElementById('hangup-btn').addEventListener('click', () => leaveCallGracefully());
window.addEventListener('beforeunload', () => leaveCallGracefully());

function leaveCallGracefully() {
    Object.keys(peerConnections).forEach(id => sendSignal(id, { type: 'bye', sender: myUserId }));
    localStream?.getTracks().forEach(t => t.stop());
    Object.values(peerConnections).forEach(pc => pc.close());
    window.location.href = window.location.origin + window.location.pathname;
}

// OS-Level PiP
const pipBtn = document.getElementById('pip-btn');
if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
        const remoteVideo = videoGrid.querySelector('video');
        if (!remoteVideo) return alert("Waiting for others to join...");
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await remoteVideo.requestPictureInPicture();
        } catch (e) { console.error(e); }
    });
}
