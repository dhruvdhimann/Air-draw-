const video = document.getElementById('webcam');
const canvas = document.getElementById('output-canvas');
const ctx = canvas.getContext('2d');
const statusBadge = document.getElementById('status-badge');

let drawColor = "#ff00e5";
let brushSize = 10;
let paths = []; // Stores all completed lines
let currentPath = []; // Stores the line currently being drawn
let lastGesture = "idle";
let currentMode = "neon"; // neon, solid, rainbow
let hue = 0; // for rainbow colors
let gestureCooldown = 0; // Prevent spamming gestures
let particles = []; // For sparkle magic
let lastX = 0, lastY = 0, lastTime = Date.now();

// --- Setup & Responsiveness ---
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- UI Controls ---
document.querySelectorAll('.color').forEach(c => {
  c.onclick = () => {
    document.querySelector('.color.active').classList.remove('active');
    c.classList.add('active');
    drawColor = c.dataset.color;
  };
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelector('.mode-btn.active').classList.remove('active');
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  };
});

function undo() {
  if (paths.length > 0) paths.pop();
}

function saveDrawing() {
  const link = document.createElement('a');
  link.download = 'AirDraw_Masterpiece.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

document.getElementById('size-slider').oninput = (e) => brushSize = parseInt(e.target.value);
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-save').onclick = saveDrawing;
document.getElementById('btn-clear').onclick = () => {
  paths = [];
  currentPath = [];
};

// --- Gesture Detection Math ---
function getDist(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function analyzeGesture(landmarks) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const dThumb = getDist(thumbTip, wrist);
  const dIndex = getDist(indexTip, wrist);
  const dMiddle = getDist(middleTip, wrist);
  const dRing = getDist(ringTip, wrist);
  const dPinky = getDist(pinkyTip, wrist);

  const thumbIsExtended = dThumb > 0.3;
  const otherClosed = dIndex < 0.3 && dMiddle < 0.3 && dRing < 0.3;

  // 1. SAVE: Thumbs Up
  if (thumbIsExtended && otherClosed) {
    if (thumbTip.y < landmarks[5].y) return "thumbs_up";
  }

  // 2. UNDO: Open Palm (All 5 Fingers Extended)
  if (thumbIsExtended && dIndex > 0.35 && dMiddle > 0.35 && dRing > 0.35 && dPinky > 0.35) return "open_palm";

  // 3. ERASE: Index and Middle fingers extended (Two Fingers / Peace Sign)
  if (dIndex > 0.35 && dMiddle > 0.35 && dRing < 0.30) return "erase";

  // 4. DRAW: Only Index extended, Middle closed
  if (dIndex > 0.35 && dMiddle < 0.30) return "draw";

  // 5. IDLE: Default state
  return "idle";
}

// --- MediaPipe Implementation ---
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.8,
  minTrackingConfidence: 0.8
});

hands.onResults(onResults);

function onResults(results) {
  // Clear and Draw Mirrored Camera
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];

    // Premium Skeleton Styling
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {color: 'rgba(0, 240, 255, 0.5)', lineWidth: 2});
    drawLandmarks(ctx, landmarks, {color: '#ff00e5', lineWidth: 2, fillColor: '#1a1a2e', radius: 4});

    const gesture = analyzeGesture(landmarks);
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    
    let x = indexTip.x * canvas.width;
    let y = indexTip.y * canvas.height;

    if (gesture === "erase") {
      x = ((indexTip.x + middleTip.x) / 2) * canvas.width;
      y = ((indexTip.y + middleTip.y) / 2) * canvas.height;
    }

    if (gestureCooldown > 0) gestureCooldown--;

    // IMPORTANT: Finalize the path immediately if we stop drawing
    if (gesture !== "draw" && currentPath.length > 0) {
      paths.push([...currentPath]);
      currentPath = [];
    }

    if (gesture === "thumbs_up") {
      if (gestureCooldown === 0) {
        statusBadge.className = 'badge drawing';
        statusBadge.innerHTML = '<i class="fa-solid fa-download"></i><span>Saving</span>';
        saveDrawing();
        gestureCooldown = 45; // ~1.5s cooldown
      }
    } 
    else if (gesture === "open_palm") {
      if (gestureCooldown === 0) {
        statusBadge.className = 'badge erasing';
        statusBadge.innerHTML = '<i class="fa-solid fa-rotate-left"></i><span>Undo</span>';
        undo();
        gestureCooldown = 30; // ~1s cooldown
      }
    }
    else if (gesture === "draw") {
      if (statusBadge.className !== 'badge drawing') {
        statusBadge.className = 'badge drawing';
        statusBadge.innerHTML = '<i class="fa-solid fa-pen-nib"></i><span>Drawing</span>';
      }
      
      if (currentPath.length === 0) {
        lastX = x; lastY = y; lastTime = Date.now();
      }
      let now = Date.now();
      let dx = x - lastX;
      let dy = y - lastY;
      let velocity = Math.sqrt(dx*dx + dy*dy) / Math.max(now - lastTime, 1);
      let dynamicSize = Math.max(3, brushSize - (velocity * 8));
      
      lastX = x; lastY = y; lastTime = now;

      let strokeColor = drawColor;
      if (currentMode === "rainbow") {
         hue = (hue + 2) % 360;
         strokeColor = `hsl(${hue}, 100%, 50%)`;
      }
      
      if (currentMode === "sparkle") {
        for (let i = 0; i < 2; i++) {
          particles.push({
            x: x + (Math.random() - 0.5) * 20,
            y: y + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 8 + 2,
            life: 1.0,
            color: strokeColor
          });
        }
      }

      currentPath.push({ x, y, color: strokeColor, size: dynamicSize, mode: currentMode });
    } 
    else if (gesture === "erase") {
      if (statusBadge.className !== 'badge erasing') {
        statusBadge.className = 'badge erasing';
        statusBadge.innerHTML = '<i class="fa-solid fa-eraser"></i><span>Erasing</span>';
      }
      eraseAt(x, y);
    } 
    else {
      if (statusBadge.className !== 'badge idle') {
        statusBadge.className = 'badge idle';
        statusBadge.innerHTML = '<i class="fa-solid fa-hand-fist"></i><span>Idle</span>';
      }
    }
    lastGesture = gesture;
  }
  ctx.restore();

  // Draw the actual brush strokes
  renderDrawing();
}

function eraseAt(x, y) {
  const eraseRadius = 70; // Adjust for larger/smaller eraser area
  
  // Clean existing paths
  paths = paths.map(path => 
    path.filter(p => {
      const d = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
      return d > eraseRadius;
    })
  ).filter(path => path.length > 1);
}

function renderDrawing() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Draw history
  paths.forEach(path => drawStroke(path));
  // Draw current
  drawStroke(currentPath);

  // Sparkle Particles
  for (let i = particles.length - 1; i >= 0; i--) {
     let p = particles[i];
     p.x += p.vx;
     p.y += p.vy;
     p.life -= 0.03;

     ctx.globalAlpha = p.life > 0 ? p.life : 0;
     ctx.fillStyle = p.color;
     ctx.beginPath();
     ctx.arc(p.x, p.y, Math.random() * 3 + 1, 0, Math.PI * 2);
     ctx.fill();

     if (p.life <= 0) particles.splice(i, 1);
  }
  ctx.globalAlpha = 1.0;

  ctx.restore();
}

function drawStroke(stroke) {
  if (stroke.length < 2) return;
  const mode = stroke[0].mode || "neon";
  
  if (mode === "neon" || mode === "rainbow" || mode === "sparkle") {
    ctx.shadowBlur = 15;
    ctx.shadowColor = stroke[0].color;
  } else {
    ctx.shadowBlur = 0;
  }
  ctx.strokeStyle = stroke[0].color;
  
  // Calligraphic Segment Stroking
  if (stroke.length < 3) {
     ctx.beginPath();
     ctx.lineWidth = stroke[0].size;
     ctx.moveTo(stroke[0].x, stroke[0].y);
     ctx.lineTo(stroke[1].x, stroke[1].y);
     ctx.stroke();
  } else {
     ctx.beginPath();
     ctx.lineWidth = stroke[0].size;
     ctx.moveTo(stroke[0].x, stroke[0].y);
     for (let i = 1; i < stroke.length - 2; i++) {
       const xc = (stroke[i].x + stroke[i + 1].x) / 2;
       const yc = (stroke[i].y + stroke[i + 1].y) / 2;
       
       ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, xc, yc);
       ctx.stroke(); // Stroke segment
       
       // Begin next segment with dynamic size
       ctx.beginPath();
       ctx.lineWidth = stroke[i+1].size;
       ctx.moveTo(xc, yc);
     }
     ctx.quadraticCurveTo(
       stroke[stroke.length - 2].x, stroke[stroke.length - 2].y, 
       stroke[stroke.length - 1].x, stroke[stroke.length - 1].y
     );
     ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

const camera = new Camera(video, {
  onFrame: async () => { await hands.send({image: video}); },
  width: 1280, height: 720
});
camera.start().then(() => {
  const loader = document.getElementById('loading-screen');
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 500);
});