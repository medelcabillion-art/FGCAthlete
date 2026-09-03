/* ================================================================
   ⬇️⬇️⬇️  PASTE YOUR SUPABASE PROJECT DETAILS BELOW  ⬇️⬇️⬇️

   Where to find them: Supabase dashboard → Project Settings (gear
   icon) → Data API (or "API") → copy "Project URL" and the
   "anon public" key.

   Replace ONLY the text inside the quotes on the next two lines.
   Do not remove the quote marks.
   ================================================================ */

const SUPABASE_URL = "https://xcgwltntqdppofgibfbm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZ3dsdG50cWRwcG9mZ2liZmJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MTU3NzAsImV4cCI6MjEwMzk5MTc3MH0.8j9rUX8UlFfa7IaeYdsp2QiLLiValOJgcIaE67XNsKA";

/* ================================================================
   ⬆️⬆️⬆️  STOP EDITING ABOVE THIS LINE  ⬆️⬆️⬆️
   ================================================================ */

let sb = null;
let athletes = [];   // {id, name, active}
let dates = [];       // {date_key, label}
let payments = [];    // {athlete_id, date_key, amount}

function isConfigured(){
  return !SUPABASE_URL.includes("PASTE_YOUR") && !SUPABASE_ANON_KEY.includes("PASTE_YOUR");
}

function setConn(ok, text){
  document.getElementById('connDot').classList.toggle('live', ok);
  document.getElementById('connText').textContent = text;
}

async function init(){
  if(!isConfigured()){
    document.getElementById('setupWarning').style.display = 'block';
    setConn(false, 'Not connected — add your Supabase keys');
    return;
  }
  try{
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await loadAll();
    setConn(true, 'Live');
    subscribeRealtime();
  }catch(err){
    console.error('Supabase connection failed:', err);
    setConn(false, 'Connection failed — see console (F12) for details');
    document.getElementById('setupWarning').style.display = 'block';
    document.getElementById('setupWarning').innerHTML =
      `<b>Could not connect to Supabase.</b><br>Error: ${err.message || err}<br>
       Double-check your SUPABASE_URL and SUPABASE_ANON_KEY in app.js are copied exactly,
       with no extra spaces, and that the schema SQL ran successfully.`;
  }
}

async function loadAll(){
  const [ath, dat, pay] = await Promise.all([
    sb.from('athletes').select('*').order('created_at'),
    sb.from('collection_dates').select('*').order('date_key'),
    sb.from('payments').select('*')
  ]);
  if(ath.error) throw ath.error;
  if(dat.error) throw dat.error;
  if(pay.error) throw pay.error;
  athletes = ath.data || [];
  dates = dat.data || [];
  payments = pay.data || [];
  renderLedger();
  renderRoster();
}

function subscribeRealtime(){
  sb.channel('kuno-sync')
    .on('postgres_changes', {event:'*', schema:'public', table:'payments'}, loadAll)
    .on('postgres_changes', {event:'*', schema:'public', table:'athletes'}, loadAll)
    .on('postgres_changes', {event:'*', schema:'public', table:'collection_dates'}, loadAll)
    .subscribe();
}

/* ---------- ledger rendering ---------- */
function paymentFor(athleteId, dateKey){
  const p = payments.find(x=>x.athlete_id===athleteId && x.date_key===dateKey);
  return p ? Number(p.amount) : undefined;
}
function athleteTotal(athleteId){
  return payments.filter(p=>p.athlete_id===athleteId)
    .reduce((s,p)=>s+(Number(p.amount)||0),0);
}

function renderLedger(){
  const headRow = document.getElementById('headRow');
  const bodyRows = document.getElementById('bodyRows');
  const footRow = document.getElementById('footRow');

  headRow.innerHTML = '<th>Name</th>' + dates.map(d=>`<th>${d.label}</th>`).join('') + '<th>Total</th><th></th>';

  bodyRows.innerHTML = athletes.map(a=>{
    const cells = dates.map(d=>{
      const val = paymentFor(a.id, d.date_key);
      return `<td><input class="cell${val?' paid':''}" type="number" min="0" step="1"
        value="${val!==undefined?val:''}"
        onchange="setPayment('${a.id}','${d.date_key}',this.value)"></td>`;
    }).join('');
    return `<tr>
      <td>${a.name}</td>
      ${cells}
      <td class="total-cell">₱${athleteTotal(a.id)}</td>
      <td><button class="remove-x" title="Remove athlete" onclick="removeAthlete('${a.id}')">✕</button></td>
    </tr>`;
  }).join('');

  const colTotals = dates.map(d =>
    payments.filter(p=>p.date_key===d.date_key).reduce((s,p)=>s+(Number(p.amount)||0),0)
  );
  const grand = athletes.reduce((s,a)=>s+athleteTotal(a.id),0);
  footRow.innerHTML = '<td>Total</td>' + colTotals.map(t=>`<td>₱${t}</td>`).join('') +
    `<td class="total-cell">₱${grand}</td><td></td>`;

  renderStats(grand);
}

function renderStats(grand){
  const paidCount = athletes.filter(a=>athleteTotal(a.id)>0).length;
  document.getElementById('statRow').innerHTML = `
    <div class="stat"><div class="n">₱${grand}</div><div class="l">Total collected</div></div>
    <div class="stat"><div class="n">${paidCount}</div><div class="l">Have paid something</div></div>
    <div class="stat"><div class="n">${athletes.length-paidCount}</div><div class="l">No payment yet</div></div>
    <div class="stat"><div class="n">${athletes.length}</div><div class="l">Total athletes</div></div>
  `;
}

async function setPayment(athleteId, dateKey, value){
  if(value===''){
    await sb.from('payments').delete().eq('athlete_id', athleteId).eq('date_key', dateKey);
  } else {
    await sb.from('payments').upsert({athlete_id: athleteId, date_key: dateKey, amount: Number(value)});
  }
  await loadAll();
}

async function addAthlete(){
  const input = document.getElementById('newAthleteName');
  const name = input.value.trim();
  if(!name) return;
  await sb.from('athletes').insert({name: name.toUpperCase()});
  input.value = '';
  await loadAll();
}

async function removeAthlete(id){
  await sb.from('athletes').delete().eq('id', id);
  await loadAll();
}

async function addDateColumn(){
  const input = document.getElementById('newDateVal');
  if(!input.value) return;
  const d = new Date(input.value + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
  await sb.from('collection_dates').insert({date_key: input.value, label});
  input.value = '';
  await loadAll();
}

function exportCSV(){
  const header = ['Name', ...dates.map(d=>d.label), 'Total'];
  const rows = athletes.map(a=>[
    a.name, ...dates.map(d=>paymentFor(a.id, d.date_key) ?? ''), athleteTotal(a.id)
  ]);
  const csv = [header, ...rows].map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'fgc_kuno_ledger.csv'; link.click();
  URL.revokeObjectURL(url);
}

/* ---------- matchmaking (local only — no need to sync courts) ---------- */
let activeMap = {}; // athleteId -> bool, defaults true

function renderRoster(){
  const roster = document.getElementById('roster');
  roster.innerHTML = athletes.map(a=>{
    if(!(a.id in activeMap)) activeMap[a.id] = true;
    return `<label class="chip">
      <input type="checkbox" ${activeMap[a.id] ? 'checked':''} onchange="toggleActive('${a.id}', this.checked)">
      ${a.name}
    </label>`;
  }).join('');
}
function toggleActive(id, checked){ activeMap[id] = checked; }

function shuffle(arr){
  const out = arr.slice();
  for(let i=out.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [out[i],out[j]] = [out[j],out[i]];
  }
  return out;
}

function generateCourts(){
  const format = document.getElementById('formatSel').value;
  const perCourt = format==='doubles' ? 4 : 2;
  const pool = shuffle(athletes.filter(a=>activeMap[a.id]).map(a=>a.name));

  const courts = [];
  let i=0;
  for(; i+perCourt<=pool.length; i+=perCourt) courts.push(pool.slice(i, i+perCourt));
  const bench = pool.slice(i);

  const grid = document.getElementById('courtsGrid');
  if(courts.length===0){
    grid.innerHTML = `<p class="hint">Not enough players checked in for a full court yet.</p>`;
  } else {
    grid.innerHTML = courts.map((c,idx)=>{
      if(format==='doubles'){
        return `<div class="court-card"><h3>Court ${idx+1}</h3>
          <div class="side">${c[0]} &amp; ${c[1]}</div>
          <div class="vs">vs</div>
          <div class="side">${c[2]} &amp; ${c[3]}</div></div>`;
      }
      return `<div class="court-card"><h3>Court ${idx+1}</h3>
        <div class="side">${c[0]}</div><div class="vs">vs</div><div class="side">${c[1]}</div></div>`;
    }).join('');
  }
  document.getElementById('benchNote').innerHTML = bench.length ? `<b>On the bench:</b> ${bench.join(', ')}` : '';
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-ledger').style.display = tab==='ledger' ? '' : 'none';
    document.getElementById('tab-courts').style.display = tab==='courts' ? '' : 'none';
  });
});

init();