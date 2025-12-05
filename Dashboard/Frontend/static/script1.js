const API="http://127.0.0.1:5000"

/* CHART HANDLES */
let charts={bar:null,pie:null}
let alertsChart=null

/* INIT */
document.addEventListener("DOMContentLoaded",()=>{
  loadDashboard();
  loadPDFDropdowns();
  loadAlerts();
  loadGuidelines();
});

/* AUTO REFRESH */
setInterval(()=>{loadDashboard();loadAlerts();},10000);
setInterval(()=>{
  if(document.getElementById("viewRecords").style.display!=="none")
    loadTable();
},10000);

setInterval(()=>{
  if(document.getElementById("viewGuidelines").style.display!=="none")
    loadGuidelines();
},8000);

/* SWITCH VIEW */
function switchView(v){
  ["Dashboard","Records","Summaries","Rules","Alerts","Guidelines"].forEach(n=>{
    document.getElementById("view"+n).style.display=(n.toLowerCase()===v.toLowerCase())?"":"none";
  });

  if(v==="records") loadTable();
  if(v==="guidelines") loadGuidelines();
}

/* DARK MODE */
function toggleDark(){document.body.classList.toggle("dark");}

/* CHAT POPUP */
function toggleChat(){
  const box=document.getElementById("chatBox");
  box.style.display=(box.style.display==="none"||box.style.display==="")?"flex":"none";
}

/* UPLOAD PDF */
async function uploadPDF(){
  const fileInput=document.getElementById("pdfInput");
  const category=document.getElementById("uploadCategory").value;
  if(!fileInput.files.length){alert("Select a PDF!");return;}

  let fd=new FormData();
  fd.append("pdf", fileInput.files[0]);
  fd.append("category", category);

  document.getElementById("uploadMsg").textContent="Uploading...";

  const r=await fetch(API+"/upload_pdf",{method:"POST",body:fd});
  const j=await r.json();

  if(j.id){
    document.getElementById("uploadMsg").innerHTML="✅ Uploaded: "+j.id+" | Guidelines Extracted: "+j.guidelines;
    loadDashboard();
    loadPDFDropdowns();
    loadAlerts();
    loadGuidelines();
  } 
  else {
    document.getElementById("uploadMsg").textContent="❌ Upload failed";
  }
}

/* DASHBOARD DATA */
async function loadDashboard(){
  const r=await fetch(`${API}/dashboard_stats`);
  const d=await r.json();

  document.getElementById("sAml").textContent=d.aml_reviews;
  document.getElementById("sAlert").textContent=d.transaction_alerts;
  document.getElementById("sDoc").textContent=d.document_audits;
  document.getElementById("sRisk").textContent=d.risk_percent+"%";

  loadBarChart(d);
  loadPieChart(d);
}

/* BAR CHART */
function loadBarChart(d){
  if(charts.bar) charts.bar.destroy();

  charts.bar=new Chart(document.getElementById("barChart"),{
    type:"bar",
    data:{
      labels:["AML","Alerts","Docs"],
      datasets:[{data:[d.aml_reviews,d.transaction_alerts,d.document_audits]}]
    }
  });
}

/* PIE CHART */
function loadPieChart(d){
  if(charts.pie) charts.pie.destroy();

  charts.pie=new Chart(document.getElementById("pieChart"),{
    type:"pie",
    data:{
      labels:["AML","Alerts","Docs"],
      datasets:[{data:[d.aml_reviews,d.transaction_alerts,d.document_audits]}]
    }
  });
}

/* TABLE */
async function loadTable(){
  const s=document.getElementById("searchBox").value||"";
  const r=await fetch(`${API}/all_pdfs?search=${s}&page=1`);
  const j=await r.json();
  const tb=document.getElementById("tbody");
  tb.innerHTML="";
  
  (j.data||[]).forEach(row=>{
    tb.innerHTML+=`
      <tr>
        <td>${row.id}</td>
        <td>${row.category}</td>
        <td>${row.date}</td>
        <td>${row.preview}</td>
      </tr>`;
  });
}

/* DROPDOWNS */
async function loadPDFDropdowns(){
  const r=await fetch(API+"/all_pdfs?search=&page=1");
  const j=await r.json();
  const s1=document.getElementById("sumDocSelect");
  const s2=document.getElementById("rulesDocId");

  s1.innerHTML='<option value="">-- Select Document --</option>';
  s2.innerHTML='<option value="">-- Select Document --</option>';

  (j.data||[]).forEach(d=>{
    s1.innerHTML+=`<option value="${d.id}">${d.id}</option>`;
    s2.innerHTML+=`<option value="${d.id}">${d.id}</option>`;
  });
}

/* SUMMARY */
async function fetchSummary(){
  const id=document.getElementById("sumDocSelect").value;
  if(!id){alert("Select PDF");return;}
  const r=await fetch(API+"/summarize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
  const j=await r.json();
  document.getElementById("summaryText").textContent=j.summary||"No summary";
}

/* DOWNLOAD SUMMARY */
function downloadSummaryPDF(){
  const text=document.getElementById("summaryText").innerText;
  if(!text){alert("No summary available!");return;}
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("Compliance Summary",10,10);
  doc.text(text,10,20);
  doc.save("summary.pdf");
}

/* RULES + CHECKLIST */
async function extractRules(){
  const id=document.getElementById("rulesDocId").value;
  if(!id){alert("Select PDF");return;}

  const r=await fetch(API+"/extract_rules",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
  const j=await r.json();
  document.getElementById("rulesText").textContent=(j.rules||[]).join("\n");
}

async function generateChecklist(){
  const id=document.getElementById("rulesDocId").value;
  if(!id){alert("Select PDF");return;}

  const r=await fetch(API+"/generate_checklist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
  const j=await r.json();
  renderChecklist(j.checklist||[]);
}

function renderChecklist(items){
  const a=document.getElementById("checklistArea");
  a.innerHTML="";
  if(!items.length){a.textContent="No checklist";return;}
  items.forEach(i=>{
    a.innerHTML+=`<div><input type="checkbox"> <b>${i.title}</b> - ${i.detail}</div>`;
  });
}

/* ALERTS */
async function loadAlerts(){
  const r=await fetch(API+"/alerts_stats");
  const j=await r.json();

  if(alertsChart) alertsChart.destroy();

  alertsChart=new Chart(document.getElementById("alertsPie"),{
    type:"doughnut",
    data:{
      labels:["Critical","High","Medium","Low"],
      datasets:[{data:[j.critical,j.high,j.medium,j.low]}]
    }
  });
}

/* GUIDELINES */
async function loadGuidelines(){
  document.getElementById("guidelinesList").textContent="Loading...";

  const r=await fetch(API+"/get_guidelines");
  const j=await r.json();
  const list=document.getElementById("guidelinesList");

  if(!j.guidelines||!j.guidelines.length){
    list.textContent="No guidelines found";
    return;
  }

  let html="";
  j.guidelines.forEach(g=>{
    html+=`
      <div style="margin-bottom:6px">
        ✔ ${g.guideline}
        <span style="color:gray;font-size:12px"> (PDF: ${g.source})</span>
      </div>`;
  });

  list.innerHTML=html;
}

/* VOICE INPUT */
function startVoice(){
  if(!window.webkitSpeechRecognition){alert("Voice not supported!");return;}
  const rec=new webkitSpeechRecognition();rec.lang="en-US";
  rec.onresult=e=>{document.getElementById("chatInput").value=e.results[0][0].transcript;}
  rec.start();
}

/* BOT SPEAK */
function speakBot(){
  const lastBot=[...document.querySelectorAll(".bot .bubble")].pop();
  if(!lastBot){alert("No response to speak");return;}
  let text=lastBot.innerText;
  const speech=new SpeechSynthesisUtterance(text);
  speech.lang="en-US";speech.pitch=1;speech.rate=1;speech.volume=1;
  speechSynthesis.speak(speech);
}

/* CHATBOT */
async function askBot(){
  const q=document.getElementById("chatInput").value.trim();
  if(!q)return;
  pushChat("you",q);
  document.getElementById("chatInput").value="";

  const r=await fetch(API+"/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q})});
  const j=await r.json();
  pushChat("bot",j.answer||"No answer");
}

/* PUSH CHAT */
function pushChat(who,text){
  const row=document.createElement("div");
  row.className="msg "+who;
  const b=document.createElement("div");
  b.className="bubble";
  b.textContent=text;
  row.appendChild(b);
  document.getElementById("chatArea").appendChild(row);
  document.getElementById("chatArea").scrollTop=document.getElementById("chatArea").scrollHeight;
}
