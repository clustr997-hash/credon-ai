import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.knowledge_store import detect_query_subject

tests = [
    "What is Newton's second law of motion?",
    "Solve the integral of x^2 dx",
    "Explain DNA replication",
    "What is polymorphism in OOP?",
    "Hello how are you?",
    "What is momentum?",
    "Explain thermodynamics entropy",
    "Binary search algorithm complexity",
    "What is photosynthesis?",
    "Solve quadratic equation",
]
for t in tests:
    print(f"  {t:55s} -> {detect_query_subject(t)}")
