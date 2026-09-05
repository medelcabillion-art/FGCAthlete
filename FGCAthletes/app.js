const SUPABASE_URL = "https://xcgwltntqdppofgibfbm.supabase.co";        // e.g. "https://abcdefgh.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZ3dsdG50cWRwcG9mZ2liZmJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MTU3NzAsImV4cCI6MjEwMzk5MTc3MH0.8j9rUX8UlFfa7IaeYdsp2QiLLiValOJgcIaE67XNsKA";       // long string starting with "eyJ..."

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
  renderLockSelects();
  renderLockedPairs();
  renderLeaderboard();
}

function renderLeaderboard(){
  const body = document.getElementById('leaderRows');
  if(!body) return;
  const ranked = athletes.slice().sort((a,b)=>{
    const wa = a.wins||0, wb = b.wins||0;
    if(wb !== wa) return wb - wa;
    const gpA = (a.wins||0)+(a.losses||0), gpB = (b.wins||0)+(b.losses||0);
    const rateA = gpA ? (a.wins||0)/gpA : 0;
    const rateB = gpB ? (b.wins||0)/gpB : 0;
    return rateB - rateA;
  });
  body.innerHTML = ranked.map((a,idx)=>{
    const w = a.wins||0, l = a.losses||0;
    const gp = w+l;
    const rate = gp ? Math.round((w/gp)*100) : 0;
    return `<tr>
      <td>${idx+1}</td>
      <td>${a.name}</td>
      <td class="total-cell">${w}</td>
      <td>${l}</td>
      <td>${gp ? rate+'%' : '—'}</td>
    </tr>`;
  }).join('');
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

/* Which date column counts as "today's session":
   an exact match to today's date if one exists, otherwise
   the most recent date on or before today. */
function getSessionDateKey(){
  const todayStr = new Date().toISOString().slice(0,10);
  if(dates.some(d=>d.date_key===todayStr)) return todayStr;
  const past = dates.filter(d=>d.date_key <= todayStr).sort((a,b)=>b.date_key.localeCompare(a.date_key));
  return past.length ? past[0].date_key : null;
}

function isUnpaidToday(athleteId){
  const sessionKey = getSessionDateKey();
  if(!sessionKey) return false; // no session date yet — don't flag anyone
  const val = paymentFor(athleteId, sessionKey);
  return !val; // undefined or 0 counts as unpaid
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
let lockedPairs = []; // array of [athleteId1, athleteId2] — always teamed together in doubles

function renderRoster(){
  const chips = athletes.map(a=>{
    if(!(a.id in activeMap)) activeMap[a.id] = true;
    const unpaid = isUnpaidToday(a.id);
    return `<label class="chip${unpaid ? ' unpaid' : ''}">
      <input type="checkbox" ${activeMap[a.id] ? 'checked':''} onchange="toggleActive('${a.id}', this.checked)">
      ${a.name}
      ${unpaid ? '<span class="badge">unpaid</span>' : ''}
    </label>`;
  }).join('');
  const roster = document.getElementById('roster');
  const rosterBB = document.getElementById('rosterBB');
  if(roster) roster.innerHTML = chips;
  if(rosterBB) rosterBB.innerHTML = chips;
}
function toggleActive(id, checked){
  activeMap[id] = checked;
  renderRoster(); // keep pickleball + basketball checklists in sync with each other
}

function markCantPlay(athleteId, kind){
  activeMap[athleteId] = false;
  renderRoster();
  if(kind === 'pickle') generateCourts();
  else generateBasketball();
}

/* ---------- locked partners (pickleball doubles only) ---------- */
function renderLockSelects(){
  const optionsHtml = athletes.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  const selA = document.getElementById('lockA');
  const selB = document.getElementById('lockB');
  if(selA) selA.innerHTML = '<option value="">Player 1</option>' + optionsHtml;
  if(selB) selB.innerHTML = '<option value="">Player 2</option>' + optionsHtml;
}

function renderLockedPairs(){
  const el = document.getElementById('lockedList');
  if(!el) return;
  if(lockedPairs.length===0){
    el.innerHTML = '<p class="hint" style="margin:0;">No locked pairs yet.</p>';
    return;
  }
  el.innerHTML = lockedPairs.map((p, idx)=>{
    const n1 = athletes.find(a=>a.id===p[0])?.name || '?';
    const n2 = athletes.find(a=>a.id===p[1])?.name || '?';
    return `<div class="chip">🔒 ${n1} &amp; ${n2}
      <button class="remove-x" onclick="unlockPair(${idx})">✕</button></div>`;
  }).join('');
}

function lockPair(){
  const aId = document.getElementById('lockA').value;
  const bId = document.getElementById('lockB').value;
  if(!aId || !bId || aId===bId) return;
  // a player can only be in one locked pair at a time
  lockedPairs = lockedPairs.filter(p => !p.includes(aId) && !p.includes(bId));
  lockedPairs.push([aId, bId]);
  renderLockedPairs();
}

function unlockPair(idx){
  lockedPairs.splice(idx, 1);
  renderLockedPairs();
}

function shuffle(arr){
  const out = arr.slice();
  for(let i=out.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [out[i],out[j]] = [out[j],out[i]];
  }
  return out;
}

let currentCourts = []; // last generated pickleball matches, for recording results
let currentGames = [];  // last generated basketball matches, for recording results

function generateCourts(){
  const format = document.getElementById('formatSel').value;
  const nameTag = (a, locked) => {
    const unpaidTag = isUnpaidToday(a.id) ? ` <span class="badge" style="margin-left:6px;">unpaid</span>` : '';
    const lockTag = locked ? ' 🔒' : '';
    return `<span class="player">${a.name}${lockTag}${unpaidTag}
      <button class="miss-btn" title="Can't play — remove &amp; reshuffle" onclick="markCantPlay('${a.id}','pickle')">✕</button></span>`;
  };

  if(format === 'singles'){
    const pool = shuffle(athletes.filter(a=>activeMap[a.id]));
    const courts = [];
    let i=0;
    for(; i+2<=pool.length; i+=2) courts.push({team1:[pool[i]], team2:[pool[i+1]], locked1:false, locked2:false});
    const bench = pool.slice(i);
    currentCourts = courts;

    const grid = document.getElementById('courtsGrid');
    grid.innerHTML = courts.length===0
      ? `<p class="hint">Not enough players checked in for a full court yet.</p>`
      : courts.map((c,idx)=>renderMatchCard('pickle', idx, `Court ${idx+1}`,
          nameTag(c.team1[0]), nameTag(c.team2[0]))).join('');
    document.getElementById('benchNote').innerHTML = bench.length
      ? `<b>On the bench:</b> ${bench.map(a=>a.name).join(', ')}` : '';
    return;
  }

  // --- doubles, with locked pairs kept together as one team ---
  const activeIds = new Set(athletes.filter(a=>activeMap[a.id]).map(a=>a.id));
  const byId = id => athletes.find(a=>a.id===id);

  const validLockedPairs = lockedPairs.filter(p => activeIds.has(p[0]) && activeIds.has(p[1]));
  const lockedIds = new Set(validLockedPairs.flat());

  const remaining = shuffle(athletes.filter(a=>activeIds.has(a.id) && !lockedIds.has(a.id)));
  const adhocTeams = [];
  let r=0;
  for(; r+2<=remaining.length; r+=2) adhocTeams.push([remaining[r], remaining[r+1]]);
  const leftoverSingles = remaining.slice(r); // 0 or 1 player with no partner this round

  const lockedTeams = validLockedPairs.map(p => [byId(p[0]), byId(p[1])]);
  const allTeams = shuffle([...lockedTeams.map(t=>({team:t, locked:true})), ...adhocTeams.map(t=>({team:t, locked:false}))]);

  const courts = [];
  let i=0;
  for(; i+2<=allTeams.length; i+=2){
    courts.push({team1:allTeams[i].team, team2:allTeams[i+1].team, locked1:allTeams[i].locked, locked2:allTeams[i+1].locked});
  }
  const benchTeam = allTeams.slice(i); // 0 or 1 leftover team
  const benchPlayers = [...benchTeam.flatMap(t=>t.team), ...leftoverSingles];
  currentCourts = courts;

  const grid = document.getElementById('courtsGrid');
  grid.innerHTML = courts.length===0
    ? `<p class="hint">Not enough players checked in for a full court yet.</p>`
    : courts.map((c, idx)=>{
        const side1 = c.team1.map(p=>nameTag(p, c.locked1)).join(' &amp; ');
        const side2 = c.team2.map(p=>nameTag(p, c.locked2)).join(' &amp; ');
        return renderMatchCard('pickle', idx, `Court ${idx+1}`, side1, side2);
      }).join('');
  document.getElementById('benchNote').innerHTML = benchPlayers.length
    ? `<b>On the bench:</b> ${benchPlayers.map(a=>a.name).join(', ')}` : '';
}

function renderMatchCard(kind, idx, title, side1Html, side2Html){
  return `<div class="court-card" id="${kind}-card-${idx}">
    <h3>${title}</h3>
    <div class="side">${side1Html}</div>
    <div class="vs">vs</div>
    <div class="side">${side2Html}</div>
    <div class="win-row">
      <button class="action secondary win-btn" onclick="recordResult('${kind}', ${idx}, 1)">Team 1 won</button>
      <button class="action secondary win-btn" onclick="recordResult('${kind}', ${idx}, 2)">Team 2 won</button>
    </div>
  </div>`;
}

async function recordResult(kind, idx, winnerSide){
  const source = kind === 'pickle' ? currentCourts : currentGames;
  const match = source[idx];
  if(!match) return;
  const winners = winnerSide === 1 ? match.team1 : match.team2;
  const losers  = winnerSide === 1 ? match.team2 : match.team1;

  const card = document.getElementById(`${kind}-card-${idx}`);
  if(card){
    const row = card.querySelector('.win-row');
    if(row) row.innerHTML = `<span class="badge" style="border-color:var(--court); color:var(--court);">recorded ✓</span>`;
  }

  await Promise.all([
    ...winners.map(p => sb.from('athletes').update({ wins: (p.wins||0) + 1 }).eq('id', p.id)),
    ...losers.map(p => sb.from('athletes').update({ losses: (p.losses||0) + 1 }).eq('id', p.id))
  ]);
  await loadAll();
}

function generateBasketball(){
  const perTeam = Number(document.getElementById('bbFormatSel').value); // 2, 3, or 4
  const perGame = perTeam * 2;
  const activeAthletes = athletes.filter(a=>activeMap[a.id]);
  const pool = shuffle(activeAthletes);

  const nameTag = (a) => {
    const unpaidTag = isUnpaidToday(a.id) ? ` <span class="badge" style="margin-left:6px;">unpaid</span>` : '';
    return `<span class="player">${a.name}${unpaidTag}
      <button class="miss-btn" title="Can't play — remove &amp; reshuffle" onclick="markCantPlay('${a.id}','bb')">✕</button></span>`;
  };

  const games = [];
  let i=0;
  for(; i+perGame<=pool.length; i+=perGame){
    const chunk = pool.slice(i, i+perGame);
    games.push({team1: chunk.slice(0, perTeam), team2: chunk.slice(perTeam)});
  }
  const bench = pool.slice(i);
  currentGames = games;

  const grid = document.getElementById('bbGrid');
  grid.innerHTML = games.length===0
    ? `<p class="hint">Not enough players checked in for a full ${perTeam}v${perTeam} game yet.</p>`
    : games.map((g, idx)=>renderMatchCard('bb', idx, `Game ${idx+1} — ${perTeam}v${perTeam}`,
        g.team1.map(nameTag).join(', '), g.team2.map(nameTag).join(', '))).join('');
  document.getElementById('bbBenchNote').innerHTML = bench.length
    ? `<b>On the bench:</b> ${bench.map(a=>a.name).join(', ')}` : '';
}

/* ---------- tabs ---------- */
const tabSections = { ledger: 'tab-ledger', courts: 'tab-courts', basketball: 'tab-basketball', leaderboard: 'tab-leaderboard' };
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    Object.entries(tabSections).forEach(([key, id])=>{
      document.getElementById(id).style.display = (key===tab) ? '' : 'none';
    });
  });
});

init();
