# iRacing Weekly Reports — Primus UI Implementation Plan (Plan 2 of 2)

> **For agentic workers:** Implement task-by-task. This UI lives in the single-file app `index.html`, which has **no browser test harness** (consistent with the rest of Primus), so each task is verified **manually in the browser**, mirroring how the existing wizard is validated.

**Goal:** Add a "Reports" top-level view to Primus that fetches `data/weekly-reports.json` and shows, for a chosen series + class, four toggleable top-10 leaderboards (Fastest Qualifying / Fastest Race Lap / Best Race Avg / Fastest Cars) with driver name + iRating + car, for the current race week.

**Architecture:** A new top-level view (sibling to the 4-step wizard, NOT a `.panel`) toggled from the header via `showView('setup'|'reports')`. It `fetch()`es the JSON (relative path, cache-busted), builds a series autocomplete (mirroring `searchTracks`) from the JSON itself, reveals class pills only for multiclass series, and renders the active leaderboard. Works identically against the current sample JSON and the future live JSON (same schema). Single-file, no dependencies, theme-matched.

**Spec:** `docs/superpowers/specs/2026-05-22-iracing-weekly-reports-design.md` (§8).

---

## Integration facts (from index.html)

- Header ends at line ~214; unit toggle is a `.pills` group at ~208. View toggle goes beside it.
- Wizard = `.steps` bar (line 215) + `.panel` divs `#panel1..4` (221+). `goStep(n)` (line ~483) toggles `.panel.on` by index — so Reports must NOT be a `.panel`.
- Autocomplete pattern: `searchTracks(v)` filters into `#tdd` (`.open`), `selT(name)` selects, outside-click closes (line 2170). Mirror this for series.
- CSS uses theme vars (`--mut`, `--mut2`, etc.); `.pill`/`.pill.on`, `.topt`, `.tt` classes exist to reuse.

---

### Task 1: Header view toggle + Reports container + showView()

**Files:** Modify `index.html` (header ~208; after `#panel4` ~end of panels; JS near `goStep`).

- [ ] **Step 1:** In the header, before `#unitToggle`, add a view toggle:
```html
<div class="pills" id="viewToggle" style="gap:3px;">
  <div class="pill on" data-val="setup" onclick="showView('setup')">Setup</div>
  <div class="pill" data-val="reports" onclick="showView('reports')">Reports</div>
</div>
```
- [ ] **Step 2:** After the last wizard panel (`#panel4` closing `</div>`), add the Reports view container:
```html
<div id="reportsView" style="display:none;padding:1.75rem 2rem;max-width:920px;margin:0 auto;"></div>
```
- [ ] **Step 3:** Add `showView()` near `goStep`:
```js
function showView(v){
  var setup = v!=='reports';
  document.querySelector('.steps').style.display = setup?'':'none';
  var panels=document.querySelectorAll('.panel');
  for(var i=0;i<panels.length;i++) panels[i].style.display = setup?'':'none';
  if(setup){ /* restore active panel */ document.querySelectorAll('.panel').forEach&&null; }
  document.getElementById('reportsView').style.display = setup?'none':'block';
  var vt=document.querySelectorAll('#viewToggle .pill');
  for(var j=0;j<vt.length;j++) vt[j].classList.toggle('on', vt[j].dataset.val===v);
  if(!setup) initReports();
  window.scrollTo(0,0);
}
```
> Note: when returning to setup, the `.panel` that had `.on` regains `display:block` via the `.panel.on` CSS only if inline `display` is cleared. Set `panels[i].style.display=''` (empty) so the stylesheet's `.panel`/`.panel.on` rules take over again — the code above does this.
- [ ] **Step 4 (verify):** Open `index.html`. Click **Reports** → wizard hides, empty Reports area shows. Click **Setup** → wizard returns on the panel you were on. Commit.

---

### Task 2: Reports CSS

**Files:** Modify `index.html` (CSS block near other rules).

- [ ] **Step 1:** Add styles (theme-matched):
```css
.rep-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;border-bottom:1px solid var(--line,#333);padding-bottom:8px;margin-bottom:12px;}
.rep-head .rh-series{font-family:'Barlow Condensed',sans-serif;font-size:1.3rem;font-weight:600;}
.rep-head .rh-meta{color:var(--mut);font-size:0.8rem;}
.rep-head .rh-upd{margin-left:auto;color:var(--mut2);font-size:0.7rem;}
.rep-toggles{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;}
.rep-banner{background:rgba(255,180,60,0.12);border:1px solid rgba(255,180,60,0.4);color:#ffb43c;font-size:0.72rem;font-weight:600;padding:0.45rem 0.75rem;border-radius:3px;margin-bottom:12px;}
.lb{width:100%;border-collapse:collapse;font-size:0.85rem;}
.lb th{text-align:left;color:var(--mut2);font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;padding:4px 8px;border-bottom:1px solid var(--line,#333);}
.lb td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);}
.lb .lb-rank{color:var(--mut2);width:2.2em;}
.lb .lb-lap{font-variant-numeric:tabular-nums;font-weight:600;}
.lb .lb-ir{color:var(--mut);font-variant-numeric:tabular-nums;}
.rep-empty{color:var(--mut2);font-size:0.85rem;padding:1.5rem 0;text-align:center;}
```
- [ ] **Step 2 (verify):** No visual break in existing app. Commit.

---

### Task 3: Fetch + state (loading/error/empty/sample)

**Files:** Modify `index.html` (JS).

- [ ] **Step 1:** Add fetch + render scaffold:
```js
var REPORTS=null, _reportsLoaded=false, repSel={key:null,cls:null,cat:'qualifying'};
function initReports(){
  if(_reportsLoaded){renderReports();return;}
  var host=document.getElementById('reportsView');
  host.innerHTML='<div class="rep-empty">Loading weekly reports…</div>';
  fetch('data/weekly-reports.json?t='+Date.now(),{cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
    .then(function(j){REPORTS=j;_reportsLoaded=true;renderReports();})
    .catch(function(){host.innerHTML='<div class="rep-empty">Couldn\'t load reports right now. Try again later.</div>';});
}
```
- [ ] **Step 2 (verify):** Serve locally (`./serve.ps1` or any static server — `file://` blocks fetch), open Reports → "Loading…" then the picker (built in Task 4). Until Task 4, `renderReports` is undefined; add a temporary stub `function renderReports(){document.getElementById('reportsView').innerHTML='<div class=rep-empty>loaded</div>';}` to verify the fetch path, then replace in Task 4. Commit after Task 4.

> Important: must be served over http (the `serve.ps1` in the repo, or GitHub Pages). `fetch` on `file://` fails.

---

### Task 4: Series autocomplete (built from the JSON)

**Files:** Modify `index.html` (JS + the view's HTML built in renderReports).

- [ ] **Step 1:** `renderReports()` builds the shell with a search box + dropdown + slots:
```js
function renderReports(){
  var host=document.getElementById('reportsView');
  var banner = (REPORTS&&REPORTS.sample) ? '<div class="rep-banner">Sample data — live iRacing results pending API access.</div>' : '';
  host.innerHTML = banner +
    '<div class="ptitle">Weekly Reports</div>'+
    '<div class="psub">Fastest laps of the current race week by series. Type a series to begin.</div>'+
    '<div class="tswrap" style="position:relative;">'+
      '<input type="text" id="repSearch" placeholder="Search series e.g. GT3, IMSA, Porsche Cup" oninput="searchSeries(this.value)" autocomplete="off">'+
      '<div class="tdd" id="rdd"></div>'+
    '</div>'+
    '<div id="repClassRow" style="margin-top:10px;"></div>'+
    '<div id="repCard" style="margin-top:14px;"></div>';
  if(repSel.key) renderRepCard();
}
function seriesList(){return Object.keys((REPORTS&&REPORTS.series)||{}).map(function(k){return Object.assign({key:k},REPORTS.series[k]);});}
function searchSeries(v){
  var dd=document.getElementById('rdd');
  if(!v||v.length<1){dd.classList.remove('open');return;}
  var q=v.toLowerCase();
  var res=seriesList().filter(function(s){return (s.displayName+' '+s.category).toLowerCase().indexOf(q)>=0;}).slice(0,8);
  if(!res.length){dd.classList.remove('open');return;}
  dd.innerHTML=res.map(function(s){return '<div class="topt" onclick="selSeries(\''+s.key+'\')"><span>'+s.displayName+'</span><span class="ttags"><span class="tt tt-m">'+s.category+'</span></span></div>';}).join('');
  dd.classList.add('open');
}
function selSeries(key){
  repSel.key=key; repSel.cls=null; repSel.cat='qualifying';
  var s=REPORTS.series[key];
  document.getElementById('repSearch').value=s.displayName;
  document.getElementById('rdd').classList.remove('open');
  var classes=Object.keys(s.classes||{});
  repSel.cls=classes[0]||null;
  renderClassRow(); renderRepCard();
}
document.addEventListener('click',function(e){var dd=document.getElementById('rdd');if(dd&&!e.target.closest('#reportsView .tswrap'))dd.classList.remove('open');});
```
- [ ] **Step 2:** Reuse the existing `.tdd` dropdown styles (already in the file for `#tdd`); confirm `.tdd`/`.tdd.open`/`.topt` rules are generic (they are — used by track search). If `#tdd` styles are ID-scoped, add `.tdd` class equivalents.
- [ ] **Step 3 (verify):** Type "gt3" → dropdown lists matching series; selecting fills the box. Commit after Task 5.

---

### Task 5: Class pills + leaderboard render

**Files:** Modify `index.html` (JS).

- [ ] **Step 1:** Class row + card:
```js
function renderClassRow(){
  var row=document.getElementById('repClassRow');
  var s=REPORTS.series[repSel.key]; var classes=Object.keys(s.classes||{});
  if(!s.multiclass||classes.length<2){row.innerHTML='';return;}
  row.innerHTML='<div class="pills" id="repClassPills">'+classes.map(function(c){
    return '<div class="pill'+(c===repSel.cls?' on':'')+'" onclick="selRepClass(\''+c+'\')">'+c+'</div>';
  }).join('')+'</div>';
}
function selRepClass(c){repSel.cls=c;repSel.cat='qualifying';renderClassRow();renderRepCard();}

var CATS=[['qualifying','Fastest Qualifying'],['raceLap','Fastest Race Lap'],['raceAvg','Best Race Avg'],['cars','Fastest Cars']];
function renderRepCard(){
  var card=document.getElementById('repCard'); if(!card)return;
  var node=((REPORTS.series[repSel.key]||{}).classes||{})[repSel.cls];
  if(!node){card.innerHTML='<div class="rep-empty">No data for this selection yet.</div>';return;}
  var hasCars=Array.isArray(node.cars)&&node.cars.length>0;
  var cats=CATS.filter(function(c){return c[0]!=='cars'||hasCars;});
  if(repSel.cat==='cars'&&!hasCars)repSel.cat='qualifying';
  var toggles='<div class="rep-toggles">'+cats.map(function(c){
    return '<div class="pill'+(c[0]===repSel.cat?' on':'')+'" onclick="selRepCat(\''+c[0]+'\')">'+c[1]+'</div>';
  }).join('')+'</div>';
  var rows=(node[repSel.cat]||[]);
  var body = rows.length ? rows.map(function(r){
    return '<tr><td class="lb-rank">'+r.rank+'</td><td class="lb-lap">'+(r.lap||'—')+'</td><td>'+r.driver+'</td><td class="lb-ir">'+(r.irating?('iR '+r.irating):'')+'</td><td>'+(r.car||'')+'</td></tr>';
  }).join('') : '<tr><td colspan="5" class="rep-empty">No laps recorded yet this week.</td></tr>';
  var upd = node.lastFetchedUtc ? '<span class="rh-upd">updated '+timeAgo(node.lastFetchedUtc)+'</span>' : '';
  card.innerHTML =
    '<div class="rep-head"><span class="rh-series">'+REPORTS.series[repSel.key].displayName+(repSel.cls&&REPORTS.series[repSel.key].multiclass?(' · '+repSel.cls):'')+'</span>'+
    '<span class="rh-meta">Week '+(node.weekNum!=null?node.weekNum:'?')+' · '+(node.track||'')+'</span>'+upd+'</div>'+
    toggles+
    '<table class="lb"><thead><tr><th>#</th><th>Lap</th><th>Driver</th><th>iRating</th><th>Car</th></tr></thead><tbody>'+body+'</tbody></table>';
}
function selRepCat(c){repSel.cat=c;renderRepCard();}
function timeAgo(iso){var d=Date.now()-Date.parse(iso);if(isNaN(d))return'';var m=Math.round(d/60000);if(m<1)return'just now';if(m<60)return m+' min ago';var h=Math.round(m/60);if(h<24)return h+'h ago';return Math.round(h/24)+'d ago';}
```
- [ ] **Step 2 (verify):** Select GT3 Regional Europe → see top-10 Qualifying; toggle Race Lap/Race Avg/Fastest Cars. Select IMSA — Open → class pills GTP/LMP2/GT3 appear; switching class updates the board. Select Porsche Cup → no "Fastest Cars" toggle. Commit.

---

### Task 6: Polish + regenerate hosted index.html

- [ ] **Step 1:** Verify the `.tdd` dropdown for series sits above content (z-index) and outside-click closes it without affecting the track dropdown.
- [ ] **Step 2:** Confirm switching Setup⇄Reports repeatedly leaves the wizard fully functional (panels, pills, generate).
- [ ] **Step 3:** Confirm `metric/imperial` toggle doesn't corrupt the reports view (reports lap strings are pre-formatted; leave as-is).
- [ ] **Step 4:** Commit, push. Confirm live at `https://ajacoby27.github.io/Primus-systems/` → Reports → loads the committed sample JSON (same-origin) and renders.

---

## Self-Review
- Spec §8 coverage: separate top-level view (Task 1), autocomplete series picker reusing track pattern (Task 4), class pills for multiclass only (Task 5), 4 top-10 toggles + single-car hides Cars (Task 5), states loading/empty/error/sample + "updated N min ago" + cache-bust (Tasks 3,5). ✓
- No placeholders except the explicitly-temporary `renderReports` stub in Task 3 (replaced in Task 4). 
- Consistency: `repSel` shape `{key,cls,cat}` used uniformly; category keys (`qualifying/raceLap/raceAvg/cars`) match the JSON schema (spec §7) exactly.
- Live-data parity: identical code path for sample and live JSON; only the `sample` banner differs.
