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

# -------- GROQ + EMBEDDING ----------
GROQ_API_KEY = "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"
LLM_MODEL = "llama-3.1-8b-instant"
local_embedder = SentenceTransformer("all-MiniLM-L6-v2")

# -------- CHROMA CLOUD CLIENT ----------
client = chromadb.CloudClient(
    api_key="ck-HkzmFk6A6QSfM4Sv2n612V4V65wPkwGbPxM2RwopxUSJ",
    tenant="9b448e8d-452e-40ed-bbbf-522360d89db1",
    database="dashboard"
)

collection = client.get_or_create_collection("pdf_store")
guideline_collection = client.get_or_create_collection("guidelines_store")

# -------- FLASK ----------
app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static"
)
CORS(app)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# -------- EMBEDDING ----------
def embed(text_list):
    try:
        return local_embedder.encode(text_list).tolist()
    except Exception as e:
        print("Embedding failed:", e)
        return None

# -------- CHAT ----------
def groq_chat(messages):
    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={"model": LLM_MODEL, "messages": messages},
            timeout=60
        )
        data = r.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return "Chat error: " + str(e)

# -------- GUIDELINE EXTRACTION ----------
def extract_guidelines_from_text(text):
    keywords = ["must", "should", "required", "ensure", "mandatory", "not allowed"]
    guidelines = []
    for line in text.split("\n"):
        if any(k in line.lower() for k in keywords):
            if len(line.strip()) > 8:
                guidelines.append(line.strip())
    return guidelines

def save_guidelines_to_chroma(guidelines, source_id):
    if not guidelines:
        return
    embeds = embed(guidelines)
    ids = [f"guideline-{source_id}-{i}" for i in range(len(guidelines))]
    guideline_collection.add(
        ids=ids,
        documents=guidelines,
        embeddings=embeds,
        metadatas=[{"source": source_id}] * len(guidelines)
    )

# -------- HEALTH ----------
@app.get("/health")
def health():
    return jsonify({"ok": True})

# -------- PDF UPLOAD ----------
@app.post("/upload_pdf")
def upload_pdf():
    if "pdf" not in request.files:
        return jsonify({"error": "No file"}), 400

    f = request.files["pdf"]
    category = request.form.get("category", "DOC")

    filepath = os.path.join(UPLOAD_DIR, f.filename)
    f.save(filepath)

    reader = PdfReader(filepath)
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""

    doc_id = f.filename + "-" + datetime.now().strftime("%H%M%S")

    vectors = embed([text])
    if vectors is None:
        return jsonify({"error": "Embedding failed"}), 500

    collection.add(
        ids=[doc_id],
        documents=[text],
        embeddings=vectors,
        metadatas=[{
            "file": f.filename,
            "category": category,
            "date": datetime.now().strftime("%Y-%m-%d")
        }]
    )

    # ✅ Extract and save guidelines for THIS PDF only
    guidelines = extract_guidelines_from_text(text)
    save_guidelines_to_chroma(guidelines, doc_id)

    return jsonify({
        "id": doc_id,
        "preview": text[:300],
        "guidelines": len(guidelines)
    })

# ✅ ✅ ✅ UPDATED — SHOW ONLY latest PDF guidelines
@app.get("/get_guidelines")
def get_guidelines():
    data = guideline_collection.get(include=["documents", "metadatas"])
    docs = data.get("documents", [])
    metas = data.get("metadatas", [])

    if not docs:
        return jsonify({"guidelines": []})

    # Group guidelines by PDF source (PDF_ID)
    grouped = {}
    for i, g in enumerate(docs):
        src = metas[i].get("source", "Unknown")
        grouped.setdefault(src, []).append(g)

    # ✅ Get only last uploaded PDF ID
    last_pdf = list(grouped.keys())[-1]

    final = [{"guideline": g, "source": last_pdf} for g in grouped[last_pdf]]

    return jsonify({"guidelines": final})

# -------- REST OF ENDPOINTS SAME --------
@app.get("/all_pdfs")
def all_pdfs():
    search = (request.args.get("search") or "").lower()
    page = int(request.args.get("page") or 1)
    PAGE = 50

    data = collection.get(include=["documents", "metadatas"])
    ids = data.get("ids", [])
    docs = data.get("documents", [])
    metas = data.get("metadatas", [])

    rows = []
    for i, doc_id in enumerate(ids):
        m = metas[i]
        preview = (docs[i] or "")[:250]

        if search in preview.lower() or search in m.get("category", "").lower():
            rows.append({
                "id": doc_id,
                "category": m.get("category", ""),
                "date": m.get("date", ""),
                "file": m.get("file", ""),
                "preview": preview
            })

    total = len(rows)
    start = (page - 1) * PAGE
    end = start + PAGE
    return jsonify({"total": total, "data": rows[start:end]})

@app.get("/dashboard_stats")
def dashboard_stats():
    data = collection.get(include=["metadatas"])
    aml = alerts = docs = 0
    for m in data.get("metadatas", []):
        c = (m.get("category") or "").upper()
        if c == "AML": aml += 1
        if c == "ALERT": alerts += 1
        if c == "DOC": docs += 1
    risk = min(100, alerts * 15 + aml * 5)
    return jsonify({
        "aml_reviews": aml,
        "transaction_alerts": alerts,
        "document_audits": docs,
        "risk_percent": risk
    })

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

@app.post("/summarize")
def summarize():
    doc_id = request.json.get("id")
    if not doc_id:
        return jsonify({"summary": "No document selected"})
    result = collection.get(ids=[doc_id], include=["documents"])
    text = result.get("documents", [""])[0]
    summary = groq_chat([
        {"role": "system", "content":
         "You are a senior compliance expert. Summarize in short bullet points."},
        {"role": "user", "content": text}
    ])
    return jsonify({"summary": summary})

@app.post("/extract_rules")
def extract_rules():
    doc_id = request.json.get("id")
    if doc_id:
        result = collection.get(ids=[doc_id], include=["documents"])
    else:
        result = collection.get(include=["documents"])
    text = result.get("documents", [""])[0]

    rules = groq_chat([
        {"role": "system", "content":
         "Extract compliance rules as bullet points. No extra explanation."},
        {"role": "user", "content": text}
    ])

    cleaned = [r.strip() for r in rules.split("\n") if r.strip()]
    return jsonify({"rules": cleaned})

@app.post("/generate_checklist")
def generate_checklist():
    doc_id = request.json.get("id")
    if doc_id:
        result = collection.get(ids=[doc_id], include=["documents"])
    else:
        result = collection.get(include=["documents"])
    text = result.get("documents", [""])[0]

    cl = groq_chat([
        {"role": "system", "content":
         "Create a compliance checklist. Format: Title - Action."},
        {"role": "user", "content": text}
    ])

    items = []
    for line in cl.split("\n"):
        if not line.strip():
            continue
        if "-" in line:
            t, d = line.split("-", 1)
            items.append({"title": t.strip(), "detail": d.strip()})
        else:
            items.append({"title": line.strip(), "detail": ""})
    return jsonify({"checklist": items})

@app.post("/ask")
def ask():
    q = request.json.get("question", "")
    if not q:
        return jsonify({"answer": "Ask something"})

    vec = embed([q])[0]
    result = collection.query(query_embeddings=[vec], n_results=1, include=["documents"])
    docs = result.get("documents", [[]])

    context = docs[0][0] if docs and docs[0] else "No relevant document found."

    ans = groq_chat([
        {"role": "system", "content": "You are a compliance expert."},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {q}"}
    ])
    return jsonify({"answer": ans})

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/export_excel")
def export_excel():
    data = collection.get(include=["ids", "metadatas"])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "category", "date", "file"])
    for i, doc_id in enumerate(data.get("ids", [])):
        m = data["metadatas"][i]
        w.writerow([doc_id, m.get("category", ""), m.get("date", ""), m.get("file", "")])
    buf.seek(0)
    return send_file(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        download_name="compliance.csv",
        as_attachment=True,
        mimetype="text/csv"
    )

if __name__ == "__main__":
    app.run(port=5000, debug=True)
