// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    RecaptchaVerifier, 
    signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// TODO: Replace this with your actual config from Firebase
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

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
let localStream = null;
let confirmationResult = null; // Stores the Firebase OTP session

// --- Routing & Initialization ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    // Guest joining via link: skip auth, go straight to meeting
    currentRoom = roomParam;
    showView(meetingView);
    startCamera();
    document.getElementById('room-display').innerText = `Room: ${currentRoom}`;
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
                // SMS sent successfully
                confirmationResult = result;
                phoneStep.classList.add('hidden');
                otpStep.classList.remove('hidden');
            }).catch((error) => {
                console.error("SMS not sent", error);
                alert("Failed to send OTP. Check the console for details.");
                // Reset recaptcha so the user can try again
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
        confirmationResult.confirm(code).then((result) => {
            // User successfully verified!
            const user = result.user;
            console.log("Logged in as:", user.phoneNumber);
            createSession();
        }).catch((error) => {
            console.error("Bad OTP", error);
            alert("Invalid OTP. Try again.");
        });
    } else {
        alert("Please wait for the OTP to arrive and enter it.");
    }
});

document.getElementById('back-btn').addEventListener('click', () => {
    otpStep.classList.add('hidden');
    phoneStep.classList.remove('hidden');
});

// --- Dashboard Link Generation ---
document.getElementById('generate-link-btn').addEventListener('click', () => {
    const randomStr = Math.random().toString(36).substring(2, 11);
    currentRoom = `${randomStr.slice(0,3)}-${randomStr.slice(3,7)}-${randomStr.slice(7)}`;
    
    const baseUrl = window.location.origin + window.location.pathname;
    const joinUrl = `${baseUrl}?room=${currentRoom}`;
    
    meetingLinkInput.value = joinUrl;
    linkContainer.classList.remove('hidden');
});

document.getElementById('copy-btn').addEventListener('click', () => {
    meetingLinkInput.select();
    navigator.clipboard.writeText(meetingLinkInput.value);
    alert("Link copied to clipboard!");
});

document.getElementById('join-now-btn').addEventListener('click', () => {
    showView(meetingView);
    startCamera();
    document.getElementById('room-display').innerText = `Room: ${currentRoom}`;
});

// --- Meeting Camera Controls ---
async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
    } catch (err) {
        console.error("Failed to access camera", err);
        alert("Camera access denied.");
    }
}

document.getElementById('mic-btn').addEventListener('click', (e) => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const icon = e.currentTarget.querySelector('span');
        icon.innerText = audioTrack.enabled ? 'mic' : 'mic_off';
        e.currentTarget.style.backgroundColor = audioTrack.enabled ? '#3c4043' : '#ea4335';
    }
});

document.getElementById('cam-btn').addEventListener('click', (e) => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const icon = e.currentTarget.querySelector('span');
        icon.innerText = videoTrack.enabled ? 'videocam' : 'videocam_off';
        e.currentTarget.style.backgroundColor = videoTrack.enabled ? '#3c4043' : '#ea4335';
    }
});

document.getElementById('end-btn').addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    window.location.href = window.location.pathname;
});
