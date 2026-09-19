"""Vector layer for PCL memory — real embeddings + cosine search, no keyword overlap.

Embedding provider chain (best-ready wins, provider is logged):
  1. sentence_transformers (local, best quality) — warms in background
  2. chroma ONNX MiniLM (local, 384-d, no torch — ships with chromadb) — warms in background
  3. Ollama via app.services.models.generate_embedding (real model when daemon up)
  4. deterministic hashing fallback (normalized, 256-d — weak but still vector search)

Chroma (PersistentClient in backend/data/chroma/) is the vector index.
JSON files remain the append-only source of truth; Chroma holds id->vector
and we hydrate payloads from JSON. Embeddings are computed by us and passed
explicitly, so we never depend on Chroma's embedding_function API.
"""
from __future__ import annotations
import hashlib
import math
import re
import threading
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_CHROMA_DIR = _DATA_DIR / "chroma"
_CHROMA_DIR.mkdir(parents=True, exist_ok=True)

_LOCK = threading.RLock()
_CHROMA_CLIENT: Any = None
_ST_MODEL: Any = None
_ONNX_EF: Any = None
_LOADER_STATE: dict[str, str] = {}
_EMBED_PROVIDER = "undecided"
_EMBED_DIM = 0
_EMBED_DIM_KEY = ""


def _effective_key() -> str:
    if _ST_MODEL is not None:
        return "st"
    if _ONNX_EF is not None:
        return "onnx"
    return "fallback"


def dim() -> int:
    """Embedding width of the active provider. Collection names include this
    so a provider change (e.g. hash 256-d → onnx 384-d) auto-segregates the
    index instead of mixing incompatible vectors."""
    global _EMBED_DIM, _EMBED_DIM_KEY
    key = _effective_key()
    if _EMBED_DIM <= 0 or _EMBED_DIM_KEY != key:
        _EMBED_DIM = len(embed("dimension probe"))
        _EMBED_DIM_KEY = key
    return _EMBED_DIM


def episodic_collection() -> str:
    return f"pcl_episodic_{dim()}d"


def semantic_collection() -> str:
    return f"pcl_semantic_{dim()}d"


def embed_provider() -> str:
    """Which embedding provider is active (for logging/evals, not hardcoded)."""
    global _EMBED_PROVIDER, _EMBED_DIM_KEY
    _ensure_provider()
    if _ONNX_EF is not None and _EMBED_PROVIDER in ("ollama_or_hash_fallback", "hash_fallback"):
        _EMBED_PROVIDER = "chroma_onnx_minilm"
        _EMBED_DIM_KEY = ""
    return _EMBED_PROVIDER


def _kick_loader(name: str, build: object) -> None:
    """Start one background thread per embedder. The request path never blocks
    on multi-hundred-MB model loads (Render cold starts, slow disks)."""
    global _LOADER_STATE
    if _LOADER_STATE.get(name) != "undecided":
        return
    _LOADER_STATE[name] = "loading"

    def _load() -> None:
        global _ST_MODEL, _ONNX_EF, _EMBED_PROVIDER, _EMBED_DIM_KEY
        try:
            result = build()
            if name == "st":
                _ST_MODEL = result
            else:
                _ONNX_EF = result
                result(["provider probe"])  # force model load inside this thread
            _LOADER_STATE[name] = "ready"
            best = _effective_key()
            if best == "st" or (best == "onnx" and _EMBED_PROVIDER in ("ollama_or_hash_fallback", "hash_fallback")):
                _EMBED_PROVIDER = "sentence_transformers" if best == "st" else "chroma_onnx_minilm"
                _EMBED_DIM_KEY = ""
            print(f"[PCL vectors] {name} embedder ready (background warmup)")
        except Exception as exc:
            _LOADER_STATE[name] = "failed"
            print(f"[PCL vectors] {name} embedder unavailable: {exc}")

    import threading as _th
    _th.Thread(target=_load, daemon=True, name=f"pcl-{name}-warmup").start()


def _build_st() -> Any:
    from sentence_transformers import SentenceTransformer  # type: ignore
    return SentenceTransformer("all-MiniLM-L6-v2")


def _build_onnx() -> Any:
    from chromadb.utils.embedding_functions import DefaultEmbeddingFunction  # type: ignore
    return DefaultEmbeddingFunction()


def _ensure_provider() -> None:
    global _EMBED_PROVIDER
    if _EMBED_PROVIDER != "undecided":
        return
    # Heavy models warm in background; serve Ollama/hash until one is ready.
    _kick_loader("st", _build_st)
    _kick_loader("onnx", _build_onnx)
    try:
        from app.services.models import generate_embedding  # type: ignore
        vec = generate_embedding("probe")
        if vec and any(abs(v) > 1e-9 for v in vec):
            _EMBED_PROVIDER = "ollama_or_hash_fallback"
            return
    except Exception:
        pass
    _EMBED_PROVIDER = "hash_fallback"


def embed(text: str) -> list[float]:
    _ensure_provider()
    cleaned = re.sub(r"\s+", " ", (text or "").strip())[:2000]
    if not cleaned:
        return [0.0] * 256
    if _ST_MODEL is not None:
        try:
            vec = _ST_MODEL.encode(cleaned, normalize_embeddings=True).tolist()
            return [float(v) for v in vec]
        except Exception:
            pass
    if _ONNX_EF is not None:
        try:
            out = _ONNX_EF([cleaned])
            # NOTE: chroma returns a numpy array — never use truthiness on it.
            first = out[0] if out is not None and len(out) > 0 else None
            if first is not None and len(first) > 0:
                v = [float(x) for x in first]
                norm = math.sqrt(sum(x * x for x in v)) or 1.0
                return [x / norm for x in v]
        except Exception as exc:
            print(f"[PCL vectors] onnx embed failed, falling through: {exc}")
    try:
        from app.services.models import generate_embedding  # type: ignore
        vec = generate_embedding(cleaned)
        if vec and any(abs(v) > 1e-9 for v in vec):
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            return [float(v) / norm for v in vec]
    except Exception:
        pass
    return _hash_embed(cleaned)


def _hash_embed(text: str, dim: int = 256) -> list[float]:
    vec = [0.0] * dim
    for token in re.findall(r"\w+", text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        idx = int(digest[:8], 16) % dim
        sign = -1.0 if int(digest[8:10], 16) % 2 else 1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = sum(x * y for x, y in zip(a[:n], b[:n]))
    na = math.sqrt(sum(x * x for x in a[:n])) or 1.0
    nb = math.sqrt(sum(y * y for y in b[:n])) or 1.0
    return max(-1.0, min(1.0, dot / (na * nb)))


def _client() -> Any | None:
    global _CHROMA_CLIENT
    with _LOCK:
        if _CHROMA_CLIENT is not None:
            return _CHROMA_CLIENT
        try:
            import chromadb  # type: ignore
            _CHROMA_CLIENT = chromadb.PersistentClient(path=str(_CHROMA_DIR))
            return _CHROMA_CLIENT
        except Exception as exc:
            print(f"[PCL vectors] chroma unavailable, using JSON-cosine fallback: {exc}")
            _CHROMA_CLIENT = False
            return None


def _collection(name: str) -> Any | None:
    client = _client()
    if client is None:
        return None
    try:
        return client.get_or_create_collection(name=name)
    except Exception as exc:
        print(f"[PCL vectors] collection {name} failed: {exc}")
        return None


def upsert(collection_name: str, doc_id: str, vector: list[float], metadata: dict[str, Any]) -> bool:
    """Returns True if indexed in Chroma, False if caller must rely on JSON scan."""
    flat = {k: (str(v)[:500] if not isinstance(v, (str, int, float, bool)) else v)
            for k, v in metadata.items()}
    if not flat:
        flat = {"kind": collection_name}
    col = _collection(collection_name)
    if col is None:
        return False
    try:
        col.upsert(ids=[doc_id], embeddings=[vector], metadatas=[flat])
        return True
    except Exception as exc:
        print(f"[PCL vectors] upsert failed ({collection_name}): {exc}")
        return False


def query(collection_name: str, vector: list[float], top_k: int = 5,
          where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Returns [{id, cosine, metadata}] sorted by cosine desc. Empty list = no index."""
    col = _collection(collection_name)
    if col is None:
        return []
    try:
        res = col.query(query_embeddings=[vector], n_results=top_k,
                        where=where or None, include=["metadatas", "distances"])
        ids = (res.get("ids") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        out = []
        for i, doc_id in enumerate(ids):
            # Chroma returns L2 distance for default HNSW; convert robustly:
            # our vectors are L2-normalized so cosine = 1 - d^2/2.
            d = float(dists[i]) if i < len(dists) else 2.0
            cos_sim = max(-1.0, min(1.0, 1.0 - (d * d) / 2.0))
            out.append({"id": doc_id, "cosine": round(cos_sim, 4),
                        "metadata": metas[i] if i < len(metas) else {}})
        out.sort(key=lambda x: x["cosine"], reverse=True)
        return out
    except Exception as exc:
        print(f"[PCL vectors] query failed ({collection_name}): {exc}")
        return []
