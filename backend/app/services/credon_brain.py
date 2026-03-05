"""Credon Brain — The built-in intelligence engine.

This is Credon AI's own knowledge base + reasoning engine.
It works WITHOUT any external AI model (no Ollama needed).

Architecture:
1. KNOWLEDGE_BASE: Massive built-in knowledge across domains
2. LEARNED_QA: Self-learning store — saves every good Q&A pair
3. REASONING: Pattern matching + template engine for new questions
4. SELF_IMPROVEMENT: Gets smarter with every conversation

The brain retrieves from:
  - Built-in knowledge (curated facts)
  - Learned Q&A pairs (from past conversations)
  - Web sources (when available)
  - Pattern-based reasoning (for math, greetings, etc.)
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, cast
from difflib import SequenceMatcher
from threading import RLock

# ── Paths ────────────────────────────────────────────────────────

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_LEARNED_FILE = _DATA_DIR / "credon_learned.json"
_FEEDBACK_FILE = _DATA_DIR / "credon_feedback.json"
_LOCK = RLock()

# Public aliases for cross-module access (feedback route)
learned_qa_ref = lambda: _learned_qa  # noqa: E731
save_learned_ref = lambda: _save_learned  # noqa: E731
lock_ref = _LOCK

# ── Built-in Knowledge Base ──────────────────────────────────────

KNOWLEDGE_BASE: dict[str, dict[str, str]] = {
    # ─── AI & Technology ───
    "what is artificial intelligence": {
        "answer": "**Artificial Intelligence (AI)** is the simulation of human intelligence by machines. It encompasses:\n\n- **Machine Learning**: Systems that learn from data\n- **Deep Learning**: Neural networks with multiple layers\n- **Natural Language Processing**: Understanding human language\n- **Computer Vision**: Interpreting visual information\n- **Robotics**: Physical AI agents\n\nAI is transforming healthcare, finance, transportation, and virtually every industry. Modern AI like large language models (LLMs) can understand context, generate text, write code, and reason through complex problems.\n\n**You might also want to know:**\n- What is machine learning vs deep learning?\n- How do large language models work?\n- What are the ethical concerns around AI?",
        "thinking": "User asking about AI fundamentals. Will cover definition, subfields, and real-world applications. High confidence — well-established domain knowledge.",
    },
    "what is machine learning": {
        "answer": "**Machine Learning (ML)** is a subset of AI where systems learn from data without being explicitly programmed.\n\n### Types of ML:\n1. **Supervised Learning** — Learns from labeled data (classification, regression)\n2. **Unsupervised Learning** — Finds patterns in unlabeled data (clustering)\n3. **Reinforcement Learning** — Learns through trial and reward\n\n### Popular Algorithms:\n- Linear/Logistic Regression\n- Decision Trees & Random Forests\n- Support Vector Machines\n- Neural Networks\n- K-Means Clustering\n\n### Tools & Frameworks:\n- **Python**: scikit-learn, TensorFlow, PyTorch\n- **R**: caret, randomForest\n\nML powers recommendation systems (Netflix, Spotify), fraud detection, medical diagnosis, and self-driving cars.\n\n**You might also want to know:**\n- How do neural networks work?\n- What's the difference between ML and deep learning?\n- How to start learning machine learning?",
        "thinking": "ML fundamentals query. Covering types, algorithms, tools, and applications. This is core CS knowledge — high confidence.",
    },
    "what is deep learning": {
        "answer": "**Deep Learning** is a subset of machine learning that uses artificial neural networks with many layers (hence \"deep\").\n\n### Key Concepts:\n- **Neural Networks**: Layers of interconnected nodes (neurons)\n- **Backpropagation**: How networks learn from errors\n- **Activation Functions**: ReLU, Sigmoid, Softmax\n- **Architectures**: CNNs (images), RNNs/LSTMs (sequences), Transformers (language)\n\n### Why It's Powerful:\n- Automatically learns features from raw data\n- Scales with more data and compute\n- State-of-the-art in: image recognition, NLP, speech, game playing\n\n### Breakthrough Models:\n- **GPT/LLMs**: Language understanding & generation\n- **DALL-E/Stable Diffusion**: Image generation\n- **AlphaFold**: Protein structure prediction\n\n**You might also want to know:**\n- How do transformers work?\n- What hardware do you need for deep learning?\n- What is transfer learning?",
        "thinking": "Deep learning query — covering neural network basics, architectures, and modern breakthroughs. High confidence.",
    },
    "how do large language models work": {
        "answer": "## How Large Language Models (LLMs) Work\n\nLLMs like GPT, DeepSeek, LLaMA, and Gemini are AI systems trained to understand and generate human language.\n\n### Core Architecture: Transformer\nLLMs are built on the **Transformer architecture** (introduced in 2017 by Google):\n\n1. **Tokenization** — Text is split into tokens (words/subwords)\n2. **Embeddings** — Each token becomes a high-dimensional vector\n3. **Self-Attention** — The model learns which tokens relate to each other\n4. **Feed-Forward Layers** — Process and transform the attended information\n5. **Output Layer** — Predicts the next token probability distribution\n\n### Training Process:\n- **Pre-training**: Learns language patterns from massive text corpora (billions of tokens)\n- **Fine-tuning**: Adapted for specific tasks (chat, coding, reasoning)\n- **RLHF**: Reinforcement Learning from Human Feedback — aligns model with human preferences\n\n### Key Principles:\n- **Next-token prediction**: The fundamental task — predict what comes next\n- **Scaling laws**: Bigger models + more data = better performance\n- **Emergent abilities**: Complex reasoning appears at scale\n- **Context window**: How much text the model can process at once\n\n### Modern LLM Families:\n| Model | Creator | Strength |\n|-------|---------|----------|\n| GPT-4o | OpenAI | General intelligence |\n| DeepSeek R1 | DeepSeek | Reasoning + math |\n| LLaMA 3 | Meta | Open-source |\n| Gemini | Google | Multimodal |\n| Claude | Anthropic | Safety + analysis |\n\n**You might also want to know:**\n- What is the transformer architecture?\n- How is RLHF used to train AI?\n- What are the limitations of LLMs?",
        "thinking": "Question about LLM mechanics. Will explain transformer architecture, training pipeline, and key principles. Core AI topic — high confidence.",
    },
    "what is transformer architecture": {
        "answer": "## The Transformer Architecture\n\nThe **Transformer** is the neural network architecture behind all modern LLMs. Introduced in the 2017 paper *\"Attention Is All You Need\"* by Vaswani et al.\n\n### Key Innovation: Self-Attention\nUnlike previous models (RNNs) that process text sequentially, Transformers process **all tokens in parallel** using attention mechanisms.\n\n### How It Works:\n```\nInput → Tokenize → Embed → [Attention + FFN] × N layers → Output\n```\n\n1. **Multi-Head Attention**: Learns different types of relationships between words\n   - $\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$\n2. **Position Encoding**: Adds positional information since attention has no inherent order\n3. **Feed-Forward Networks**: Two linear transformations with ReLU activation\n4. **Layer Normalization**: Stabilizes training\n5. **Residual Connections**: Helps gradients flow through deep networks\n\n### Why It Matters:\n- **Parallelizable**: Trains much faster than RNNs on GPUs\n- **Long-range dependencies**: Can relate words far apart in text\n- **Scalable**: Works from millions to trillions of parameters\n\n### Variants:\n- **Encoder-only**: BERT (classification, embeddings)\n- **Decoder-only**: GPT, LLaMA (text generation)\n- **Encoder-Decoder**: T5, BART (translation, summarization)\n\n**You might also want to know:**\n- How does self-attention work mathematically?\n- What is BERT vs GPT?\n- How do you train a transformer from scratch?",
        "thinking": "Transformer architecture question. Covering self-attention, architecture components, and variants. Deep technical topic — high confidence.",
    },
    "how does ai generate text": {
        "answer": "## How AI Generates Text\n\nAI text generation works through **autoregressive next-token prediction**:\n\n### Step-by-Step Process:\n1. **Input Processing**: Your prompt is tokenized into numbers\n2. **Context Understanding**: The model processes all tokens through attention layers\n3. **Probability Distribution**: For each position, the model outputs probabilities for ~50,000+ possible next tokens\n4. **Sampling Strategy**: A token is selected using:\n   - **Temperature**: Controls randomness (low = deterministic, high = creative)\n   - **Top-p (nucleus)**: Only considers tokens within cumulative probability p\n   - **Top-k**: Only considers the k most likely tokens\n5. **Iteration**: The generated token is appended, and the process repeats\n\n### Example:\n```\nPrompt: \"The capital of France is\"\nModel predicts: Paris (92%), Lyon (3%), Marseille (1%), ...\nOutput: \"Paris\"\nNext: \"The capital of France is Paris.\"\n```\n\n### Key Concepts:\n- **Context Window**: Maximum input length (4K to 128K+ tokens)\n- **Streaming**: Tokens are generated one at a time (that's why AI \"types\")\n- **Chain-of-Thought**: Multi-step reasoning before answering\n- **Hallucination**: When the model generates plausible but false information\n\n**You might also want to know:**\n- What is temperature in AI generation?\n- How do AI models avoid hallucination?\n- What is prompt engineering?",
        "thinking": "Text generation mechanics. Explaining autoregressive prediction, sampling strategies, and key concepts. High confidence.",
    },
    "what is prompt engineering": {
        "answer": "## Prompt Engineering\n\nPrompt engineering is the art and science of crafting inputs to get the best outputs from AI models.\n\n### Key Techniques:\n1. **Clear Instructions**: Be specific about what you want\n2. **Few-Shot Examples**: Show the AI 2-3 examples of desired output\n3. **Chain-of-Thought**: Ask the model to \"think step by step\"\n4. **Role Assignment**: \"You are an expert in...\"\n5. **Output Format**: Specify JSON, markdown, bullet points, etc.\n\n### Example — Bad vs Good:\n```\nBad:  \"Tell me about Python\"\nGood: \"Explain Python's key features for a beginner programmer.\n       Include: syntax examples, use cases, and comparison with JavaScript.\n       Format as bullet points with code snippets.\"\n```\n\n### Advanced Patterns:\n- **ReAct**: Reasoning + Action loops\n- **Tree of Thought**: Explore multiple reasoning paths\n- **Self-Consistency**: Generate multiple answers, pick the consensus\n- **RAG**: Retrieval-Augmented Generation (search + generate)\n\n**You might also want to know:**\n- How to write better prompts for coding tasks?\n- What is RAG (Retrieval-Augmented Generation)?\n- How do system prompts work?",
        "thinking": "Prompt engineering techniques. Covering basic to advanced patterns with practical examples. High confidence.",
    },
    "what is python": {
        "answer": "**Python** is one of the world's most popular programming languages, known for its simplicity and versatility.\n\n### Why Python?\n- **Easy to learn**: Clean, readable syntax\n- **Versatile**: Web, AI/ML, data science, automation, scripting\n- **Huge ecosystem**: 400,000+ packages on PyPI\n- **Community**: One of the largest developer communities\n\n### Key Use Cases:\n- **Web Development**: Django, Flask, FastAPI\n- **Data Science**: pandas, NumPy, matplotlib\n- **AI/ML**: TensorFlow, PyTorch, scikit-learn\n- **Automation**: Selenium, requests, BeautifulSoup\n\n### Quick Example:\n```python\ndef greet(name):\n    return f\"Hello, {name}! Welcome to Python.\"\n\nprint(greet(\"World\"))  # Hello, World! Welcome to Python.\n```\n\n**You might also want to know:**\n- What are the best Python frameworks?\n- How to install Python packages?\n- Python vs JavaScript — which to learn first?",
        "thinking": "Python fundamentals query. Covering popularity, use cases, ecosystem. High confidence — one of the most well-documented languages.",
    },
    "what is javascript": {
        "answer": "**JavaScript** is the programming language of the web — it runs in every browser and powers interactive websites.\n\n### Key Facts:\n- **Created**: 1995 by Brendan Eich\n- **Runs**: In browsers + server-side (Node.js)\n- **Paradigm**: Multi-paradigm (OOP, functional, event-driven)\n\n### Where It's Used:\n- **Frontend**: React, Vue, Angular, Svelte\n- **Backend**: Node.js, Express, Next.js\n- **Mobile**: React Native, Ionic\n- **Desktop**: Electron (VS Code is built with it!)\n\n### Modern Features (ES6+):\n```javascript\nconst greet = (name) => `Hello, ${name}!`;\nconst numbers = [1, 2, 3].map(n => n * 2); // [2, 4, 6]\nconst { x, y } = { x: 10, y: 20 }; // Destructuring\n```\n\n**You might also want to know:**\n- What is TypeScript?\n- React vs Vue vs Angular?\n- How does async/await work?",
        "thinking": "JavaScript fundamentals. Covering history, ecosystem, modern features. High confidence.",
    },
    # ─── Science ───
    "what is quantum computing": {
        "answer": "**Quantum Computing** uses quantum mechanics to solve problems impossible for classical computers.\n\n### Core Concepts:\n- **Qubits**: Unlike classical bits (0 or 1), qubits can be both simultaneously (superposition)\n- **Entanglement**: Qubits linked so measuring one instantly affects another\n- **Quantum Gates**: Operations that manipulate qubits\n\n### What It Can Do:\n- Break current encryption (Shor's algorithm)\n- Simulate molecular structures for drug discovery\n- Optimize logistics and supply chains\n- Accelerate AI/ML training\n\n### Current Players:\n- **IBM** (Eagle, Condor processors)\n- **Google** (Sycamore — quantum supremacy claim)\n- **Microsoft** (topological approach)\n- **D-Wave** (quantum annealing)\n\n> ⚡ Current quantum computers have 100-1000+ qubits but need millions for practical use.\n\n**You might also want to know:**\n- When will quantum computers be practical?\n- What is quantum supremacy?\n- How does quantum encryption work?",
        "thinking": "Quantum computing explanation. Covering qubits, entanglement, applications, and current state. High confidence — well-established physics.",
    },
    "what is blockchain": {
        "answer": "**Blockchain** is a decentralized, immutable digital ledger technology.\n\n### How It Works:\n1. Transactions are grouped into **blocks**\n2. Each block contains a **hash** of the previous block\n3. Blocks form a **chain** — tampering with one breaks the chain\n4. **Consensus mechanisms** (PoW, PoS) validate new blocks\n\n### Key Types:\n- **Public**: Bitcoin, Ethereum (open to anyone)\n- **Private**: Hyperledger (permissioned access)\n- **Hybrid**: Combines both approaches\n\n### Applications Beyond Crypto:\n- Supply chain tracking\n- Digital identity verification\n- Smart contracts (self-executing agreements)\n- Decentralized finance (DeFi)\n- NFTs and digital ownership\n\n**You might also want to know:**\n- What is Ethereum and smart contracts?\n- How does cryptocurrency mining work?\n- What is DeFi?",
        "thinking": "Blockchain fundamentals. Covering mechanism, types, applications. High confidence.",
    },
    # ─── General Knowledge ───
    "what can you do": {
        "answer": "I'm **Credon AI** — your intelligent assistant! Here's what I can help with:\n\n### 🔍 **Research & Search**\n- Search the web for latest information\n- Find and summarize articles\n- Compare different viewpoints\n\n### 🧮 **Math & Science**\n- Solve equations step-by-step\n- Explain scientific concepts\n- Help with physics, chemistry, biology\n\n### 💻 **Coding & Tech**\n- Write and debug code\n- Explain programming concepts\n- Help with web development, Python, JavaScript, and more\n\n### 💡 **General Knowledge**\n- Answer questions on any topic\n- Explain complex topics simply\n- Help with writing and analysis\n\n### 🎨 **Creative**\n- Help with writing and brainstorming\n- Generate ideas and suggestions\n\nI think through problems carefully, show my reasoning, and learn from every conversation to get smarter!\n\n**You might also want to know:**\n- How does Credon AI work?\n- What makes Credon different from other AI?\n- Can you help me with my homework?",
        "thinking": "User asking about capabilities. Listing all major features across research, math, coding, general knowledge, and creative tasks.",
    },
    "what can you do for me": {
        "answer": "I'm **Credon AI** — your intelligent assistant! Here's what I can help with:\n\n### 🔍 **Research & Search**\n- Search the web for latest information\n- Find and summarize articles\n- Compare different viewpoints\n\n### 🧮 **Math & Science**\n- Solve equations step-by-step\n- Explain scientific concepts\n- Help with physics, chemistry, biology\n\n### 💻 **Coding & Tech**\n- Write and debug code\n- Explain programming concepts\n- Help with web development, Python, JavaScript, and more\n\n### 💡 **General Knowledge**\n- Answer questions on any topic\n- Explain complex topics simply\n- Help with writing and analysis\n\nI think through problems carefully, show my reasoning, and learn from every conversation to get smarter!\n\n**You might also want to know:**\n- How does Credon AI work?\n- What makes Credon different from other AI?\n- Can you help me with my homework?",
        "thinking": "User asking about capabilities. Listing all major features. High confidence — describing own functionality.",
    },
    "who are you": {
        "answer": "I'm **Credon AI** — an intelligent research assistant built to think, search, and learn.\n\n### What Makes Me Different:\n- **I think first**: I analyze questions before answering, showing my reasoning\n- **I search smart**: Web search with multiple fallback providers\n- **I learn**: Every conversation makes me smarter\n- **I'm honest**: I tell you my confidence level and cite sources\n- **I speak naturally**: Like talking to a smart friend, not a robot\n\n### My Model:\n**Credon Alpha 1** — an adaptive routing engine that combines multiple AI technologies for the best possible answer.\n\n**You might also want to know:**\n- What technology powers Credon AI?\n- How does Credon learn from conversations?\n- What topics are you best at?",
        "thinking": "Identity question. Describing Credon AI's unique features and approach.",
    },
    "what is credon ai": {
        "answer": "**Credon AI** is an intelligent research assistant that combines multiple AI technologies into one cohesive experience.\n\n### Key Features:\n- **Adaptive Model Routing**: Automatically picks the best AI model for each question\n- **Web Search Integration**: Searches multiple providers with automatic fallbacks\n- **Thinking & Reasoning**: Shows its thought process transparently\n- **Self-Learning**: Gets smarter with every conversation\n- **Math Support**: Step-by-step solutions with LaTeX rendering\n- **Code Generation**: Helps write and debug code\n- **Multi-language**: Works in English and Hinglish\n\n### Model: Credon Alpha 1\nAn adaptive engine that routes queries intelligently — simple questions get fast answers, complex ones get deep reasoning.\n\n**You might also want to know:**\n- How does Credon AI's thinking work?\n- What models power Credon?\n- How can I get the best answers from Credon?",
        "thinking": "User asking about Credon AI itself. Covering features, capabilities, and architecture.",
    },
    # ─── Math ───
    "what is calculus": {
        "answer": "**Calculus** is the mathematical study of change and motion.\n\n### Two Main Branches:\n\n#### 1. Differential Calculus\n- Studies **rates of change** (slopes, velocities)\n- Key concept: **Derivative** $f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$\n- Example: If $f(x) = x^2$, then $f'(x) = 2x$\n\n#### 2. Integral Calculus\n- Studies **accumulation** (areas, totals)\n- Key concept: **Integral** $\\int f(x)\\,dx$\n- Example: $\\int x^2\\,dx = \\frac{x^3}{3} + C$\n\n### Fundamental Theorem:\nDifferentiation and integration are **inverse operations**:\n$$\\frac{d}{dx}\\int_a^x f(t)\\,dt = f(x)$$\n\n### Applications:\n- Physics (velocity, acceleration)\n- Engineering (optimization)\n- Economics (marginal costs)\n- Biology (population growth)\n\n**You might also want to know:**\n- How do derivatives work step by step?\n- What are common integration techniques?\n- What is multivariable calculus?",
        "thinking": "Calculus fundamentals. Covering differential and integral calculus with formulas and applications. Using LaTeX for math notation.",
    },
    # ─── History ───
    "what is the internet": {
        "answer": "**The Internet** is a global network of interconnected computers that communicate using standardized protocols.\n\n### Brief History:\n- **1969**: ARPANET — first network (4 nodes)\n- **1983**: TCP/IP adopted — the Internet is born\n- **1991**: World Wide Web created by Tim Berners-Lee\n- **1993**: First graphical browser (Mosaic)\n- **2000s**: Social media, smartphones, cloud\n- **2020s**: AI, IoT, Web3\n\n### How It Works:\n1. Your device connects to an **ISP**\n2. DNS translates domain names to IP addresses\n3. Data travels as **packets** through routers\n4. **TCP/IP** ensures reliable delivery\n5. **HTTP/HTTPS** serves web pages\n\n### Key Protocols:\n- **HTTP/HTTPS**: Web browsing\n- **SMTP/IMAP**: Email\n- **FTP**: File transfer\n- **WebSocket**: Real-time communication\n\n**You might also want to know:**\n- How does DNS work?\n- What is the difference between Internet and WWW?\n- What is Web3?",
        "thinking": "Internet explanation. Covering history, how it works, protocols. High confidence.",
    },
    # ─── Training & Open Source AI ───
    "how to train an ai model": {
        "answer": "## How to Train an AI Model (Step-by-Step)\n\nTraining an AI model involves several stages:\n\n### 1. **Data Collection**\n- Gather text, code, images, or whatever domain you need\n- Common sources: Common Crawl, Wikipedia, GitHub, ArXiv, Reddit\n- Format: **JSON**, **JSONL**, or **plain text** (NOT raw PDFs)\n- Tools: `pdfminer`, `PyMuPDF`, `trafilatura` to extract text\n\n### 2. **Data Preprocessing**\n```python\n# Example: Convert PDFs to training format\nfrom datasets import Dataset\nimport json\n\ndata = [{\"instruction\": \"What is X?\", \"output\": \"X is...\"} for ...]\nDataset.from_list(data).save_to_disk(\"my_dataset\")\n```\n\n### 3. **Choose a Base Model**\n- **LLaMA** (Meta) — best open-source foundation\n- **Mistral** — fast and efficient\n- **Qwen** (Alibaba) — excellent multilingual\n- **Falcon** (TII) — strong for research\n\n### 4. **Fine-Tuning (Most Practical)**\n```bash\n# Using Hugging Face + QLoRA (4-bit, runs on consumer GPU)\npip install transformers peft bitsandbytes trl\n```\n\n### 5. **Frameworks & Tools**\n- **Hugging Face Transformers** — model loading & training\n- **PyTorch** — deep learning backend\n- **PEFT/LoRA** — efficient fine-tuning (saves 90% memory)\n- **DeepSpeed/Accelerate** — distributed training\n- **Weights & Biases** — experiment tracking\n\n### 6. **Hardware Requirements**\n- **Fine-tuning**: 1x RTX 3090/4090 (24GB) with QLoRA\n- **Full training**: Multiple A100/H100 GPUs (very expensive)\n- **Free options**: Google Colab, Kaggle notebooks\n\n**You might also want to know:**\n- How to fine-tune LLaMA on my own data?\n- What is LoRA and how does it work?\n- Where to get free GPU compute for training?",
        "thinking": "AI training guide. Covering full pipeline from data to deployment. Practical focus on what individuals can actually do.",
    },
    "how to train llama": {
        "answer": "## Fine-Tuning LLaMA on Your Own Data\n\nHere's a practical guide to fine-tuning **LLaMA** (or LLaMA 2/3):\n\n### Step 1: Prepare Your Data\nFormat as instruction-output pairs in **JSONL**:\n```json\n{\"instruction\": \"What is photosynthesis?\", \"output\": \"Photosynthesis is the process by which plants convert sunlight...\"}\n{\"instruction\": \"Write a Python hello world\", \"output\": \"```python\\nprint('Hello, World!')\\n```\"}\n```\n\n### Step 2: Install Dependencies\n```bash\npip install transformers datasets peft bitsandbytes trl accelerate\n```\n\n### Step 3: Fine-Tune with QLoRA\n```python\nfrom transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig\nfrom peft import LoraConfig, get_peft_model\nfrom trl import SFTTrainer\n\n# Load model in 4-bit (runs on 8GB+ GPU)\nmodel = AutoModelForCausalLM.from_pretrained(\n    \"meta-llama/Llama-2-7b-hf\",\n    quantization_config=BitsAndBytesConfig(load_in_4bit=True),\n    device_map=\"auto\"\n)\n\n# Apply LoRA adapters\nlora_config = LoraConfig(r=16, lora_alpha=32, target_modules=[\"q_proj\", \"v_proj\"])\nmodel = get_peft_model(model, lora_config)\n\n# Train\ntrainer = SFTTrainer(model=model, train_dataset=dataset, max_seq_length=2048)\ntrainer.train()\nmodel.save_pretrained(\"my-fine-tuned-llama\")\n```\n\n### Step 4: Deploy with Ollama\n```bash\n# Convert to GGUF format and run locally\nollama create my-model -f Modelfile\nollama run my-model\n```\n\n**You might also want to know:**\n- Where to get open-source training datasets?\n- How to convert PDFs to training data?\n- How to run fine-tuned models with Ollama?",
        "thinking": "LLaMA fine-tuning guide. Providing actual code examples. Focus on QLoRA which is practical for consumer hardware.",
    },
    "how to get open source model data": {
        "answer": "## Where to Get Open-Source Model Data (For Free)\n\nHere are the best sources for training data:\n\n### 📚 **Text Datasets**\n| Source | Size | What |\n|--------|------|------|\n| [Common Crawl](https://commoncrawl.org) | 250B+ pages | Raw web data |\n| [The Pile](https://pile.eleuther.ai) | 825 GB | Curated mix (books, code, wiki) |\n| [RedPajama](https://www.together.ai/redpajama) | 1.2T tokens | LLaMA-style training data |\n| [Dolma](https://allenai.org/dolma) | 3T tokens | AI2's open dataset |\n| [Wikipedia dumps](https://dumps.wikimedia.org) | ~20 GB | All of Wikipedia |\n\n### 💻 **Code Datasets**\n- **The Stack** (BigCode) — 6TB of code in 350+ languages\n- **GitHub archive** — all public repos\n- **CodeParrot** — Python code dataset\n\n### 🎓 **Instruction/Chat Datasets**\n- **OpenAssistant** (OASST) — human conversations\n- **Alpaca** — instruction-following format\n- **ShareGPT** — shared ChatGPT conversations\n- **UltraChat** — large instruction dataset\n\n### 🔧 **How to Use Them**\n```python\nfrom datasets import load_dataset\n\n# Load from Hugging Face Hub\ndataset = load_dataset(\"Open-Orca/OpenOrca\")\nprint(dataset[\"train\"][0])  # See format\n```\n\n### 📄 **From Your Own PDFs/Docs**\n```python\nimport pymupdf  # pip install PyMuPDF\n\ndef pdf_to_text(path):\n    doc = pymupdf.open(path)\n    return \"\\n\".join(page.get_text() for page in doc)\n```\n\nAll datasets above are **free** and licensed for research/commercial use.\n\n**You might also want to know:**\n- How to clean and preprocess training data?\n- What format does fine-tuning need?\n- How to merge multiple datasets?",
        "thinking": "Open-source data sources for LLM training. Providing specific links and code examples. High confidence.",
    },
    "how to make credon ai better": {
        "answer": "## How to Make Credon AI Even Better 🚀\n\nHere's your roadmap to improving Credon:\n\n### 1. **Expand the Knowledge Base**\nEvery conversation already makes Credon smarter via self-learning. You can also:\n- Add more built-in knowledge entries to `credon_brain.py`\n- Import Q&A datasets from Hugging Face\n- Feed it your own domain-specific knowledge\n\n### 2. **Fine-Tune a Custom Model**\n```bash\n# Use QLoRA to fine-tune Qwen or LLaMA on Credon's learned data\npython fine_tune.py --model qwen3:8b --data ./data/credon_learned.json\n```\nThis trains a model specifically optimized for Credon's style.\n\n### 3. **Add RAG (Retrieval-Augmented Generation)**\nConnect Credon to more knowledge:\n- **Vector database**: ChromaDB or FAISS for semantic search\n- **Document loaders**: Index PDFs, websites, notes\n- Every query searches the database first\n\n### 4. **Improve Web Search**\n- Add more search providers\n- Implement better content extraction\n- Cache frequently asked topics\n\n### 5. **Free Resources to Use**\n- **Google Colab** — free GPU for training\n- **Hugging Face** — host models free\n- **Ollama** — run models locally (free)\n- **DuckDuckGo** — free web search API\n- **Cloudflare Workers** — free serverless hosting\n\n### 6. **Future: Credon Alpha 2**\n- Multimodal (image understanding)\n- Voice input/output\n- Plugin system for tools\n- Persistent memory across sessions\n\n**You might also want to know:**\n- How to set up a vector database for Credon?\n- How to fine-tune Qwen for Credon's style?\n- What's the cheapest way to host Credon?",
        "thinking": "Improvement roadmap for Credon AI. Covering practical steps from easy to advanced.",
    },
    "how does google train gemini": {
        "answer": "## How Google Trains Gemini\n\n### Data\n- **Massive scale**: Trained on diverse text, code, images, audio, and video\n- **Proprietary sources**: Google Search index, YouTube transcripts, Google Books, Google Scholar\n- **Public data**: Common Crawl, Wikipedia, GitHub, ArXiv papers\n- Google does NOT release exact datasets\n\n### Infrastructure\n- **TPU v5 chips** — Google's custom AI accelerators\n- **Distributed clusters** — thousands of TPUs working together\n- **Cost**: Estimated $100M+ per training run\n\n### Training Process\n1. **Pre-training**: Learn language patterns from trillions of tokens\n2. **Instruction tuning**: Train to follow instructions well\n3. **RLHF**: Reinforcement Learning from Human Feedback for alignment\n4. **Safety training**: Red-teaming and content filtering\n\n### Model Architecture\n- **Transformer-based** (like GPT, but multimodal from the start)\n- **Mixture of Experts (MoE)** — activates only relevant parts per query\n- Multiple sizes: Nano, Flash, Pro, Ultra\n\n### Key Difference from Open Source\n| Aspect | Gemini | Open Source (LLaMA) |\n|--------|--------|--------------------|\n| Data | Proprietary | Public datasets |\n| Cost | $100M+ | $100-10K |\n| Hardware | TPU v5 | Consumer GPUs |\n| Weights | Closed | Open |\n\n**You might also want to know:**\n- How can I train my own model for free?\n- What open-source models rival Gemini?\n- How does Gemini compare to GPT-4?",
        "thinking": "Google Gemini training explanation. Covering data, infrastructure, process, and comparison with open-source approaches.",
    },
    "how to train credon ai model": {
        "answer": "## Training Credon AI's Custom Model 🧠\n\nHere's how to create a custom model specifically for Credon:\n\n### Step 1: Export Credon's Learned Data\nCredon automatically saves every Q&A to `data/credon_learned.json`. This is your gold mine!\n\n### Step 2: Convert to Training Format\n```python\nimport json\n\nwith open(\"data/credon_learned.json\") as f:\n    learned = json.load(f)\n\n# Convert to instruction-tuning format\ntraining_data = []\nfor entry in learned:\n    training_data.append({\n        \"instruction\": entry[\"question\"],\n        \"output\": entry[\"answer\"],\n        \"system\": \"You are Credon AI, an intelligent research assistant.\"\n    })\n\nwith open(\"credon_training.jsonl\", \"w\") as f:\n    for item in training_data:\n        f.write(json.dumps(item) + \"\\n\")\n```\n\n### Step 3: Fine-Tune with QLoRA (Free on Colab)\n```python\nfrom transformers import AutoModelForCausalLM\nfrom peft import LoraConfig, get_peft_model\nfrom trl import SFTTrainer\n\nmodel = AutoModelForCausalLM.from_pretrained(\"Qwen/Qwen2.5-7B\")\nlora_config = LoraConfig(r=16, lora_alpha=32)\nmodel = get_peft_model(model, lora_config)\n\ntrainer = SFTTrainer(\n    model=model,\n    train_dataset=dataset,\n    dataset_text_field=\"output\",\n    max_seq_length=4096\n)\ntrainer.train()\n```\n\n### Step 4: Deploy to Ollama\n```bash\n# Export to GGUF\npython convert.py --model ./credon-model --outtype f16\n\n# Create Ollama model\nollama create credon-alpha-2 -f Modelfile\n```\n\n### Cost: **FREE** ✅\n- Google Colab for training (free T4 GPU)\n- Ollama for local deployment\n- All tools are open source\n\n**You might also want to know:**\n- How much data does Credon need to train well?\n- How to add PDF documents to Credon's knowledge?\n- How to set up continuous learning for Credon?",
        "thinking": "Custom training guide for Credon AI. Using the self-learning data as training corpus. Practical and free approach.",
    },
    # ─── More General Knowledge ───
    "what is react": {
        "answer": "**React** is a JavaScript library for building user interfaces, created by **Meta (Facebook)** in 2013.\n\n### Why React?\n- **Component-based**: Build UIs from reusable pieces\n- **Virtual DOM**: Fast updates by comparing changes efficiently\n- **Declarative**: Describe what you want, React figures out how\n- **Massive ecosystem**: Next.js, React Native, Redux, and more\n\n### Key Concepts:\n```jsx\n// A React component\nfunction Welcome({ name }) {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <div>\n      <h1>Hello, {name}!</h1>\n      <button onClick={() => setCount(count + 1)}>\n        Clicked {count} times\n      </button>\n    </div>\n  );\n}\n```\n\n### React Ecosystem:\n- **Next.js** — Full-stack React framework (SSR, routing)\n- **React Native** — Mobile apps with React\n- **Redux/Zustand** — State management\n- **Tailwind CSS** — Styling\n\n**You might also want to know:**\n- React vs Vue vs Angular — which is best?\n- How does Next.js work with React?\n- What are React hooks?",
        "thinking": "React fundamentals. Covering philosophy, key concepts with code, and ecosystem. High confidence.",
    },
    "what is next js": {
        "answer": "**Next.js** is a React framework for building full-stack web applications, created by **Vercel**.\n\n### Key Features:\n- **Server-Side Rendering (SSR)** — Pages render on the server for SEO\n- **Static Generation (SSG)** — Pre-build pages at build time\n- **App Router** — File-based routing with layouts\n- **API Routes** — Backend endpoints in the same project\n- **Middleware** — Run code before requests\n- **Image Optimization** — Automatic image handling\n\n### Quick Start:\n```bash\nnpx create-next-app@latest my-app\ncd my-app\nnpm run dev\n```\n\n### File Structure:\n```\napp/\n  layout.tsx    → Root layout\n  page.tsx      → Home page\n  about/\n    page.tsx    → /about page\n  api/\n    route.ts    → API endpoint\n```\n\n**You might also want to know:**\n- How does the App Router work?\n- Next.js vs traditional React?\n- How to deploy Next.js for free?",
        "thinking": "Next.js fundamentals. Covering features, setup, and file structure. High confidence.",
    },
    "what is fastapi": {
        "answer": "**FastAPI** is a modern, fast Python web framework for building APIs.\n\n### Why FastAPI?\n- **Fastest Python framework** (on par with Node.js/Go)\n- **Auto-generated docs** — Swagger UI built-in\n- **Type safety** — Uses Python type hints\n- **Async support** — Built on Starlette + Pydantic\n\n### Quick Example:\n```python\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Item(BaseModel):\n    name: str\n    price: float\n\n@app.get(\"/\")\ndef read_root():\n    return {\"Hello\": \"World\"}\n\n@app.post(\"/items/\")\ndef create_item(item: Item):\n    return {\"name\": item.name, \"price\": item.price}\n```\n\n```bash\npip install fastapi uvicorn\nuvicorn main:app --reload\n# Docs at http://localhost:8000/docs\n```\n\n**You might also want to know:**\n- How to add authentication to FastAPI?\n- FastAPI vs Flask vs Django?\n- How to deploy FastAPI for free?",
        "thinking": "FastAPI fundamentals. Covering speed, features, code example. High confidence — Credon's own backend uses it!",
    },
    # ─── PHYSICS ───
    "what is newton's laws of motion": {
        "answer": "## Newton's Three Laws of Motion\n\n### First Law (Inertia)\nAn object at rest stays at rest, and an object in motion stays in motion with the same velocity, unless acted upon by an external force.\n$$\\sum \\vec{F} = 0 \\implies \\vec{v} = \\text{constant}$$\n\n### Second Law (Force & Acceleration)\nThe acceleration of an object is directly proportional to the net force and inversely proportional to its mass.\n$$\\vec{F} = m\\vec{a}$$\n\n### Third Law (Action-Reaction)\nFor every action, there is an equal and opposite reaction.\n$$\\vec{F}_{12} = -\\vec{F}_{21}$$\n\n### Examples:\n- **1st Law**: A book on a table stays still until pushed\n- **2nd Law**: A heavier car needs more force to accelerate\n- **3rd Law**: Rocket exhaust pushes down → rocket goes up\n\n**You might also want to know:**\n- How to solve F=ma problems step by step?\n- What is the difference between mass and weight?\n- How do Newton's laws apply to circular motion?",
        "thinking": "Newton's laws — core classical mechanics. Covering all three laws with formulas and examples. High confidence.",
    },
    "what is thermodynamics": {
        "answer": "## Thermodynamics — The Science of Heat and Energy\n\n### Four Laws:\n\n**Zeroth Law**: If A is in thermal equilibrium with B, and B with C, then A is with C.\n\n**First Law** (Conservation of Energy):\n$$\\Delta U = Q - W$$\nInternal energy change = Heat added − Work done\n\n**Second Law**: Entropy of an isolated system always increases.\n$$\\Delta S \\geq 0$$\nHeat flows spontaneously from hot to cold, never the reverse.\n\n**Third Law**: As temperature approaches absolute zero, entropy approaches a minimum.\n$$\\lim_{T \\to 0} S = 0$$\n\n### Key Concepts:\n- **Enthalpy**: $H = U + PV$\n- **Gibbs Free Energy**: $G = H - TS$ (spontaneous if $\\Delta G < 0$)\n- **Carnot Efficiency**: $\\eta = 1 - \\frac{T_C}{T_H}$\n\n### Applications:\nEngines, refrigerators, chemical reactions, power plants, weather systems.\n\n**You might also want to know:**\n- How does a Carnot engine work?\n- What is entropy in simple terms?\n- How to solve thermodynamics numerical problems?",
        "thinking": "Thermodynamics fundamentals. All four laws with formulas. Core physics topic for engineering and science students.",
    },
    "what is electromagnetic induction": {
        "answer": "## Electromagnetic Induction\n\nDiscovered by **Michael Faraday** (1831) — the process of generating electric current by changing magnetic flux.\n\n### Faraday's Law:\n$$\\mathcal{E} = -\\frac{d\\Phi_B}{dt}$$\nThe induced EMF equals the negative rate of change of magnetic flux.\n\n### Lenz's Law:\nThe induced current flows in a direction that **opposes** the change causing it (the minus sign).\n\n### Magnetic Flux:\n$$\\Phi_B = \\vec{B} \\cdot \\vec{A} = BA\\cos\\theta$$\n\n### Applications:\n- **Generators**: Convert mechanical → electrical energy\n- **Transformers**: Step voltage up/down\n- **Inductors**: Store energy in magnetic fields\n- **Wireless charging**: Inductive coupling\n\n### Key Formula (for a coil):\n$$\\mathcal{E} = -N \\frac{d\\Phi_B}{dt}$$\nwhere $N$ = number of turns\n\n**You might also want to know:**\n- How does an AC generator work?\n- What is self-inductance and mutual inductance?\n- How to solve Faraday's law problems?",
        "thinking": "Electromagnetic induction — Faraday's law, Lenz's law. Core electromagnetism topic. High confidence.",
    },
    "what is optics": {
        "answer": "## Optics — The Study of Light\n\n### Reflection:\n$$\\theta_i = \\theta_r$$\nAngle of incidence = Angle of reflection\n\n### Refraction (Snell's Law):\n$$n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2$$\n\n### Lens Formula:\n$$\\frac{1}{f} = \\frac{1}{v} - \\frac{1}{u}$$\n\n### Mirror Formula:\n$$\\frac{1}{f} = \\frac{1}{v} + \\frac{1}{u}$$\n\n### Types of Optics:\n- **Geometrical**: Ray tracing, lenses, mirrors\n- **Wave**: Interference, diffraction, polarization\n- **Quantum**: Photons, photoelectric effect\n\n### Key Phenomena:\n- **Total Internal Reflection**: Fiber optics, diamonds sparkling\n- **Diffraction**: Light bending around obstacles\n- **Interference**: Young's double-slit experiment\n- **Polarization**: Sunglasses, LCD screens\n\n**You might also want to know:**\n- How to solve lens/mirror problems step by step?\n- What is Young's double-slit experiment?\n- How do optical fibers work?",
        "thinking": "Optics fundamentals. Covering reflection, refraction, wave optics. High confidence.",
    },
    "what is wave motion": {
        "answer": "## Wave Motion\n\nA wave is a disturbance that transfers energy without transferring matter.\n\n### Wave Equation:\n$$v = f\\lambda$$\nVelocity = Frequency × Wavelength\n\n### Types:\n- **Transverse**: Vibration perpendicular to direction (light, string waves)\n- **Longitudinal**: Vibration parallel to direction (sound waves)\n\n### Key Properties:\n- **Amplitude ($A$)**: Maximum displacement\n- **Frequency ($f$)**: Oscillations per second (Hz)\n- **Wavelength ($\\lambda$)**: Distance between successive crests\n- **Period ($T$)**: Time for one complete oscillation: $T = 1/f$\n\n### Wave Phenomena:\n- **Superposition**: Waves add when they overlap\n- **Interference**: Constructive (amplify) or destructive (cancel)\n- **Standing Waves**: $f_n = \\frac{nv}{2L}$ (harmonics)\n- **Doppler Effect**: $f' = f \\frac{v \\pm v_o}{v \\mp v_s}$\n\n**You might also want to know:**\n- How does sound travel through different media?\n- What is the Doppler effect in detail?\n- How to solve standing wave problems?",
        "thinking": "Wave motion fundamentals. Covering types, equation, properties. Core physics topic.",
    },
    # ─── MATHEMATICS ───
    "what is linear algebra": {
        "answer": "## Linear Algebra\n\nThe study of vectors, matrices, and linear transformations — the backbone of modern math and CS.\n\n### Core Concepts:\n\n**Vectors & Operations:**\n$$\\vec{a} \\cdot \\vec{b} = |a||b|\\cos\\theta = \\sum a_i b_i$$\n\n**Matrix Multiplication:**\n$$(AB)_{ij} = \\sum_k A_{ik} B_{kj}$$\n\n**Determinant (2×2):**\n$$\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc$$\n\n**Eigenvalues & Eigenvectors:**\n$$A\\vec{v} = \\lambda\\vec{v}$$ where $\\lambda$ = eigenvalue, $\\vec{v}$ = eigenvector\n\n### Key Results:\n- **Cramer's Rule**: Solve $Ax = b$ using determinants\n- **Inverse**: $A^{-1} = \\frac{1}{\\det(A)} \\text{adj}(A)$\n- **Rank**: Number of linearly independent rows/columns\n\n### Applications:\n- Machine learning (PCA, SVD)\n- Computer graphics (transformations)\n- Quantum mechanics (state spaces)\n- Data science (regression)\n\n**You might also want to know:**\n- How to find eigenvalues step by step?\n- What is SVD and why does it matter?\n- How to solve systems of linear equations?",
        "thinking": "Linear algebra fundamentals. Covering vectors, matrices, eigenvalues. Essential for STEM students.",
    },
    "what is probability and statistics": {
        "answer": "## Probability & Statistics\n\n### Probability Basics:\n$$P(A) = \\frac{\\text{favorable outcomes}}{\\text{total outcomes}}$$\n\n**Key Rules:**\n- Addition: $P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$\n- Multiplication: $P(A \\cap B) = P(A) \\cdot P(B|A)$\n- Bayes' Theorem: $P(A|B) = \\frac{P(B|A) \\cdot P(A)}{P(B)}$\n\n### Distributions:\n| Distribution | PMF/PDF | Mean | Variance |\n|---|---|---|---|\n| Binomial | $\\binom{n}{k}p^k(1-p)^{n-k}$ | $np$ | $np(1-p)$ |\n| Poisson | $\\frac{e^{-\\lambda}\\lambda^k}{k!}$ | $\\lambda$ | $\\lambda$ |\n| Normal | $\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-(x-\\mu)^2/2\\sigma^2}$ | $\\mu$ | $\\sigma^2$ |\n\n### Statistics:\n- **Mean**: $\\bar{x} = \\frac{\\sum x_i}{n}$\n- **Variance**: $\\sigma^2 = \\frac{\\sum(x_i - \\bar{x})^2}{n}$\n- **Standard Deviation**: $\\sigma = \\sqrt{\\sigma^2}$\n\n**You might also want to know:**\n- How to solve Bayes' theorem problems?\n- What is hypothesis testing?\n- How to use the normal distribution table?",
        "thinking": "Probability and statistics. Core math topic with formulas, distributions, and statistical measures.",
    },
    "what is trigonometry": {
        "answer": "## Trigonometry\n\nThe study of relationships between angles and sides of triangles.\n\n### Basic Ratios (Right Triangle):\n$$\\sin\\theta = \\frac{\\text{opposite}}{\\text{hypotenuse}}, \\quad \\cos\\theta = \\frac{\\text{adjacent}}{\\text{hypotenuse}}, \\quad \\tan\\theta = \\frac{\\sin\\theta}{\\cos\\theta}$$\n\n### Key Identities:\n- **Pythagorean**: $\\sin^2\\theta + \\cos^2\\theta = 1$\n- **Double Angle**: $\\sin 2\\theta = 2\\sin\\theta\\cos\\theta$\n- **Sum**: $\\sin(A+B) = \\sin A \\cos B + \\cos A \\sin B$\n\n### Important Values:\n| $\\theta$ | $\\sin$ | $\\cos$ | $\\tan$ |\n|---|---|---|---|\n| 0° | 0 | 1 | 0 |\n| 30° | 1/2 | √3/2 | 1/√3 |\n| 45° | 1/√2 | 1/√2 | 1 |\n| 60° | √3/2 | 1/2 | √3 |\n| 90° | 1 | 0 | ∞ |\n\n### Applications:\nNavigation, physics (waves, oscillations), engineering, astronomy, music theory.\n\n**You might also want to know:**\n- How to prove trigonometric identities?\n- What are inverse trig functions?\n- How is trigonometry used in physics?",
        "thinking": "Trigonometry fundamentals. Covering ratios, identities, and value table. Core math topic.",
    },
    "what is differential equations": {
        "answer": "## Differential Equations\n\nEquations involving derivatives — they model how things change.\n\n### Types:\n- **ODE** (Ordinary): One independent variable — $\\frac{dy}{dx} + P(x)y = Q(x)$\n- **PDE** (Partial): Multiple variables — $\\frac{\\partial^2 u}{\\partial x^2} + \\frac{\\partial^2 u}{\\partial y^2} = 0$\n\n### Common Forms:\n\n**Separable**: $\\frac{dy}{dx} = f(x)g(y) \\implies \\int\\frac{dy}{g(y)} = \\int f(x)dx$\n\n**Linear 1st Order**: $\\frac{dy}{dx} + Py = Q$\nSolution: $y = e^{-\\int P\\,dx}\\left(\\int Qe^{\\int P\\,dx}dx + C\\right)$\n\n**2nd Order Constant Coefficients**: $ay'' + by' + cy = 0$\nCharacteristic equation: $ar^2 + br + c = 0$\n\n### Applications:\n- Population growth: $\\frac{dP}{dt} = kP \\implies P = P_0 e^{kt}$\n- Radioactive decay: $N = N_0 e^{-\\lambda t}$\n- Spring-mass: $m\\ddot{x} + c\\dot{x} + kx = F(t)$\n- Circuit analysis: $L\\frac{di}{dt} + Ri = V$\n\n**You might also want to know:**\n- How to solve separable ODEs step by step?\n- What is the Laplace transform method?\n- How to solve second-order linear ODEs?",
        "thinking": "Differential equations. Covering types, solution methods, applications. Essential for STEM students.",
    },
    # ─── CHEMISTRY ───
    "what is periodic table": {
        "answer": "## The Periodic Table of Elements\n\nOrganized by **atomic number** (protons), the periodic table arranges all known elements by their properties.\n\n### Structure:\n- **Periods** (rows): 7 periods — elements in a period have the same number of electron shells\n- **Groups** (columns): 18 groups — elements in a group have similar chemical properties\n\n### Key Groups:\n| Group | Name | Examples | Properties |\n|---|---|---|---|\n| 1 | Alkali Metals | Li, Na, K | Highly reactive, soft metals |\n| 2 | Alkaline Earth | Be, Mg, Ca | Reactive, form +2 ions |\n| 17 | Halogens | F, Cl, Br, I | Very reactive nonmetals |\n| 18 | Noble Gases | He, Ne, Ar | Stable, unreactive |\n\n### Trends Across a Period (→):\n- Atomic radius **decreases**\n- Ionization energy **increases**\n- Electronegativity **increases**\n- Metallic character **decreases**\n\n### Trends Down a Group (↓):\n- Atomic radius **increases**\n- Ionization energy **decreases**\n- Electronegativity **decreases**\n- Metallic character **increases**\n\n**You might also want to know:**\n- What is electron configuration?\n- How do periodic trends work in detail?\n- What are transition metals?",
        "thinking": "Periodic table fundamentals. Structure, groups, and trends. Core chemistry topic.",
    },
    "what is chemical bonding": {
        "answer": "## Chemical Bonding\n\nAtoms bond to achieve a stable electron configuration (usually an octet).\n\n### Types of Bonds:\n\n**1. Ionic Bond**\n- Transfer of electrons (metal → nonmetal)\n- Example: $\\text{Na}^+ + \\text{Cl}^- \\rightarrow \\text{NaCl}$\n- Properties: High melting point, conducts electricity in solution\n\n**2. Covalent Bond**\n- Sharing of electrons (nonmetal + nonmetal)\n- Example: $\\text{H}_2\\text{O}$ — oxygen shares electrons with two hydrogens\n- Types: Single ($\\sigma$), Double ($\\sigma + \\pi$), Triple ($\\sigma + 2\\pi$)\n\n**3. Metallic Bond**\n- Sea of delocalized electrons\n- Explains conductivity, malleability, luster\n\n### Bond Properties:\n- **Bond Length**: Distance between bonded nuclei\n- **Bond Energy**: Energy to break a bond\n- **Polarity**: Electronegativity difference\n  - Nonpolar: $\\Delta EN < 0.5$\n  - Polar covalent: $0.5 < \\Delta EN < 1.7$\n  - Ionic: $\\Delta EN > 1.7$\n\n### Molecular Geometry (VSEPR):\n- 2 pairs → Linear (180°)\n- 3 pairs → Trigonal planar (120°)\n- 4 pairs → Tetrahedral (109.5°)\n\n**You might also want to know:**\n- How to draw Lewis dot structures?\n- What is hybridization (sp, sp2, sp3)?\n- How does VSEPR theory predict molecular shape?",
        "thinking": "Chemical bonding fundamentals. Ionic, covalent, metallic bonds with properties. Core chemistry.",
    },
    "what is organic chemistry": {
        "answer": "## Organic Chemistry — Chemistry of Carbon Compounds\n\n### Why Carbon?\n- Forms 4 covalent bonds (can chain, branch, form rings)\n- Bonds with C, H, O, N, S, halogens\n\n### Functional Groups:\n| Group | Formula | Name | Example |\n|---|---|---|---|\n| -OH | R-OH | Alcohol | Ethanol |\n| -CHO | R-CHO | Aldehyde | Formaldehyde |\n| -COOH | R-COOH | Carboxylic acid | Acetic acid |\n| -NH₂ | R-NH₂ | Amine | Methylamine |\n| C=C | R₂C=CR₂ | Alkene | Ethylene |\n| -CO- | R-CO-R | Ketone | Acetone |\n\n### Naming (IUPAC):\n1. Find longest carbon chain\n2. Number carbons from nearest substituent\n3. Name substituents with position numbers\n4. Example: 2-methylbutane = 4 carbons, methyl at C-2\n\n### Key Reactions:\n- **Substitution**: $\\text{CH}_4 + \\text{Cl}_2 \\xrightarrow{UV} \\text{CH}_3\\text{Cl} + \\text{HCl}$\n- **Addition**: Alkene + HBr → haloalkane\n- **Elimination**: Alcohol → Alkene + H₂O\n- **Oxidation**: Alcohol → Aldehyde → Carboxylic acid\n\n**You might also want to know:**\n- How to name organic compounds step by step?\n- What is the difference between SN1 and SN2 reactions?\n- How do aromatic compounds work?",
        "thinking": "Organic chemistry fundamentals. Functional groups, naming, reactions. Core chemistry topic for students.",
    },
    # ─── BIOLOGY ───
    "what is cell biology": {
        "answer": "## Cell Biology — The Study of Life's Basic Unit\n\n### Cell Types:\n- **Prokaryotic**: No nucleus (bacteria, archaea)\n- **Eukaryotic**: Has nucleus (plants, animals, fungi)\n\n### Key Organelles:\n| Organelle | Function |\n|---|---|\n| **Nucleus** | DNA storage, gene expression control |\n| **Mitochondria** | ATP production (cellular respiration) |\n| **Ribosome** | Protein synthesis |\n| **ER** (Rough) | Protein processing + transport |\n| **ER** (Smooth) | Lipid synthesis, detox |\n| **Golgi** | Package & ship proteins |\n| **Lysosome** | Digestion of waste |\n| **Chloroplast** | Photosynthesis (plant cells only) |\n| **Cell Wall** | Structural support (plants, bacteria) |\n\n### Cell Division:\n- **Mitosis**: 1 cell → 2 identical cells (growth, repair)\n- **Meiosis**: 1 cell → 4 genetically unique cells (gametes)\n\n### Cell Membrane:\n- Phospholipid bilayer\n- Selectively permeable\n- Transport: Diffusion, osmosis, active transport\n\n**You might also want to know:**\n- How does mitosis differ from meiosis?\n- What is ATP and how is it produced?\n- How does osmosis work?",
        "thinking": "Cell biology fundamentals. Organelles, cell types, division. Core biology topic.",
    },
    "what is genetics": {
        "answer": "## Genetics — The Science of Heredity\n\n### DNA Structure:\n- Double helix of nucleotides (A-T, G-C base pairs)\n- Sugar-phosphate backbone\n- Gene = segment of DNA coding for a protein\n\n### Central Dogma:\n$$\\text{DNA} \\xrightarrow{\\text{transcription}} \\text{mRNA} \\xrightarrow{\\text{translation}} \\text{Protein}$$\n\n### Mendel's Laws:\n1. **Law of Segregation**: Each organism has two alleles per gene; they separate during gamete formation\n2. **Law of Independent Assortment**: Genes for different traits sort independently\n\n### Key Terms:\n- **Genotype**: Genetic makeup (BB, Bb, bb)\n- **Phenotype**: Physical expression (tall, short)\n- **Dominant**: Expressed in Bb\n- **Recessive**: Only expressed in bb\n- **Punnett Square**: Tool for predicting offspring ratios\n\n### DNA Replication:\n- **Semiconservative**: Each new DNA has one old + one new strand\n- Enzymes: Helicase (unwind), DNA Polymerase (copy), Ligase (join)\n\n**You might also want to know:**\n- How to solve Punnett square problems?\n- What are mutations and their types?\n- How does PCR amplify DNA?",
        "thinking": "Genetics fundamentals. DNA, Mendel's laws, central dogma. Core biology topic.",
    },
    "what is photosynthesis": {
        "answer": "## Photosynthesis — How Plants Make Food\n\n### Overall Equation:\n$$6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{light}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2$$\n\n### Two Stages:\n\n**1. Light Reactions** (thylakoid membrane)\n- Absorb sunlight via chlorophyll\n- Split water: $2\\text{H}_2\\text{O} \\rightarrow 4\\text{H}^+ + 4e^- + \\text{O}_2$\n- Produce: ATP + NADPH\n\n**2. Calvin Cycle** (stroma)\n- Use ATP + NADPH to fix CO₂\n- Carbon fixation by RuBisCO enzyme\n- Produce: Glucose (G3P)\n\n### Factors Affecting Rate:\n- Light intensity\n- CO₂ concentration\n- Temperature\n- Water availability\n\n### Chloroplast Structure:\n- **Thylakoids**: Stacked into grana — light reactions occur here\n- **Stroma**: Fluid surrounding thylakoids — Calvin cycle occurs here\n\n**You might also want to know:**\n- What is the difference between C3, C4, and CAM plants?\n- How does cellular respiration relate to photosynthesis?\n- What is the role of chlorophyll in light absorption?",
        "thinking": "Photosynthesis. Light reactions, Calvin cycle, equation. Core biology topic.",
    },
    "what is evolution": {
        "answer": "## Evolution — Change in Species Over Time\n\n### Darwin's Theory of Natural Selection:\n1. **Variation**: Individuals differ in traits\n2. **Competition**: Resources are limited\n3. **Selection**: Individuals with advantageous traits survive and reproduce more\n4. **Inheritance**: Traits are passed to offspring\n\n### Evidence for Evolution:\n- **Fossil record**: Shows gradual changes over time\n- **Comparative anatomy**: Homologous structures (human arm vs whale flipper)\n- **Molecular biology**: DNA similarities across species\n- **Biogeography**: Island species similar to nearby mainland\n- **Embryology**: Similar embryonic development across vertebrates\n\n### Key Concepts:\n- **Speciation**: Formation of new species (geographic isolation + divergence)\n- **Adaptation**: Traits that improve survival\n- **Genetic Drift**: Random changes in small populations\n- **Gene Flow**: Migration introduces new alleles\n\n### Hardy-Weinberg Equilibrium:\n$$p^2 + 2pq + q^2 = 1$$\nwhere $p$ + $q$ = 1 (allele frequencies)\n\n**You might also want to know:**\n- What is the difference between microevolution and macroevolution?\n- How does speciation occur?\n- What are the types of natural selection?",
        "thinking": "Evolution fundamentals. Natural selection, evidence, Hardy-Weinberg. Core biology.",
    },
    # ─── COMPUTER SCIENCE ───
    "what is data structures and algorithms": {
        "answer": "## Data Structures & Algorithms (DSA)\n\n### Core Data Structures:\n| Structure | Access | Search | Insert | Delete |\n|---|---|---|---|---|\n| **Array** | O(1) | O(n) | O(n) | O(n) |\n| **Linked List** | O(n) | O(n) | O(1) | O(1) |\n| **Stack** (LIFO) | O(1) | O(n) | O(1) | O(1) |\n| **Queue** (FIFO) | O(1) | O(n) | O(1) | O(1) |\n| **Hash Table** | — | O(1) avg | O(1) avg | O(1) avg |\n| **BST** | O(log n) | O(log n) | O(log n) | O(log n) |\n\n### Essential Algorithms:\n\n**Sorting:**\n- Bubble: O(n²) — simple but slow\n- Merge: O(n log n) — divide & conquer, stable\n- Quick: O(n log n) avg — fast, in-place\n\n**Searching:**\n- Linear: O(n)\n- Binary: O(log n) — requires sorted array\n\n**Graph:**\n- BFS: Level-by-level traversal\n- DFS: Deep exploration first\n- Dijkstra: Shortest path\n\n### Big O Notation:\n$$O(1) < O(\\log n) < O(n) < O(n \\log n) < O(n^2) < O(2^n)$$\n\n**You might also want to know:**\n- How to implement binary search step by step?\n- What is dynamic programming?\n- How to solve tree/graph problems?",
        "thinking": "DSA fundamentals. Complexity table, sorting, searching, graphs. Core CS topic every programmer must know.",
    },
    "what is operating system": {
        "answer": "## Operating Systems (OS)\n\nSoftware that manages hardware and provides services for programs.\n\n### Core Functions:\n- **Process Management**: Create, schedule, terminate processes\n- **Memory Management**: Allocate/deallocate RAM, virtual memory\n- **File System**: Organize data on storage devices\n- **I/O Management**: Handle device drivers and peripherals\n- **Security**: User authentication, access control\n\n### Process Scheduling:\n| Algorithm | Type | Advantage |\n|---|---|---|\n| **FCFS** | Non-preemptive | Simple |\n| **SJF** | Non-preemptive | Minimum avg wait |\n| **Round Robin** | Preemptive | Fair, good for time-sharing |\n| **Priority** | Both | Urgent tasks first |\n\n### Key Concepts:\n- **Deadlock**: Processes blocked waiting for each other\n  - Conditions: Mutual exclusion, Hold & wait, No preemption, Circular wait\n- **Virtual Memory**: Uses disk as extended RAM (paging)\n- **Context Switch**: Saving/restoring process state\n- **Threads vs Processes**: Threads share memory, processes don't\n\n### Examples:\nWindows, Linux, macOS, Android, iOS\n\n**You might also want to know:**\n- How does virtual memory and paging work?\n- What is a deadlock and how to prevent it?\n- How does Linux differ from Windows internally?",
        "thinking": "Operating systems fundamentals. Process management, scheduling, deadlock. Core CS topic.",
    },
    "what is object oriented programming": {
        "answer": "## Object-Oriented Programming (OOP)\n\nA programming paradigm based on objects that contain data and behavior.\n\n### Four Pillars:\n\n**1. Encapsulation**\nBundling data + methods, hiding internals.\n```python\nclass BankAccount:\n    def __init__(self):\n        self.__balance = 0  # private\n    def deposit(self, amount):\n        self.__balance += amount\n```\n\n**2. Inheritance**\nChild class inherits from parent class.\n```python\nclass Animal:\n    def speak(self): pass\nclass Dog(Animal):\n    def speak(self): return \"Woof!\"\n```\n\n**3. Polymorphism**\nSame interface, different behavior.\n```python\ndef make_sound(animal: Animal):\n    print(animal.speak())  # Works for Dog, Cat, etc.\n```\n\n**4. Abstraction**\nHide complexity, show only essentials.\n```python\nfrom abc import ABC, abstractmethod\nclass Shape(ABC):\n    @abstractmethod\n    def area(self): pass\n```\n\n### OOP vs Functional:\n| OOP | Functional |\n|---|---|\n| State + behavior together | Pure functions, no side effects |\n| Objects communicate | Data flows through functions |\n| Java, C++, Python | Haskell, Elixir, Lisp |\n\n**You might also want to know:**\n- What are design patterns in OOP?\n- What is SOLID principle?\n- When to use OOP vs functional programming?",
        "thinking": "OOP fundamentals. Four pillars with Python code examples. Core CS concept.",
    },
    "what is database management": {
        "answer": "## Database Management Systems (DBMS)\n\nSoftware to store, retrieve, and manage data efficiently.\n\n### Types:\n- **Relational (SQL)**: Tables with rows/columns — MySQL, PostgreSQL, SQLite\n- **NoSQL**: Flexible schemas — MongoDB (document), Redis (key-value), Neo4j (graph)\n- **Cloud**: Firestore, DynamoDB, Cosmos DB\n\n### SQL Essentials:\n```sql\n-- Create\nCREATE TABLE students (id INT PRIMARY KEY, name VARCHAR(100), grade FLOAT);\n\n-- Insert\nINSERT INTO students VALUES (1, 'Alice', 95.5);\n\n-- Query\nSELECT name, grade FROM students WHERE grade > 90 ORDER BY grade DESC;\n\n-- Join\nSELECT s.name, c.title FROM students s\nJOIN enrollments e ON s.id = e.student_id\nJOIN courses c ON e.course_id = c.id;\n```\n\n### Normalization:\n- **1NF**: No repeating groups\n- **2NF**: No partial dependencies\n- **3NF**: No transitive dependencies\n- **BCNF**: Every determinant is a candidate key\n\n### ACID Properties:\n- **Atomicity**: All or nothing\n- **Consistency**: Valid state to valid state\n- **Isolation**: Concurrent transactions don't interfere\n- **Durability**: Committed data survives crashes\n\n**You might also want to know:**\n- SQL vs NoSQL — when to use which?\n- How to design a database schema?\n- What is indexing and how does it speed up queries?",
        "thinking": "Database management fundamentals. SQL, types, normalization, ACID. Core CS topic.",
    },
}

# Additional keyword → answer mappings for common queries
GREETING_RESPONSES = {
    "hi": "Hey there! 👋 I'm **Credon AI**, your intelligent assistant. How can I help you today?\n\n**You might also want to know:**\n- What can Credon AI do?\n- Tell me a fun fact\n- Help me with a coding problem",
    "hii": "Hey there! 👋 I'm **Credon AI**, your intelligent assistant. How can I help you today?\n\n**You might also want to know:**\n- What can Credon AI do?\n- Tell me a fun fact\n- Help me with a coding problem",
    "hiii": "Hey there! 👋 I'm **Credon AI**, your intelligent assistant. How can I help you today?\n\n**You might also want to know:**\n- What can Credon AI do?\n- Tell me a fun fact\n- Help me with a coding problem",
    "hello": "Hello! 👋 I'm **Credon AI** — ready to search, think, and solve. What would you like to explore?\n\n**You might also want to know:**\n- What are your capabilities?\n- Search something for me\n- Help me understand a concept",
    "hellooo": "Hello! 👋 I'm **Credon AI** — ready to search, think, and solve. What would you like to explore?\n\n**You might also want to know:**\n- What are your capabilities?\n- Search something for me\n- Help me understand a concept",
    "hey": "Hey! 👋 What's on your mind? I'm here to help with anything — research, math, coding, or just chatting!\n\n**You might also want to know:**\n- What can you do?\n- Explain something to me\n- Help me with my work",
    "hola": "¡Hola! 👋 I'm **Credon AI**. How can I help you today?\n\n**You might also want to know:**\n- What can you do?\n- Search something for me\n- Help me understand a concept",
    "yo": "Yo! 👋 What's good? I'm Credon AI — here to help with anything you need!\n\n**You might also want to know:**\n- What can you do?\n- Search the web for something\n- Help me with coding",
    "sup": "Hey! 👋 What's up? I'm Credon AI — ready when you are!\n\n**You might also want to know:**\n- What can you do?\n- Help me with a problem\n- Search for something",
    "good morning": "Good morning! ☀️ Hope you're having a great start to your day. What can I help you with?\n\n**You might also want to know:**\n- What's the latest news?\n- Give me a productivity tip\n- Help me plan my day",
    "good afternoon": "Good afternoon! 🌤️ How can I assist you today?\n\n**You might also want to know:**\n- Search something for me\n- Help me with a problem\n- Teach me something new",
    "good evening": "Good evening! 🌙 What would you like to explore or learn about?\n\n**You might also want to know:**\n- Summarize a topic for me\n- Help me with homework\n- Tell me something interesting",
    "good night": "Good night! 🌙 Before you go, is there anything I can help with?\n\n**You might also want to know:**\n- Set a reminder topic for tomorrow\n- Give me a fun fact to sleep on\n- Help me with something quick",
    "thanks": "You're welcome! 😊 Glad I could help. Is there anything else you'd like to know?\n\n**You might also want to know:**\n- Ask me another question\n- Dive deeper into the topic\n- Explore something new",
    "thank you": "You're welcome! 😊 Happy to help. Feel free to ask me anything else!\n\n**You might also want to know:**\n- Explore a related topic\n- Ask a follow-up question\n- Try a different subject",
    "bye": "Goodbye! 👋 Remember, I'm always here whenever you need help. Have a great day!\n\n**You might also want to know:**\n- Save this conversation\n- Come back with more questions\n- Share Credon AI with friends",
    "ok": "Got it! 👍 Need anything else? I'm here to help.\n\n**You might also want to know:**\n- Ask me something new\n- Search the web for something\n- Help me with a problem",
    "okay": "Alright! 👍 What would you like to do next?\n\n**You might also want to know:**\n- Ask another question\n- Explore a topic\n- Help with coding or math",
}

# ── Self-Learning Store ──────────────────────────────────────────

_learned_qa: list[dict[str, Any]] = []
_feedback_memory: dict[str, dict[str, Any]] = {}


def _normalize_question(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return re.sub(r"[^a-z0-9\s_\-\+\#]", "", normalized)


def _answer_signature(answer: str) -> str:
    compact = re.sub(r"\s+", " ", answer.strip().lower())
    return compact[:220]


def _looks_math_query(text: str) -> bool:
    return bool(
        re.search(
            r"\d+\s*[+\-*/^]\s*\d+|\b(calculate|solve|compute|evaluate|integral|derivative|equation|simplify|factor|percent|ratio|sum|product|sqrt|sin|cos|tan|log)\b",
            text.lower(),
        )
    )


def _load_learned() -> None:
    """Load previously learned Q&A pairs from disk."""
    global _learned_qa
    if _LEARNED_FILE.exists():
        try:
            data = json.loads(_LEARNED_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                entries = cast(list[Any], data)
                _learned_qa = [
                    cast(dict[str, str], item)
                    for item in entries
                    if isinstance(item, dict)
                ]
            print(f"[Credon Brain] Loaded {len(_learned_qa)} learned Q&A pairs")
        except Exception as e:
            print(f"[Credon Brain] Failed to load learned data: {e}")
            _learned_qa = []


def _load_feedback() -> None:
    global _feedback_memory
    if _FEEDBACK_FILE.exists():
        try:
            data = json.loads(_FEEDBACK_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _feedback_memory = cast(dict[str, dict[str, Any]], data)
        except Exception as e:
            print(f"[Credon Brain] Failed to load feedback memory: {e}")
            _feedback_memory = {}


def _save_learned() -> None:
    """Persist learned Q&A pairs to disk."""
    with _LOCK:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp = _LEARNED_FILE.with_suffix(".tmp")
        temp.write_text(
            json.dumps(_learned_qa, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp.replace(_LEARNED_FILE)


def _save_feedback() -> None:
    with _LOCK:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp = _FEEDBACK_FILE.with_suffix(".tmp")
        temp.write_text(
            json.dumps(_feedback_memory, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp.replace(_FEEDBACK_FILE)


def register_feedback(
    question: str,
    answer: str,
    vote: str,
    category: str | None = None,
    reason: str | None = None,
) -> None:
    q = _normalize_question(question)
    if not q or not answer.strip():
        return

    ans_sig = _answer_signature(answer)
    with _LOCK:
        bucket = _feedback_memory.setdefault(
            q,
            {
                "upvotes": 0,
                "downvotes": 0,
                "blocked_answers": [],
                "events": [],
            },
        )
        if vote == "up":
            bucket["upvotes"] = int(bucket.get("upvotes", 0)) + 1
            blocked = cast(list[str], bucket.get("blocked_answers", []))
            if ans_sig in blocked:
                blocked.remove(ans_sig)
                bucket["blocked_answers"] = blocked
        elif vote == "down":
            bucket["downvotes"] = int(bucket.get("downvotes", 0)) + 1
            blocked = cast(list[str], bucket.get("blocked_answers", []))
            if ans_sig not in blocked:
                blocked.append(ans_sig)
            bucket["blocked_answers"] = blocked[-30:]

        events = cast(list[dict[str, str]], bucket.get("events", []))
        events.append(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "vote": vote,
                "category": category or "",
                "reason": (reason or "")[:300],
            }
        )
        bucket["events"] = events[-80:]

        for existing in _learned_qa:
            if _normalize_question(str(existing.get("question", ""))) != q:
                continue
            if _answer_signature(str(existing.get("answer", ""))) != ans_sig:
                continue
            if vote == "up":
                existing["upvotes"] = int(existing.get("upvotes", 0)) + 1
                existing["confidence"] = "high"
                existing["quality_score"] = int(existing.get("quality_score", 0)) + 2
            elif vote == "down":
                existing["downvotes"] = int(existing.get("downvotes", 0)) + 1
                existing["quality_score"] = int(existing.get("quality_score", 0)) - 3
                existing["confidence"] = "low"

        _save_feedback()
        _save_learned()


def learn_from_conversation(question: str, answer: str, confidence: str = "medium") -> None:
    """IMPROVED: Stricter quality filters for self-learning.
    Called after every successful answer generation."""
    if not question.strip() or not answer.strip():
        return
    if len(answer) < 50:  # Increased from 20
        return
    if confidence == "low":
        return

    q = question.strip().lower()

    # EXPANDED blocked question patterns
    blocked_question_markers = [
        "[replying to previous answer]",
        "[user attached",
        "summarize this",
        "explain this in simpler",
        "regenerate",
        "simplify",
        "tl;dr",
        "can you explain",
        "what are the latest",
    ]
    if any(marker in q for marker in blocked_question_markers):
        return

    if len(q.split()) <= 2 and q not in {"who am i", "what is my name"}:
        return

    # EXPANDED blocked answer patterns
    blocked_answer_markers = [
        "while i'm building a deeper understanding",
        "try enabling web search",
        "i'm continuously learning",
        "analyzing the query and searching",
        "building a comprehensive response",
        "here's what i found about",
        "huntington ingalls",  # Specific bad example
    ]
    if any(marker in answer.lower() for marker in blocked_answer_markers):
        return
    if answer.strip().startswith("The answer is:") and not _looks_math_query(question):
        return
    # Don't save error messages
    if "backend" in answer.lower() and "running" in answer.lower():
        return
    if "warming up" in answer.lower():
        return

    # NEW: Relevance check - question and answer should share keywords
    q_words = set(re.findall(r'\w{4,}', q))
    a_words = set(re.findall(r'\w{4,}', answer.lower()))
    overlap = len(q_words & a_words)
    if overlap < 2:  # At least 2 shared meaningful words
        return

    entry = {
        "question": q,
        "answer": answer.strip(),
        "confidence": confidence,
        "quality_score": 1,
        "upvotes": 0,
        "downvotes": 0,
        "learned_at": datetime.now(timezone.utc).isoformat(),
    }

    with _LOCK:
        # Avoid exact duplicates
        for existing in _learned_qa:
            if existing.get("question") == entry["question"]:
                # Update with newer/better answer
                existing["answer"] = entry["answer"]
                existing["confidence"] = entry["confidence"]
                existing["learned_at"] = entry["learned_at"]
                existing["quality_score"] = int(existing.get("quality_score", 0)) + 1
                _save_learned()
                return
        _learned_qa.append(entry)
        # Keep max 10000 entries
        if len(_learned_qa) > 10000:
            _learned_qa.pop(0)
        _save_learned()
    print(f"[Credon Brain] Learned: '{question[:60]}...' (total: {len(_learned_qa)})")


def _similarity(a: str, b: str) -> float:
    """Simple similarity score between two strings."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


_STOPWORDS = {
    "what", "is", "are", "the", "a", "an", "in", "on", "for", "to", "of", "and", "or",
    "how", "why", "when", "where", "who", "with", "about", "tell", "me", "explain", "simple",
}


def _key_terms(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-zA-Z0-9_]{3,}", text.lower())
        if w not in _STOPWORDS
    }


def find_learned_answer(query: str) -> dict[str, str] | None:
    """Search learned Q&A pairs for a similar past answer."""
    q = query.strip().lower()
    best_match = None
    best_score = 0.0

    q_terms = _key_terms(q)
    for entry in _learned_qa:
        e_terms = _key_terms(entry["question"])
        if q_terms and e_terms and len(q_terms & e_terms) < 2:
            continue
        q_key = _normalize_question(str(entry.get("question", "")))
        feedback = _feedback_memory.get(q_key, {})
        blocked_answers = cast(list[str], feedback.get("blocked_answers", []))
        if _answer_signature(str(entry.get("answer", ""))) in blocked_answers:
            continue

        score = _similarity(q, entry["question"])
        quality_score = int(entry.get("quality_score", 0))
        score += min(max(quality_score * 0.02, -0.12), 0.12)
        upvotes = int(entry.get("upvotes", 0))
        downvotes = int(entry.get("downvotes", 0))
        score += min((upvotes - downvotes) * 0.01, 0.08)
        if score > best_score:
            best_score = score
            best_match = entry

    # Require stronger match to avoid unrelated learned answers.
    if best_match and best_score > 0.68:
        return best_match
    return None


# ── Math Engine ──────────────────────────────────────────────────

def _try_math(query: str) -> str | None:
    """Try to solve simple math expressions directly."""
    # Clean up the query
    q = query.lower().strip()

    # Only engage math eval when the query actually looks mathematical.
    if not _looks_math_query(q):
        return None

    q = re.sub(r"(what is|calculate|solve|compute|evaluate)\s*", "", q)
    q = re.sub(r"[?!.]$", "", q).strip()

    # Try direct evaluation of simple expressions
    # Only allow safe math characters
    safe_expr = re.sub(r"[^0-9+\-*/().^ ]", "", q)
    safe_expr = safe_expr.replace("^", "**")  # Convert ^ to Python power

    if safe_expr and re.match(r"^[\d+\-*/().** ]+$", safe_expr):
        try:
            # Safe eval with only math builtins
            result = eval(safe_expr, {"__builtins__": {}}, {
                "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos,
                "tan": math.tan, "log": math.log, "pi": math.pi, "e": math.e,
                "abs": abs, "pow": pow, "round": round,
            })
            if isinstance(result, (int, float)):
                if isinstance(result, float) and result.is_integer():
                    result = int(result)
                return (
                    f"The answer is:\n\n$${''.join(safe_expr.split())} = {result}$$\n\n"
                    f"**You might also want to know:**\n"
                    f"- Try a more complex calculation\n"
                    f"- Explain step by step\n"
                    f"- Help with algebra or calculus"
                )
        except Exception:
            pass
    return None


# ── Main Brain Interface ─────────────────────────────────────────

def credon_think(query: str, sources: list[dict[str, Any]] | None = None) -> str:
    """Generate a thinking/reasoning trace for the query — structured like DeepSeek's chain-of-thought."""
    q = query.strip().lower()
    q_norm = re.sub(r"\bai\b", "artificial intelligence", q)

    # Check knowledge base
    for key, entry in KNOWLEDGE_BASE.items():
        if _similarity(q_norm, key) > 0.65:
            thinking = entry.get("thinking", "")
            if thinking:
                return (
                    f"Hmm, the user is asking about \"{query}\". "
                    f"This is a topic I know well from my knowledge base.\n\n"
                    f"{thinking}\n\n"
                    f"I'll provide a comprehensive, well-structured answer with clear explanations and follow-up suggestions."
                )
            return f"The user asks about \"{query}\". I have strong knowledge on this topic. Will provide a thorough answer."

    # Check if math
    if _try_math(query):
        return (
            f"This is a mathematical expression: \"{query}\". "
            "I'll compute this directly using my built-in math engine. "
            "Let me break it down step by step and show the work."
        )

    # Check sources — structured analysis
    if sources and len(sources) >= 2:
        titles = [s.get("title", "")[:60] for s in sources[:4]]
        snippets_preview = "; ".join(
            (s.get("snippet", "")[:80] + "...") for s in sources[:3] if s.get("snippet")
        )
        return (
            f"The user asks: \"{query}\"\n\n"
            f"I have {len(sources)} sources to work with. Let me analyze them:\n"
            f"- Sources: {', '.join(titles)}\n"
            f"- Key content: {snippets_preview}\n\n"
            f"My approach: I'll synthesize the most relevant information from these sources, "
            f"identify the main points, check for consensus across sources, and compose "
            f"a clear, well-structured answer with proper formatting."
        )
    elif sources and len(sources) == 1:
        title = sources[0].get("title", "Source")
        return (
            f"The user asks: \"{query}\"\n\n"
            f"I have one source: \"{title}\". I'll extract the key information and "
            f"supplement with my built-in knowledge to provide a complete answer."
        )

    # Check learned
    learned = find_learned_answer(query)
    if learned:
        return (
            f"I've seen a similar question before (confidence: {learned.get('confidence', 'medium')}). "
            f"Let me adapt my previous answer to best fit this specific query."
        )

    # General reasoning
    word_count = len(q.split())
    if word_count <= 4:
        return f"Simple query: \"{query}\". I'll give a concise, direct answer."
    return (
        f"Analyzing: \"{query}\"\n\n"
        f"This looks like a {'complex' if word_count > 12 else 'moderate'} question. "
        f"I'll search my knowledge base, evaluate what I know, and provide "
        f"the best possible answer with supporting details."
    )


def credon_answer(
    query: str,
    sources: list[dict[str, Any]] | None = None,
    target_language: str = "en",
) -> str | None:
    """Try to answer using Credon Brain's built-in intelligence.
    Returns None if no good answer found (should fallback to Ollama).
    Returns answer string if Brain can handle it."""
    q = query.strip().lower()
    q_norm = re.sub(r"\bai\b", "artificial intelligence", q)

    # 1. Check greetings — normalize repeated chars (hiii→hi, hellooo→hello)
    q_greeting = re.sub(r'(.)\1{2,}', r'\1\1', q)  # collapse 3+ repeats to 2
    for greeting, response in GREETING_RESPONSES.items():
        if q_greeting == greeting or q == greeting:
            return response
    for greeting, response in GREETING_RESPONSES.items():
        if q == greeting or q.startswith(greeting + " ") or q.rstrip("!?.") == greeting:
            return response

    q_terms = _key_terms(q_norm)

    # 2. Multi-strategy knowledge matching with relevance guard
    best_match = None
    best_score = 0.0

    for key, entry in KNOWLEDGE_BASE.items():
        key_terms = _key_terms(key)
        term_overlap = len(q_terms & key_terms) if q_terms and key_terms else 0

        # For content queries, skip entries with no meaningful term overlap.
        if q_terms and term_overlap == 0:
            continue

        # Strategy 1: Direct similarity
        sim = _similarity(q_norm, key)
        if sim > best_score:
            best_score = sim
            best_match = entry

        # Strategy 2: Keyword overlap (NEW)
        q_words = set(q_norm.split())
        key_words = set(key.split())
        overlap = len(q_words & key_words)
        keyword_score = overlap / max(len(key_words), 1)

        if keyword_score > 0.5 and overlap >= 2:
            if keyword_score > best_score:
                best_score = keyword_score
                best_match = entry

    # Keep threshold moderate but enforce relevance through term overlap guard above.
    if best_match and best_score > 0.58:
        return best_match["answer"]

    # 3. Try math
    math_answer = _try_math(query)
    if math_answer:
        return math_answer

    # 4. Check learned Q&A with LOWER threshold
    learned = find_learned_answer(query)
    if learned:
        return learned["answer"]

    # 5. IMPROVED: Source synthesis with better prompts
    if sources:
        return _answer_from_sources_improved(query, sources, target_language)

    # 6. No answer available from Brain
    return None


def _answer_from_sources_improved(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
) -> str:
    """Better source synthesis - clearer and more direct."""
    if not sources:
        if target_language == "hinglish":
            return (
                f"'{query}' ke baare mein mujhe sources nahi mile. "
                "Web search enable karo ya question ko specific banao."
            )
        return (
            f"I couldn't find sources for **\"{query}\"**. "
            "Try enabling web search or making your question more specific."
        )

    # Extract best points from sources
    main_point = ""
    supporting_points: list[str] = []

    for s in sources[:4]:
        snippet = (s.get("snippet") or "").strip()
        if not snippet:
            continue

        # Take first strong sentence as main point
        sentences = re.split(r'(?<=[.!?])\s+', snippet)
        clean_sentences = [sent.strip() for sent in sentences if len(sent.strip()) > 20]

        if not main_point and clean_sentences:
            main_point = clean_sentences[0]
        elif clean_sentences:
            supporting_points.append(clean_sentences[0])

    if not main_point:
        main_point = "Based on available sources"

    # Build answer based on language
    if target_language == "hinglish":
        support_text = "\n".join(f"- {p}" for p in supporting_points[:2])
        return (
            f"**{query}** ke baare mein:\n\n"
            f"{main_point}\n\n"
            f"**Main points:**\n{support_text}\n\n"
            f"**Sources:**\n" +
            "\n".join(f"- [{s['title']}]({s['url']})" for s in sources[:3]) +
            "\n\n**Aap yeh bhi pooch sakte ho:**\n"
            "- Isko aur detail mein samjhao?\n"
            "- Koi example do?\n"
            "- Related topics kya hain?"
        )

    support_text = "\n".join(f"- {p}" for p in supporting_points[:2])
    return (
        f"**{query}**\n\n"
        f"{main_point}\n\n"
        f"**Key points:**\n{support_text}\n\n"
        f"**Sources:**\n" +
        "\n".join(f"- [{s['title']}]({s['url']})" for s in sources[:3]) +
        "\n\n**You might also want to know:**\n"
        "- Can you explain this in more detail?\n"
        "- Can you give an example?\n"
        "- What are related topics?"
    )


# ── Initialize on import ─────────────────────────────────────────

_load_learned()
_load_feedback()
print(f"[Credon Brain] Initialized with {len(KNOWLEDGE_BASE)} knowledge entries + {len(_learned_qa)} learned pairs")
