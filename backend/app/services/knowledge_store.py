from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable, cast

try:
    import firebase_admin  # type: ignore[import-untyped]
    from firebase_admin import credentials, firestore  # type: ignore[import-untyped]
except Exception:
    firebase_admin = None  # type: ignore[assignment]
    credentials = None  # type: ignore[assignment]
    firestore = None  # type: ignore[assignment]

try:
    import psycopg  # type: ignore[import-untyped]
    from psycopg.rows import dict_row  # type: ignore[import-untyped]
except Exception:
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]

from app.services.models import generate_embedding

_STORE_LOCK = Lock()
_LOCAL_FILE = Path(__file__).resolve().parents[2] / "data" / "knowledge_vectors.json"
_LOCAL_CHUNKS: list[dict[str, Any]] = []


def _knowledge_backend_mode() -> str:
    """Backend mode: auto | postgres | firestore | local."""
    mode = os.getenv("KNOWLEDGE_STORE_BACKEND", "auto").strip().lower()
    return mode if mode in {"auto", "postgres", "firestore", "local"} else "auto"


def _postgres_dsn() -> str:
    # Supabase pooled Postgres URL or direct Postgres URL.
    return os.getenv("SUPABASE_DB_URL", "").strip()


def _postgres_ready() -> bool:
    return bool(psycopg is not None and _postgres_dsn())


def _embedding_literal(embedding: list[float]) -> str:
    # pgvector text literal format: [0.1,0.2,...]
    return "[" + ",".join(f"{float(v):.8f}" for v in embedding) + "]"


def _postgres_ingest_chunks(rows: list[dict[str, Any]]) -> int:
    if not rows or not _postgres_ready() or psycopg is None:
        return 0
    dsn = _postgres_dsn()
    inserted = 0
    try:
        pg = cast(Any, psycopg)
        with pg.connect(dsn, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                for row in rows:
                    emb = cast(list[float], row.get("embedding") or [])
                    cur.execute(
                        """
                        insert into public.knowledge_chunks (
                            id, user_id, document_id, chunk_index, text,
                            embedding, source_type, subject, tags,
                            board, university, semester, filename, created_at
                        )
                        values (
                            %s, %s, %s, %s, %s,
                            CAST(%s as vector), %s, %s, %s,
                            %s, %s, %s, %s, %s
                        )
                        on conflict (id) do update set
                            text = excluded.text,
                            embedding = excluded.embedding,
                            source_type = excluded.source_type,
                            subject = excluded.subject,
                            tags = excluded.tags,
                            board = excluded.board,
                            university = excluded.university,
                            semester = excluded.semester,
                            filename = excluded.filename,
                            created_at = excluded.created_at
                        """,
                        (
                            row.get("id"),
                            row.get("user_id"),
                            row.get("document_id"),
                            row.get("chunk_index"),
                            row.get("text"),
                            _embedding_literal(emb),
                            row.get("source_type"),
                            row.get("subject"),
                            row.get("tags") or [],
                            row.get("board"),
                            row.get("university"),
                            row.get("semester"),
                            row.get("filename"),
                            row.get("created_at"),
                        ),
                    )
                    inserted += 1
            conn.commit()
    except Exception as exc:
        print(f"[warn] postgres ingest failed, using fallback store: {exc}")
        return 0
    return inserted


def _postgres_retrieve_scored(query_emb: list[float], user_id: str, query_subject: str = "", limit: int = 32) -> list[tuple[float, dict[str, Any]]]:
    if not _postgres_ready() or psycopg is None or dict_row is None:
        return []
    dsn = _postgres_dsn()
    scored: list[tuple[float, dict[str, Any]]] = []
    try:
        qvec = _embedding_literal(query_emb)
        pg = cast(Any, psycopg)
        with pg.connect(dsn, connect_timeout=5) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    """
                    select
                        id, user_id, document_id, chunk_index, text,
                        source_type, subject, tags, board, university,
                        semester, filename, created_at,
                        (1 - (embedding <=> CAST(%s as vector))) as score
                    from public.knowledge_chunks
                    where user_id = %s
                    order by embedding <=> CAST(%s as vector)
                    limit %s
                    """,
                    (qvec, user_id, qvec, limit),
                )
                rows = cur.fetchall()
        for raw in cast(list[Any], rows):
            if not isinstance(raw, dict):
                continue
            row = cast(dict[str, Any], raw)
            score = float(row.get("score") or 0.0)
            chunk_subj = (row.get("subject") or "").lower()
            if query_subject and query_subject != "general" and chunk_subj == query_subject:
                score *= 1.15
            if score > 0.08:
                scored.append((score, row))
    except Exception as exc:
        print(f"[warn] postgres retrieve failed, using fallback store: {exc}")
        return []
    return scored

# ── Academic subject detection ────────────────────────────────────

_SUBJECT_KEYWORDS: dict[str, list[str]] = {
    "physics": [
        "newton", "force", "velocity", "acceleration", "momentum", "energy",
        "thermodynamics", "entropy", "wave", "optics", "quantum", "relativity",
        "electromagnetism", "magnetic", "electric field", "circuit", "resistor",
        "capacitor", "inductor", "frequency", "wavelength", "photon", "nucleus",
        "radioactive", "gravitation", "torque", "angular", "oscillation",
        "friction", "kinetic", "potential energy", "work done", "power",
        "joule", "coulomb", "ampere", "volt", "ohm", "farad", "henry",
        "gauss", "tesla", "hertz", "decibel", "refraction", "diffraction",
        "interference", "polarization", "semiconductor", "diode", "transistor",
    ],
    "mathematics": [
        "calculus", "integral", "derivative", "equation", "matrix", "vector",
        "algebra", "polynomial", "function", "limit", "continuity", "differential",
        "trigonometry", "sin", "cos", "tan", "logarithm", "exponential",
        "probability", "statistics", "mean", "median", "variance", "deviation",
        "permutation", "combination", "set theory", "group theory", "topology",
        "geometry", "theorem", "proof", "axiom", "lemma", "corollary",
        "eigenvalue", "determinant", "linear algebra", "fourier", "laplace",
        "binomial", "poisson", "gaussian", "normal distribution", "hypothesis",
        "regression", "correlation", "differentiation", "integration",
    ],
    "chemistry": [
        "molecule", "atom", "electron", "proton", "neutron", "orbital",
        "bond", "covalent", "ionic", "metallic", "reaction", "oxidation",
        "reduction", "acid", "base", "ph", "mole", "molarity", "titration",
        "organic", "inorganic", "polymer", "catalyst", "enzyme", "periodic table",
        "element", "compound", "solution", "solvent", "solute", "equilibrium",
        "enthalpy", "gibbs", "electrochemistry", "stoichiometry", "isomer",
        "hydrocarbon", "aldehyde", "ketone", "alcohol", "ester", "amine",
        "carboxylic", "aromatic", "aliphatic", "nucleophile", "electrophile",
    ],
    "biology": [
        "cell", "dna", "rna", "protein", "gene", "chromosome", "mitosis",
        "meiosis", "photosynthesis", "respiration", "enzyme", "metabolism",
        "organism", "species", "evolution", "natural selection", "mutation",
        "ecology", "ecosystem", "biodiversity", "taxonomy", "anatomy",
        "physiology", "neuron", "synapse", "hormone", "immune", "antibody",
        "virus", "bacteria", "fungi", "plant", "animal", "tissue", "organ",
        "ribosome", "mitochondria", "chloroplast", "nucleus", "membrane",
        "transcription", "translation", "allele", "phenotype", "genotype",
    ],
    "computer_science": [
        "algorithm", "data structure", "array", "linked list", "tree", "graph",
        "sorting", "searching", "recursion", "iteration", "complexity",
        "big o", "database", "sql", "nosql", "api", "rest", "http",
        "tcp", "ip", "network", "operating system", "thread", "process",
        "compiler", "interpreter", "assembly", "binary", "hexadecimal",
        "object oriented", "inheritance", "polymorphism", "encapsulation",
        "abstraction", "design pattern", "machine learning", "neural network",
        "deep learning", "artificial intelligence", "python", "javascript",
        "java", "c++", "rust", "go", "typescript", "react", "node",
        "docker", "kubernetes", "git", "version control", "devops", "ci cd",
    ],
    "engineering": [
        "structural", "mechanical", "electrical", "civil", "thermodynamics",
        "fluid mechanics", "material science", "stress", "strain", "load",
        "beam", "truss", "concrete", "steel", "welding", "cad", "cam",
        "manufacturing", "quality control", "signal processing", "control system",
        "plc", "scada", "automation", "robotics", "mechatronics",
    ],
    "economics": [
        "demand", "supply", "market", "gdp", "inflation", "deflation",
        "fiscal policy", "monetary policy", "interest rate", "exchange rate",
        "microeconomics", "macroeconomics", "elasticity", "utility",
        "marginal", "equilibrium", "monopoly", "oligopoly", "trade",
        "taxation", "budget", "investment", "capital", "stock", "bond",
    ],
    "history": [
        "civilization", "empire", "dynasty", "revolution", "war", "treaty",
        "colonial", "independence", "constitution", "democracy", "monarchy",
        "medieval", "renaissance", "industrial revolution", "cold war",
        "world war", "ancient", "archaeological", "artifact", "era",
    ],
    "pharmacy": [
        "drug", "pharmaceutical", "pharmacology", "pharmacokinetics", "dosage",
        "tablet", "capsule", "injection", "formulation", "bioavailability",
        "toxicology", "adverse effect", "prescription", "otc", "antibiotic",
        "analgesic", "antipyretic", "antiviral", "antifungal", "vaccine",
        "clinical trial", "pharmacognosy", "herbal", "excipient", "dissolution",
        "pharmacodynamics", "receptor", "agonist", "antagonist", "therapeutic",
    ],
    "medical_science": [
        "diagnosis", "symptom", "pathology", "clinical", "surgery", "radiology",
        "cardiology", "neurology", "oncology", "dermatology", "orthopedic",
        "pediatric", "gynecology", "ophthalmology", "psychiatry", "epidemiology",
        "prognosis", "anesthesia", "biopsy", "mri", "ct scan", "ultrasound",
        "blood pressure", "diabetes", "cholesterol", "infection", "inflammation",
        "fracture", "tumor", "benign", "malignant", "chronic", "acute",
    ],
    "law": [
        "constitution", "legislation", "statute", "amendment", "jurisprudence",
        "plaintiff", "defendant", "verdict", "judgment", "appeal", "court",
        "contract", "tort", "criminal", "civil", "advocate", "bail",
        "habeas corpus", "jurisdiction", "precedent", "litigation", "arbitration",
        "intellectual property", "copyright", "patent", "trademark", "ipc",
        "crpc", "fundamental rights", "directive principles", "preamble",
    ],
    "commerce": [
        "accounting", "ledger", "journal", "balance sheet", "profit loss",
        "debit", "credit", "audit", "taxation", "gst", "income tax",
        "financial statement", "ratio analysis", "depreciation", "amortization",
        "cost accounting", "budget", "cash flow", "working capital",
        "partnership", "company", "share", "dividend", "stock exchange",
        "banking", "insurance", "mutual fund", "fdi", "export", "import",
    ],
    "arts_humanities": [
        "literature", "poetry", "prose", "drama", "novel", "fiction",
        "philosophy", "ethics", "aesthetics", "epistemology", "metaphysics",
        "sociology", "anthropology", "psychology", "linguistics", "culture",
        "political science", "governance", "public administration", "diplomacy",
        "art history", "music theory", "theater", "film studies", "media",
    ],
    "environmental_science": [
        "ecology", "pollution", "climate change", "global warming", "ozone",
        "biodiversity", "conservation", "deforestation", "renewable energy",
        "solar", "wind energy", "carbon footprint", "greenhouse", "ecosystem",
        "sustainability", "waste management", "recycling", "water treatment",
        "soil erosion", "desertification", "environmental impact", "wetland",
    ],
}


def _detect_subject(text: str) -> str:
    """Auto-detect academic subject from text content using keyword frequency.
    Uses adaptive threshold: 1 hit for short queries, 3 for longer content.
    Uses word-boundary matching to avoid false substring matches."""
    text_lower = text.lower()
    word_count = len(text_lower.split())
    # Short queries (< 20 words) need only 1 keyword; longer text needs 3
    threshold = 1 if word_count < 20 else 3
    scores: dict[str, int] = {}
    for subject, keywords in _SUBJECT_KEYWORDS.items():
        score = sum(
            1 for kw in keywords
            if re.search(r'\b' + re.escape(kw) + r'\b', text_lower)
        )
        if score >= threshold:
            scores[subject] = score
    if not scores:
        return "general"
    return max(scores, key=lambda subject_name: scores[subject_name])


def detect_query_subject(query: str) -> str:
    """Detect subject from a user query (exported for use in chat routing)."""
    return _detect_subject(query)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _firebase_client() -> Any | None:
    if firebase_admin is None or credentials is None or firestore is None:
        return None

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    resolved_service_account_path = None
    if service_account_path:
        candidate = Path(service_account_path)
        if not candidate.is_absolute():
            repo_root = Path(__file__).resolve().parents[3]
            candidate = repo_root / candidate
        resolved_service_account_path = str(candidate)

    project_id = os.getenv("FIREBASE_PROJECT_ID")
    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key = os.getenv("FIREBASE_PRIVATE_KEY")

    if not getattr(firebase_admin, "_apps", {}):
        try:
            initialize_app = cast(Callable[..., Any], getattr(firebase_admin, "initialize_app"))
            if resolved_service_account_path and os.path.exists(resolved_service_account_path):
                initialize_app(credentials.Certificate(resolved_service_account_path))
            elif project_id and client_email and private_key:
                initialize_app(
                    credentials.Certificate(
                        {
                            "type": "service_account",
                            "project_id": project_id,
                            "private_key": private_key.replace("\\n", "\n"),
                            "client_email": client_email,
                            "token_uri": "https://oauth2.googleapis.com/token",
                        }
                    )
                )
            else:
                return None
        except ValueError:
            pass

    return firestore.client()


def _load_local() -> None:
    if not _LOCAL_FILE.exists():
        return
    try:
        payload = json.loads(_LOCAL_FILE.read_text(encoding="utf-8"))
        chunks_any: Any = payload.get("chunks", [])
        if isinstance(chunks_any, list):
            safe_chunks: list[dict[str, Any]] = []
            for item in cast(list[Any], chunks_any):
                if isinstance(item, dict):
                    safe_chunks.append(cast(dict[str, Any], item))
            _LOCAL_CHUNKS.extend(safe_chunks)
    except Exception:
        return


def _persist_local() -> None:
    _LOCAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"chunks": _LOCAL_CHUNKS}
    temp_file = _LOCAL_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(_LOCAL_FILE)


def _chunk_text(text: str, chunk_size: int = 900, overlap: int = 140) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunks.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(size))
    na = math.sqrt(sum(x * x for x in a[:size])) or 1.0
    nb = math.sqrt(sum(x * x for x in b[:size])) or 1.0
    return dot / (na * nb)


def _to_float_list(values: Any) -> list[float]:
    if not isinstance(values, list):
        return []
    numeric: list[float] = []
    for value in cast(list[Any], values):
        if isinstance(value, (int, float)):
            numeric.append(float(value))
    return numeric


def _append_local_chunk(
    user_id: str,
    document_id: str,
    chunk_index: int,
    text: str,
    embedding: list[float],
    source_type: str,
    filename: str,
    subject: str = "",
    tags: list[str] | None = None,
    board: str = "",
    university: str = "",
    semester: str = "",
) -> None:
    _LOCAL_CHUNKS.append(
        {
            "id": f"{document_id}_{chunk_index}",
            "user_id": user_id,
            "document_id": document_id,
            "chunk_index": chunk_index,
            "text": text,
            "embedding": embedding,
            "source_type": source_type,
            "filename": filename,
            "subject": subject,
            "tags": tags or [],
            "board": board,
            "university": university,
            "semester": semester,
            "created_at": _now_iso(),
        }
    )


def _local_retrieve_scored(query_emb: list[float], user_id: str, query_subject: str = "") -> list[tuple[float, dict[str, Any]]]:
    scored: list[tuple[float, dict[str, Any]]] = []
    with _STORE_LOCK:
        for row in _LOCAL_CHUNKS:
            if row.get("user_id") != user_id:
                continue
            emb_any: Any = row.get("embedding")
            numeric_emb = _to_float_list(emb_any)
            if not numeric_emb:
                continue
            score = _cosine(query_emb, numeric_emb)
            # Subject-aware boost
            chunk_subj = (row.get("subject") or "").lower()
            if query_subject and query_subject != "general" and chunk_subj == query_subject:
                score *= 1.15
            if score > 0.08:
                scored.append((score, row))
    return scored


def ingest_knowledge_text(
    user_id: str,
    document_id: str,
    text: str,
    source_type: str,
    filename: str,
    subject: str = "",
    tags: list[str] | None = None,
    board: str = "",
    university: str = "",
    semester: str = "",
) -> dict[str, int | str]:
    chunks = _chunk_text(text)
    if not chunks:
        return {"document_id": document_id, "chunks": 0, "stored": 0}
    _subject = (subject or _detect_subject(text)).lower().strip()
    _tags = [t.lower().strip() for t in (tags or [])]
    _board = board.strip()
    _university = university.strip()
    _semester = semester.strip()
    backend_mode = _knowledge_backend_mode()

    client = _firebase_client()
    stored = 0

    pg_rows: list[dict[str, Any]] = []
    for idx, chunk in enumerate(chunks):
        emb = generate_embedding(chunk)
        pg_rows.append(
            {
                "id": f"{document_id}_{idx}",
                "user_id": user_id,
                "document_id": document_id,
                "chunk_index": idx,
                "text": chunk,
                "embedding": emb,
                "source_type": source_type,
                "subject": _subject,
                "tags": _tags,
                "board": _board,
                "university": _university,
                "semester": _semester,
                "filename": filename,
                "created_at": _now_iso(),
            }
        )

    # Primary path: Supabase Postgres + pgvector
    if backend_mode in {"auto", "postgres"}:
        pg_inserted = _postgres_ingest_chunks(pg_rows)
        if pg_inserted > 0:
            return {"document_id": document_id, "chunks": len(chunks), "stored": pg_inserted}

    if client and backend_mode in {"auto", "firestore"}:
        try:
            base_ref = (
                client.collection("users")
                .document(user_id)
                .collection("knowledge_chunks")
            )
            for row in pg_rows:
                doc_row = dict(row)
                doc_row.pop("id", None)
                base_ref.document(f"{document_id}_{row['chunk_index']}").set(doc_row)
                stored += 1
            return {"document_id": document_id, "chunks": len(chunks), "stored": stored}
        except Exception as exc:
            print(f"[warn] firestore ingest failed, using local store: {exc}")

    with _STORE_LOCK:
        for row in pg_rows:
            _append_local_chunk(
                user_id=user_id,
                document_id=document_id,
                chunk_index=cast(int, row["chunk_index"]),
                text=cast(str, row["text"]),
                embedding=cast(list[float], row["embedding"]),
                source_type=source_type,
                filename=filename,
                subject=_subject,
                tags=_tags,
                board=_board,
                university=_university,
                semester=_semester,
            )
            stored += 1
        _persist_local()

    return {"document_id": document_id, "chunks": len(chunks), "stored": stored}


def retrieve_knowledge_context(user_id: str, query: str, top_k: int = 4, subject_hint: str = "") -> list[dict[str, Any]]:
    """Retrieve relevant knowledge chunks. Subject-aware: boosts chunks matching query subject."""
    if not query.strip():
        return []

    query_emb = generate_embedding(query)
    query_subject = (subject_hint or _detect_subject(query)).lower().strip()
    backend_mode = _knowledge_backend_mode()
    client = _firebase_client()
    scored: list[tuple[float, dict[str, Any]]] = []

    if backend_mode in {"auto", "postgres"}:
        scored = _postgres_retrieve_scored(
            query_emb=query_emb,
            user_id=user_id,
            query_subject=query_subject,
            limit=max(top_k * 8, 32),
        )
        if scored:
            scored.sort(key=lambda x: x[0], reverse=True)
        elif backend_mode == "postgres":
            # Explicit postgres mode should not silently cross users by switching providers.
            return []

    if not scored and client and backend_mode in {"auto", "firestore"}:
        try:
            docs = (
                client.collection("users")
                .document(user_id)
                .collection("knowledge_chunks")
                .limit(500)
                .stream()
            )
            for doc in docs:
                raw_row: Any = doc.to_dict()
                if not isinstance(raw_row, dict):
                    continue
                row = cast(dict[str, Any], raw_row)
                emb_any: Any = row.get("embedding")
                numeric_emb = _to_float_list(emb_any)
                if not numeric_emb:
                    continue
                score = _cosine(query_emb, numeric_emb)
                # Subject-aware boost: +15% if chunk subject matches query subject
                chunk_subj = (row.get("subject") or "").lower()
                if query_subject and query_subject != "general" and chunk_subj == query_subject:
                    score *= 1.15
                if score > 0.08:
                    scored.append((score, row))
        except Exception as exc:
            print(f"[warn] firestore retrieve failed, using local store: {exc}")
            scored = _local_retrieve_scored(query_emb=query_emb, user_id=user_id, query_subject=query_subject)
    else:
        if not scored:
            scored = _local_retrieve_scored(query_emb=query_emb, user_id=user_id, query_subject=query_subject)

    scored.sort(key=lambda x: x[0], reverse=True)

    results: list[dict[str, Any]] = []
    for score, row in scored[:top_k]:
        file_name = row.get("filename") or "uploaded-document"
        doc_id = row.get("document_id") or "doc"
        chunk_index = row.get("chunk_index") or 0
        text = (row.get("text") or "")[:480]
        subject_label = row.get("subject") or "general"
        results.append(
            {
                "title": f"{file_name} (chunk {chunk_index + 1})",
                "url": f"credon://knowledge/{doc_id}#{chunk_index}",
                "snippet": text,
                "score": round(score, 4),
                "subject": subject_label,
            }
        )

    return results


_load_local()
