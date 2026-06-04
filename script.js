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

const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const meetingView = document.getElementById('meeting-view');
const phoneStep = document.getElementById('phone-step');
const otpStep = document.getElementById('otp-step');
const phoneInput = document.getElementById('phone-input');
const otpInput = document.getElementById('otp-input');
const linkContainer = document.getElementById('link-container');
const meetingLinkInput = document.getElementById('meeting-link');
const videoGrid = document.getElementById('video-grid');

let currentRoom = "";
let confirmationResult = null; 

const myUserId = Math.random().toString(36).substring(2, 12); 
const peerConnections = {}; 
let localStream = null;

const configuration = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    currentRoom = roomParam;
    showView(meetingView);
    startGroupCall(); 
} else {
    checkSession();
}

function showView(view) {
    authView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    meetingView.classList.add('hidden');
    view.classList.remove('hidden');
}

function checkSession() {
    const sessionExpiry = localStorage.getItem('cw_session');
    if (sessionExpiry && Date.now() < parseInt(sessionExpiry)) {
        showView(dashboardView);
    } else {
        localStorage.removeItem('cw_session');
        showView(authView);
    }
}

function createSession() {
    const expiryDate = Date.now() + (7 * 24 * 60 * 60 * 1000);
    localStorage.setItem('cw_session', expiryDate);
    showView(dashboardView);
}

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('cw_session');
    linkContainer.classList.add('hidden');
    showView(authView);
    phoneStep.classList.remove('hidden');
    otpStep.classList.add('hidden');
    phoneInput.value = "";
    otpInput.value = "";
});

auth.settings.appVerificationDisabledForTesting = false; 
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'invisible' });

document.getElementById('send-otp-btn').addEventListener('click', () => {
    const phone = phoneInput.value;
    if (phone.length === 10) {
        signInWithPhoneNumber(auth, `+91${phone}`, window.recaptchaVerifier)
            .then(result => {
                confirmationResult = result;
                phoneStep.classList.add('hidden');
                otpStep.classList.remove('hidden');
            }).catch(error => alert("Failed to send OTP."));
    } else { alert("Enter a valid 10-digit number."); }
});

document.getElementById('verify-otp-btn').addEventListener('click', () => {
    if (otpInput.value.length >= 4 && confirmationResult) {
        confirmationResult.confirm(otpInput.value).then(() => createSession())
        .catch(() => alert("Invalid OTP."));
    }
});

document.getElementById('back-btn').addEventListener('click', () => {
    otpStep.classList.add('hidden');
    phoneStep.classList.remove('hidden');
});

document.getElementById('generate-link-btn').addEventListener('click', () => {
    currentRoom = `room-${Math.random().toString(36).substring(2, 11)}`;
    meetingLinkInput.value = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
    linkContainer.classList.remove('hidden');
});

document.getElementById('copy-btn').addEventListener('click', () => {
    meetingLinkInput.select();
    navigator.clipboard.writeText(meetingLinkInput.value);
    alert("Link copied!");
});

document.getElementById('join-now-btn').addEventListener('click', () => {
    showView(meetingView);
    startGroupCall();
});


// --- Dynamic Layout Manager ---
function updateLayout() {
    const localVideo = document.getElementById('local-video');
    if (!localVideo) return;
    
    // Count how many remote videos are currently inside the grid
    const remoteVideoCount = videoGrid.querySelectorAll('video').length;
    
    if (remoteVideoCount > 0) {
        localVideo.classList.add('pip'); // Shrink me
    } else {
        localVideo.classList.remove('pip'); // Full screen me
    }
}


// --- Group WebRTC Logic ---
async function startGroupCall() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    
    const localVideo = document.createElement('video');
    localVideo.id = 'local-video';
    localVideo.srcObject = localStream;
    localVideo.autoplay = true;
    localVideo.muted = true; 
    localVideo.playsInline = true;
    
    // Inject local video into the main container, NOT the grid
    document.querySelector('.video-container').appendChild(localVideo);
    updateLayout();

    const roomRef = doc(db, 'rooms', currentRoom);
    const participantsRef = collection(roomRef, 'participants');
    
    const myInboxRef = collection(roomRef, `inbox_${myUserId}`);
    onSnapshot(myInboxRef, snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                processIncomingSignal(change.doc.data());
            }
        });
    });

    const existingUsers = await getDocs(participantsRef);
    existingUsers.forEach(userDoc => {
        const targetUserId = userDoc.id;
        if (targetUserId !== myUserId) {
            initiateCallToUser(targetUserId);
        }
    });

    await setDoc(doc(participantsRef, myUserId), { joinedAt: Date.now() });
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
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = remoteStream;
            videoGrid.appendChild(remoteVideo);
            updateLayout(); // Trigger PiP!
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            remoteVideo.remove();
            delete peerConnections[targetUserId];
            updateLayout(); // Expand back to full screen if they were the last person
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

    if (type === 'offer') {
        const pc = createPeerConnection(sender);
        await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(sender, { type: 'answer', sdp: answer.sdp, sender: myUserId });
    } 
    else if (type === 'answer') {
        const pc = peerConnections[sender];
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
    } 
    else if (type === 'candidate') {
        const pc = peerConnections[sender];
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

async function sendSignal(targetUserId, message) {
    const targetInbox = collection(db, 'rooms', currentRoom, `inbox_${targetUserId}`);
    await addDoc(targetInbox, message);
}

// --- Video Controls ---
document.getElementById('toggle-mic-btn').addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById('mic-icon').innerText = audioTrack.enabled ? 'mic' : 'mic_off';
});

document.getElementById('toggle-cam-btn').addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById('cam-icon').innerText = videoTrack.enabled ? 'videocam' : 'videocam_off';
});

document.getElementById('hangup-btn').addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections).forEach(pc => pc.close());
    window.location.href = window.location.pathname;
});
