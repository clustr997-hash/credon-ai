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
}

# Additional keyword → answer mappings for common queries
GREETING_RESPONSES = {
    "hi": "Hey there! 👋 I'm **Credon AI**, your intelligent assistant. How can I help you today?\n\n**You might also want to know:**\n- What can Credon AI do?\n- Tell me a fun fact\n- Help me with a coding problem",
    "hello": "Hello! 👋 I'm **Credon AI** — ready to search, think, and solve. What would you like to explore?\n\n**You might also want to know:**\n- What are your capabilities?\n- Search something for me\n- Help me understand a concept",
    "hey": "Hey! 👋 What's on your mind? I'm here to help with anything — research, math, coding, or just chatting!\n\n**You might also want to know:**\n- What can you do?\n- Explain something to me\n- Help me with my work",
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

_learned_qa: list[dict[str, str]] = []


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


def learn_from_conversation(question: str, answer: str, confidence: str = "medium") -> None:
    """Save a Q&A pair so Credon gets smarter over time.
    Called after every successful answer generation."""
    if not question.strip() or not answer.strip():
        return
    if len(answer) < 20:  # Skip trivially short answers
        return
    if confidence == "low":
        return

    q = question.strip().lower()
    blocked_question_markers = [
        "[replying to previous answer]",
        "[user attached",
        "summarize this in",
        "explain this in simpler words",
        "regenerate",
    ]
    if any(marker in q for marker in blocked_question_markers):
        return

    if len(q.split()) <= 2 and q not in {"who am i", "what is my name"}:
        return

    blocked_answer_markers = [
        "while i'm building a deeper understanding",
        "try enabling web search",
        "i'm continuously learning and improving",
            "analyzing the query and searching my knowledge base",
            "building a comprehensive response based on available information",
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

    entry = {
        "question": q,
        "answer": answer.strip(),
        "confidence": confidence,
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


def find_learned_answer(query: str) -> dict[str, str] | None:
    """Search learned Q&A pairs for a similar past answer."""
    q = query.strip().lower()
    best_match = None
    best_score = 0.0

    for entry in _learned_qa:
        score = _similarity(q, entry["question"])
        if score > best_score:
            best_score = score
            best_match = entry

    # Require >70% match to return a learned answer
    if best_match and best_score > 0.70:
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
    """Generate a thinking/reasoning trace for the query."""
    q = query.strip().lower()
    q_norm = re.sub(r"\bai\b", "artificial intelligence", q)

    # Check knowledge base
    for key, entry in KNOWLEDGE_BASE.items():
        if _similarity(q_norm, key) > 0.65:
            return entry.get("thinking", "Analyzing query using built-in knowledge. High confidence.")

    # Check if math
    if _try_math(query):
        return "Mathematical expression detected. Computing directly using Credon's built-in math engine. High confidence."

    # Check sources
    if sources:
        titles = [s.get("title", "")[:50] for s in sources[:3]]
        return f"Analyzing {len(sources)} web sources. Most relevant: {', '.join(titles)}. Will synthesize key points into a comprehensive answer."

    # Check learned
    learned = find_learned_answer(query)
    if learned:
        return f"Found a similar question in my knowledge base (confidence: {learned.get('confidence', 'medium')}). Adapting previous answer."

    return "Analyzing the query and searching my knowledge base. Will provide the best answer I can."


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

    # 1. Check greetings
    for greeting, response in GREETING_RESPONSES.items():
        if q == greeting or q.startswith(greeting + " ") or q.rstrip("!?.") == greeting:
            return response

    # 2. Check exact knowledge base matches
    for key, entry in KNOWLEDGE_BASE.items():
        sim = _similarity(q_norm, key)
        if sim > 0.65:
            return entry["answer"]

    # 3. Partial knowledge base matching (keyword overlap)
    q_words = set(q_norm.split())
    for key, entry in KNOWLEDGE_BASE.items():
        key_words = set(key.split())
        overlap = len(q_words & key_words) / max(len(key_words), 1)
        if overlap > 0.6 and len(q_words & key_words) >= 2:
            return entry["answer"]

    # 4. Try math
    math_answer = _try_math(query)
    if math_answer:
        return math_answer

    # 5. Check learned Q&A pairs
    learned = find_learned_answer(query)
    if learned:
        return learned["answer"]

    # 6. If we have web sources, build an answer from them
    if sources:
        return _answer_from_sources(query, sources, target_language)

    # 7. No answer available from Brain
    return None


def _answer_from_sources(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
) -> str:
    """Synthesize an answer from web sources when no AI model is available."""
    points: list[str] = []
    source_refs: list[str] = []

    for s in sources[:4]:
        snippet = (s.get("snippet") or "").strip()
        title = s.get("title", "Source")
        url = s.get("url", "")
        if snippet:
            sentences = re.split(r"(?<=[.!?])\s+", snippet)
            clean = " ".join(sentences[:2])[:280]
            clean = re.sub(r"\s+", " ", clean).strip()
            if clean:
                points.append(clean)
            if url:
                source_refs.append(f"[{title}]({url})")

    if not points:
        return (
            f"I searched for information about **\"{query}\"** but couldn't extract detailed content.\n\n"
            f"Try rephrasing your question with more specific terms!\n\n"
            f"**You might also want to know:**\n"
            f"- Can you break this down differently?\n"
            f"- What specific aspect interests you?\n"
            f"- Try enabling web search for better results"
        )

    lead = points[0]
    extras = points[1:4]
    refs = "\n".join(f"- {r}" for r in source_refs[:3])

    if target_language == "hinglish":
        extra_block = "\n".join(f"- {p}" for p in extras)
        return (
            f"Simple answer: {lead}\n\n"
            f"Agar easy terms mein samjhein, toh main points yeh hain:\n"
            f"{extra_block if extra_block else '- Is topic ke liye official source verify karna best hai.'}\n\n"
            f"**Sources:**\n{refs}\n\n"
            f"**Aap yeh bhi pooch sakte ho:**\n"
            f"- Isko aur simple mein samjhao\n"
            f"- Iske latest updates kya hain?\n"
            f"- Koi related topic explore karein?"
        )

    extra_block = "\n".join(f"- {p}" for p in extras)
    return (
        f"Short answer: {lead}\n\n"
        f"In simpler terms, the key points are:\n"
        f"{extra_block if extra_block else '- Check official sources for exact details.'}\n\n"
        f"**Sources:**\n{refs}\n\n"
        f"**You might also want to know:**\n"
        f"- Can you explain this in simpler terms?\n"
        f"- What are the latest developments?\n"
        f"- Are there related topics to explore?"
    )


# ── Initialize on import ─────────────────────────────────────────

_load_learned()
print(f"[Credon Brain] Initialized with {len(KNOWLEDGE_BASE)} knowledge entries + {len(_learned_qa)} learned pairs")
