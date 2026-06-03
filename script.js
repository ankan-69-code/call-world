// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Your exact Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAv4YOIRpkgDZCJznrmCBF0YQhQJtCAY88",
  authDomain: "call-world-bdbe6.firebaseapp.com",
  projectId: "call-world-bdbe6",
  storageBucket: "call-world-bdbe6.firebasestorage.app",
  messagingSenderId: "417335991997",
  appId: "1:417335991997:web:81983e3cad0b69484721d4",
  measurementId: "G-YTXB18QFJ6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- DOM Elements ---
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const meetingView = document.getElementById('meeting-view');
const phoneStep = document.getElementById('phone-step');
const otpStep = document.getElementById('otp-step');
const phoneInput = document.getElementById('phone-input');
const otpInput = document.getElementById('otp-input');
const linkContainer = document.getElementById('link-container');
const meetingLinkInput = document.getElementById('meeting-link');

let currentRoom = "";
let confirmationResult = null; 

// --- WebRTC State ---
const configuration = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};
let peerConnection = null;
let localStream = null;
let remoteStream = null;
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// --- Routing & Initialization ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    // Guest joining via link
    currentRoom = roomParam;
    showView(meetingView);
    startGuestCall(); 
} else {
    // Host visiting the main page
    checkSession();
}

function showView(view) {
    authView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    meetingView.classList.add('hidden');
    view.classList.remove('hidden');
}

// --- Session Management (7 Days) ---
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

// --- Firebase Phone Authentication ---
auth.settings.appVerificationDisabledForTesting = false; 
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    'size': 'invisible'
});

document.getElementById('send-otp-btn').addEventListener('click', () => {
    const phone = phoneInput.value;
    const formattedPhoneNumber = `+91${phone}`; 

    if (phone.length === 10) {
        const appVerifier = window.recaptchaVerifier;
        signInWithPhoneNumber(auth, formattedPhoneNumber, appVerifier)
            .then((result) => {
                confirmationResult = result;
                phoneStep.classList.add('hidden');
                otpStep.classList.remove('hidden');
            }).catch((error) => {
                console.error("SMS not sent", error);
                alert("Failed to send OTP. Check console.");
                window.recaptchaVerifier.render().then(function(widgetId) {
                    grecaptcha.reset(widgetId);
                });
            });
    } else {
        alert("Please enter a valid 10-digit mobile number.");
    }
});

document.getElementById('verify-otp-btn').addEventListener('click', () => {
    const code = otpInput.value;
    if (code.length >= 4 && confirmationResult) {
        confirmationResult.confirm(code).then(() => {
            createSession();
        }).catch((error) => {
            console.error("Bad OTP", error);
            alert("Invalid OTP. Try again.");
        });
    } else {
        alert("Please wait for the OTP to arrive.");
    }
});

document.getElementById('back-btn').addEventListener('click', () => {
    otpStep.classList.add('hidden');
    phoneStep.classList.remove('hidden');
});

// --- Dashboard Link Generation ---
document.getElementById('generate-link-btn').addEventListener('click', () => {
    // Generate a random room string
    const randomStr = Math.random().toString(36).substring(2, 11);
    currentRoom = `room-${randomStr}`;
    
    const baseUrl = window.location.origin + window.location.pathname;
    meetingLinkInput.value = `${baseUrl}?room=${currentRoom}`;
    linkContainer.classList.remove('hidden');
});

document.getElementById('copy-btn').addEventListener('click', () => {
    meetingLinkInput.select();
    navigator.clipboard.writeText(meetingLinkInput.value);
    alert("Link copied!");
});

// --- WebRTC Logic ---

async function openUserMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    remoteStream = new MediaStream();
    
    localVideo.srcObject = localStream;
    remoteVideo.srcObject = remoteStream;
}

function registerPeerConnectionListeners() {
    peerConnection.addEventListener('track', event => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
    });
}

// Host creates the connection offer
async function createRoom(roomId) {
    const roomRef = doc(db, 'rooms', roomId);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    peerConnection.addEventListener('icecandidate', event => {
        if (!event.candidate) return;
        addDoc(callerCandidatesCollection, event.candidate.toJSON());
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const roomWithOffer = {
        offer: {
            type: offer.type,
            sdp: offer.sdp,
        },
    };
    await setDoc(roomRef, roomWithOffer);

    onSnapshot(roomRef, async snapshot => {
        const data = snapshot.data();
        if (!peerConnection.currentRemoteDescription && data && data.answer) {
            const rtcSessionDescription = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(rtcSessionDescription);
        }
    });

    onSnapshot(collection(roomRef, 'calleeCandidates'), snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                let data = change.doc.data();
                await peerConnection.addIceCandidate(new RTCIceCandidate(data));
            }
        });
    });
}

// Guest joins and answers the connection
async function joinRoomById(roomId) {
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
        alert("Meeting room is waiting for host to join, or doesn't exist.");
        return;
    }

    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
        if (!event.candidate) return;
        addDoc(calleeCandidatesCollection, event.candidate.toJSON());
    });

    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
        answer: {
            type: answer.type,
            sdp: answer.sdp,
        }
    };
    await setDoc(roomRef, roomWithAnswer, { merge: true });

    onSnapshot(collection(roomRef, 'callerCandidates'), snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                let data = change.doc.data();
                await peerConnection.addIceCandidate(new RTCIceCandidate(data));
            }
        });
    });
}

// --- Join Button Listeners ---
document.getElementById('join-now-btn').addEventListener('click', async () => {
    showView(meetingView);
    await openUserMedia();
    await createRoom(currentRoom);
});

async function startGuestCall() {
    await openUserMedia();
    await joinRoomById(currentRoom);
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
    if (peerConnection) {
        peerConnection.close();
    }
    window.location.href = window.location.pathname;
});
