from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Optional
import speech_recognition as sr
import tempfile
import os
import math

router = APIRouter()


def calculate_confidence_score(
    transcript: str,
    duration_seconds: float,
    word_count: int
) -> dict:
    """
    Calculate a confidence score based on:
    - Answer length (word count)
    - Speaking duration
    - Words per minute (speaking pace)
    - Filler word detection
    - Sentence complexity estimate
    """

    # --- Base score from word count ---
    # 50-150 words is ideal for an interview answer
    if word_count < 10:
        length_score = 20
    elif word_count < 30:
        length_score = 45
    elif word_count < 50:
        length_score = 65
    elif word_count <= 150:
        length_score = 90
    elif word_count <= 250:
        length_score = 75  # too long is also penalized
    else:
        length_score = 55

    # --- Pace score (words per minute) ---
    # Ideal interview pace: 120-160 WPM
    if duration_seconds > 0:
        wpm = (word_count / duration_seconds) * 60
    else:
        wpm = 0

    if 120 <= wpm <= 160:
        pace_score = 100
    elif 90 <= wpm < 120 or 160 < wpm <= 190:
        pace_score = 80
    elif 60 <= wpm < 90 or 190 < wpm <= 220:
        pace_score = 60
    else:
        pace_score = 40

    # --- Filler word penalty ---
    filler_words = ["um", "uh", "like", "you know", "basically", "literally", "actually", "so so", "kinda"]
    filler_count = sum(transcript.lower().count(fw) for fw in filler_words)
    filler_penalty = min(filler_count * 3, 20)  # max -20 points

    # --- Final weighted score ---
    raw_score = (length_score * 0.5) + (pace_score * 0.5) - filler_penalty
    final_score = max(10, min(100, round(raw_score)))

    # --- Rating label ---
    if final_score >= 85:
        rating = "Excellent"
    elif final_score >= 70:
        rating = "Good"
    elif final_score >= 50:
        rating = "Average"
    else:
        rating = "Needs Improvement"

    return {
        "confidence_score": final_score,
        "rating": rating,
        "breakdown": {
            "length_score": length_score,
            "pace_score": pace_score,
            "filler_penalty": filler_penalty,
            "words_per_minute": round(wpm, 1),
            "filler_count": filler_count,
        }
    }


@router.post("/audio")
async def analyze_audio(
    audio: UploadFile = File(...),
    duration: Optional[float] = Form(default=0.0),
    question_index: Optional[int] = Form(default=0),
):
    """
    Accept an audio file, transcribe it, calculate confidence score.
    Accepts: WAV, WebM, MP3, OGG
    """

    # Save uploaded audio to temp file
    suffix = os.path.splitext(audio.filename)[1] if audio.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    transcript = ""
    word_count = 0

    try:
        recognizer = sr.Recognizer()

        # Convert to WAV if needed using SpeechRecognition's AudioFile
        with sr.AudioFile(tmp_path) as source:
            audio_data = recognizer.record(source)

        # Use Google's free speech recognition
        transcript = recognizer.recognize_google(audio_data)
        word_count = len(transcript.split())

    except sr.UnknownValueError:
        transcript = ""
        word_count = 0
    except sr.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Speech recognition service unavailable: {str(e)}")
    except Exception as e:
        # If audio format isn't supported, return partial result
        transcript = ""
        word_count = 0
    finally:
        os.unlink(tmp_path)

    # Calculate confidence
    confidence_data = calculate_confidence_score(
        transcript=transcript,
        duration_seconds=duration,
        word_count=word_count
    )

    return {
        "question_index": question_index,
        "transcript": transcript,
        "word_count": word_count,
        "duration_seconds": duration,
        **confidence_data
    }


@router.post("/text")
async def analyze_text(
    transcript: str = Form(...),
    duration: float = Form(default=30.0),
    question_index: int = Form(default=0),
):
    """
    Analyze already-transcribed text (for Web Speech API integration).
    Use this when transcription is done in the browser.
    """
    word_count = len(transcript.split())

    confidence_data = calculate_confidence_score(
        transcript=transcript,
        duration_seconds=duration,
        word_count=word_count
    )

    return {
        "question_index": question_index,
        "transcript": transcript,
        "word_count": word_count,
        "duration_seconds": duration,
        **confidence_data
    }


@router.post("/report")
async def generate_report(scores: list[dict]):
    """
    Generate a final interview report from a list of per-question scores.
    Expects: [{"question_index": 0, "confidence_score": 82, "transcript": "...", ...}, ...]
    """
    if not scores:
        raise HTTPException(status_code=400, detail="No scores provided.")

    avg_score = round(sum(s["confidence_score"] for s in scores) / len(scores))

    if avg_score >= 85:
        overall_rating = "Excellent"
        summary = "Outstanding performance! You demonstrated strong communication, clarity, and confidence throughout the interview."
    elif avg_score >= 70:
        overall_rating = "Good"
        summary = "Solid performance overall. You showed good communication skills with some room to improve depth and fluency."
    elif avg_score >= 50:
        overall_rating = "Average"
        summary = "Decent attempt. Focus on reducing filler words, increasing answer depth, and maintaining a steady speaking pace."
    else:
        overall_rating = "Needs Improvement"
        summary = "Keep practicing! Work on structuring your answers using the STAR method and building confidence in delivery."

    # Find strongest and weakest answer
    best = max(scores, key=lambda x: x["confidence_score"])
    worst = min(scores, key=lambda x: x["confidence_score"])

    return {
        "overall_score": avg_score,
        "overall_rating": overall_rating,
        "summary": summary,
        "total_questions": len(scores),
        "best_answer": {"question_index": best["question_index"], "score": best["confidence_score"]},
        "weakest_answer": {"question_index": worst["question_index"], "score": worst["confidence_score"]},
        "per_question": scores,
    }
