/* Общий код всех страниц портала: даты/числа, тема, движок графиков (SVG), карточки, запуск страницы.
   Подключается страницами после ../data/data.js (RAW — сырые таблицы) и dataset.js (расчёт → DATA). */
if(typeof DATA==='undefined') document.body.innerHTML='<p style="font:16px sans-serif;padding:24px">Нет данных — откройте приложение SEL</p>';

// Страница без своих данных (<body data-needs="weight kcal …"> — нужен хотя бы один непустой ряд) → вместо содержимого
// приглашение подключить сервис; код страницы обёрнут в if(!PAGE_EMPTY).
const PAGE_EMPTY = (()=>{
  const n = document.body.dataset.needs;
  if(!n || typeof DATA==='undefined') return false;
  if(n.split(' ').some(k=>(DATA[k]||[]).length)) return false;
  const w = document.querySelector('.wrap');
  [...w.children].forEach(c=>{ if(c.tagName!=='NAV' && c.tagName!=='SCRIPT') c.hidden = true; });
  const m = document.createElement('div'); m.className = 'card';
  m.innerHTML = (typeof Nav!=='undefined' ? '<div class="empty-logo">'+Nav.logo(56)+'</div>' : '') + '<h2>Данных пока нет</h2><div class="desc">Подключите FatSecret или Whoop' +
    (window.health ? ' — на странице <a href="settings.html">«Настройки»</a>' : '') + '.</div>';
  w.appendChild(m);
  return true;
})();

// ---------- даты и числа ----------
const $ = s => document.querySelector(s);
const DAY = 864e5;
const P = s => new Date(s.slice(0,10)+'T00:00:00');
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addD = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const fmtD = d => d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','');
const fmtDY = d => d.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const fmtW = d => d.toLocaleDateString('ru-RU',{weekday:'short'});
const nf = (v,dg=0) => v==null||isNaN(v) ? '—' : v.toLocaleString('ru-RU',{minimumFractionDigits:dg,maximumFractionDigits:dg});
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
function median(a){ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
const plural = (n,a,b,c) => { const m=n%10, h=n%100; return (m===1&&h!==11)?a:(m>=2&&m<=4&&(h<12||h>14))?b:c; };
const dni = n => n+' '+plural(n,'день','дня','дней');
// текст из CSV и ответов сервисов (заметки, названия видов спорта) — только через esc: в innerHTML он не должен стать разметкой
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const css = v => getComputedStyle($('.viz-root')).getPropertyValue(v).trim();   // цвет из текущей темы

// ---------- графики ----------
const tip=document.createElement('div'); tip.className='tip';
const JOBS=[];                                   // графики рисуются после вставки карточек (нужна ширина)
function chart(el,cfg){ JOBS.push(()=>drawChart(el,cfg)); }
function niceTicks(a,b,n){ const st=Math.pow(10,Math.floor(Math.log10((b-a)/n))); const c=[1,2,2.5,5,10].map(k=>k*st).find(k=>(b-a)/k<=n)||st*10; const out=[]; for(let v=Math.ceil(a/c)*c; v<=b+1e-9; v+=c) out.push(+v.toFixed(6)); return out; }
function roundTop(x,y,w,h,r){ if(h<=0) return ''; r=Math.max(0,r); return `M${x},${y+h} L${x},${y+r} Q${x},${y} ${x+r},${y} L${x+w-r},${y} Q${x+w},${y} ${x+w},${y+r} L${x+w},${y+h} Z`; }
function drawChart(el,cfg){
  // cfg: {from,to (мс), y:[min,max], yticks?, yfmt?, H?, hover:[{t,html}], refs?:[{y,label}],
  //       layers:[{type:'bar'|'line'|'dots'|'stack'|'dstack'|'step'|'hline', data:[[date,val]], color, colorOf?, opacity?, width?(дней), keys?, colors?, maxGap?, dash?, sw?, r?, offset?, y?}]}
  const W=el.clientWidth||520, H=cfg.H||220, m={l:40,r:12,t:12,b:24};
  const iw=W-m.l-m.r, ih=H-m.t-m.b;
  const x=t=>m.l+(t-cfg.from)/(cfg.to-cfg.from)*iw;
  const [y0,y1]=cfg.y; const y=v=>m.t+ih-(v-y0)/(y1-y0)*ih;
  let s=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`;
  (cfg.yticks||niceTicks(y0,y1,4)).forEach(v=>{ s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${m.l-6}" y="${y(v)+4}" text-anchor="end">${(cfg.yfmt||nf)(v)}</text>`; });
  const span=(cfg.to-cfg.from)/DAY;
  if(span<=70){ // недели
    let d=new Date(cfg.from); while(d.getDay()!==1) d=addD(d,1);
    while(d<=cfg.to){ const xx=x(d); s+=`<line x1="${xx}" x2="${xx}" y1="${m.t+ih}" y2="${m.t+ih+4}" stroke="var(--border)"/><text x="${xx}" y="${H-6}" text-anchor="middle">${fmtD(d)}</text>`; d=addD(d, span>35?14:7); }
  } else {
    let d=new Date(cfg.from); d.setDate(1); d.setMonth(d.getMonth()+1); const stepM=span>300?2:1;
    while(d<=cfg.to){ const xx=x(d); s+=`<line x1="${xx}" x2="${xx}" y1="${m.t+ih}" y2="${m.t+ih+4}" stroke="var(--border)"/><text x="${xx}" y="${H-6}" text-anchor="middle">${d.toLocaleDateString('ru-RU',{month:'short'}).replace('.','')}</text>`; d.setMonth(d.getMonth()+stepM); }
  }
  s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${m.t+ih}" y2="${m.t+ih}" stroke="var(--border)"/>`;
  cfg.layers.forEach(L=>{
    const data=(L.data||[]).filter(([dd])=>{const t=P(dd); return t>=cfg.from&&t<=cfg.to;});
    if(L.type==='bar'){
      const bw=Math.max(1.5,(L.width||1)*DAY/(cfg.to-cfg.from)*iw-2);
      data.forEach(([dd,v])=>{ const t=P(dd).getTime()+(L.width||1)*DAY/2; const h=Math.max(0,y(y0)-y(v)); s+=`<path d="${roundTop(x(t)-bw/2,y(v),bw,h,Math.min(4,bw/2,h))}" fill="${L.colorOf?L.colorOf(v):L.color}" opacity="${L.opacity||1}"/>`; });
    }
    if(L.type==='stack'){
      const bw=Math.max(3,7*DAY/(cfg.to-cfg.from)*iw-2);
      data.forEach(([dd,o])=>{ const t=P(dd).getTime()+3.5*DAY; let acc=0; const ks=L.keys.filter(k=>o[k]>0);
        ks.forEach((k,i)=>{ const top=i===ks.length-1; const yA=y(acc), yB=y(acc+o[k]); const h=yA-yB-(top?0:2); const col=L.colors[L.keys.indexOf(k)];
          s+= top?`<path d="${roundTop(x(t)-bw/2,yB,bw,h,Math.min(4,bw/2,h))}" fill="${col}"/>`:`<rect x="${x(t)-bw/2}" y="${yB+2}" width="${bw}" height="${Math.max(0,h)}" fill="${col}"/>`; acc+=o[k]; }); });
    }
    if(L.type==='dstack'){ // стек по дням
      const bw=Math.max(1.5,DAY/(cfg.to-cfg.from)*iw-2);
      data.forEach(([dd,o])=>{ const t=P(dd).getTime()+DAY/2; let acc=0; const ks=L.keys.filter(k=>o[k]>0);
        ks.forEach((k,i)=>{ const top=i===ks.length-1; const yA=y(acc), yB=y(acc+o[k]); const h=yA-yB-(top?0:1); const col=L.colors[L.keys.indexOf(k)];
          s+= top?`<path d="${roundTop(x(t)-bw/2,yB,bw,h,Math.min(3,bw/2,h))}" fill="${col}"/>`:`<rect x="${x(t)-bw/2}" y="${yB+1}" width="${bw}" height="${Math.max(0,h)}" fill="${col}"/>`; acc+=o[k]; }); });
    }
    if(L.type==='hline'){ s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(L.y)}" y2="${y(L.y)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="5 4"/>`; }
    if(L.type==='line'){
      const seg=[]; let prev=null;
      data.forEach(([dd,v])=>{ if(v==null) return; const t=P(dd).getTime()+(L.offset||0); const gap=prev&&(t-prev)>(L.maxGap||4)*DAY; seg.push((seg.length&&!gap?'L':'M')+x(t).toFixed(1)+' '+y(v).toFixed(1)); prev=t; });
      s+=`<path d="${seg.join(' ')}" fill="none" stroke="${L.color}" stroke-width="${L.sw||2}" stroke-linejoin="round" stroke-linecap="round" opacity="${L.opacity||1}"${L.dash?` stroke-dasharray="${L.dash}"`:''}/>`;
    }
    if(L.type==='dots'){ data.forEach(([dd,v])=>{ if(v==null) return; s+=`<circle cx="${x(P(dd))}" cy="${y(v)}" r="${L.r||4}" fill="${L.color}" stroke="var(--surface-1)" stroke-width="2"/>`; }); }
    if(L.type==='step'){ // цель-ступенька
      let d=''; let prevV=null;
      data.forEach(([dd,v],i)=>{ const xx=x(P(dd)); if(prevV===null) d+=`M${xx} ${y(v)}`; else if(v!==prevV) d+=` L${xx} ${y(prevV)} L${xx} ${y(v)}`; prevV=v; if(i===data.length-1) d+=` L${x(cfg.to)} ${y(v)}`; });
      s+=`<path d="${d}" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      if(data.length){ const lv=data[data.length-1][1]; s+=`<text x="${W-m.r-2}" y="${y(lv)-5}" text-anchor="end" style="fill:var(--text-secondary)">цель ${nf(lv)}</text>`; }
    }
  });
  (cfg.refs||[]).forEach(R=>{ s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(R.y)}" y2="${y(R.y)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W-m.r-2}" y="${y(R.y)-5}" text-anchor="end" style="fill:var(--text-secondary)">${R.label}</text>`; });
  s+=`<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t+ih}" stroke="var(--text-muted)" stroke-width="1" opacity="0"/>`;
  s+=`<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML=s; el.appendChild(tip.cloneNode());
  const svg=el.querySelector('svg'), cross=el.querySelector('.cross'), tp=el.querySelector('.tip');
  const hov=cfg.hover.filter(h=>h.t>=cfg.from&&h.t<=cfg.to);
  svg.addEventListener('mousemove',e=>{
    const rc=svg.getBoundingClientRect(), mx=e.clientX-rc.left; if(mx<m.l||mx>W-m.r||!hov.length){tp.style.opacity=0;cross.setAttribute('opacity',0);return;}
    const t=cfg.from+(mx-m.l)/iw*(cfg.to-cfg.from); let best=hov[0]; hov.forEach(h=>{ if(Math.abs(h.t-t)<Math.abs(best.t-t)) best=h; });
    const xx=x(best.t); cross.setAttribute('x1',xx); cross.setAttribute('x2',xx); cross.setAttribute('opacity',.6);
    tp.innerHTML=best.html; tp.style.opacity=1; const tw=tp.offsetWidth; tp.style.left=(xx+12+tw>W?Math.max(0,xx-12-tw):xx+12)+'px'; tp.style.top='8px';
  });
  svg.addEventListener('mouseleave',()=>{tp.style.opacity=0;cross.setAttribute('opacity',0);});
}

// карточка графика в #charts; с tableRows/tableHead — ещё и кнопка «Таблица»
function card(id,title,desc,legend,tableRows,tableHead){
  const c=document.createElement('div'); c.className='card';
  if(tableRows){
    c.innerHTML=`<div class="cardhead"><div><h2>${title}</h2><div class="desc">${desc}</div></div><button class="iconbtn tb">Таблица</button></div>
    <div class="legend">${legend||''}</div><div class="chart" id="${id}"></div><div class="tablewrap" hidden><table><thead><tr>${tableHead.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${tableRows.slice().reverse().map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    c.querySelector('.tb').onclick=()=>{ const tw=c.querySelector('.tablewrap'); tw.hidden=!tw.hidden; c.querySelector('.chart').hidden=!tw.hidden; c.querySelector('.tb').textContent=tw.hidden?'Таблица':'График'; };
  } else {
    c.innerHTML=`<h2>${title}</h2><div class="desc">${desc}</div><div class="legend">${legend||''}</div><div class="chart" id="${id}"></div>`;
  }
  $('#charts').appendChild(c); return c.querySelector('.chart');
}
const Lg={sq:(c,t)=>`<span><i class="sq" style="background:${c}"></i>${t}</span>`, ln:(c,t)=>`<span><i class="swl" style="border-color:${c}"></i>${t}</span>`, ref:t=>`<span><i class="swd" style="border-color:var(--text-secondary)"></i>${t}</span>`};

// ---------- календарь: подсказка у ячейки (типовой элемент — во всех календарях только так) ----------
// el — блок календаря (.hm, прокручивается по горизонтали), ячейки — <rect class="c" data-d="ГГГГ-ММ-ДД">;
// html(ds) — содержимое подсказки. Подсказка живёт в родителе el, а не внутри: прокрутка обрезала бы её.
// Под ячейкой, если влезает до низа календаря; иначе (нижние ячейки) — над ней. По ширине — в пределах родителя.
function calTips(el, html){
  const box=el.parentElement;
  if(getComputedStyle(box).position==='static') box.style.position='relative';
  box.querySelectorAll(':scope>.tip').forEach(t=>t.remove());          // от прошлой отрисовки
  const tp=tip.cloneNode(); box.appendChild(tp);
  el.querySelectorAll('rect.c').forEach(c=>{
    c.addEventListener('mouseenter',()=>{
      tp.innerHTML=html(c.dataset.d); tp.style.opacity=1;
      const rb=c.getBoundingClientRect(), bb=box.getBoundingClientRect(), hb=el.getBoundingClientRect();
      const tw=tp.offsetWidth, th=tp.offsetHeight, g=6;
      tp.style.left=Math.max(0,Math.min(rb.left-bb.left+rb.width/2-tw/2, box.clientWidth-tw))+'px';
      tp.style.top=(rb.bottom+g+th<=hb.bottom ? rb.bottom-bb.top+g : rb.top-bb.top-th-g)+'px';
    });
    c.addEventListener('mouseleave',()=>tp.style.opacity=0);
  });
}

// ---------- период (кнопки #range: 7 / 14 / … / all) ----------
// periodDays — последние p дней до end (all — с first), не раньше first; prevDays — столько же дней перед ним
// (first — не раньше этой даты; null — без ограничения)
function periodDays(p, first, end){
  let start = p==='all' ? new Date(first) : addD(end,-(+p-1));
  if(start<first) start=new Date(first);
  const days=[]; for(let d=new Date(start); d<=end; d=addD(d,1)) days.push(iso(d));
  return {start, end, days};
}
function prevDays(cur, first){
  const n=cur.days.length, end=addD(cur.start,-1), start=addD(end,-(n-1));
  const days=[]; for(let d=new Date(start); d<=end; d=addD(d,1)) if(!first||d>=first) days.push(iso(d));
  return {start, end, days};
}

// плитки показателей в #tiles: [{lab, val, note, c — цвет точки или null}] (lab/val/note — готовая разметка страницы)
function tileCards(items){
  $('#tiles').innerHTML = items.map(i=>`<div class="tile"><div class="lab">${i.lab}</div><div class="val">${i.val}</div><div class="note">${i.c?`<span class="dot" style="background:${i.c}"></span>`:''}<span>${i.note}</span></div></div>`).join('');
}

// ---------- запуск страницы ----------
// render — перерисовать всё; onRange(button) — что сделать при выборе периода (#range button);
// init — один раз после применения сохранённой темы, до первой отрисовки
function boot(render, onRange, init){
  document.querySelectorAll('#range button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('#range button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); onRange(b); render(); });
  $('#theme').onclick=()=>{ const r=document.documentElement; const dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme=dark?'light':'dark'; try{localStorage.setItem('theme',r.dataset.theme)}catch(e){} render(); };
  try{ const t=localStorage.getItem('theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
  if(init) init();
  render();
  let rz; addEventListener('resize',()=>{clearTimeout(rz); rz=setTimeout(render,150)});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>render()); // цвета графиков берутся из темы при отрисовке
}
