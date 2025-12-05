import os
import io
import csv
from datetime import datetime
from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
from PyPDF2 import PdfReader
import requests
import chromadb
from sentence_transformers import SentenceTransformer

# ============================================================
#                API KEYS & MODEL CONFIG
# ============================================================

GROQ_API_KEY = "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"
LLM_MODEL = "llama-3.1-8b-instant"

embedder = SentenceTransformer("all-MiniLM-L6-v2")

# ============================================================
#                 CHROMA CLOUD CONNECTION
# ============================================================

client = chromadb.CloudClient(
  api_key='ck-7qRWtAZw2Cd3vfKX2V2HK7yKPV5VFeZbKJRTvhEh1xnf',
  tenant='9b448e8d-452e-40ed-bbbf-522360d89db1',
  database='Regbot'
)

collection = client.get_or_create_collection("pdf_store")
guideline_collection = client.get_or_create_collection("guidelines_store")

# ============================================================
#                FLASK APP INITIALIZATION
# ============================================================

app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static"
)

CORS(app)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ============================================================
#                    EMBEDDING FUNCTION
# ============================================================

def embed(texts):
    try:
        return embedder.encode(texts).tolist()
    except Exception as e:
        print("Embedding failed:", e)
        return None

# ============================================================
#                      GROQ CHAT
# ============================================================

def groq_chat(messages):
    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={"model": LLM_MODEL, "messages": messages},
            timeout=60
        )
        return r.json()["choices"][0]["message"]["content"]

    except Exception as e:
        return f"Chat Error: {str(e)}"

# ============================================================
#              GUIDELINE EXTRACTION FUNCTION
# ============================================================

def extract_guidelines(text):
    keywords = ["must", "should", "required", "ensure", "mandatory", "not allowed"]
    gl = []

    for line in text.split("\n"):
        if any(k in line.lower() for k in keywords):
            if len(line.strip()) > 8:
                gl.append(line.strip())

    return gl[:100]

# ============================================================
#                    HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return jsonify({"ok": True})

# ============================================================
#                    PDF UPLOAD
# ============================================================

@app.post("/upload_pdf")
def upload_pdf():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF received"}), 400

    f = request.files["pdf"]
    category = request.form.get("category", "DOC")

    save_path = os.path.join(UPLOAD_DIR, f.filename)
    f.save(save_path)

    # Extract PDF text
    try:
        reader = PdfReader(save_path)
    except:
        return jsonify({"error": "Invalid PDF file"}), 400

    text = ""
    for p in reader.pages:
        try:
            text += p.extract_text() or ""
        except:
            pass

    doc_id = f"{datetime.now().timestamp()}-{f.filename}"

    vec = embed([text])
    if not vec:
        return jsonify({"error": "Embedding Error"}), 500

    collection.add(
        ids=[doc_id],
        documents=[text],
        embeddings=vec,
        metadatas=[{
            "file": f.filename,
            "category": category,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
    )

    # Extract guidelines
    guidelines = extract_guidelines(text)

    if guidelines:
        guideline_collection.add(
            ids=[f"g-{doc_id}-{i}" for i in range(len(guidelines))],
            documents=guidelines,
            embeddings=embed(guidelines),
            metadatas=[{"source": doc_id}] * len(guidelines)
        )

    return jsonify({
        "id": doc_id,
        "preview": text[:300],
        "guidelines": len(guidelines)
    })

# ============================================================
#                 GET GUIDELINES
# ============================================================

@app.get("/get_guidelines")
def get_guidelines():
    data = guideline_collection.get(include=["documents", "metadatas"])

    docs = data.get("documents", [])
    meta = data.get("metadatas", [])

    out = []
    for i, g in enumerate(docs):
        out.append({"guideline": g, "source": meta[i].get("source", "unknown")})

    return jsonify({"guidelines": out})

# ============================================================
#                        ALL PDF RECORDS
# ============================================================

@app.get("/all_pdfs")
def all_pdfs():
    search = (request.args.get("search") or "").lower()
    page = int(request.args.get("page") or 1)
    PAGE = 50

    data = collection.get(include=["documents", "metadatas"])
    ids = data.get("ids", [])
    texts = data.get("documents", [])
    meta = data.get("metadatas", [])

    results = []
    for i, doc_id in enumerate(ids):
        preview = (texts[i] or "")[:250]
        cat = meta[i].get("category", "")

        if search in preview.lower() or search in cat.lower():
            results.append({
                "id": doc_id,
                "category": cat,
                "date": meta[i].get("date", ""),
                "file": meta[i].get("file", ""),
                "preview": preview
            })

    start = (page - 1) * PAGE
    end = start + PAGE

    return jsonify({
        "total": len(results),
        "data": results[start:end]
    })

# ============================================================
#                        DASHBOARD
# ============================================================

@app.get("/dashboard_stats")
def dashboard_stats():
    # FIX: remove "ids" from include
    data = collection.get(include=["metadatas"])

    metas = data.get("metadatas", [])
    ids = data.get("ids", [])  # IDs come automatically

    if not metas:
        return jsonify({
            "aml_reviews": 0,
            "transaction_alerts": 0,
            "document_audits": 0,
            "risk_percent": 0
        })

    # FIX: find the latest uploaded PDF
    latest_index = max(range(len(metas)), key=lambda i: metas[i].get("date", ""))

    latest = metas[latest_index]
    last_cat = (latest.get("category") or "").upper()

    # FIX: show only the LAST PDF category
    aml = 1 if last_cat == "AML" else 0
    alerts = 1 if last_cat == "ALERT" else 0
    docs = 1 if last_cat == "DOC" else 0

    # simple risk formula
    risk = alerts * 60 + aml * 30

    return jsonify({
        "aml_reviews": aml,
        "transaction_alerts": alerts,
        "document_audits": docs,
        "risk_percent": min(100, risk)
    })


# ============================================================
#                        ALERTS PIE CHART
# ============================================================

@app.get("/alerts_stats")
def alerts_stats():
    data = collection.get(include=["metadatas"])
    critical = high = medium = low = 0

    for m in data.get("metadatas", []):
        c = (m.get("category") or "").upper()
        if c == "ALERT": critical += 1
        if c == "AML": high += 1
        if c == "DOC": low += 1

    return jsonify({
        "critical": critical,
        "high": high,
        "medium": medium,
        "low": low
    })

# ============================================================
#                        SUMMARY
# ============================================================

@app.post("/summarize")
def summarize():
    doc_id = request.json.get("id")
    if not doc_id:
        return jsonify({"summary": "No document selected"})

    # FIX: Fetch only the selected PDF
    result = collection.get(ids=[doc_id], include=["documents"])
    docs = result.get("documents", [])

    if not docs:
        return jsonify({"summary": "Document not found"})

    text = docs[0]

    summary = groq_chat([
        {"role": "system", "content": "Summarize the PDF clearly."},
        {"role": "user", "content": text}
    ])

    return jsonify({"summary": summary})

# ============================================================
#                       RULE EXTRACTION
# ============================================================

@app.post("/extract_rules")
def extract_rules():
    doc_id = request.json.get("id")
    result = collection.get(ids=[doc_id], include=["documents"])
    text = result.get("documents", [""])[0]

    rules = groq_chat([
        {"role": "system", "content": "Extract only rules from this PDF."},
        {"role": "user", "content": text}
    ])

    cleaned = [r.strip() for r in rules.split("\n") if r.strip()]
    return jsonify({"rules": cleaned})


# ============================================================
#                     COMPLIANCE CHECKLIST
# ============================================================

@app.post("/generate_checklist")
def generate_checklist():
    doc_id = request.json.get("id")
    result = collection.get(ids=[doc_id], include=["documents"])
    text = result.get("documents", [""])[0]

    cl = groq_chat([
        {"role": "system", "content": "Create checklist only from this PDF."},
        {"role": "user", "content": text}
    ])

    items = []
    for line in cl.split("\n"):
        if "-" in line:
            t, d = line.split("-", 1)
            items.append({"title": t.strip(), "detail": d.strip()})
    return jsonify({"checklist": items})


# ============================================================
#                         CHATBOT
# ============================================================

@app.post("/ask")
def ask():
    q = request.json.get("question", "")
    vec = embed([q])[0]

    # RAG search
    result = collection.query(query_embeddings=[vec], n_results=1, include=["documents"])
    context = result["documents"][0][0]

    answer = groq_chat([
        {"role": "system", "content": "You are a senior compliance expert."},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {q}"}
    ])

    return jsonify({"answer": answer})

# ============================================================
#                         FRONTEND RENDER
# ============================================================

@app.get("/")
def home():
    return render_template("index.html")

# ============================================================
#                         CSV EXPORT
# ============================================================

@app.get("/export_excel")
def export_excel():
    data = collection.get(include=["ids", "metadatas"])

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "category", "date", "file"])

    for i, doc_id in enumerate(data["ids"]):
        m = data["metadatas"][i]
        writer.writerow([doc_id, m.get("category", ""), m.get("date", ""), m.get("file", "")])

    buf.seek(0)
    return send_file(
        io.BytesIO(buf.getvalue().encode()),
        download_name="records.csv",
        as_attachment=True,
        mimetype="text/csv"
    )

# ============================================================
#                         RUN SERVER
# ============================================================

if __name__ == "__main__":
    app.run(port=5000, debug=True)
