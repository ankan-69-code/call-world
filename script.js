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
const joinNowBtn = document.getElementById('join-now-btn');
const videoGrid = document.getElementById('video-grid');

let currentRoom = "";
let confirmationResult = null; 

// --- WebRTC Group State ---
const myUserId = Math.random().toString(36).substring(2, 12); 
const peerConnections = {}; 
let localStream = null;

// MOBILE NETWORK FIX: Added public STUN/TURN fallback addresses
const configuration = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
    ],
    iceCandidatePoolSize: 10
};

// --- MESH OPTIMIZATION & MOBILE CAMERA FIX ---
const mediaConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true
    },
    video: { 
        facingMode: "user", 
        width: { ideal: 480, max: 640 }, 
        height: { ideal: 360, max: 480 }, 
        frameRate: { ideal: 15, max: 20 } 
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
    joinNowBtn.classList.add('hidden');
    inputs.phone.value = "";
    inputs.otp.value = "";
    steps.phone.classList.remove('hidden');
    steps.otp.classList.add('hidden');
    showView(views.auth);
});

// ==========================================
//   MOBILE RECAPTCHA FIX (VISIBLE MODE)
// ==========================================
auth.settings.appVerificationDisabledForTesting = false; 

window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 
    'size': 'normal',
    'callback': (response) => {
        console.log("reCAPTCHA verified successfully.");
    }
});

document.getElementById('send-otp-btn').addEventListener('click', () => {
    if (inputs.phone.value.length === 10) {
        signInWithPhoneNumber(auth, `+91${inputs.phone.value}`, window.recaptchaVerifier)
            .then(result => {
                confirmationResult = result;
                steps.phone.classList.add('hidden');
                steps.otp.classList.remove('hidden');
            }).catch((err) => {
                console.error("SMS Sending Error:", err);
                alert("Failed to send OTP. Please complete the reCAPTCHA.");
                // Reset recaptcha if it fails so the user can try again
                window.recaptchaVerifier.render().then(function(widgetId) {
                    grecaptcha.reset(widgetId);
                });
            });
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
    joinNowBtn.classList.remove('hidden'); // Reveal join button
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Browser infrastructure too legacy for video streaming.");
        }

        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        
        const localVideo = document.createElement('video');
        localVideo.id = 'local-video';
        localVideo.srcObject = localStream;
        localVideo.autoplay = true;
        localVideo.muted = true; 
        
        localVideo.setAttribute('playsinline', 'true');
        localVideo.playsInline = true;
        
        document.querySelector('.video-container').appendChild(localVideo);
        updateLayout();

        const roomRef = doc(db, 'rooms', currentRoom);
        const participantsRef = collection(roomRef, 'participants');
        
        onSnapshot(collection(roomRef, `inbox_${myUserId}`), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') processIncomingSignal(change.doc.data());
            });
        });

        const existingUsers = await getDocs(participantsRef);
        existingUsers.forEach(userDoc => {
            if (userDoc.id !== myUserId) initiateCallToUser(userDoc.id);
        });

        await setDoc(doc(participantsRef, myUserId), { joinedAt: Date.now() });
        
    } catch (error) {
        console.error("Camera error:", error);
        alert("Could not access your camera or microphone. Please check system permissions.");
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
    remoteVideo.setAttribute('playsinline', 'true');
    remoteVideo.playsInline = true;

    pc.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        if (!document.getElementById(`video-${targetUserId}`)) {
            remoteVideo.srcObject = remoteStream;
            videoGrid.appendChild(remoteVideo);
            updateLayout(); 
        }
    };

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

async function initiateCallToUser(targetUserId) {
    const pc = createPeerConnection(targetUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetUserId, { type: 'offer', sdp: offer.sdp, sender: myUserId });
}

async function processIncomingSignal(data) {
    const { sender, type, sdp, candidate } = data;
    
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

document.getElementById('hangup-btn').addEventListener('click', () => {
    leaveCallGracefully();
});

window.addEventListener('beforeunload', () => {
    leaveCallGracefully();
});

function leaveCallGracefully() {
    Object.keys(peerConnections).forEach(targetUserId => {
        sendSignal(targetUserId, { type: 'bye', sender: myUserId });
    });

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peerConnections).forEach(pc => pc.close());
    window.location.href = window.location.pathname;
}

// ==========================================
//   OS-LEVEL PICTURE-IN-PICTURE
// ==========================================
const pipBtn = document.getElementById('pip-btn');

if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
        const remoteVideo = videoGrid.querySelector('video');
        if (!remoteVideo) return alert("No one else is in the call yet!");

        try {
            if (!document.pictureInPictureEnabled) {
                return alert("Your device does not support Picture-in-Picture mode.");
            }

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

document.addEventListener("visibilitychange", async () => {
    const remoteVideo = videoGrid.querySelector('video');
    if (!remoteVideo || !document.pictureInPictureEnabled) return;

    if (document.hidden) {
        try {
            if (!document.pictureInPictureElement) {
                await remoteVideo.requestPictureInPicture();
            }
        } catch (error) {
            console.warn("PiP auto-activation bypassed by browser security policy.", error);
        }
    } else {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            }
        } catch (error) {
            console.error("Could not exit PiP:", error);
        }
    }
});
