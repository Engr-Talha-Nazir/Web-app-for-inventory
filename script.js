// Robust loader + Region/Product insights + Accuracy metric
let RAW_ROWS=[], FILTERED_ROWS=[], SERIES=[], DATES=[];
let MEAN=0, STD=1, MODEL=null, TRAIN_SPLIT_INDEX=null, CHARTS={};

const E=id=>document.getElementById(id);
const els={ date:()=>E('dateCol'), target:()=>E('targetCol'), agg:()=>E('aggFunc'), store:()=>E('storeFilter'), product:()=>E('productFilter'), region:()=>E('regionFilter') };
function log(m){const t=new Date().toLocaleTimeString();E('log').innerHTML+=`[${t}] ${m}<br/>`;E('log').scrollTop=E('log').scrollHeight;}
function errorMsg(msg){const box=E('errorBox');box.textContent=msg;box.classList.remove('hidden');}
function clearError(){E('errorBox').classList.add('hidden');E('errorBox').textContent='';}
function setStepActive(n){const steps=document.querySelectorAll('.stepper .step');steps.forEach((s,i)=>s.classList.toggle('active',i<=n-1));E('cardEDA').classList.toggle('disabled',n<2);E('btnEDA').disabled=(n<2);E('cardModel').classList.toggle('disabled',n<3);E('btnTrain').disabled=(n<3);E('cardForecast').classList.toggle('disabled',n<4);E('btnPredict').disabled=(n<4);E('btnEvaluate').disabled=(n<4);}

// Utils
const tryNum=v=>(typeof v==='number'?v:Number(v));
const asDate=v=>{const d=new Date(v);return isNaN(d.getTime())?null:d;};
function basicStats(a){const n=a.length||1;const m=a.reduce((x,y)=>x+y,0)/n;const v=a.reduce((s,x)=>s+(x-m)**2,0)/n;return {mean:m,std:Math.sqrt(v)||1,min:Math.min(...a),max:Math.max(...a)};}
function zfit(a){const s=basicStats(a);MEAN=s.mean;STD=s.std;}
const z=a=>a.map(x=>(x-MEAN)/STD);
const iz=a=>a.map(x=>x*STD+MEAN);
function uniq(rows,key){const S=new Set();rows.forEach(r=>{const v=r[key];if(v!==undefined&&v!==null&&v!=='')S.add(String(v));});return Array.from(S).sort();}
function populateSelect(sel,opts,selected){sel.innerHTML='';opts.forEach(opt=>{const o=document.createElement('option');o.value=opt.value;o.textContent=opt.label;if(selected!=null&&selected===opt.value)o.selected=true;sel.appendChild(o);});}
function toTable(rows,limit=200){const m=E('tableMount');if(!rows.length){m.innerHTML='';return;}const keys=Object.keys(rows[0]).filter(k=>!k.startsWith('__'));let html=`<table><thead><tr>${keys.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>`;for(let i=0;i<Math.min(limit,rows.length);i++){const r=rows[i];html+=`<tr>${keys.map(k=>`<td>${r[k]??''}</td>`).join('')}</tr>`;}m.innerHTML=html+'</tbody></table>';}
function summarize(rows,dk,tk){const n=rows.length,first=rows[0]?.[dk],last=rows[n-1]?.[dk];const vals=rows.map(r=>tryNum(r[tk])).filter(Number.isFinite);const s=basicStats(vals);E('dataSummary').innerHTML=`<div><b>Rows:</b> ${n}</div><div><b>Date range:</b> ${first} → ${last}</div><div><b>Target:</b> ${tk} | <b>mean:</b> ${s.mean.toFixed(2)} <b>std:</b> ${s.std.toFixed(2)} <b>min:</b> ${s.min.toFixed(2)} <b>max:</b> ${s.max.toFixed(2)}</div>`;}

// Column detection
function detectColumns(rows){
  if(!rows.length) return {dateKey:null, targetKey:null};
  const names=Object.keys(rows[0]);
  const norm=(s)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const n=names.map(norm);
  const dateC=['date','ds','day','timestamp','time'];
  const targetC=['unitssold','demand','qty','quantity','sales','units','consumption','demandforecast','unitsordered','orders','value'];
  const pick=cands=>{for(const c of cands){const i=n.indexOf(c);if(i!==-1)return names[i];}for(let i=0;i<n.length;i++) if(cands.some(c=>n[i].includes(c))) return names[i]; return null;};
  const dateKey=pick(dateC)||names.find(x=>/date/i.test(x))||names[0];
  let targetKey=pick(targetC)||names.find(x=>/Units Sold/i.test(x))||names.find(x=>/Demand Forecast/i.test(x))||names[1]||names[0];
  return {dateKey,targetKey};
}

// Robust CSV (Papa)
function parseCSV(text){
  const res = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
  if(res.errors && res.errors.length){
    const msg = res.errors.slice(0,3).map(e=>`${e.type} at row ${e.row}: ${e.message}`).join(' | ');
    throw new Error('CSV parse error: '+msg);
  }
  return res.data;
}

// Data.js
async function getFromDataJS(){
  if(typeof window!=='undefined' && typeof window.INVENTORY_DATA!=='undefined') return window.INVENTORY_DATA;
  try{ if(typeof dataset!=='undefined') return dataset; } catch(e){}
  return null;
}

// Demo
function syntheticData(n=365){
  const start=new Date('2024-01-01'); const rows=[]; const regions=['North','South','East','West'];
  for(let i=0;i<n;i++){
    const d=new Date(start.getTime()+i*86400000);
    const dow=d.getDay();
    const region=regions[i%regions.length];
    const y=Math.max(0,120+15*Math.sin(2*Math.PI*i/7)+(dow===6?18:0)+0.07*i+(Math.random()-0.5)*12 + (region==='North'?12:0));
    rows.push({"Date":d.toISOString().slice(0,10),"Store ID":"S"+String(1+(i%15)).padStart(3,'0'),"Product ID":"P"+String(1+(i%30)).padStart(4,'0'),"Category":"Groceries","Region":region,"Weather Condition":"Sunny","Holiday/Promotion":(i%30===0?1:0),"Units Sold":Number(y.toFixed(2))});
  }
  return rows;
}

async function loadRowsFrom(kind){
  clearError();
  let rows=null;
  try{
    if(kind==='file'){
      const f=E('fileInput').files[0];
      if(!f){ throw new Error('Please choose a file first.'); }
      const txt=await f.text();
      rows = f.name.toLowerCase().endsWith('.json') ? JSON.parse(txt) : parseCSV(txt);
      log(`Loaded ${rows.length} rows from ${f.name}`);
    }else if(kind==='datajs'){
      rows = await getFromDataJS();
      if(!rows){ throw new Error('No global data found in data.js. Define either window.INVENTORY_DATA=[...] or const dataset=[...].'); }
      log(`Loaded ${rows.length} rows from data.js`);
    }else{
      rows = syntheticData();
      log(`Loaded ${rows.length} demo rows.`);
    }
  }catch(e){
    errorMsg(e.message||String(e));
    log('❌ '+(e.message||String(e)));
    return null;
  }
  if(!Array.isArray(rows) || !rows.length){ errorMsg('No rows found in dataset.'); return null; }
  rows = rows.filter(r => r && Object.keys(r).some(k => String(r[k]).trim()!==''));
  return rows;
}

// Filters & aggregation
function applyFilters(){
  const store=els.store().value, product=els.product().value, region=els.region().value;
  FILTERED_ROWS = RAW_ROWS.filter(r =>
    (store==='__ALL__'   || String(r.__store)===store) &&
    (product==='__ALL__' || String(r.__product)===product) &&
    (region==='__ALL__'  || String(r.__region)===region)
  );
}
function aggregateByDate(dk,tk){
  const agg=els.agg().value;
  const map=new Map();
  for(const r of FILTERED_ROWS){
    const d=r[dk];
    const v=tryNum(r[tk]);
    if(!Number.isFinite(v)) continue;
    if(!map.has(d)) map.set(d,[0,0,null]);
    const a=map.get(d); a[0]+=v; a[1]+=1; a[2]=v;
  }
  const dates=Array.from(map.keys()).sort();
  const series=dates.map(ds=>{
    const[s,c,last]=map.get(ds);
    if(agg==='sum') return s;
    if(agg==='mean') return s/(c||1);
    return last;
  });
  return {dates:dates.map(asDate), series};
}
function rebuildSeries(){
  const dk=els.date().value, tk=els.target().value;
  applyFilters();
  const {dates,series} = aggregateByDate(dk, tk);
  DATES=dates; SERIES=series;
}

// Charts
function lineChart(id,labels,data,label,extra=[]){
  if(CHARTS[id]) CHARTS[id].destroy();
  const ctx=E(id).getContext('2d');
  CHARTS[id]=new Chart(ctx,{
    type:'line',
    data:{labels, datasets:[{label,data,fill:false,tension:0.2}, ...extra]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#e2e8f0'}}, tooltip:{mode:'index',intersect:false}},
      scales:{ x:{ticks:{color:'#cbd5e1'}}, y:{ticks:{color:'#cbd5e1'}} }
    }
  });
}
function barChart(id,labels,data,label,colors){
  if(CHARTS[id]) CHARTS[id].destroy();
  const ctx=E(id).getContext('2d');
  CHARTS[id]=new Chart(ctx,{
    type:'bar',
    data:{labels, datasets:[{label, data, backgroundColor: colors}]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#e2e8f0'}}},
      scales:{ x:{ticks:{color:'#cbd5e1'}}, y:{ticks:{color:'#cbd5e1'}} }
    }
  });
}
function barChartStacked(id, labels, datasets){
  if(CHARTS[id]) CHARTS[id].destroy();
  const ctx=E(id).getContext('2d');
  CHARTS[id]=new Chart(ctx,{
    type:'bar',
    data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#e2e8f0'}}},
      scales:{
        x:{ stacked:true, ticks:{color:'#cbd5e1'} },
        y:{ stacked:true, ticks:{color:'#cbd5e1'} }
      }
    }
  });
}
function getPalette(n){
  const out=[];
  for(let i=0;i<n;i++){ const h = Math.round((360*i)/Math.max(1,n)); out.push(`hsl(${h} 80% 55% / 0.85)`); }
  return out;
}

// Category helpers
function sumByCategory(rows, key, targetKey){
  const sum=new Map();
  for(const r of rows){
    const k=r[key]; const v=tryNum(r[targetKey]);
    if(k==null || !Number.isFinite(v)) continue;
    sum.set(k,(sum.get(k)||0)+v);
  }
  const labels=Array.from(sum.keys());
  const data=labels.map(k=>sum.get(k));
  return {labels,data};
}
function topKByCategorySum(rows, key, targetKey, k=10){
  const m = sumByCategory(rows, key, targetKey);
  const pairs = m.labels.map((lab,i)=>({lab,val:m.data[i]})).sort((a,b)=>b.val-a.val).slice(0,k);
  return {labels:pairs.map(p=>p.lab), data:pairs.map(p=>p.val)};
}

// EDA
function renderEDA(){
  if(!SERIES.length){ log('Load data first.'); return; }
  const tk=els.target().value;
  const labels=DATES.map(d=>d? d.toISOString().slice(0,10):'');

  // Core 4
  const rw=Math.max(3, Number(E('rollingWindow').value)||7);
  const roll=(function(arr,w){const out=[];for(let i=0;i<arr.length;i++){const s=Math.max(0,i-w+1);const sl=arr.slice(s,i+1);out.push(sl.reduce((a,b)=>a+b,0)/sl.length);}return out;})(SERIES,rw);
  lineChart('tsChart', labels, SERIES, 'Target', [{label:`Rolling mean (${rw})`, data:roll, fill:false, borderDash:[6,6], tension:0.2}]);

  const hist=(function(arr,bins=24){const min=Math.min(...arr),max=Math.max(...arr);const step=(max-min)/(bins||1)||1;const edges=Array.from({length:bins+1},(_,i)=>min+i*step);const counts=new Array(bins).fill(0);for(const v of arr){let idx=Math.min(Math.floor((v-min)/step),bins-1);if(idx<0) idx=0;counts[idx]++;}const labels=counts.map((_,i)=>`${edges[i].toFixed(1)}–${edges[i+1].toFixed(1)}`);return{labels,counts};})(SERIES,24);
  barChart('histChart', hist.labels, hist.counts, 'Histogram', getPalette(hist.labels.length));

  const dow=(function(dates,series){const sums=[0,0,0,0,0,0,0], cnt=[0,0,0,0,0,0,0];for(let i=0;i<series.length;i++){const d=dates[i];if(!(d instanceof Date)) continue;const k=d.getDay();sums[k]+=series[i];cnt[k]++;}const avgs=sums.map((s,i)=>cnt[i]? s/cnt[i]:0);return{labels:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], avgs};})(DATES,SERIES);
  barChart('dowChart', dow.labels, dow.avgs, 'Mean by Day of Week', getPalette(dow.labels.length));

  const ac=(function(arr,maxLag=30){const n=arr.length,mean=arr.reduce((a,b)=>a+b,0)/n;const denom=arr.reduce((s,x)=>s+(x-mean)*(x-mean),0)||1;const out=[];for(let lag=1;lag<=maxLag;lag++){let num=0;for(let t=lag;t<n;t++){num+=(arr[t]-mean)*(arr[t-lag]-mean);}out.push(num/denom);}return out;})(SERIES,30);
  barChart('acfChart', Array.from({length:30},(_,i)=>`lag ${i+1}`), ac, 'Autocorrelation (1–30)', getPalette(30));

  // Categorical 4 (auto picks)
  const fields = ["Category","Region","Weather Condition","Holiday/Promotion"];
  const available = fields.filter(f => FILTERED_ROWS.some(r=>r[f]!==undefined));
  const fallbacks = ["Store ID","Product ID"].filter(f => FILTERED_ROWS.some(r=>r[f]!==undefined));
  const targets = available.concat(fallbacks).slice(0,4);

  function meanByCategory(rows, key, targetKey){
    const sum=new Map(), cnt=new Map();
    for(const r of rows){ const k=r[key]; const v=tryNum(r[targetKey]); if(k==null || !Number.isFinite(v)) continue; sum.set(k,(sum.get(k)||0)+v); cnt.set(k,(cnt.get(k)||0)+1); }
    const labels=Array.from(sum.keys()); const data=labels.map(k=>sum.get(k)/(cnt.get(k)||1)); return {labels,data};
  }

  const p1 = meanByCategory(FILTERED_ROWS, targets[0], tk);
  barChart('cat1Chart', p1.labels, p1.data, `${targets[0]} — mean ${tk}`, getPalette(p1.labels.length));

  const p2 = meanByCategory(FILTERED_ROWS, targets[1], tk);
  barChart('cat2Chart', p2.labels, p2.data, `${targets[1]} — mean ${tk}`, getPalette(p2.labels.length));

  const p3 = (function(){ const tmp = topKByCategorySum(FILTERED_ROWS, targets[2], tk, 10); return tmp; })();
  barChart('cat3Chart', p3.labels, p3.data, `Top ${Math.min(10,p3.labels.length)} ${targets[2]} — total ${tk}`, getPalette(p3.labels.length));

  const p4 = (function(){ const tmp = topKByCategorySum(FILTERED_ROWS, targets[3], tk, 10); return tmp; })();
  barChart('cat4Chart', p4.labels, p4.data, `Top ${Math.min(10,p4.labels.length)} ${targets[3]} — total ${tk}`, getPalette(p4.labels.length));

  // Region & Product Insights
  const regKey='__region', prodKey='__product';
  const regions = uniq(FILTERED_ROWS, regKey);
  const regionTotals = sumByCategory(FILTERED_ROWS, regKey, tk);
  barChart('regionTotalsChart', regionTotals.labels, regionTotals.data, `Total ${tk} by Region`, getPalette(regionTotals.labels.length));

  const topProdOverall = topKByCategorySum(FILTERED_ROWS, prodKey, tk, 10);
  barChart('topProductsOverallChart', topProdOverall.labels, topProdOverall.data, `Top 10 Products — total ${tk}`, getPalette(topProdOverall.labels.length));

  const regionColors = getPalette(regions.length);
  const stackedDatasets = regions.map((r,idx)=>{
    const data = topProdOverall.labels.map(p => {
      let s=0;
      for(const row of FILTERED_ROWS){
        if(String(row[prodKey])===String(p) && String(row[regKey])===String(r)){
          const v=tryNum(row[tk]); if(Number.isFinite(v)) s+=v;
        }
      }
      return s;
    });
    return { label: r, data, backgroundColor: regionColors[idx] };
  });
  barChartStacked('topProductsByRegionChart', topProdOverall.labels, stackedDatasets);

  // Mini table: top product per region
  let html = '<table><thead><tr><th>Region</th><th>Top Product</th><th>Total '+tk+'</th></tr></thead><tbody>';
  for(const r of regions){
    const sums=new Map();
    for(const row of FILTERED_ROWS){
      if(String(row[regKey])!==String(r)) continue;
      const p=row[prodKey]; const v=tryNum(row[tk]); if(!Number.isFinite(v)) continue;
      sums.set(p,(sums.get(p)||0)+v);
    }
    let bestProd='—', bestVal=0;
    for(const [p,val] of sums.entries()){ if(val>bestVal){bestVal=val;bestProd=p;} }
    html+=`<tr><td>${r}</td><td>${bestProd}</td><td>${bestVal.toFixed(2)}</td></tr>`;
  }
  html+='</tbody></table>';
  E('regionTopTable').innerHTML = html;

  log('EDA rendered with region/product insights.');
  setStepActive(3);
}

// Windowing
function makeWindows(series,seqLen){ const X=[],y=[]; for(let i=0;i+seqLen<series.length;i++){ X.push(series.slice(i,i+seqLen)); y.push(series[i+seqLen]); } return {X,y}; }
function splitXY(X,y, testRatio=0.2){ const n=X.length, nTest=Math.max(1,Math.floor(n*testRatio)), nTrain=n-nTest; TRAIN_SPLIT_INDEX=nTrain; return {Xtr:X.slice(0,nTrain), ytr:y.slice(0,nTrain), Xte:X.slice(nTrain), yte:y.slice(nTrain)}; }

// Model
function buildModel(kind, seqLen, units, dropout){
  const m=tf.sequential();
  const rnn=(kind==='LSTM') ? tf.layers.lstm({units, inputShape:[seqLen,1], returnSequences:false, dropout})
                            : tf.layers.gru ({units, inputShape:[seqLen,1], returnSequences:false, dropout});
  m.add(rnn); m.add(tf.layers.dense({units:32, activation:'relu'})); m.add(tf.layers.dense({units:1}));
  m.compile({optimizer:tf.train.adam(), loss:'meanSquaredError'});
  return m;
}
async function trainModel(){
  if(!SERIES.length){ log('Load data first.'); return; }
  const seqLen=Number(E('seqLen').value), units=Number(E('units').value), dropout=Number(E('dropout').value);
  const epochs=Number(E('epochs').value), batch=Number(E('batch').value), kind=E('modelType').value;

  zfit(SERIES);
  const zs=z(SERIES);
  const {X,y}=makeWindows(zs, seqLen);
  if(X.length<10){ log('❌ Not enough data for chosen sequence length.'); return; }
  const {Xtr,ytr,Xte,yte}=splitXY(X,y,0.2);

  const tXtr=tf.tensor3d(Xtr.map(x=>x.map(v=>[v])));
  const tytr=tf.tensor2d(ytr.map(v=>[v]));
  const tXte=tf.tensor3d(Xte.map(x=>x.map(v=>[v])));
  const tyte=tf.tensor2d(yte.map(v=>[v]));

  if(MODEL){ MODEL.dispose(); MODEL=null; }
  MODEL=buildModel(kind, seqLen, units, dropout);

  if(CHARTS.lossChart) CHARTS.lossChart.destroy();
  CHARTS.lossChart = new Chart(E('lossChart').getContext('2d'),{
    type:'line',
    data:{labels:[], datasets:[
      {label:'Train Loss', data:[], fill:false, tension:0.1},
      {label:'Val Loss', data:[], fill:false, borderDash:[6,6], tension:0.1}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#e2e8f0'}} },
      scales:{ x:{ticks:{color:'#cbd5e1'}}, y:{ticks:{color:'#cbd5e1'}} }
    }
  });

  E('spinner').classList.remove('hidden');
  E('btnTrain').disabled=true;
  log(`Training ${kind}(${units}) for ${epochs} epochs, batch ${batch}...`);

  await MODEL.fit(tXtr,tytr,{
    epochs, batchSize:batch, validationSplit:0.1, shuffle:false,
    callbacks:{
      onEpochEnd: async (epoch, logs)=>{
        CHARTS.lossChart.data.labels.push(epoch+1);
        CHARTS.lossChart.data.datasets[0].data.push(Number(logs.loss.toFixed(6)));
        CHARTS.lossChart.data.datasets[1].data.push(Number((logs.val_loss??NaN).toFixed(6)));
        CHARTS.lossChart.update();
        log(`Epoch ${epoch+1}/${epochs} — loss=${logs.loss.toFixed(6)} val=${(logs.val_loss??0).toFixed(6)}`);
        await tf.nextFrame();
      }
    }
  });

  tXtr.dispose(); tytr.dispose();
  window.__tXtest=tXte; window.__tytest=tyte;
  E('spinner').classList.add('hidden');
  log('✅ Training complete.');
  setStepActive(4);
  E('btnPredict').disabled=false;
  E('btnEvaluate').disabled=false;
}

// Prediction & Evaluation
function oneStepPredictSequence(model,lastWindow,h){
  const out=[]; let win=lastWindow.slice();
  for(let i=0;i<h;i++){
    const x=tf.tensor3d([win.map(v=>[v])]); const yhat=model.predict(x);
    const val=yhat.dataSync()[0]; x.dispose(); yhat.dispose();
    out.push(val); win=win.slice(1).concat(val);
  }
  return out;
}
function predictFuture(){
  if(!MODEL){ log('Train model first.'); return; }
  const seqLen=Number(E('seqLen').value), horizon=Number(E('horizon').value);
  const zs=z(SERIES); const last=zs.slice(zs.length-seqLen);
  if(last.length<seqLen){ log('❌ Not enough data for sequence length.'); return; }
  const zf=oneStepPredictSequence(MODEL,last,horizon); const f=iz(zf);

  const lastDate = DATES[DATES.length-1] || new Date(); const futLabels=[];
  for(let i=1;i<=horizon;i++){ const d=new Date(lastDate.getTime()+i*86400000); futLabels.push(d.toISOString().slice(0,10)); }
  const combinedLabels = DATES.map(d=>d? d.toISOString().slice(0,10):'').concat(futLabels);
  lineChart('predChart', combinedLabels, SERIES.concat(Array(horizon).fill(null)), 'Actual', [
    {label:'Forecast', data:Array(SERIES.length).fill(null).concat(f), fill:false, borderDash:[4,4], tension:0.2}
  ]);
  log('✅ Forecast plotted.');
}
function evaluateTest(){
  if(!MODEL || !window.__tXtest || !window.__tytest){ log('Train model first.'); return; }
  const tXte=window.__tXtest, tyte=window.__tytest;
  const predsZ=MODEL.predict(tXte);
  const preds=predsZ.arraySync().map(r=>r[0]);
  const trueZ=tyte.arraySync().map(r=>r[0]);
  const yhat=iz(preds), ytrue=iz(trueZ);

  function MAE(t,p){ const n=t.length; let s=0; for(let i=0;i<n;i++) s+=Math.abs(t[i]-p[i]); return s/n; }
  function RMSE(t,p){ const n=t.length; let s=0; for(let i=0;i<n;i++){ const e=t[i]-p[i]; s+=e*e; } return Math.sqrt(s/n); }
  function MAPE(t,p){ const eps=1e-8; const n=t.length; let s=0,c=0; for(let i=0;i<n;i++){ if(Math.abs(t[i])<eps) continue; s+=Math.abs((p[i]-t[i])/t[i]); c++; } return c? s/c : 0; }
  function SMAPE(t,p){ const eps=1e-8; const n=t.length; let s=0; for(let i=0;i<n;i++){ s+=Math.abs(p[i]-t[i])/(Math.abs(t[i])+Math.abs(p[i])+eps); } return (2/n)*s; }

  const mae=MAE(ytrue,yhat), rmse=RMSE(ytrue,yhat), mape=MAPE(ytrue,yhat), smape=SMAPE(ytrue,yhat);
  const acc=Math.max(0,Math.min(1,1-smape/2));
  E('kpiACC').textContent=(100*acc).toFixed(2)+'%';
  E('kpiMAE').textContent=mae.toFixed(3);
  E('kpiRMSE').textContent=rmse.toFixed(3);
  E('kpiMAPE').textContent=(100*mape).toFixed(2)+'%';
  E('kpiSMAPE').textContent=(100*smape).toFixed(2)+'%';

  const seqLen=Number(E('seqLen').value);
  const {X,y}=makeWindows(z(SERIES), seqLen);
  const start = TRAIN_SPLIT_INDEX + seqLen;
  const labels = DATES.slice(start, start+ytrue.length).map(d=>d? d.toISOString().slice(0,10):'');
  lineChart('predChart', labels, ytrue, 'Actual (Test)', [
    {label:'Predicted (Test)', data:yhat, fill:false, borderDash:[6,2], tension:0.2}
  ]);
  predsZ.dispose();
  log('✅ Evaluation complete.');
}

// Wiring
async function handleLoad(kind){
  const rows = await loadRowsFrom(kind);
  if(!rows) return;

  try{
    const names = Object.keys(rows[0]);
    const {dateKey,targetKey} = detectColumns(rows);
    RAW_ROWS = rows.map(r=>({
      ...r,
      __date:r[dateKey],
      __store:r["Store ID"]??r["store"]??r["store_id"],
      __product:r["Product ID"]??r["product"]??r["product_id"],
      __region:r["Region"]??r["region"]
    }));

    const dateOpts = names.map(n=>({value:n,label:n}));
    const numCols = names.filter(n => rows.some(rr => Number.isFinite(tryNum(rr[n]))));
    const targetOpts = numCols.map(n=>({value:n,label:n}));
    const wrap = (arr,key)=>["__ALL__"].concat(uniq(arr,key));
    populateSelect(E('dateCol'), dateOpts, dateKey||names[0]);
    populateSelect(E('targetCol'), targetOpts, targetKey || (numCols[0]||names[0]));
    populateSelect(E('storeFilter'), wrap(RAW_ROWS,'__store').map(v=>({value:v,label:v==="__ALL__"?"All":v})),"__ALL__");
    populateSelect(E('productFilter'), wrap(RAW_ROWS,'__product').map(v=>({value:v,label:v==="__ALL__"?"All":v})),"__ALL__");
    populateSelect(E('regionFilter'), wrap(RAW_ROWS,'__region').map(v=>({value:v,label:v==="__ALL__"?"All":v})),"__ALL__");

    applyFilters();
    const dk=E('dateCol').value, tk=E('targetCol').value;
    ({dates:DATES, series:SERIES} = aggregateByDate(dk,tk));

    RAW_ROWS.sort((a,b)=>(asDate(a.__date)||0)-(asDate(b.__date)||0));
    toTable(RAW_ROWS);
    summarize(RAW_ROWS, dk, tk);

    setStepActive(2);
    E('btnEDA').disabled=false;
    E('btnTrain').disabled=true;
    E('btnPredict').disabled=true;
    E('btnEvaluate').disabled=true;
  }catch(e){
    errorMsg('Failed to prepare data: '+(e.message||String(e)));
    log('❌ '+(e.message||String(e)));
  }
}
function reprepare(){
  if(!RAW_ROWS.length) return;
  rebuildSeries();
  summarize(RAW_ROWS, E('dateCol').value, E('targetCol').value);
  setStepActive(2);
  log('Filters/columns changed. Re-run EDA and training.');
}

E('btnLoad').addEventListener('click',()=>handleLoad('file'));
E('btnLoadDataJS').addEventListener('click',()=>handleLoad('datajs'));
E('btnDemo').addEventListener('click',()=>handleLoad('demo'));
E('btnEDA').addEventListener('click',renderEDA);
E('btnTrain').addEventListener('click',()=>{trainModel().catch(e=>{console.error(e);log(`❌ ${e.message}`);}).finally(()=>{E('btnTrain').disabled=false;});});
E('btnPredict').addEventListener('click',()=>{try{predictFuture();}catch(e){console.error(e);log(`❌ ${e.message}`);}});
E('btnEvaluate').addEventListener('click',()=>{try{evaluateTest();}catch(e){console.error(e);log(`❌ ${e.message}`);}});
['dateCol','targetCol','aggFunc','storeFilter','productFilter','regionFilter'].forEach(id=>E(id).addEventListener('change',reprepare));

setStepActive(1);
log('Ready. Step 1: load a dataset (CSV/JSON, data.js, or Demo).');