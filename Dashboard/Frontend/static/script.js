// API is relative since Flask serves frontend
const API = "";

// chart handles
let charts = { bar: null, pie: null };
let alertsChart = null;
let currentPage = 1;
let sortDesc = true;
let searchTerm = "";

// utils
function toast(msg, timeout = 2500) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.innerText = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), timeout);
}
function setLoading(id, show = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = show ? "block" : "none";
}
async function safeJson(res) {
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(txt || res.statusText);
  }
  return res.json();
}

// init
document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadDashboard();
  loadPDFDropdowns();
  loadAlerts();
  loadGuidelines();
  setInterval(() => { loadDashboard(); loadAlerts(); }, 15000);
});

// bind UI
function bindUI() {
  document.querySelectorAll(".nav button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      switchView(btn.getAttribute("data-view"));
    });
  });

  document.getElementById("darkToggle").addEventListener("click", () => document.body.classList.toggle("dark"));
  document.getElementById("uploadBtn").addEventListener("click", uploadPDF);

  const sb = document.getElementById("searchBox");
  if (sb) sb.addEventListener("input", e => { searchTerm = e.target.value.trim(); currentPage = 1; loadTable(); });
  document.getElementById("prevPage").addEventListener("click", () => { if (currentPage>1) { currentPage--; loadTable(); }});
  document.getElementById("nextPage").addEventListener("click", () => { currentPage++; loadTable(); });
  document.getElementById("sortDateBtn").addEventListener("click", () => { sortDesc = !sortDesc; loadTable(); });

  document.getElementById("fetchSummaryBtn").addEventListener("click", fetchSummary);
  document.getElementById("downloadSummaryBtn").addEventListener("click", downloadSummaryPDF);

  document.getElementById("extractRulesBtn").addEventListener("click", extractRules);
  document.getElementById("generateChecklistBtn").addEventListener("click", generateChecklist);

  document.getElementById("chatLauncher").addEventListener("click", toggleChat);
  document.getElementById("sendBtn").addEventListener("click", askBot);
  document.getElementById("voiceBtn").addEventListener("click", startVoice);
  document.getElementById("chatInput").addEventListener("keydown", e => { if (e.key === "Enter") askBot(); });

  const gs = document.getElementById("guidelineSearch");
  if (gs) gs.addEventListener("input", loadGuidelines);
}

// view switching
function switchView(v) {
  ["Dashboard","Records","Summaries","Rules","Alerts","Guidelines"].forEach(n=>{
    const el = document.getElementById("view"+n);
    if (!el) return;
    el.style.display = (n.toLowerCase()===v.toLowerCase()) ? "" : "none";
  });
  if (v==="records") loadTable();
  if (v==="guidelines") loadGuidelines();
}

// upload PDF
async function uploadPDF() {
  const fileInput = document.getElementById("pdfInput");
  const category = document.getElementById("uploadCategory").value;
  if (!fileInput.files.length) { toast("Select a PDF"); return; }

  const btn = document.getElementById("uploadBtn");
  btn.disabled = true;
  const fd = new FormData();
  fd.append("pdf", fileInput.files[0]);
  fd.append("category", category);

  document.getElementById("uploadMsg").textContent = "Uploading...";
  try {
    const res = await fetch(`${API}/upload_pdf`, { method: "POST", body: fd });
    const j = await safeJson(res);
    if (j.id) {
      document.getElementById("uploadMsg").textContent = `✅ Uploaded: ${j.id} | Guidelines: ${j.guidelines || 0}`;
      toast("Upload successful");
      loadDashboard(); loadPDFDropdowns(); loadAlerts(); loadGuidelines();
    } else {
      throw new Error("Upload failed");
    }
  } catch (err) {
    console.error(err);
    document.getElementById("uploadMsg").textContent = "❌ Upload failed";
    toast("Upload failed");
  } finally {
    btn.disabled = false;
  }
}

// dashboard
async function loadDashboard() {
  try {
    const r = await fetch(`${API}/dashboard_stats`);
    const d = await safeJson(r);
    document.getElementById("sAml").textContent = d.aml_reviews ?? 0;
    document.getElementById("sAlert").textContent = d.transaction_alerts ?? 0;
    document.getElementById("sDoc").textContent = d.document_audits ?? 0;
    document.getElementById("sRisk").textContent = (d.risk_percent ?? 0) + "%";
    document.getElementById("scorePercent").textContent = Math.max(0, 100 - (d.risk_percent ?? 20));
    loadBarChart(d); loadPieChart(d); updateAnalysis(d);
  } catch (err) {
    console.error(err); toast("Failed to load dashboard");
  }
}

function updateAnalysis(d) {
  const score = Math.max(0, Math.round(100 - (d.risk_percent ?? 20)));
  document.getElementById("scorePercent2").textContent = score;
  const trend = ((d.transaction_alerts ?? 0) * 0.45) + ((d.aml_reviews ?? 0) * 0.2);
  document.getElementById("riskTrend").innerHTML = `Overall risk indicator: <b>${trend.toFixed(1)}</b>`;
  const issues = [];
  if ((d.transaction_alerts ?? 0) > 50) issues.push("Spike in transaction alerts");
  if ((d.document_audits ?? 0) < 5) issues.push("Low audit coverage");
  if ((d.aml_reviews ?? 0) > 30) issues.push("High AML review backlog");
  const el = document.getElementById("topIssues");
  el.innerHTML = issues.length ? issues.map(i => `<li>${i}</li>`).join("") : `<li>No major issues</li>`;
}

// charts
function loadBarChart(d) {
  try {
    if (charts.bar) charts.bar.destroy();
    charts.bar = new Chart(document.getElementById("barChart"), {
      type: "bar",
      data: {
        labels: ["AML","Alerts","Docs"],
        datasets:[{label:"Count",data:[d.aml_reviews||0,d.transaction_alerts||0,d.document_audits||0],backgroundColor:['#0d9488','#ef4444','#f59e0b']}]
      },
      options:{responsive:true,plugins:{legend:{display:false}}}
    });
  } catch(e){console.error(e);}
}
function loadPieChart(d) {
  try {
    if (charts.pie) charts.pie.destroy();
    charts.pie = new Chart(document.getElementById("pieChart"), {
      type: "pie",
      data: {
        labels:["AML","Alerts","Docs"],
        datasets:[{data:[d.aml_reviews||0,d.transaction_alerts||0,d.document_audits||0]}]
      }
    });
  } catch(e){console.error(e);}
}

// records (pagination)
async function loadTable() {
  setLoading('tableLoader', true);
  try {
    const s = encodeURIComponent(searchTerm || "");
    const res = await fetch(`${API}/all_pdfs?search=${s}&page=${currentPage}`);
    const j = await safeJson(res);
    const rows = j.data || [];
    rows.sort((a,b) => {
      if (!a.date || !b.date) return 0;
      return sortDesc ? new Date(b.date)-new Date(a.date) : new Date(a.date)-new Date(b.date);
    });
    const tb = document.getElementById("tbody");
    tb.innerHTML = rows.map(r => {
      const highlight = searchTerm && ((r.id + r.category + r.date + r.preview).toLowerCase().includes(searchTerm.toLowerCase())) ? ' style="background:#fffbe6"' : '';
      return `<tr ${highlight}><td>${r.id}</td><td>${r.category}</td><td>${r.date}</td><td>${r.preview}</td></tr>`;
    }).join("");
    document.getElementById("pageInfo").textContent = `Page ${currentPage}`;
  } catch (err) {
    console.error(err); toast("Failed to load records");
  } finally {
    setLoading('tableLoader', false);
  }
}

// dropdowns
async function loadPDFDropdowns() {
  try {
    const res = await fetch(`${API}/all_pdfs?search=&page=1`);
    const j = await safeJson(res);
    const s1 = document.getElementById("sumDocSelect");
    const s2 = document.getElementById("rulesDocId");
    s1.innerHTML = '<option value="">-- Select Document --</option>';
    s2.innerHTML = '<option value="">-- Select Document --</option>';
    (j.data||[]).forEach(d => {
      s1.innerHTML += `<option value="${d.id}">${d.id}</option>`;
      s2.innerHTML += `<option value="${d.id}">${d.id}</option>`;
    });
  } catch(err){console.error(err);}
}

// summary
async function fetchSummary() {
  const id = document.getElementById("sumDocSelect").value;
  if (!id) { toast("Select PDF"); return; }
  setLoading('summaryLoader', true);
  try {
    const res = await fetch(`${API}/summarize`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({id}) });
    const j = await safeJson(res);
    document.getElementById("summaryText").textContent = j.summary || "No summary";
  } catch(err){console.error(err); toast("Failed to fetch summary");}
  finally { setLoading('summaryLoader', false); }
}
function downloadSummaryPDF() {
  const text = document.getElementById("summaryText").innerText;
  if (!text) { toast("No summary"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("Compliance Summary",10,10);
  doc.text(text,10,20);
  doc.save("summary.pdf");
}

// rules & checklist
async function extractRules() {
  const id = document.getElementById("rulesDocId").value;
  if (!id) { toast("Select PDF"); return; }
  try {
    const res = await fetch(`${API}/extract_rules`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({id}) });
    const j = await safeJson(res);
    document.getElementById("rulesText").textContent = (j.rules||[]).join("\n");
  } catch(err){console.error(err); toast("Failed to extract rules");}
}
async function generateChecklist() {
  const id = document.getElementById("rulesDocId").value;
  if (!id) { toast("Select PDF"); return; }
  try {
    const res = await fetch(`${API}/generate_checklist`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({id}) });
    const j = await safeJson(res);
    const area = document.getElementById("checklistArea");
    area.innerHTML = "";
    (j.checklist||[]).forEach(it => {
      const div = document.createElement("div");
      div.innerHTML = `<label><input type="checkbox"> <b>${it.title}</b> - ${it.detail}</label>`;
      area.appendChild(div);
    });
  } catch(err){console.error(err); toast("Failed to generate checklist");}
}

// alerts
async function loadAlerts() {
  try {
    const res = await fetch(`${API}/alerts_stats`);
    const j = await safeJson(res);
    if (alertsChart) alertsChart.destroy();
    alertsChart = new Chart(document.getElementById("alertsPie"), {
      type: "doughnut",
      data: { labels:["Critical","High","Medium","Low"], datasets:[{data:[j.critical||0,j.high||0,j.medium||0,j.low||0], backgroundColor:['#ef4444','#f97316','#f59e0b','#10b981']}]}
    });
  } catch(err){console.error(err);}
}

// guidelines
async function loadGuidelines() {
  try {
    const res = await fetch(`${API}/get_guidelines`);
    const j = await safeJson(res);
    const q = document.getElementById("guidelineSearch")?.value?.toLowerCase() || "";
    const list = document.getElementById("guidelinesList");
    if (!j.guidelines || !j.guidelines.length) { list.textContent = "No guidelines found"; return; }
    list.innerHTML = j.guidelines.filter(g => !q || (g.guideline + g.source).toLowerCase().includes(q)).map(g => `
      <div class="guide-card"><div>✔ ${g.guideline}</div><div class="small-muted">PDF: ${g.source}</div></div>
    `).join("");
  } catch(err){console.error(err); document.getElementById("guidelinesList").textContent = "Failed to load"; }
}

// voice & chat
function startVoice() {
  if (!window.webkitSpeechRecognition) { toast("Voice not supported"); return; }
  const rec = new webkitSpeechRecognition(); rec.lang = "en-US";
  rec.onresult = e => document.getElementById("chatInput").value = e.results[0][0].transcript;
  rec.start();
}
function toggleChat() {
  const box = document.getElementById("chatBox");
  box.style.display = (box.style.display === "flex") ? "none" : "flex";
}

function pushChat(who, text) {
  const row = document.createElement("div");
  row.className = "msg " + who;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  document.getElementById("chatArea").appendChild(row);
  document.getElementById("chatArea").scrollTop = 
      document.getElementById("chatArea").scrollHeight;
}

async function askBot() {
  const q = document.getElementById("chatInput").value.trim();
  if (!q) return;
  pushChat("you", q);
  document.getElementById("chatInput").value = "";

  const res = await fetch("/ask", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ question: q })
  });

  const j = await res.json();
  pushChat("bot", j.answer);
}

async function askBot() {
  const q = document.getElementById("chatInput").value.trim();
  if (!q) return;
  pushChat("you", q);
  document.getElementById("chatInput").value = "";
  pushTyping();
  try {
    const res = await fetch(`${API}/ask`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ question: q })});
    const j = await safeJson(res);
    removeTyping();
    pushChat("bot", j.answer || "No answer");
  } catch (err) {
    console.error(err); removeTyping(); pushChat("bot", "Sorry, I couldn't fetch an answer.");
  }
}
function pushChat(who, text) {
  const row = document.createElement("div"); row.className = "msg " + who;
  if (who === "bot") {
    const avatar = document.createElement("div"); avatar.className = "avatar";
    avatar.innerHTML = `<img src="${window.location.origin}/static/bot.png" alt="bot">`; row.appendChild(avatar);
  }
  const b = document.createElement("div"); b.className = "bubble"; b.textContent = text; row.appendChild(b);
  const ts = document.createElement("div"); ts.className = "ts"; ts.textContent = new Date().toLocaleTimeString(); row.appendChild(ts);
  document.getElementById("chatArea").appendChild(row);
  document.getElementById("chatArea").scrollTop = document.getElementById("chatArea").scrollHeight;
}
function pushTyping() {
  removeTyping();
  const row = document.createElement("div"); row.className = "msg bot typing"; row.id = "typingRow";
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.innerHTML = `<img src="${window.location.origin}/static/bot.png" alt="bot">`;
  const b = document.createElement("div"); b.className = "bubble"; b.innerHTML = `<span class="typing-dots">●●●</span>`;
  row.appendChild(avatar); row.appendChild(b); document.getElementById("chatArea").appendChild(row);
  document.getElementById("chatArea").scrollTop = document.getElementById("chatArea").scrollHeight;
}
function removeTyping() { const t = document.getElementById("typingRow"); if (t) t.remove(); }
