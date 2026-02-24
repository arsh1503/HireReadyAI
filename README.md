# HireReady AI — Backend Setup

## 1. Install dependencies
```bash
pip install -r requirements.txt
```

## 2. Run the server
```bash
python main.py
```
Server starts at: http://localhost:8000

## 3. API Docs (auto-generated)
Open in browser: http://localhost:8000/docs

---

## API Endpoints

### 🎯 Interview Questions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/interview/questions?role=Software Engineer` | Get all questions for a role |
| GET | `/interview/question/{index}?role=Software Engineer` | Get single question by index |
| GET | `/interview/roles` | List all available roles |

### 🎙 Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analyze/audio` | Upload audio → get transcript + confidence score |
| POST | `/analyze/text` | Send transcript text → get confidence score |
| POST | `/analyze/report` | Send all scores → get full interview report |

### 📄 Resume
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/resume/parse` | Upload resume → extract skills |
| POST | `/resume/questions` | Upload resume + role → get personalized questions |

---

## Connecting to React Frontend

In your React app, set the base URL:
```js
const API_BASE = "http://localhost:8000";

// Example: fetch questions
const res = await fetch(`${API_BASE}/interview/questions?role=Software Engineer`);
const data = await res.json();

// Example: analyze text answer
const form = new FormData();
form.append("transcript", "My answer here...");
form.append("duration", "45");
form.append("question_index", "0");
const res = await fetch(`${API_BASE}/analyze/text`, { method: "POST", body: form });
```

# 👨‍💻 Author

**Arsh Gupta**

AMD Slingshot Hackathon 2026

---

# 🏆 Hackathon Submission

This project was built for the **AMD Slingshot Hackathon 2026**.

---

# ⭐ If you like this project, please star the repo!
