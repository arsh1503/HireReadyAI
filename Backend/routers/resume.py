from fastapi import APIRouter, UploadFile, File, HTTPException
import tempfile
import os
import re

router = APIRouter()

# Skill keyword database
TECH_SKILLS = [
    # Languages
    "python", "javascript", "typescript", "java", "c++", "c#", "go", "rust",
    "ruby", "php", "swift", "kotlin", "scala", "r", "matlab",
    # Frontend
    "react", "vue", "angular", "next.js", "tailwind", "html", "css", "sass",
    "redux", "graphql", "webpack",
    # Backend
    "fastapi", "django", "flask", "node.js", "express", "spring", "rails",
    "rest api", "microservices",
    # Data / ML
    "pandas", "numpy", "tensorflow", "pytorch", "scikit-learn", "keras",
    "machine learning", "deep learning", "nlp", "computer vision",
    "data science", "sql", "postgresql", "mysql", "mongodb", "redis",
    # DevOps / Cloud
    "docker", "kubernetes", "aws", "gcp", "azure", "ci/cd", "jenkins",
    "github actions", "terraform", "linux", "git",
    # Other
    "agile", "scrum", "jira", "figma", "adobe xd",
]

SOFT_SKILLS = [
    "leadership", "communication", "teamwork", "problem solving",
    "critical thinking", "time management", "collaboration", "mentoring",
    "public speaking", "project management",
]


def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF using PyPDF2."""
    try:
        import PyPDF2
        text = ""
        with open(file_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() or ""
        return text
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {str(e)}")


def extract_text_from_docx(file_path: str) -> str:
    """Extract text from DOCX using python-docx."""
    try:
        import docx
        doc = docx.Document(file_path)
        return "\n".join([para.text for para in doc.paragraphs])
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read DOCX: {str(e)}")


def extract_skills(text: str) -> dict:
    """Scan text and return matched tech and soft skills."""
    text_lower = text.lower()

    found_tech = [skill for skill in TECH_SKILLS if skill in text_lower]
    found_soft = [skill for skill in SOFT_SKILLS if skill in text_lower]

    return {
        "technical": found_tech,
        "soft": found_soft,
        "all": found_tech + found_soft,
    }


def extract_experience_years(text: str) -> int:
    """Try to extract years of experience mentioned in resume."""
    patterns = [
        r"(\d+)\+?\s*years? of experience",
        r"(\d+)\+?\s*years? experience",
        r"experience\s*[:of]*\s*(\d+)\+?\s*years?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text.lower())
        if match:
            return int(match.group(1))
    return 0


def generate_personalized_questions(skills: list, role: str) -> list:
    """Generate skill-specific interview questions based on extracted resume skills."""
    questions = []

    skill_questions = {
        "python": "Can you walk me through a Python project where you used advanced features like decorators or async programming?",
        "react": "How have you managed complex state in a large React application?",
        "machine learning": "Describe a machine learning model you built end to end — from data to deployment.",
        "docker": "How have you used Docker in your development or deployment workflow?",
        "sql": "Can you explain a time you optimized a slow SQL query?",
        "aws": "What AWS services have you used and what were the use cases?",
        "leadership": "Tell me about a time you led a team through a difficult project.",
        "typescript": "How has TypeScript improved the quality of your JavaScript projects?",
        "fastapi": "Describe an API you built with FastAPI. What design decisions did you make?",
        "django": "What's your approach to structuring a Django project for scalability?",
        "kubernetes": "How have you used Kubernetes to manage containerized applications?",
        "tensorflow": "Walk me through a neural network you trained using TensorFlow.",
        "communication": "Give an example of how you communicated a complex technical concept to a non-technical stakeholder.",
    }

    # Add personalized questions for matched skills
    for skill in skills[:5]:  # Limit to top 5 skills
        if skill in skill_questions:
            questions.append({
                "skill": skill,
                "question": skill_questions[skill],
                "type": "skill-specific"
            })

    # Always add role-level question
    questions.append({
        "skill": "general",
        "question": f"What excites you most about this {role} role, and what unique value do you bring?",
        "type": "motivational"
    })

    return questions


@router.post("/parse")
async def parse_resume(file: UploadFile = File(...)):
    """
    Upload a resume (PDF or DOCX), extract skills, and generate personalized questions.
    """

    filename = file.filename or "resume"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in [".pdf", ".docx", ".doc", ".txt"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload PDF, DOCX, or TXT."
        )

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Extract text based on file type
        if ext == ".pdf":
            text = extract_text_from_pdf(tmp_path)
        elif ext in [".docx", ".doc"]:
            text = extract_text_from_docx(tmp_path)
        else:
            with open(tmp_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
    finally:
        os.unlink(tmp_path)

    if not text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from resume. Is it a scanned image?")

    # Analyze
    skills = extract_skills(text)
    experience_years = extract_experience_years(text)

    return {
        "filename": filename,
        "skills": skills,
        "experience_years": experience_years,
        "text_preview": text[:300] + "..." if len(text) > 300 else text,
        "skill_count": len(skills["all"]),
    }


@router.post("/questions")
async def get_resume_questions(
    file: UploadFile = File(...),
    role: str = "Software Engineer"
):
    """
    Parse resume and return personalized interview questions.
    """
    # Re-use parse logic
    parse_result = await parse_resume(file)
    skills = parse_result["skills"]["all"]

    personalized_questions = generate_personalized_questions(skills, role)

    return {
        "role": role,
        "detected_skills": skills[:10],
        "personalized_questions": personalized_questions,
        "total_questions": len(personalized_questions),
    }
