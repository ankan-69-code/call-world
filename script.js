// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    RecaptchaVerifier, 
    signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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

// --- Routing & Initialization ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    // Guest joining via link
    currentRoom = roomParam;
    showView(meetingView);
    launchGuestCall(); // Call the safety loop function
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

// --- Safety Loop for ZegoCloud ---
function launchGuestCall() {
    // If Zego isn't fully loaded yet, wait 200ms and check again
    if (typeof ZegoUIKitPrebuilt === 'undefined') {
        console.log("Zego SDK loading, please wait...");
        setTimeout(launchGuestCall, 200);
        return;
    }
    // If it is loaded, start the meeting!
    joinVideoCall();
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
                alert("Failed to send OTP. Check the console for details.");
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

// --- Join Button Listener ---
document.getElementById('join-now-btn').addEventListener('click', () => {
    showView(meetingView);
    launchGuestCall(); // Call the safety loop function here too
});

// --- ZegoCloud Video Meeting ---
const ZEGO_APP_ID = 826320753; 
const ZEGO_SERVER_SECRET = "1f98403b7ffca9f9595f16d2264b5627be90cc134a793353626ec000ea328cad"; 

function joinVideoCall() {
    if (!currentRoom) return alert("No room ID found.");
    
    const userName = auth.currentUser ? auth.currentUser.phoneNumber : "Guest";
    const userID = Math.random().toString(36).substring(7);

    setTimeout(() => {
        // --- FAIL-SAFE: Force-create the container if the browser cache is hiding it ---
        let zegoContainer = document.getElementById('zego-container');
        
        if (!zegoContainer) {
            console.warn("Cache glitch detected! Building the container dynamically...");
            zegoContainer = document.createElement('div');
            zegoContainer.id = 'zego-container';
            zegoContainer.style.width = '100vw';
            zegoContainer.style.height = '100vh';
            
            // Try to put it in the meeting view, otherwise just slap it on the body
            const meetingViewContainer = document.getElementById('meeting-view');
            if (meetingViewContainer) {
                meetingViewContainer.appendChild(zegoContainer);
            } else {
                document.body.appendChild(zegoContainer);
            }
        }
        // ------------------------------------------------------------------------------

        const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
            ZEGO_APP_ID, 
            ZEGO_SERVER_SECRET, 
            currentRoom, 
            userID, 
            userName
        );

        const zp = ZegoUIKitPrebuilt.create(kitToken);

        zp.joinRoom({
            container: zegoContainer, // Pass the guaranteed container
            sharedLinks: [{
                name: 'Meeting Link',
                url: window.location.origin + window.location.pathname + '?room=' + currentRoom,
            }],
            scenario: {
                mode: ZegoUIKitPrebuilt.GroupCall, 
            },
            showScreenSharingButton: true,
            onLeaveRoom: () => {
                window.location.href = window.location.pathname;
            }
        });
    }, 100); 
}
            }
