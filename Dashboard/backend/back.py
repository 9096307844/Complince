from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


# --------------------------------------
#   1. KPI ENDPOINT
# --------------------------------------
@app.route("/api/kpis")
def kpis():
    return jsonify({
        "compliance_score": 87,
        "high_risk": 4,
        "open_incidents": 12,
        "training_completion": 92
    })


# --------------------------------------
#   2. HEATMAP ENDPOINT
# --------------------------------------
@app.route("/api/heatmap")
def heatmap():
    return jsonify([
        {"department": "HR", "low": 3, "medium": 1, "high": 2},
        {"department": "Finance", "low": 1, "medium": 2, "high": 3},
        {"department": "IT", "low": 6, "medium": 2, "high": 1},
        {"department": "Operations", "low": 4, "medium": 3, "high": 0},
    ])


# --------------------------------------
#   3. INCIDENTS TABLE ENDPOINT
# --------------------------------------
@app.route("/api/incidents")
def incidents():
    return jsonify([
        {"issue": "Unauthorized access", "owner": "R. Sharma", "risk": "High", "status": "Open"},
        {"issue": "Missing policy sign-off", "owner": "M. Patel", "risk": "Medium", "status": "Investigating"},
        {"issue": "Unpatched server", "owner": "A. Khan", "risk": "High", "status": "Open"},
        {"issue": "Incomplete training", "owner": "S. Rao", "risk": "Low", "status": "Remediated"},
    ])


# --------------------------------------
#   4. TRAINING CHART ENDPOINT
# --------------------------------------
@app.route("/api/training_chart")
def training_chart():
    return jsonify({
        "labels": ["May","Jun","Jul","Aug","Sep","Oct","Nov"],
        "data": [68, 72, 78, 83, 86, 89, 92]
    })


# --------------------------------------
#   5. INCIDENT CHART ENDPOINT
# --------------------------------------
@app.route("/api/incident_chart")
def incident_chart():
    return jsonify({
        "labels": ["May","Jun","Jul","Aug","Sep","Oct","Nov"],
        "data": [14, 12, 10, 9, 11, 12, 8]
    })


# --------------------------------------
#   6. POLICY LIST ENDPOINT
# --------------------------------------
@app.route("/api/policies")
def policies():
    return jsonify([
        {"name": "InfoSec Policy", "version": "v2.1", "updated": "Nov 2025"},
        {"name": "Data Privacy", "version": "v1.8", "updated": "Sep 2025"},
        {"name": "Audit Plan", "version": "2025-Q4", "updated": "Oct 2025"},
        {"name": "Incident SOP", "version": "v3.0", "updated": "Aug 2025"},
    ])


# --------------------------------------
#   RUN SERVER
# --------------------------------------
if __name__ == "__main__":
    print("🚀 Backend running at: http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
