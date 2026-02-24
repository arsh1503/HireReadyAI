import { useState, useEffect, useRef } from "react";

// ── API Configuration ─────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8000";

const api = {
  // Fetch questions for a job role
  async getQuestions(role) {
    const res = await fetch(`${API_BASE}/interview/questions?role=${encodeURIComponent(role)}`);
    if (!res.ok) throw new Error("Failed to fetch questions");
    const data = await res.json();
    return data.questions;
  },

  // Parse resume and get personalized questions
  async parseResume(file, role) {
    const form = new FormData();
    form.append("file", file);
    form.append("role", role);
    const res = await fetch(`${API_BASE}/resume/questions`, { method: "POST", body: form });
    if (!res.ok) throw new Error("Failed to parse resume");
    return await res.json();
  },

  // Analyze a text transcript and get confidence score
  async analyzeText(transcript, duration, questionIndex) {
    const form = new FormData();
    form.append("transcript",     transcript);
    form.append("duration",       String(duration));
    form.append("question_index", String(questionIndex));
    const res = await fetch(`${API_BASE}/analyze/text`, { method: "POST", body: form });
    if (!res.ok) throw new Error("Failed to analyze answer");
    return await res.json();
  },

  // Generate final report from all scores
  async generateReport(scores) {
    const res = await fetch(`${API_BASE}/analyze/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scores),
    });
    if (!res.ok) throw new Error("Failed to generate report");
    return await res.json();
  },

  // Health check
  async ping() {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  },
};

// Fallback questions if backend is offline
const FALLBACK_QUESTIONS = [
  "Tell me about yourself and your background in software development.",
  "Can you walk me through a challenging project you've worked on?",
  "How do you approach debugging a complex issue in production?",
  "Describe your experience with REST APIs and backend development.",
  "Where do you see yourself in 5 years, professionally?",
];

const pulseRing = `
  @keyframes pulseRing {
    0% { transform: scale(1); opacity: 0.6; }
    100% { transform: scale(1.6); opacity: 0; }
  }
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; } 50% { opacity: 0; }
  }
  @keyframes scanline {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100vh); }
  }
  @keyframes avatarFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }
  @keyframes waveBar {
    0%, 100% { height: 6px; } 50% { height: 24px; }
  }
  @keyframes scoreCount {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes spinSlow {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes glowPulse {
    0%, 100% { box-shadow: 0 0 20px rgba(0,245,160,0.2); }
    50% { box-shadow: 0 0 40px rgba(0,245,160,0.4); }
  }
`;

// ── Confidence scoring from real transcript ──────────────────────────────────
function calculateConfidence(transcript, durationSeconds) {
  if (!transcript || transcript.trim().length === 0) return 10;

  const words = transcript.trim().split(/\s+/);
  const wordCount = words.length;

  // 1. Length score (ideal: 50–150 words)
  let lengthScore;
  if (wordCount < 10)       lengthScore = 20;
  else if (wordCount < 30)  lengthScore = 45;
  else if (wordCount < 50)  lengthScore = 65;
  else if (wordCount <= 150)lengthScore = 95;
  else if (wordCount <= 250)lengthScore = 78;
  else                      lengthScore = 60;

  // 2. Pace score (ideal: 110–160 WPM)
  const wpm = durationSeconds > 0 ? (wordCount / durationSeconds) * 60 : 0;
  let paceScore;
  if (wpm >= 110 && wpm <= 160)       paceScore = 100;
  else if (wpm >= 80 && wpm < 110)    paceScore = 80;
  else if (wpm > 60 && wpm <= 80)     paceScore = 75;
  else if (wpm >= 50 && wpm < 60)     paceScore = 55;
  else                                 paceScore = 35;

  // 3. Filler word penalty (max -20)
  const fillers = ["um","uh","like","you know","basically","literally","actually","kinda","sorta","right","so so"];
  const fillerCount = fillers.reduce((acc, f) => acc + (transcript.toLowerCase().split(f).length - 1), 0);
  const fillerPenalty = Math.min(fillerCount * 4, 20);

  // 4. Vocabulary richness bonus (unique words ratio)
  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, "")));
  const richness = uniqueWords.size / Math.max(wordCount, 1);
  const richBonus = richness > 0.7 ? 5 : richness > 0.5 ? 2 : 0;

  const raw = (lengthScore * 0.5) + (paceScore * 0.5) - fillerPenalty + richBonus;
  return Math.max(10, Math.min(100, Math.round(raw)));
}

// ── Webcam + Integrity Analysis Hook ────────────────────────────────────────
function useWebcam(active) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const intervalRef = useRef(null);

  const [camError,   setCamError]   = useState("");
  const [integrity,  setIntegrity]  = useState({
    faceDetected:  null,
    lookingForward:null,
    goodLighting:  null,
    tabFocused:    true,
    violations:    0,
  });

  // Tab focus detection
  useEffect(() => {
    const onBlur  = () => setIntegrity(p => ({ ...p, tabFocused: false, violations: p.violations + 1 }));
    const onFocus = () => setIntegrity(p => ({ ...p, tabFocused: true }));
    window.addEventListener("blur",  onBlur);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); };
  }, []);

  // Start/stop webcam when active changes
  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [active]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCamError("");
      // Start frame analysis every 800ms
      intervalRef.current = setInterval(() => analyzeFrame(), 800);
    } catch (e) {
      if (e.name === "NotAllowedError") {
        setCamError("Camera access denied. Please allow camera permissions.");
      } else {
        setCamError("Could not access camera: " + e.message);
      }
    }
  };

  const stopCamera = () => {
    clearInterval(intervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const analyzeFrame = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    canvas.width  = video.videoWidth  || 320;
    canvas.height = video.videoHeight || 240;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels    = imageData.data;

    // ── 1. Lighting analysis ──────────────────────────────────────────────
    // Average brightness of all pixels (0–255)
    let totalBrightness = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      totalBrightness += (pixels[i] * 0.299 + pixels[i+1] * 0.587 + pixels[i+2] * 0.114);
    }
    const avgBrightness = totalBrightness / (pixels.length / 4);
    const goodLighting  = avgBrightness > 40 && avgBrightness < 220;

    // ── 2. Face presence (skin-tone pixel ratio in center zone) ──────────
    // Sample the center 40% of the frame for skin-like tones
    const cx1 = Math.floor(canvas.width  * 0.30);
    const cx2 = Math.floor(canvas.width  * 0.70);
    const cy1 = Math.floor(canvas.height * 0.10);
    const cy2 = Math.floor(canvas.height * 0.70);

    let skinPixels  = 0;
    let totalPixels = 0;
    for (let y = cy1; y < cy2; y += 2) {
      for (let x = cx1; x < cx2; x += 2) {
        const idx = (y * canvas.width + x) * 4;
        const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
        // Skin tone heuristic: R dominant, warm, not too dark or bright
        if (
          r > 60 && g > 40 && b > 20 &&
          r > g && r > b &&
          (r - g) > 10 &&
          r < 250 && g < 220
        ) skinPixels++;
        totalPixels++;
      }
    }
    const skinRatio   = skinPixels / Math.max(totalPixels, 1);
    const faceDetected = skinRatio > 0.06; // 6% threshold — more lenient

    // ── 3. Gaze/orientation heuristic ────────────────────────────────────
    // Compare brightness symmetry between left and right halves
    // Raised threshold significantly — lighting variation causes false positives
    let leftBrightness = 0, rightBrightness = 0, halfCount = 0;
    const midX = Math.floor(canvas.width / 2);
    for (let y = cy1; y < cy2; y += 3) {
      for (let x = cx1; x < midX; x += 3) {
        const idx = (y * canvas.width + x) * 4;
        leftBrightness += pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114;
        halfCount++;
      }
    }
    let rightCount = 0;
    for (let y = cy1; y < cy2; y += 3) {
      for (let x = midX; x < cx2; x += 3) {
        const idx = (y * canvas.width + x) * 4;
        rightBrightness += pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114;
        rightCount++;
      }
    }
    const lAvg = leftBrightness  / Math.max(halfCount, 1);
    const rAvg = rightBrightness / Math.max(rightCount, 1);
    const asymmetry    = Math.abs(lAvg - rAvg);
    // Raised from 35 → 60 to reduce false FAIL on "looking forward"
    const lookingForward = faceDetected && asymmetry < 60;

    setIntegrity(prev => {
      // Only count a violation when face *transitions* from detected → not detected
      // This prevents the counter incrementing every 800ms frame
      const newViolation = prev.faceDetected === true && !faceDetected ? 1 : 0;
      return {
        ...prev,
        faceDetected,
        lookingForward,
        goodLighting,
        violations: prev.violations + newViolation,
      };
    });
  };

  return { videoRef, canvasRef, camError, integrity };
}

// ── PDF Report Component (hidden, only visible on print) ─────────────────────
function PDFReport({ jobRole, fileName, avgScore, confidenceScores, scoreDetails, questions, integrity, resumeSkills, reportData, date }) {
  const getRatingColor = (s) => s >= 85 ? "#16a34a" : s >= 70 ? "#ca8a04" : "#dc2626";
  const getRatingLabel = (s) => s >= 85 ? "Excellent" : s >= 70 ? "Good" : "Needs Work";

  return (
    <div id="pdf-report" style={{ display: "none", fontFamily: "Georgia, serif", color: "#111", background: "#fff", padding: "0" }}>
      {/* Header */}
      <div style={{ borderBottom: "3px solid #111", paddingBottom: 16, marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>HireReady.AI</div>
            <div style={{ fontSize: 12, color: "#666", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>Interview Performance Report</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#666" }}>
            <div>{date}</div>
            <div>{jobRole}</div>
            <div style={{ fontStyle: "italic" }}>{fileName}</div>
          </div>
        </div>
      </div>

      {/* Overall score */}
      <div style={{ display: "flex", gap: 32, marginBottom: 32, alignItems: "center" }}>
        <div style={{
          width: 110, height: 110, borderRadius: "50%",
          border: `5px solid ${getRatingColor(avgScore)}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: getRatingColor(avgScore), lineHeight: 1 }}>{avgScore}</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em" }}>/ 100</div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>Overall Score</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: getRatingColor(avgScore), border: `1px solid ${getRatingColor(avgScore)}`, padding: "2px 10px", borderRadius: 100 }}>
              {getRatingLabel(avgScore)}
            </span>
          </div>
          {reportData?.summary && (
            <p style={{ fontSize: 13, color: "#444", lineHeight: 1.7, maxWidth: 460, margin: 0 }}>
              {reportData.summary}
            </p>
          )}
          {/* Stats row */}
          <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
            {[
              { v: confidenceScores.length,              l: "Questions" },
              { v: `${Math.max(...confidenceScores, 0)}%`, l: "Best Answer" },
              { v: `${Math.min(...confidenceScores, 0)}%`, l: "Lowest" },
            ].map(({ v, l }) => (
              <div key={l}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid #e5e5e5", marginBottom: 24 }} />

      {/* Question breakdown */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", marginBottom: 14 }}>
          Question-by-Question Breakdown
        </div>
        {confidenceScores.map((score, i) => {
          const detail = scoreDetails[i];
          return (
            <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < confidenceScores.length - 1 ? "1px solid #f0f0f0" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, paddingRight: 16 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Q{i + 1}</span>
                  <p style={{ fontSize: 13, color: "#222", margin: "4px 0 0", lineHeight: 1.5 }}>{questions[i]}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: getRatingColor(score) }}>{score}%</div>
                  <div style={{ fontSize: 11, color: getRatingColor(score), fontWeight: 600 }}>{getRatingLabel(score)}</div>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3, marginBottom: 8 }}>
                <div style={{ height: "100%", width: `${score}%`, background: getRatingColor(score), borderRadius: 3 }} />
              </div>
              {/* Transcript & stats if available */}
              {detail?.transcript && (
                <p style={{ fontSize: 12, color: "#666", fontStyle: "italic", lineHeight: 1.6, margin: "6px 0 0", borderLeft: "2px solid #e5e5e5", paddingLeft: 10 }}>
                  "{detail.transcript.substring(0, 200)}{detail.transcript.length > 200 ? "..." : ""}"
                </p>
              )}
              {detail?.breakdown && (
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  {[
                    { l: "Words",   v: detail.word_count },
                    { l: "WPM",     v: detail.breakdown.words_per_minute },
                    { l: "Fillers", v: detail.breakdown.filler_count },
                  ].map(({ l, v }) => (
                    <span key={l} style={{ fontSize: 11, color: "#888" }}>
                      <strong style={{ color: "#444" }}>{v ?? "—"}</strong> {l}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Integrity Report */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", marginBottom: 14 }}>
          Integrity Report
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { label: "Face Detection", ok: integrity.faceDetected !== false },
            { label: "Gaze Tracking",  ok: integrity.lookingForward !== false },
            { label: "Lighting",       ok: integrity.goodLighting !== false },
            { label: "Tab Focus",      ok: integrity.tabFocused },
          ].map(({ label, ok }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#f9f9f9", borderRadius: 6, border: "1px solid #eee" }}>
              <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: ok ? "#16a34a" : "#dc2626" }}>{ok ? "✓ PASS" : "✗ FAIL"}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #eee" }}>
          <span style={{ fontSize: 12, color: "#888" }}>Total Integrity Flags</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: integrity.violations === 0 ? "#16a34a" : integrity.violations < 4 ? "#ca8a04" : "#dc2626" }}>
            {integrity.violations === 0 ? "✓ Clean Session" : `${integrity.violations} flag${integrity.violations !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Skills detected */}
      {resumeSkills.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", marginBottom: 10 }}>
            Detected Resume Skills
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {resumeSkills.map(s => (
              <span key={s} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, border: "1px solid #ccc", color: "#444" }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "2px solid #111", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#888" }}>Generated by HireReady.AI · Confidential</span>
        <span style={{ fontSize: 11, color: "#888" }}>{date}</span>
      </div>
    </div>
  );
}

export default function HireReadyAI() {
  const [phase, setPhase]               = useState("upload");
  const [currentQ, setCurrentQ]         = useState(0);
  const [recording, setRecording]       = useState(false);
  const [timer, setTimer]               = useState(0);
  const [confidenceScores, setConfidenceScores] = useState([]);  // raw score numbers
  const [scoreDetails, setScoreDetails] = useState([]);           // full backend breakdown objects
  const [transcript, setTranscript]     = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [fileName, setFileName]         = useState("");
  const [fileObject, setFileObject]     = useState(null);         // actual File for upload
  const [jobRole, setJobRole]           = useState("Software Engineer");
  const [answeredCount, setAnsweredCount] = useState(0);
  const [micError, setMicError]         = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);

  // Backend state
  const [questions, setQuestions]       = useState(FALLBACK_QUESTIONS);
  const [backendOnline, setBackendOnline] = useState(null);       // null=checking, true, false
  const [resumeSkills, setResumeSkills] = useState([]);
  const [analyzing, setAnalyzing]       = useState(false);        // loading spinner on stop
  const [reportData, setReportData]     = useState(null);         // final backend report
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const timerRef      = useRef(null);
  const recognitionRef= useRef(null);
  const finalTextRef  = useRef("");
  const startTimeRef  = useRef(0);
  const allScoresRef  = useRef([]);                               // for report generation

  // Webcam — only active during interview phase
  const { videoRef, canvasRef, camError, integrity } = useWebcam(phase === "interview");

  // Check backend health on mount
  useEffect(() => {
    api.ping().then(online => setBackendOnline(online));
  }, []);

  // Check browser speech support
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setSpeechSupported(false);
  }, []);

  // Timer
  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Enter interview: load questions from backend ──────────────────────────
  const handleStartInterview = async () => {
    setLoadingQuestions(true);
    try {
      if (backendOnline && fileObject) {
        // Try to get resume-personalized questions
        const result = await api.parseResume(fileObject, jobRole);
        setResumeSkills(result.detected_skills || []);
        const personalizedQs = result.personalized_questions?.map(q => q.question) || [];
        if (personalizedQs.length >= 3) {
          setQuestions(personalizedQs);
        } else {
          // Fallback to role-based questions
          const roleQs = await api.getQuestions(jobRole);
          setQuestions(roleQs);
        }
      } else if (backendOnline) {
        const roleQs = await api.getQuestions(jobRole);
        setQuestions(roleQs);
      }
      // else: stay on FALLBACK_QUESTIONS
    } catch (e) {
      console.warn("Backend unavailable, using fallback questions:", e.message);
    } finally {
      setLoadingQuestions(false);
      setPhase("interview");
    }
  };

  // ── Recording ─────────────────────────────────────────────────────────────
  const handleStartRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicError("Speech recognition not supported. Please use Chrome or Edge.");
      return;
    }
    setMicError("");
    setTranscript("");
    setLiveTranscript("");
    finalTextRef.current = "";
    startTimeRef.current = Date.now();

    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = "en-US";

    recognition.onresult = (event) => {
      let interim = "", final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += text + " ";
        else interim += text;
      }
      if (final) finalTextRef.current += final;
      setLiveTranscript((finalTextRef.current + interim).trim());
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed")
        setMicError("Microphone access denied. Please allow permissions and retry.");
      else if (event.error === "no-speech")
        setMicError("No speech detected. Check your microphone.");
      else
        setMicError(`Mic error: ${event.error}. Please retry.`);
      setRecording(false);
    };

    recognition.onend = () => {
      if (recognitionRef.current && recording) {
        try { recognition.start(); } catch(e) {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setRecording(true);
      setTimer(0);
    } catch(e) {
      setMicError("Could not start microphone. Check permissions.");
    }
  };

  const handleStopRecording = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
    setAnalyzing(true);

    const finalText = (finalTextRef.current + liveTranscript).trim();
    const duration  = (Date.now() - startTimeRef.current) / 1000;

    setTranscript(finalText || "(No speech detected — please check your microphone.)");
    setLiveTranscript("");

    let score = calculateConfidence(finalText, duration);
    let detail = { confidence_score: score, rating: getRatingLabel(score), transcript: finalText, question_index: currentQ };

    // Send to backend for server-side scoring
    if (backendOnline && finalText) {
      try {
        const result = await api.analyzeText(finalText, duration, currentQ);
        score  = result.confidence_score;
        detail = result;
      } catch(e) {
        console.warn("Backend analyze failed, using local score:", e.message);
      }
    }

    setConfidenceScores(prev => [...prev, score]);
    setScoreDetails(prev => [...prev, detail]);
    allScoresRef.current = [...allScoresRef.current, detail];
    setAnsweredCount(a => a + 1);
    setAnalyzing(false);
  };

  const handleNextQuestion = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(q => q + 1);
      setTranscript("");
      setLiveTranscript("");
      setTimer(0);
      finalTextRef.current = "";
    } else {
      handleFinishInterview();
    }
  };

  const handleFinishInterview = async () => {
    setPhase("report");
    if (backendOnline && allScoresRef.current.length > 0) {
      try {
        const report = await api.generateReport(allScoresRef.current);
        setReportData(report);
      } catch(e) {
        console.warn("Report generation failed:", e.message);
      }
    }
  };

  const handleReset = () => {
    setPhase("upload"); setCurrentQ(0);
    setConfidenceScores([]); setScoreDetails([]);
    setAnsweredCount(0); setFileName(""); setFileObject(null);
    setTranscript(""); setLiveTranscript(""); setMicError("");
    setResumeSkills([]); setReportData(null);
    finalTextRef.current = ""; allScoresRef.current = [];
    setQuestions(FALLBACK_QUESTIONS);
  };

  const generatePDF = () => {
    setPdfGenerating(true);
    setTimeout(() => {
      const el = document.getElementById("pdf-report");
      if (el) el.style.display = "block";
      window.print();
      if (el) el.style.display = "none";
      setPdfGenerating(false);
    }, 120);
  };

  const avgScore = confidenceScores.length
    ? Math.round(confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length)
    : 0;

  function getRatingLabel(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    return "Needs Work";
  }

  const getRating = (score) => {
    if (score >= 85) return { label: "Excellent", color: "#00f5a0" };
    if (score >= 70) return { label: "Good",      color: "#ffd166" };
    return                  { label: "Needs Work", color: "#ef476f" };
  };

  return (
    <>
      <style>{pulseRing}</style>

      {/* Hidden PDF report — only shown on print */}
      <PDFReport
        jobRole={jobRole}
        fileName={fileName}
        avgScore={avgScore}
        confidenceScores={confidenceScores}
        scoreDetails={scoreDetails}
        questions={questions}
        integrity={integrity}
        resumeSkills={resumeSkills}
        reportData={reportData}
        date={new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      />

      <div id="app-root" style={{
        width: "100%",
        minHeight: "100vh",
        background: "#050810",
        fontFamily: "'DM Mono', 'Courier New', monospace",
        color: "#e8eaf0",
        position: "relative",
        overflowX: "hidden",
      }}>
        {/* Background grid */}
        <div style={{
          position: "fixed", inset: 0, zIndex: 0,
          backgroundImage: `
            linear-gradient(rgba(0,245,160,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,245,160,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }} />

        {/* Scanline effect */}
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "2px",
          background: "linear-gradient(90deg, transparent, rgba(0,245,160,0.15), transparent)",
          animation: "scanline 8s linear infinite",
          zIndex: 1, pointerEvents: "none",
        }} />

        {/* Header */}
        <header style={{
          position: "sticky", top: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 48px",
          height: 70,
          borderBottom: "1px solid rgba(0,245,160,0.1)",
          background: "rgba(5,8,16,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          width: "100%",
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10,
              background: "linear-gradient(135deg, #00f5a0, #00b4d8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 900, color: "#050810",
              boxShadow: "0 0 20px rgba(0,245,160,0.25)",
            }}>H</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.06em", color: "#e8eaf0", lineHeight: 1.1 }}>
                HIREREADY<span style={{ color: "#00f5a0" }}>.AI</span>
              </div>
              <div style={{ fontSize: 10, color: "rgba(232,234,240,0.3)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                Interview Simulation Platform
              </div>
            </div>
          </div>

          {/* Step progress — center */}
          <div className="header-steps" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["Upload", "Interview", "Report"].map((label, i) => {
              const p = label.toLowerCase();
              const isActive = phase === p;
              const isDone = (p === "upload" && (phase === "interview" || phase === "report")) ||
                             (p === "interview" && phase === "report");
              return (
                <div key={p} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      border: `2px solid ${isActive ? "#00f5a0" : isDone ? "rgba(0,245,160,0.4)" : "rgba(232,234,240,0.12)"}`,
                      background: isActive ? "rgba(0,245,160,0.12)" : isDone ? "rgba(0,245,160,0.06)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                      color: isActive ? "#00f5a0" : isDone ? "rgba(0,245,160,0.6)" : "rgba(232,234,240,0.25)",
                      transition: "all 0.4s ease",
                    }}>
                      {isDone ? "✓" : i + 1}
                    </div>
                    <span style={{
                      fontSize: 13, fontWeight: isActive ? 700 : 400,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      color: isActive ? "#e8eaf0" : "rgba(232,234,240,0.3)",
                      transition: "all 0.4s ease",
                    }}>{label}</span>
                  </div>
                  {i < 2 && (
                    <div style={{
                      width: 40, height: 1, margin: "0 12px",
                      background: isDone ? "rgba(0,245,160,0.3)" : "rgba(232,234,240,0.08)",
                      transition: "background 0.4s ease",
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#00f5a0",
              boxShadow: "0 0 8px rgba(0,245,160,0.6)",
              display: "inline-block",
              animation: "waveBar 2s ease-in-out infinite",
            }}/>
            <span style={{ fontSize: 12, color: "rgba(232,234,240,0.45)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Secure Mode Active
            </span>
          </div>
        </header>

        {/* PHASE: UPLOAD */}
        {phase === "upload" && (
          <div style={{
            position: "relative", zIndex: 10,
            width: "100%",
            minHeight: "calc(100vh - 70px)",
            padding: "72px 6vw 60px",
            animation: "fadeSlideIn 0.6s ease forwards",
          }}>
            <div style={{ maxWidth: 1440, margin: "0 auto" }}>

            {/* Hero */}
            <div style={{ textAlign: "center", marginBottom: 80 }}>
              {/* Badge */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 10,
                fontSize: 12, letterSpacing: "0.2em", color: "#00f5a0",
                border: "1px solid rgba(0,245,160,0.25)",
                borderRadius: 100, padding: "8px 20px", marginBottom: 32,
                background: "rgba(0,245,160,0.06)",
                boxShadow: "0 0 20px rgba(0,245,160,0.08)",
              }}>
                <span style={{ fontSize: 10 }}>✦</span> AMD SLINGSHOT 2026 HACKATHON
              </div>

              {/* Headline */}
              <h1 style={{
                fontSize: "clamp(42px, 7vw, 80px)", fontWeight: 800,
                letterSpacing: "-0.03em", lineHeight: 1.08,
                fontFamily: "'DM Serif Display', Georgia, serif",
                color: "#e8eaf0", marginBottom: 24,
              }}>
                Interview with{" "}
                <span style={{
                  background: "linear-gradient(90deg, #00f5a0, #00b4d8, #00f5a0)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  animation: "shimmer 3s linear infinite",
                }}>confidence.</span>
                <br />
                <span style={{
                  fontStyle: "italic",
                  color: "rgba(232,234,240,0.3)",
                  fontWeight: 400,
                  fontSize: "0.85em",
                }}>Land the role.</span>
              </h1>

              {/* Subtext */}
              <p style={{
                fontSize: 19, color: "rgba(232,234,240,0.5)", lineHeight: 1.75,
                maxWidth: 560, margin: "0 auto",
              }}>
                AI-powered mock interviews that adapt to your resume,
                monitor your integrity, and coach your confidence in real time.
              </p>
            </div>

            {/* Two-column layout */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 440px", gap: 28, alignItems: "start" }}>

              {/* Left: Feature cards + stats */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Feature grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {[
                    { icon: "🎙", title: "Voice Analysis",     desc: "Real-time speech-to-text with fluency & confidence scoring", color: "#00f5a0" },
                    { icon: "📷", title: "Integrity Monitor",  desc: "Camera-based presence, gaze & lighting detection", color: "#00b4d8" },
                    { icon: "🧠", title: "AI Personalization", desc: "Questions generated from your actual resume skills", color: "#a78bfa" },
                    { icon: "📊", title: "Detailed Report",    desc: "Per-question breakdown with actionable coaching tips", color: "#ffd166" },
                  ].map(({ icon, title, desc, color }) => (
                    <div key={title}
                      style={{
                        background: "rgba(232,234,240,0.02)",
                        border: "1px solid rgba(232,234,240,0.06)",
                        borderRadius: 20, padding: "26px 24px",
                        transition: "all 0.3s ease", cursor: "default",
                        position: "relative", overflow: "hidden",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.border = `1px solid ${color}30`;
                        e.currentTarget.style.background = `${color}06`;
                        e.currentTarget.style.transform = "translateY(-4px)";
                        e.currentTarget.style.boxShadow = `0 12px 40px ${color}10`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.border = "1px solid rgba(232,234,240,0.06)";
                        e.currentTarget.style.background = "rgba(232,234,240,0.02)";
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div style={{
                        width: 48, height: 48, borderRadius: 14, marginBottom: 16,
                        background: `${color}12`,
                        border: `1px solid ${color}25`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 22,
                      }}>{icon}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#e8eaf0", marginBottom: 8 }}>{title}</div>
                      <div style={{ fontSize: 13, color: "rgba(232,234,240,0.45)", lineHeight: 1.6 }}>{desc}</div>
                    </div>
                  ))}
                </div>

                {/* Stats bar */}
                <div style={{
                  background: "rgba(232,234,240,0.02)",
                  border: "1px solid rgba(232,234,240,0.06)",
                  borderRadius: 20, padding: "24px 32px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  {[
                    { n: "94%",  l: "Avg. Accuracy",  color: "#00f5a0" },
                    { n: "5",    l: "Job Roles",       color: "#00b4d8" },
                    { n: "AI",   l: "Powered",         color: "#a78bfa" },
                    { n: "Live", l: "Feedback",        color: "#ffd166" },
                  ].map(({ n, l, color }) => (
                    <div key={l} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>{n}</div>
                      <div style={{ fontSize: 12, color: "rgba(232,234,240,0.35)", marginTop: 6, letterSpacing: "0.06em" }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Setup card */}
              <div style={{
                background: "rgba(232,234,240,0.025)",
                border: "1px solid rgba(0,245,160,0.15)",
                borderRadius: 24, padding: 32,
                boxShadow: "0 0 60px rgba(0,245,160,0.04)",
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#e8eaf0", marginBottom: 6, letterSpacing: "0.01em" }}>
                  Start Your Session
                </div>
                <div style={{ fontSize: 14, color: "rgba(232,234,240,0.4)", marginBottom: 28, lineHeight: 1.6 }}>
                  Upload your resume and we'll personalize every question to your background.
                </div>

                {/* Upload area */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(232,234,240,0.4)", marginBottom: 10, textTransform: "uppercase" }}>Resume</div>
                  <div
                    onClick={() => document.getElementById("resumeInput").click()}
                    onMouseEnter={e => !fileName && (e.currentTarget.style.borderColor = "rgba(0,245,160,0.5)")}
                    onMouseLeave={e => !fileName && (e.currentTarget.style.borderColor = "rgba(0,245,160,0.2)")}
                    style={{
                      border: `2px dashed ${fileName ? "#00f5a0" : "rgba(0,245,160,0.2)"}`,
                      borderRadius: 16, padding: "32px 20px",
                      textAlign: "center", cursor: "pointer",
                      background: fileName ? "rgba(0,245,160,0.05)" : "rgba(232,234,240,0.01)",
                      transition: "all 0.25s ease",
                    }}
                  >
                    <input id="resumeInput" type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }}
                      onChange={e => {
                        const f = e.target.files[0];
                        if (f) { setFileName(f.name); setFileObject(f); }
                      }} />
                    <div style={{ fontSize: 32, marginBottom: 10 }}>{fileName ? "✅" : "📄"}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: fileName ? "#00f5a0" : "#e8eaf0", marginBottom: 4 }}>
                      {fileName || "Click to upload resume"}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(232,234,240,0.3)" }}>
                      {fileName ? "✓ Ready to go" : "PDF, DOC, DOCX — 5MB max"}
                    </div>
                  </div>
                </div>

                {/* Role selector */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(232,234,240,0.4)", marginBottom: 10, textTransform: "uppercase" }}>Target Role</div>
                  <select
                    value={jobRole}
                    onChange={e => setJobRole(e.target.value)}
                    style={{
                      width: "100%", padding: "14px 18px",
                      background: "rgba(232,234,240,0.04)",
                      border: "1px solid rgba(0,245,160,0.2)",
                      borderRadius: 12, color: "#e8eaf0",
                      fontSize: 15, outline: "none", cursor: "pointer", appearance: "none",
                    }}
                  >
                    {["Software Engineer", "Frontend Developer", "Data Scientist", "Product Manager", "DevOps Engineer"].map(r => (
                      <option key={r} value={r} style={{ background: "#0d1117" }}>{r}</option>
                    ))}
                  </select>
                </div>

                {/* Backend status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px", background: "rgba(232,234,240,0.02)", borderRadius: 10, border: "1px solid rgba(232,234,240,0.05)" }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0,
                    background: backendOnline === null ? "#ffd166" : backendOnline ? "#00f5a0" : "#ef476f",
                    boxShadow: `0 0 6px ${backendOnline ? "rgba(0,245,160,0.5)" : "rgba(239,71,111,0.4)"}`,
                  }}/>
                  <span style={{ fontSize: 12, color: "rgba(232,234,240,0.45)", letterSpacing: "0.04em" }}>
                    {backendOnline === null ? "Checking backend..." : backendOnline ? "Backend connected" : "Backend offline — fallback mode"}
                  </span>
                </div>

                {/* Begin button */}
                <button
                  onClick={handleStartInterview}
                  disabled={!fileName || loadingQuestions}
                  style={{
                    width: "100%", padding: "16px",
                    background: fileName && !loadingQuestions
                      ? "linear-gradient(135deg, #00f5a0, #00b4d8)"
                      : "rgba(232,234,240,0.05)",
                    border: "none", borderRadius: 14,
                    color: fileName && !loadingQuestions ? "#050810" : "rgba(232,234,240,0.2)",
                    fontSize: 15, fontWeight: 800, letterSpacing: "0.08em",
                    cursor: fileName && !loadingQuestions ? "pointer" : "not-allowed",
                    transition: "all 0.3s ease", textTransform: "uppercase",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    boxShadow: fileName && !loadingQuestions ? "0 4px 24px rgba(0,245,160,0.2)" : "none",
                  }}
                >
                  {loadingQuestions ? (
                    <>
                      <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(5,8,16,0.3)", borderTopColor: "#050810", animation: "spinSlow 0.8s linear infinite", display: "inline-block" }}/>
                      Personalizing Questions...
                    </>
                  ) : fileName ? "Begin Interview Session →" : "Upload Resume to Start"}
                </button>

                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(232,234,240,0.2)" }}>
                    🔒 End-to-end encrypted · Data never stored
                  </span>
                </div>
              </div>
            </div>
            </div>{/* end max-width wrapper */}
          </div>
        )}

        {/* PHASE: INTERVIEW */}
        {phase === "interview" && (
          <div className="interview-grid" style={{
            position: "relative", zIndex: 10,
            display: "grid",
            gridTemplateColumns: "1fr 380px",
            gap: 20,
            padding: "24px 32px",
            width: "100%",
            minHeight: "calc(100vh - 80px)",
            animation: "fadeSlideIn 0.5s ease forwards",
          }}>
            {/* LEFT: AI Interviewer Panel */}
            <div style={{
              background: "rgba(232,234,240,0.02)",
              border: "1px solid rgba(0,245,160,0.1)",
              borderRadius: 20,
              padding: "32px",
              display: "flex", flexDirection: "column",
              gap: 24,
            }}>
              {/* Progress */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em" }}>
                  QUESTION {currentQ + 1} OF {questions.length}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {questions.map((_, i) => (
                    <div key={i} style={{
                      width: 32, height: 5, borderRadius: 2,
                      background: i < answeredCount ? "#00f5a0" : i === currentQ ? "rgba(0,245,160,0.4)" : "rgba(232,234,240,0.1)",
                      transition: "all 0.3s ease",
                    }} />
                  ))}
                </div>
              </div>

              {/* Avatar */}
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ position: "relative" }}>
                  {recording && (
                    <div style={{
                      position: "absolute", inset: -10, borderRadius: "50%",
                      border: "2px solid rgba(0,245,160,0.5)",
                      animation: "pulseRing 1.5s ease-out infinite",
                    }} />
                  )}
                  <div style={{
                    width: 80, height: 80, borderRadius: "50%",
                    background: "linear-gradient(135deg, #0d1f2d, #1a2a3a)",
                    border: `2px solid ${recording ? "#00f5a0" : "rgba(0,245,160,0.25)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 32,
                    animation: "avatarFloat 3s ease-in-out infinite",
                    boxShadow: recording ? "0 0 24px rgba(0,245,160,0.2)" : "none",
                    transition: "border 0.3s, box-shadow 0.3s",
                  }}>🤖</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#e8eaf0" }}>Alex Chen</div>
                  <div style={{ fontSize: 14, color: recording ? "#00f5a0" : "rgba(232,234,240,0.4)", letterSpacing: "0.08em", transition: "color 0.3s" }}>
                    {recording ? "● LISTENING..." : "AI INTERVIEWER"}
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(232,234,240,0.3)", marginTop: 3 }}>{jobRole} Interview</div>
                </div>
              </div>

              {/* Question */}
              <div style={{
                background: "rgba(0,245,160,0.03)",
                border: "1px solid rgba(0,245,160,0.1)",
                borderRadius: 18, padding: "28px 28px",
                flex: 1,
              }}>
                <div style={{ fontSize: 11, color: "#00f5a0", letterSpacing: "0.2em", marginBottom: 16, textTransform: "uppercase" }}>
                  Question {currentQ + 1}
                </div>
                <p style={{
                  fontSize: 22, lineHeight: 1.65,
                  color: "#e8eaf0",
                  fontFamily: "'DM Serif Display', Georgia, serif",
                  margin: 0,
                }}>
                  "{questions[currentQ]}"
                </p>
              </div>

              {/* Browser not supported warning */}
              {!speechSupported && (
                <div style={{
                  background: "rgba(239,71,111,0.08)", border: "1px solid rgba(239,71,111,0.3)",
                  borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#ef476f",
                }}>
                  ⚠ Web Speech API not supported. Please use <strong>Chrome</strong> or <strong>Edge</strong> for voice recording.
                </div>
              )}

              {/* Mic error */}
              {micError && (
                <div style={{
                  background: "rgba(239,71,111,0.08)", border: "1px solid rgba(239,71,111,0.3)",
                  borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#ef476f",
                }}>
                  ⚠ {micError}
                </div>
              )}

              {/* Wave visualization + live transcript */}
              {recording && (
                <div style={{
                  background: "rgba(0,245,160,0.03)", border: "1px solid rgba(0,245,160,0.1)",
                  borderRadius: 12, padding: 16,
                }}>
                  {/* Waveform + timer */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", height: 32, marginBottom: 12 }}>
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} style={{
                        width: 4, borderRadius: 2,
                        background: "#00f5a0",
                        animation: `waveBar ${0.4 + (i % 5) * 0.12}s ease-in-out infinite`,
                        animationDelay: `${i * 0.05}s`,
                        opacity: 0.5 + (i % 3) * 0.2,
                      }} />
                    ))}
                    <span style={{ fontSize: 12, color: "rgba(232,234,240,0.5)", marginLeft: 12, fontVariantNumeric: "tabular-nums" }}>
                      {formatTime(timer)}
                    </span>
                  </div>
                  {/* Live transcript */}
                  <div style={{ fontSize: 13, color: "rgba(232,234,240,0.55)", lineHeight: 1.65, minHeight: 20 }}>
                    <span style={{ color: "rgba(0,245,160,0.5)", fontSize: 10, letterSpacing: "0.12em", marginRight: 8 }}>LIVE ●</span>
                    {liveTranscript || <span style={{ opacity: 0.3, fontStyle: "italic" }}>Listening... start speaking</span>}
                  </div>
                </div>
              )}

              {/* Final transcript after stopping */}
              {transcript && !recording && (
                <div style={{
                  background: "rgba(232,234,240,0.03)",
                  borderRadius: 10, padding: 16,
                  fontSize: 13, color: "rgba(232,234,240,0.6)",
                  lineHeight: 1.65,
                  borderLeft: "3px solid rgba(0,245,160,0.4)",
                  maxHeight: 160, overflowY: "auto",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ color: "rgba(0,245,160,0.6)", fontSize: 10, letterSpacing: "0.12em" }}>TRANSCRIPT</span>
                    <span style={{ fontSize: 11, color: confidenceScores.length ? getRating(confidenceScores[confidenceScores.length - 1]).color : "#fff", fontWeight: 700 }}>
                      {confidenceScores.length ? `${confidenceScores[confidenceScores.length - 1]}% Confidence` : ""}
                    </span>
                  </div>
                  <p style={{ marginBottom: 10 }}>{transcript}</p>
                  {/* Show backend breakdown if available */}
                  {scoreDetails.length > 0 && scoreDetails[scoreDetails.length - 1]?.breakdown && (
                    <div style={{ display: "flex", gap: 12, paddingTop: 8, borderTop: "1px solid rgba(232,234,240,0.06)", flexWrap: "wrap" }}>
                      {[
                        { label: "WPM", value: scoreDetails[scoreDetails.length - 1].breakdown.words_per_minute },
                        { label: "Words", value: scoreDetails[scoreDetails.length - 1].word_count },
                        { label: "Fillers", value: scoreDetails[scoreDetails.length - 1].breakdown.filler_count },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ fontSize: 11, color: "rgba(232,234,240,0.35)" }}>
                          <span style={{ color: "rgba(232,234,240,0.6)", fontWeight: 600 }}>{value ?? "—"}</span> {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Controls */}
              <div style={{ display: "flex", gap: 12 }}>
                {!recording ? (
                  <button onClick={handleStartRecording} style={{
                    flex: 1, padding: "14px",
                    background: "linear-gradient(135deg, #00f5a0, #00b4d8)",
                    border: "none", borderRadius: 12,
                    color: "#050810", fontSize: 13, fontWeight: 700,
                    cursor: "pointer", letterSpacing: "0.08em",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    🎙 START ANSWERING
                  </button>
                ) : (
                  <button onClick={handleStopRecording} disabled={analyzing} style={{
                    flex: 1, padding: "14px",
                    background: analyzing ? "rgba(232,234,240,0.06)" : "rgba(239,71,111,0.15)",
                    border: `1px solid ${analyzing ? "rgba(232,234,240,0.1)" : "rgba(239,71,111,0.4)"}`,
                    borderRadius: 12,
                    color: analyzing ? "rgba(232,234,240,0.4)" : "#ef476f",
                    fontSize: 13, fontWeight: 700,
                    cursor: analyzing ? "not-allowed" : "pointer", letterSpacing: "0.08em",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    {analyzing
                      ? <><span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(232,234,240,0.2)", borderTopColor: "#e8eaf0", animation: "spinSlow 0.8s linear infinite", display: "inline-block" }}/> ANALYZING...</>
                      : "⏹ STOP RECORDING"
                    }
                  </button>
                )}
                {(transcript || answeredCount > currentQ) && (
                  <button onClick={handleNextQuestion} style={{
                    padding: "14px 20px",
                    background: "rgba(232,234,240,0.06)",
                    border: "1px solid rgba(232,234,240,0.12)",
                    borderRadius: 12,
                    color: "#e8eaf0", fontSize: 13, fontWeight: 600,
                    cursor: "pointer",
                  }}>
                    {currentQ < questions.length - 1 ? "NEXT →" : "FINISH ✓"}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT: Camera & Stats Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Camera Feed */}
              <div style={{
                background: "rgba(232,234,240,0.02)",
                border: `1px solid ${integrity.faceDetected === false ? "rgba(239,71,111,0.3)" : "rgba(0,245,160,0.1)"}`,
                borderRadius: 16, padding: 16, flex: 1,
                transition: "border-color 0.4s ease",
              }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em" }}>
                    CAMERA FEED
                  </div>
                  {camError ? (
                    <span style={{ fontSize: 10, color: "#ef476f", fontWeight: 700 }}>⚠ ERROR</span>
                  ) : integrity.faceDetected === null ? (
                    <span style={{ fontSize: 10, color: "rgba(232,234,240,0.3)" }}>STARTING...</span>
                  ) : (
                    <span style={{ fontSize: 10, color: "#00f5a0", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00f5a0", display: "inline-block", animation: "waveBar 1s ease-in-out infinite" }}/>
                      LIVE
                    </span>
                  )}
                </div>

                {/* Video element */}
                <div style={{
                  width: "100%", aspectRatio: "4/3", borderRadius: 10,
                  background: "linear-gradient(145deg, #0d1117, #1a2332)",
                  position: "relative", overflow: "hidden",
                  border: "1px solid rgba(0,245,160,0.08)",
                }}>
                  {camError ? (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span style={{ fontSize: 28 }}>📷</span>
                      <span style={{ fontSize: 11, color: "#ef476f", textAlign: "center", padding: "0 12px" }}>{camError}</span>
                    </div>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay playsInline muted
                        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" /* mirror */ }}
                      />
                      {/* Hidden canvas for analysis */}
                      <canvas ref={canvasRef} style={{ display: "none" }} />

                      {/* Corner brackets overlay */}
                      {[
                        { top: 8, left: 8,   borderLeft: "2px solid #00f5a0", borderTop: "2px solid #00f5a0" },
                        { top: 8, right: 8,  borderRight: "2px solid #00f5a0", borderTop: "2px solid #00f5a0" },
                        { bottom: 8, left: 8,  borderLeft: "2px solid #00f5a0", borderBottom: "2px solid #00f5a0" },
                        { bottom: 8, right: 8, borderRight: "2px solid #00f5a0", borderBottom: "2px solid #00f5a0" },
                      ].map((s, i) => (
                        <div key={i} style={{ position: "absolute", width: 16, height: 16, ...s, transition: "border-color 0.3s" }} />
                      ))}

                      {/* Face not detected warning overlay */}
                      {integrity.faceDetected === false && (
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "rgba(239,71,111,0.12)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          animation: "fadeSlideIn 0.3s ease",
                        }}>
                          <span style={{ fontSize: 11, color: "#ef476f", fontWeight: 700, letterSpacing: "0.1em", background: "rgba(5,8,16,0.8)", padding: "6px 12px", borderRadius: 6 }}>
                            ⚠ FACE NOT DETECTED
                          </span>
                        </div>
                      )}

                      {/* Tab away warning */}
                      {!integrity.tabFocused && (
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "rgba(239,71,111,0.15)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <span style={{ fontSize: 11, color: "#ef476f", fontWeight: 700, letterSpacing: "0.08em", background: "rgba(5,8,16,0.85)", padding: "6px 12px", borderRadius: 6 }}>
                            ⚠ TAB SWITCH DETECTED
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Integrity indicators */}
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Face Detected",   ok: integrity.faceDetected,   pending: integrity.faceDetected === null },
                    { label: "Looking Forward", ok: integrity.lookingForward,  pending: integrity.lookingForward === null },
                    { label: "Good Lighting",   ok: integrity.goodLighting,    pending: integrity.goodLighting === null },
                    { label: "Tab Focused",     ok: integrity.tabFocused,      pending: false },
                  ].map(({ label, ok, pending }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: "rgba(232,234,240,0.45)" }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: pending ? "rgba(232,234,240,0.25)" : ok ? "#00f5a0" : "#ef476f", transition: "color 0.4s" }}>
                        {pending ? "—" : ok ? "✓ OK" : "✗ FAIL"}
                      </span>
                    </div>
                  ))}
                  {integrity.violations > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid rgba(232,234,240,0.06)" }}>
                      <span style={{ fontSize: 13, color: "rgba(232,234,240,0.35)" }}>Integrity Flags</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: integrity.violations > 3 ? "#ef476f" : "#ffd166" }}>
                        {integrity.violations}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Confidence scores */}
              <div style={{
                background: "rgba(232,234,240,0.02)",
                border: "1px solid rgba(0,245,160,0.1)",
                borderRadius: 16, padding: 16,
              }}>
                <div style={{ fontSize: 13, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em", marginBottom: 12 }}>
                  CONFIDENCE SCORES
                </div>
                {confidenceScores.length === 0 ? (
                  <div style={{ fontSize: 14, color: "rgba(232,234,240,0.25)", textAlign: "center", padding: "12px 0" }}>
                    No answers yet
                  </div>
                ) : (
                  confidenceScores.map((score, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: "rgba(232,234,240,0.45)" }}>Q{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: getRating(score).color }}>{score}%</span>
                      </div>
                      <div style={{ height: 4, background: "rgba(232,234,240,0.08)", borderRadius: 2 }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${score}%`,
                          background: getRating(score).color,
                          transition: "width 0.8s ease",
                        }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* PHASE: REPORT */}
        {phase === "report" && (
          <div style={{
            position: "relative", zIndex: 10,
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "40px 32px",
            animation: "fadeSlideIn 0.6s ease forwards",
          }}>
            <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#00f5a0", marginBottom: 16 }}>
              INTERVIEW COMPLETE
            </div>
            <h1 style={{
              fontSize: "clamp(24px, 4vw, 44px)", fontWeight: 800,
              fontFamily: "'DM Serif Display', Georgia, serif",
              marginBottom: 8, textAlign: "center",
            }}>
              Your Interview Report
            </h1>
            <p style={{ color: "rgba(232,234,240,0.4)", fontSize: 14, marginBottom: 16 }}>
              {jobRole} · {questions.length} Questions · {fileName}
            </p>

            {/* Resume skills detected */}
            {resumeSkills.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 24 }}>
                {resumeSkills.slice(0, 8).map(skill => (
                  <span key={skill} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "rgba(0,245,160,0.06)", border: "1px solid rgba(0,245,160,0.15)", color: "#00f5a0" }}>
                    {skill}
                  </span>
                ))}
              </div>
            )}

            {/* Backend summary if available */}
            {reportData?.summary && (
              <div style={{ maxWidth: 600, marginBottom: 24, padding: "14px 18px", background: "rgba(0,245,160,0.04)", border: "1px solid rgba(0,245,160,0.12)", borderRadius: 12, fontSize: 14, color: "rgba(232,234,240,0.65)", lineHeight: 1.65, textAlign: "center" }}>
                {reportData.summary}
              </div>
            )}

            {/* Big score */}
            <div style={{
              width: 160, height: 160, borderRadius: "50%",
              border: `4px solid ${getRating(avgScore).color}`,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: `radial-gradient(circle, ${getRating(avgScore).color}10, transparent)`,
              marginBottom: 32,
              animation: "scoreCount 0.8s ease forwards",
              boxShadow: `0 0 40px ${getRating(avgScore).color}30`,
            }}>
              <div style={{ fontSize: 48, fontWeight: 800, color: getRating(avgScore).color, lineHeight: 1 }}>
                {avgScore}
              </div>
              <div style={{ fontSize: 11, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em" }}>CONFIDENCE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: getRating(avgScore).color, marginTop: 4 }}>
                {getRating(avgScore).label}
              </div>
            </div>

            {/* Per-question breakdown */}
            <div style={{
              width: "100%", maxWidth: 600,
              background: "rgba(232,234,240,0.02)",
              border: "1px solid rgba(0,245,160,0.1)",
              borderRadius: 16, padding: 24, marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em", marginBottom: 16 }}>
                QUESTION BREAKDOWN
              </div>
              {confidenceScores.map((score, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "rgba(232,234,240,0.65)", maxWidth: "80%" }}>
                      Q{i + 1}: {questions[i]?.substring(0, 60)}...
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: getRating(score).color,
                      background: `${getRating(score).color}15`,
                      padding: "2px 8px", borderRadius: 20,
                    }}>{score}% · {getRating(score).label}</span>
                  </div>
                  <div style={{ height: 6, background: "rgba(232,234,240,0.06)", borderRadius: 3 }}>
                    <div style={{
                      height: "100%", width: `${score}%`,
                      borderRadius: 3, background: getRating(score).color,
                      transition: "width 1s ease",
                    }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Integrity Summary */}
            <div style={{
              width: "100%", maxWidth: 600,
              background: integrity.violations > 3 ? "rgba(239,71,111,0.04)" : "rgba(232,234,240,0.02)",
              border: `1px solid ${integrity.violations > 3 ? "rgba(239,71,111,0.2)" : "rgba(0,245,160,0.1)"}`,
              borderRadius: 16, padding: 24, marginBottom: 24,
            }}>
              <div style={{ fontSize: 11, color: "rgba(232,234,240,0.4)", letterSpacing: "0.1em", marginBottom: 16 }}>
                INTEGRITY REPORT
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "Face Detection", ok: integrity.faceDetected !== false },
                  { label: "Gaze Tracking",  ok: integrity.lookingForward !== false },
                  { label: "Lighting",       ok: integrity.goodLighting !== false },
                  { label: "Tab Focus",      ok: integrity.tabFocused },
                ].map(({ label, ok }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "rgba(232,234,240,0.02)", borderRadius: 8 }}>
                    <span style={{ fontSize: 12, color: "rgba(232,234,240,0.5)" }}>{label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: ok ? "#00f5a0" : "#ef476f" }}>
                      {ok ? "✓ PASS" : "✗ FAIL"}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid rgba(232,234,240,0.06)" }}>
                <span style={{ fontSize: 12, color: "rgba(232,234,240,0.4)" }}>Total Integrity Flags</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: integrity.violations === 0 ? "#00f5a0" : integrity.violations < 4 ? "#ffd166" : "#ef476f" }}>
                  {integrity.violations === 0 ? "✓ Clean Session" : `${integrity.violations} flag${integrity.violations > 1 ? "s" : ""} detected`}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={handleReset}
                style={{
                  padding: "14px 32px",
                  background: "linear-gradient(135deg, #00f5a0, #00b4d8)",
                  border: "none", borderRadius: 50,
                  color: "#050810", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", letterSpacing: "0.08em",
                }}>
                NEW INTERVIEW
              </button>
              <button
                onClick={generatePDF}
                disabled={pdfGenerating}
                style={{
                  padding: "14px 32px",
                  background: pdfGenerating ? "rgba(232,234,240,0.04)" : "transparent",
                  border: "1px solid rgba(0,245,160,0.3)",
                  borderRadius: 50, color: "#00f5a0",
                  fontSize: 13, fontWeight: 600, cursor: pdfGenerating ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
                }}>
                {pdfGenerating
                  ? <><span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(0,245,160,0.2)", borderTopColor: "#00f5a0", animation: "spinSlow 0.8s linear infinite", display: "inline-block" }}/> Generating...</>
                  : "⬇ DOWNLOAD PDF"
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
