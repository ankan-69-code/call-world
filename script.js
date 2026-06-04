// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
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

// --- DOM Elements ---
const views = {
    auth: document.getElementById('auth-view'),
    dashboard: document.getElementById('dashboard-view'),
    meeting: document.getElementById('meeting-view')
};
const steps = {
    phone: document.getElementById('phone-step'),
    otp: document.getElementById('otp-step')
};
const inputs = {
    phone: document.getElementById('phone-input'),
    otp: document.getElementById('otp-input'),
    link: document.getElementById('meeting-link')
};
const linkContainer = document.getElementById('link-container');
const videoGrid = document.getElementById('video-grid');

let currentRoom = "";
let confirmationResult = null; 

// --- WebRTC Group State ---
const myUserId = Math.random().toString(36).substring(2, 12); 
const peerConnections = {}; 
let localStream = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// --- MESH OPTIMIZATION: Throttling bandwidth for group calls ---
const mediaConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true
    },
    video: { 
        width: { ideal: 480, max: 640 }, 
        height: { ideal: 360, max: 480 }, 
        frameRate: { ideal: 15, max: 24 } 
    }
};

// --- Routing & Initialization ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    currentRoom = roomParam;
    showView(views.meeting);
    startGroupCall(); 
} else {
    checkSession();
}

function showView(activeView) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    activeView.classList.remove('hidden');
}

// --- Auth & Session Management ---
function checkSession() {
    const sessionExpiry = localStorage.getItem('cw_session');
    if (sessionExpiry && Date.now() < parseInt(sessionExpiry)) {
        showView(views.dashboard);
    } else {
        localStorage.removeItem('cw_session');
        showView(views.auth);
    }
}

function createSession() {
    localStorage.setItem('cw_session', Date.now() + (7 * 24 * 60 * 60 * 1000));
    showView(views.dashboard);
}

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('cw_session');
    linkContainer.classList.add('hidden');
    inputs.phone.value = "";
    inputs.otp.value = "";
    steps.phone.classList.remove('hidden');
    steps.otp.classList.add('hidden');
    showView(views.auth);
});

auth.settings.appVerificationDisabledForTesting = false; 
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'invisible' });

document.getElementById('send-otp-btn').addEventListener('click', () => {
    if (inputs.phone.value.length === 10) {
        signInWithPhoneNumber(auth, `+91${inputs.phone.value}`, window.recaptchaVerifier)
            .then(result => {
                confirmationResult = result;
                steps.phone.classList.add('hidden');
                steps.otp.classList.remove('hidden');
            }).catch(() => alert("Failed to send OTP. Try again."));
    } else { alert("Enter a valid 10-digit number."); }
});

document.getElementById('verify-otp-btn').addEventListener('click', () => {
    if (inputs.otp.value.length >= 4 && confirmationResult) {
        confirmationResult.confirm(inputs.otp.value)
            .then(() => createSession())
            .catch(() => alert("Invalid OTP."));
    }
});

document.getElementById('back-btn').addEventListener('click', () => {
    steps.otp.classList.add('hidden');
    steps.phone.classList.remove('hidden');
});

// --- Link Generation ---
document.getElementById('generate-link-btn').addEventListener('click', () => {
    currentRoom = `room-${Math.random().toString(36).substring(2, 11)}`;
    inputs.link.value = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
    linkContainer.classList.remove('hidden');
});

document.getElementById('copy-btn').addEventListener('click', () => {
    inputs.link.select();
    navigator.clipboard.writeText(inputs.link.value);
    alert("Meeting link copied!");
});

document.getElementById('join-now-btn').addEventListener('click', () => {
    showView(views.meeting);
    startGroupCall();
});

// --- Dynamic Layout Manager ---
function updateLayout() {
    const localVideo = document.getElementById('local-video');
    if (!localVideo) return;
    
    const remoteVideoCount = videoGrid.querySelectorAll('video').length;
    if (remoteVideoCount > 0) {
        localVideo.classList.add('pip');
    } else {
        localVideo.classList.remove('pip');
    }
}

// --- Group WebRTC Logic ---
async function startGroupCall() {
    try {
        // Request camera with optimized constraints
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
        const participantsRef = collection(roomRef, 'participants');
        
        // Listen for incoming connection offers
        onSnapshot(collection(roomRef, `inbox_${myUserId}`), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') processIncomingSignal(change.doc.data());
            });
        });

        // Call everyone already in the room
        const existingUsers = await getDocs(participantsRef);
        existingUsers.forEach(userDoc => {
            if (userDoc.id !== myUserId) initiateCallToUser(userDoc.id);
        });

        // Announce presence
        await setDoc(doc(participantsRef, myUserId), { joinedAt: Date.now() });
        
    } catch (error) {
        console.error("Camera error:", error);
        alert("Could not access camera/microphone.");
    }
}

function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[targetUserId] = pc; 

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            sendSignal(targetUserId, { type: 'candidate', candidate: event.candidate.toJSON(), sender: myUserId });
        }
    };

    const remoteStream = new MediaStream();
    const remoteVideo = document.createElement('video');
    remoteVideo.id = `video-${targetUserId}`;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;

    pc.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        if (!document.getElementById(`video-${targetUserId}`)) {
            remoteVideo.srcObject = remoteStream;
            videoGrid.appendChild(remoteVideo);
            updateLayout(); 
        }
    };

    // Clean up when someone leaves
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            const vidToRemove = document.getElementById(`video-${targetUserId}`);
            if (vidToRemove) vidToRemove.remove();
            delete peerConnections[targetUserId];
            updateLayout(); 
        }
    };

    return pc;
}

async function processIncomingSignal(data) {
    const { sender, type, sdp, candidate } = data;
    
    // THE NEW FIX: If they say bye, instantly kill their video
    if (type === 'bye') {
        const vidToRemove = document.getElementById(`video-${sender}`);
        if (vidToRemove) vidToRemove.remove();
        if (peerConnections[sender]) {
            peerConnections[sender].close();
            delete peerConnections[sender];
        }
        updateLayout();
        return;
    }

    const pc = peerConnections[sender] || createPeerConnection(sender);

    try {
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
    } catch (error) {
        console.error("Signal processing error:", error);
    }
}

async function sendSignal(targetUserId, message) {
    await addDoc(collection(db, 'rooms', currentRoom, `inbox_${targetUserId}`), message);
}

// --- Video Controls ---
document.getElementById('toggle-mic-btn').addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    const icon = document.getElementById('mic-icon');
    icon.innerText = audioTrack.enabled ? 'mic' : 'mic_off';
    icon.parentElement.classList.toggle('danger', !audioTrack.enabled);
});

document.getElementById('toggle-cam-btn').addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    const icon = document.getElementById('cam-icon');
    icon.innerText = videoTrack.enabled ? 'videocam' : 'videocam_off';
    icon.parentElement.classList.toggle('danger', !videoTrack.enabled);
});

// Hangup and Tab-Close Listeners
document.getElementById('hangup-btn').addEventListener('click', () => {
    leaveCallGracefully();
});

window.addEventListener('beforeunload', () => {
    leaveCallGracefully();
});

function leaveCallGracefully() {
    // 1. Tell everyone we are leaving
    Object.keys(peerConnections).forEach(targetUserId => {
        sendSignal(targetUserId, { type: 'bye', sender: myUserId });
    });

    // 2. Shut down our camera
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // 3. Sever our connections
    Object.values(peerConnections).forEach(pc => pc.close());
    
    window.location.href = window.location.pathname;
}

// ==========================================
//   OS-LEVEL PICTURE-IN-PICTURE (FLOAT)
// ==========================================

const pipBtn = document.getElementById('pip-btn');

// 1. Manual Click (Always works, bypasses browser security blocks)
if(pipBtn) {
    pipBtn.addEventListener('click', async () => {
        // Grab the first remote video in the grid
        const remoteVideo = videoGrid.querySelector('video');
        
        if (!remoteVideo) {
            return alert("No one else is in the call yet!");
        }

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await remoteVideo.requestPictureInPicture();
            }
        } catch (error) {
            console.error("PiP failed:", error);
        }
    });
}

// 2. Automatic Float (When you change tabs or go to home screen)
document.addEventListener("visibilitychange", async () => {
    const remoteVideo = videoGrid.querySelector('video');
    
    // If there is no remote video, or the browser doesn't support PiP, do nothing
    if (!remoteVideo || !document.pictureInPictureEnabled) return;

    if (document.hidden) {
        // User left the tab -> Push to OS floating window
        try {
            // Note: Some mobile browsers block this unless the user just clicked something.
            if (!document.pictureInPictureElement) {
                await remoteVideo.requestPictureInPicture();
            }
        } catch (error) {
            console.warn("Browser blocked auto-PiP. User must use the manual button.", error);
        }
    } else {
        // User came back to the tab -> Pull video back into the website
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            }
        } catch (error) {
            console.error("Could not exit PiP:", error);
        }
    }
});
