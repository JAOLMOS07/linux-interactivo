// ================= SIMULADORES DE SISTEMAS OPERATIVOS =================
const Sims = (() => {
  // procs: [{name, arrival, burst, prio}]; devuelve {gantt:[{name,start,end}], rows:[...], avgWait, avgTurn, avgResp}
  function schedule(procs, algo, quantum = 2) {
    const ps = procs.map((p, i) => ({ ...p, idx: i, rem: p.burst, first: null, finish: null }));
    const gantt = [];
    let t = 0;
    const push = (name, s, e) => {
      const last = gantt[gantt.length - 1];
      if (last && last.name === name && last.end === s) last.end = e; else gantt.push({ name, start: s, end: e });
    };
    const done = () => ps.every(p => p.rem === 0);
    const byArrival = (a, b) => a.arrival - b.arrival || a.idx - b.idx;
    if (algo === 'FCFS' || algo === 'SJF' || algo === 'PRIO') {
      while (!done()) {
        const ready = ps.filter(p => p.rem > 0 && p.arrival <= t);
        if (!ready.length) { const nx = Math.min(...ps.filter(p => p.rem > 0).map(p => p.arrival)); push('—', t, nx); t = nx; continue; }
        let pick;
        if (algo === 'FCFS') pick = ready.sort(byArrival)[0];
        else if (algo === 'SJF') pick = ready.sort((a, b) => a.burst - b.burst || byArrival(a, b))[0];
        else pick = ready.sort((a, b) => a.prio - b.prio || byArrival(a, b))[0];
        pick.first = t; push(pick.name, t, t + pick.rem); t += pick.rem; pick.rem = 0; pick.finish = t;
      }
    } else if (algo === 'SRTF' || algo === 'PRIOP') {
      while (!done()) {
        const ready = ps.filter(p => p.rem > 0 && p.arrival <= t);
        if (!ready.length) { const nx = Math.min(...ps.filter(p => p.rem > 0).map(p => p.arrival)); push('—', t, nx); t = nx; continue; }
        const pick = algo === 'SRTF' ? ready.sort((a, b) => a.rem - b.rem || byArrival(a, b))[0] : ready.sort((a, b) => a.prio - b.prio || byArrival(a, b))[0];
        if (pick.first === null) pick.first = t;
        push(pick.name, t, t + 1); t += 1; pick.rem -= 1;
        if (pick.rem === 0) pick.finish = t;
      }
    } else if (algo === 'RR') {
      const q = Math.max(1, quantum | 0);
      const queue = [];
      const sorted = ps.slice().sort(byArrival);
      let ai = 0;
      const admit = upTo => { while (ai < sorted.length && sorted[ai].arrival <= upTo) queue.push(sorted[ai++]); };
      admit(t);
      while (!done()) {
        if (!queue.length) { const nx = sorted[ai].arrival; push('—', t, nx); t = nx; admit(t); continue; }
        const p = queue.shift();
        if (p.first === null) p.first = t;
        const run = Math.min(q, p.rem);
        push(p.name, t, t + run); t += run; p.rem -= run;
        admit(t); // los que llegan durante el quantum entran antes que el expulsado
        if (p.rem > 0) queue.push(p); else p.finish = t;
      }
    }
    const rows = ps.map(p => ({ name: p.name, arrival: p.arrival, burst: p.burst, prio: p.prio, finish: p.finish, turnaround: p.finish - p.arrival, wait: p.finish - p.arrival - p.burst, response: p.first - p.arrival }));
    const avg = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    return { gantt, rows, avgWait: avg('wait'), avgTurn: avg('turnaround'), avgResp: avg('response'), total: t };
  }

  // reemplazo de páginas. refs: array de números; devuelve {steps:[{ref, frames:[...], fault, victim}], faults}
  function paging(refs, nframes, algo) {
    const frames = [];
    const loadTime = {}, lastUse = {};
    const steps = [];
    let faults = 0, fifoPtr = 0;
    refs.forEach((r, i) => {
      let fault = false, victim = null, slot = frames.indexOf(r);
      if (slot >= 0) { lastUse[r] = i; }
      else {
        fault = true; faults++;
        if (frames.length < nframes) { frames.push(r); slot = frames.length - 1; }
        else {
          let vi;
          if (algo === 'FIFO') { vi = fifoPtr; fifoPtr = (fifoPtr + 1) % nframes; }
          else if (algo === 'LRU') { vi = frames.reduce((best, f, k) => lastUse[f] < lastUse[frames[best]] ? k : best, 0); }
          else { // OPT
            let far = -1; vi = 0;
            frames.forEach((f, k) => { const nx = refs.indexOf(f, i + 1); const d = nx < 0 ? Infinity : nx; if (d > far) { far = d; vi = k; } });
          }
          victim = frames[vi]; frames[vi] = r; slot = vi;
        }
        loadTime[r] = i; lastUse[r] = i;
      }
      steps.push({ ref: r, frames: frames.slice(), fault, victim, slot });
    });
    return { steps, faults, hits: refs.length - faults };
  }
  return { schedule, paging };
})();
if (typeof module !== 'undefined') module.exports = Sims;
