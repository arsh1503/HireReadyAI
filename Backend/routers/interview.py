from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter()

# Question bank per role
QUESTION_BANK = {
    "Software Engineer": [
        "Tell me about yourself and your software engineering background.",
        "Describe a challenging technical problem you solved recently.",
        "How do you ensure code quality in your projects?",
        "Explain the difference between REST and GraphQL APIs.",
        "How do you approach system design for a scalable application?",
        "Describe your experience with version control and CI/CD pipelines.",
        "How do you handle disagreements with your team about technical decisions?",
        "Where do you see yourself in 5 years as an engineer?",
    ],
    "Frontend Developer": [
        "Tell me about your experience with React or other frontend frameworks.",
        "How do you optimize a slow-loading web page?",
        "Explain the difference between CSS Grid and Flexbox.",
        "How do you handle state management in large applications?",
        "Describe a complex UI you've built from scratch.",
        "How do you ensure accessibility in your web projects?",
        "What is your approach to responsive design?",
        "How do you stay up to date with frontend trends?",
    ],
    "Data Scientist": [
        "Walk me through a machine learning project you've worked on.",
        "How do you handle missing data in a dataset?",
        "Explain the difference between supervised and unsupervised learning.",
        "How do you evaluate a model's performance?",
        "Describe your experience with Python data libraries like pandas or NumPy.",
        "What is overfitting and how do you prevent it?",
        "How would you explain a complex model to a non-technical stakeholder?",
        "Describe your experience with data visualization.",
    ],
    "Product Manager": [
        "Tell me about a product you successfully launched.",
        "How do you prioritize features in a product roadmap?",
        "Describe how you gather and analyze user feedback.",
        "How do you handle conflicts between engineering and business needs?",
        "Walk me through how you define product requirements.",
        "How do you measure the success of a product feature?",
        "Describe a time you made a data-driven product decision.",
        "Where do you see the future of this product going?",
    ],
    "DevOps Engineer": [
        "Describe your experience with containerization tools like Docker or Kubernetes.",
        "How do you design a CI/CD pipeline from scratch?",
        "What strategies do you use for monitoring and alerting?",
        "How do you handle infrastructure as code?",
        "Describe a production incident you resolved and how you handled it.",
        "How do you ensure security in a cloud environment?",
        "What is your approach to disaster recovery planning?",
        "How do you balance speed and stability in deployments?",
    ],
}

DEFAULT_QUESTIONS = QUESTION_BANK["Software Engineer"]


@router.get("/questions")
def get_questions(role: Optional[str] = Query(default="Software Engineer")):
    """Return interview questions for a given job role."""
    questions = QUESTION_BANK.get(role, DEFAULT_QUESTIONS)
    return {
        "role": role,
        "total": len(questions),
        "questions": questions
    }


@router.get("/question/{index}")
def get_single_question(
    index: int,
    role: Optional[str] = Query(default="Software Engineer")
):
    """Return a single question by index."""
    questions = QUESTION_BANK.get(role, DEFAULT_QUESTIONS)

    if index < 0 or index >= len(questions):
        return JSONResponse(
            status_code=404,
            content={"error": f"Question index {index} out of range. Total: {len(questions)}"}
        )

    return {
        "role": role,
        "index": index,
        "total": len(questions),
        "question": questions[index],
        "is_last": index == len(questions) - 1,
    }


@router.get("/roles")
def get_roles():
    """Return all available job roles."""
    return {"roles": list(QUESTION_BANK.keys())}
