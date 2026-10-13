// ================= INTERFAZ =================
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  const K_SYS = 'lxlab.system.v1', K_PROG = 'lxlab.progress.v1';

  // ---------- estado ----------
  let sys = null, setupDone = {};
  function loadSystem() {
    const raw = store.get(K_SYS);
    if (raw) {
      try { const o = JSON.parse(raw); const S = Engine.deserialize(o.sys); if (S) { sys = S; setupDone = o.setupDone || {}; return; } } catch (e) { }
    }
    sys = Engine.createSystem(); setupDone = {};
  }
  let saveT = null;
  function saveSystem() {
    clearTimeout(saveT);
    saveT = setTimeout(() => store.set(K_SYS, JSON.stringify({ sys: Engine.serialize(sys), setupDone })), 300);
  }
  let progress = { done: {}, last: null };
  try { const p = JSON.parse(store.get(K_PROG) || 'null'); if (p && p.done) progress = p; } catch (e) { }
  let remote = null, remoteBusy = false, remoteDirty = false;
  function saveProgress() {
    store.set(K_PROG, JSON.stringify(progress));
    if (remote) { remoteDirty = true; flushRemote(); }
  }
  async function flushRemote() {
    if (remoteBusy || !remoteDirty || !remote) return;
    remoteBusy = true; remoteDirty = false;
    try { await remote.set({ done: progress.done, last: progress.last || null, updated: Date.now() }); }
    catch (e) { if (e && e.code === 'invalid_argument') remote = null; }
    remoteBusy = false;
    if (remoteDirty) flushRemote();
  }
  (async () => {
    try {
      if (!window.claude || !window.claude.use) return;
      const [user, db] = await Promise.all([window.claude.use('user'), window.claude.use('db')]);
      if (!user || !db) return;
      const id = await user.id();
      if (!id) return;
      const ref = db.doc('data/users/' + id + '/progress');
      const snap = await ref.get();
      if (snap.exists) {
        const d = snap.data() || {};
        const rd = d.done || {};
        for (const k in rd) progress.done[k] = [...new Set([...(progress.done[k] || []), ...rd[k]])].sort((a, b) => a - b);
        if (!progress.last && d.last) progress.last = d.last;
        store.set(K_PROG, JSON.stringify(progress));
        refreshAll();
      }
      remote = ref;
      remoteDirty = true; flushRemote();
    } catch (e) { /* sin guardado en la nube: seguimos con el navegador */ }
  })();

  const doneOf = m => progress.done[m.id] || [];
  const isDone = (m, i) => doneOf(m).includes(i);
  const modPct = m => doneOf(m).length / m.tasks.length;
  const totalTasks = MODULES.reduce((s, m) => s + m.tasks.length, 0);
  const totalDone = () => MODULES.reduce((s, m) => s + doneOf(m).filter(i => i < m.tasks.length).length, 0);

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------- ANSI → HTML ----------
  function ansi(s) {
    let out = '', cls = [];
    const parts = s.split(/\x1b\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const codes = parts[i].split(';').filter(Boolean);
        if (!codes.length || codes.includes('0')) cls = [];
        codes.forEach(c => { if (c !== '0') cls.push('a' + c); });
        continue;
      }
      if (!parts[i]) continue;
      out += cls.length ? `<span class="${cls.join(' ')}">${esc(parts[i])}</span>` : esc(parts[i]);
    }
    return out;
  }

  // ================= TERMINAL =================
  const Term = (() => {
    const root = el('div', { class: 'term' });
    const head = el('div', { class: 'term-h' }, el('span', { class: 'dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
    const ttl = el('span', { class: 'ttl' });
    const btnReset = el('button', { type: 'button', title: 'Vuelve a preparar los archivos de este módulo' }, 'Reiniciar laboratorio');
    const btnClear = el('button', { type: 'button' }, 'Limpiar');
    head.append(ttl, btnReset, btnClear);
    const screen = el('div', { class: 'screen', role: 'log', 'aria-live': 'polite' });
    const inrow = el('div', { class: 'inrow' });
    const ps = el('span', { class: 'ps' });
    const input = el('input', { id: 'term-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Escribe una orden', enterkeyhint: 'send' });
    inrow.append(ps, input);
    const keys = el('div', { class: 'keys' });
    root.append(head, screen, keys);
    screen.append(inrow);
    let buffer = '', hIdx = -1, draft = '', lastTab = 0;
    let onCommand = null, onEditorSave = null;
    const promptHTML = (cont) => {
      if (cont) return '<span class="a2">&gt; </span>';
      const p = Engine.prompt(sys);
      return `<span class="pu${p.user === 'root' ? ' root' : ''}">${esc(p.user)}@${esc(p.host)}</span>:<span class="pp">${esc(p.path)}</span>${p.sym} `;
    };
    function updatePrompt() { ps.innerHTML = promptHTML(!!buffer); const p = Engine.prompt(sys); ttl.textContent = `${p.user}@${p.host}: ${p.path}`; }
    function line(html, cls) { const d = el('div', { class: 'ln' + (cls ? ' ' + cls : '') }); d.innerHTML = html; screen.insertBefore(d, inrow); return d; }
    function print(text, cls) { if (!text) return; const t = text.endsWith('\n') ? text.slice(0, -1) : text; line(ansi(t), cls); }
    function sysmsg(text) { line(esc(text), 'sys'); scroll(); }
    function scroll() { screen.scrollTop = screen.scrollHeight; }
    function clear() { [...screen.querySelectorAll('.ln')].forEach(n => n.remove()); }
    function expandBang(l) {
      const h = sys.history;
      if (!/!(!|\d+|-\d+)/.test(l)) return l;
      return l.replace(/!!/g, () => h[h.length - 1] || '').replace(/!(-?\d+)/g, (m, n) => { n = +n; return (n < 0 ? h[h.length + n] : h[n - 1]) || m; });
    }
    function finishedJobs() {
      const fin = Engine.reapProcs(sys);
      sys.jobs.filter(j => j.notify).forEach(j => fin.push(j));
      fin.forEach(j => { j.notify = false; j.shown = true; print(`[${j.id}]+  ${j.state.padEnd(22)} ${j.cmd}`); });
    }
    function run(raw) {
      let l = raw;
      const echoed = promptHTML(!!buffer) + esc(raw);
      line(echoed);
      const full = buffer ? buffer + '\n' + l : l;
      if (!full.trim()) { buffer = ''; finishedJobs(); updatePrompt(); scroll(); return; }
      let expanded = buffer ? full : expandBang(full);
      if (!buffer && expanded !== full) print(expanded);
      const res = Engine.execLine(sys, expanded);
      if (res.incomplete) { buffer = expanded; updatePrompt(); scroll(); return; }
      buffer = '';
      if (expanded.trim() && sys.history[sys.history.length - 1] !== expanded.replace(/\n/g, '; ')) sys.history.push(expanded.replace(/\n/g, '; '));
      if (sys.history.length > 500) sys.history.shift();
      for (const o of res.out) {
        if (o.t === 'clear') { clear(); continue; }
        print(o.s, o.t === 'e' ? 'err' : '');
      }
      finishedJobs();
      updatePrompt();
      scroll();
      saveSystem();
      if (res.editor) openNano(res.editor);
      if (onCommand) onCommand(res, expanded);
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; hIdx = -1; run(v); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); histMove(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); histMove(1); return; }
      if (e.key === 'Tab') { e.preventDefault(); tab(); return; }
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); clear(); return; }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !window.getSelection().toString()) { e.preventDefault(); ctrlC(); return; }
      if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); input.value = ''; return; }
    });
    function ctrlC() { line(promptHTML(!!buffer) + esc(input.value) + '<span class="a2">^C</span>'); input.value = ''; buffer = ''; updatePrompt(); scroll(); }
    function histMove(d) {
      const h = sys.history;
      if (!h.length) return;
      if (hIdx === -1) { if (d > 0) return; draft = input.value; hIdx = h.length; }
      hIdx += d;
      if (hIdx < 0) hIdx = 0;
      if (hIdx >= h.length) { hIdx = -1; input.value = draft; return; }
      input.value = h[hIdx];
      setTimeout(() => input.setSelectionRange(input.value.length, input.value.length));
    }
    function tab() {
      const pos = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, pos), after = input.value.slice(pos);
      const r = Engine.complete(sys, before);
      if (r.line !== before) { input.value = r.line + after; const p = r.line.length; input.setSelectionRange(p, p); }
      else if (r.options.length) {
        const now = Date.now();
        if (now - lastTab < 900 || r.options.length <= 12) { line(promptHTML(!!buffer) + esc(input.value)); print(r.options.join('  ')); scroll(); }
        lastTab = now;
      }
    }
    screen.addEventListener('click', () => { if (!window.getSelection().toString()) input.focus({ preventScroll: true }); });
    btnClear.addEventListener('click', () => { clear(); input.focus(); });
    // teclas para móvil
    [['Tab', tab], ['↑', () => histMove(-1)], ['↓', () => histMove(1)], ['Ctrl+C', ctrlC], ['|'], ['>'], ['~'], ['/'], ['-'], ['*'], ['&'], ['$'], ['"']].forEach(([k, fn]) => {
      keys.append(el('button', { type: 'button', onmousedown: e => e.preventDefault(), onclick: () => { if (fn) fn(); else { const p = input.selectionStart ?? input.value.length; input.value = input.value.slice(0, p) + k + input.value.slice(p); input.setSelectionRange(p + 1, p + 1); } input.focus(); } }, k));
    });

    // ---- nano ----
    function openNano(ed) {
      const box = el('div', { class: 'nano', role: 'dialog', 'aria-label': 'Editor nano' });
      const ta = el('textarea', { id: 'nano-area', spellcheck: 'false', 'aria-label': 'Contenido del archivo' });
      ta.value = ed.data;
      const msg = el('div', { class: 'nano-msg' });
      const nameEl = el('span', {}, ed.name + (ed.isNew ? '' : ''));
      const modEl = el('span', {}, '');
      const hdr = el('div', { class: 'nano-h' }, el('span', {}, 'GNU nano 7.2'), nameEl, modEl);
      let modified = false, asking = false;
      const say = t => { msg.innerHTML = t ? `<span>${t}</span>` : ''; };
      say(ed.isNew ? '[ Archivo nuevo ]' : ed.readonly ? '[ Solo lectura: no tienes permiso de escritura ]' : `[ ${ed.data.split('\n').length - (ed.data.endsWith('\n') ? 1 : 0)} líneas leídas ]`);
      ta.addEventListener('input', () => { if (!modified) { modified = true; modEl.textContent = 'Modificado'; } });
      const save = () => {
        let data = ta.value;
        if (data && !data.endsWith('\n')) data += '\n';
        try {
          Engine.writeFile(sys, ed.path, data);
          modified = false; modEl.textContent = '';
          { const n = data.split('\n').length - 1; say(`[ ${n} ${n === 1 ? 'línea escrita' : 'líneas escritas'} ]`); }
          saveSystem();
          if (onEditorSave) onEditorSave(ed.path);
          return true;
        } catch (e) { say(`[ Error escribiendo ${esc(ed.name)}: ${esc(e.message)} ]`); return false; }
      };
      const close = () => { box.remove(); updatePrompt(); input.focus(); };
      const exit = () => {
        if (!modified) return close();
        asking = true;
        msg.innerHTML = '';
        msg.append(el('span', {}, '¿Guardar el búfer modificado?'), ' ',
          el('button', { type: 'button', class: 'btn sm', onclick: () => { if (save()) close(); } }, 'S Sí'), ' ',
          el('button', { type: 'button', class: 'btn sm', onclick: close }, 'N No'), ' ',
          el('button', { type: 'button', class: 'btn sm', onclick: () => { asking = false; say(''); ta.focus(); } }, '^C Cancelar'));
      };
      ta.addEventListener('keydown', e => {
        if (asking) {
          if (/^[sSyY]$/.test(e.key)) { e.preventDefault(); if (save()) close(); }
          else if (/^[nN]$/.test(e.key)) { e.preventDefault(); close(); }
          else if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); asking = false; say(''); }
          return;
        }
        if (!e.ctrlKey) return;
        const k = e.key.toLowerCase();
        if (k === 'o' || k === 's') { e.preventDefault(); save(); }
        else if (k === 'x') { e.preventDefault(); exit(); }
        else if (k === 'k') {
          e.preventDefault();
          const v = ta.value, p = ta.selectionStart;
          const a = v.lastIndexOf('\n', p - 1) + 1; let b = v.indexOf('\n', p); b = b < 0 ? v.length : b + 1;
          Term.cut = v.slice(a, b); ta.value = v.slice(0, a) + v.slice(b); ta.setSelectionRange(a, a); ta.dispatchEvent(new Event('input'));
        } else if (k === 'u') {
          e.preventDefault();
          if (Term.cut) { const p = ta.selectionStart; const v = ta.value; const a = v.lastIndexOf('\n', p - 1) + 1; ta.value = v.slice(0, a) + Term.cut + v.slice(a); ta.setSelectionRange(a + Term.cut.length, a + Term.cut.length); ta.dispatchEvent(new Event('input')); }
        }
      });
      const fb = (k, label, fn) => el('button', { type: 'button', onmousedown: e => e.preventDefault(), onclick: fn }, el('b', {}, k), label);
      const foot = el('div', { class: 'nano-f' }, fb('^O', 'Guardar', save), fb('^X', 'Salir', exit), fb('^K', 'Cortar línea', () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))), fb('^U', 'Pegar', () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', ctrlKey: true }))));
      box.append(hdr, ta, msg, foot);
      root.append(box);
      setTimeout(() => ta.focus(), 30);
    }

    function mount(slot) { slot.append(root); updatePrompt(); setTimeout(scroll); }
    function focus() { input.focus({ preventScroll: true }); scroll(); }
    function type(cmd) { input.value = cmd; focus(); input.setSelectionRange(cmd.length, cmd.length); }
    return {
      root, mount, focus, type, print, sysmsg, clear, updatePrompt,
      set onCommand(f) { onCommand = f; }, set onEditorSave(f) { onEditorSave = f; },
      set onReset(f) { btnReset.onclick = f; }, showReset(v) { btnReset.hidden = !v; }
    };
  })();

  // ================= COMPROBACIÓN DE RETOS =================
  let lessonLog = [];
  function nodeOf(p, follow = true) { const r = Engine.lookup(Object.assign({}, sys, { user: 'root' }), Engine.abspath(sys, p), follow); return r.err ? null : r.node; }
  function makeCtx(res, line) {
    const plain = Engine.stripAnsi((res.out || []).filter(o => o.s).map(o => o.s).join(''));
    const log = res.log || [];
    const match = (e, name, pred, user) => (name instanceof RegExp ? name.test(e.name) : e.name === name) && (!user || e.user === user) && (!pred || pred(e.args, e));
    return {
      S: sys, line, out: plain, log,
      ran: (name, pred, user) => log.some(e => match(e, name, pred, user)),
      ranEver: (name, pred, user) => lessonLog.some(e => match(e, name, pred, user)),
      exists: p => !!nodeOf(p, false),
      isDir: p => { const n = nodeOf(p); return !!n && n.t === 'd'; },
      isFile: p => { const n = nodeOf(p); return !!n && n.t === 'f'; },
      isLink: p => { const n = nodeOf(p, false); return !!n && n.t === 'l'; },
      read: p => { const n = nodeOf(p); return n && n.t === 'f' ? n.data : null; },
      ls: p => { const n = nodeOf(p); return n && n.t === 'd' ? Object.keys(n.c) : []; },
      mode: p => { const n = nodeOf(p); return n ? n.mode & 0o7777 : -1; },
      owner: p => { const n = nodeOf(p); return n ? n.owner : null; },
      group: p => { const n = nodeOf(p); return n ? n.group : null; },
      ino: p => { const n = nodeOf(p, false); return n ? n.ino : null; },
      trial: cmd => {
        try {
          const clone = Engine.deserialize(Engine.serialize(sys));
          clone.user = 'estudiante'; clone.cwd = HOME;
          const r = Engine.execLine(clone, cmd);
          return Engine.stripAnsi((r.out || []).filter(o => o.s).map(o => o.s).join(''));
        } catch (e) { return ''; }
      }
    };
  }
  let current = null;
  function evaluate(res, line) {
    if (!current || current.lab) return;
    lessonLog.push(...(res.log || []));
    if (lessonLog.length > 400) lessonLog = lessonLog.slice(-400);
    const ctx = makeCtx(res, line);
    let changed = false;
    for (let i = 0; i < current.tasks.length; i++) {
      if (isDone(current, i)) continue;
      const tk = current.tasks[i];
      let ok = false;
      try { ok = !!tk.check(ctx); } catch (e) { ok = false; }
      if (!ok) break;
      markDone(current, i); changed = true;
      Term.print(`\x1b[32m✓ Reto ${i + 1} completado\x1b[0m`, 'tsk');
    }
    if (changed) { renderTasks(); afterProgress(); }
  }
  function markDone(m, i) {
    const d = progress.done[m.id] = progress.done[m.id] || [];
    if (!d.includes(i)) { d.push(i); d.sort((a, b) => a - b); }
    saveProgress();
  }
  function afterProgress() {
    renderOverall();
    if (current && modPct(current) === 1 && !current._celebrated) {
      current._celebrated = true;
      toast(`Módulo completado: ${current.short}`);
    }
  }
  Term.onCommand = (res, line) => evaluate(res, line);
  Term.onEditorSave = () => evaluate({ out: [], log: [] }, '');

  // ================= VISTAS =================
  const views = { home: $('#v-home'), lesson: $('#v-lesson'), free: $('#v-free'), ref: $('#v-ref') };
  function show(name) {
    for (const k in views) views[k].hidden = k !== name;
    document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === name || (name === 'lesson' && b.dataset.v === 'home') ? 'page' : 'false'));
  }
  function renderOverall() {
    const d = totalDone();
    $('#ov-n').textContent = `${d}/${totalTasks}`;
    $('#ov-bar').style.width = (d / totalTasks * 100) + '%';
  }

  // ---------- inicio ----------
  const PHASES = [
    ['Fundamentos de la terminal', ['inicio', 'navegar', 'archivos', 'leer', 'buscar', 'tuberias']],
    ['Seguridad y procesos', ['usuarios', 'permisos', 'procesos']],
    ['Teoría de Sistemas Operativos con simuladores', ['planificacion', 'memoria', 'fs']],
    ['Automatizar y administrar', ['scripts', 'admin', 'mision']]
  ];
  function nextModule() { return MODULES.find(m => modPct(m) < 1) || MODULES[0]; }
  function renderHome() {
    const v = views.home;
    v.innerHTML = '';
    const nm = progress.last ? MODULES.find(m => m.id === progress.last && modPct(m) < 1) || nextModule() : nextModule();
    const started = totalDone() > 0;
    const wrap = el('div', { class: 'home' });
    const demo = el('div', { class: 'demo', 'aria-hidden': 'true', html:
      '<div class="l"><span class="pu">estudiante@linux-trainee</span>:<span class="pp">~</span>$ ls -l permisos/</div>' +
      '<div class="l">-rw-r--r-- 1 estudiante estudiante  36 oct 13 09:30 diario.txt</div>' +
      '<div class="l">-rw-r--r-- 1 estudiante estudiante  71 oct 13 09:30 script.sh</div>' +
      '<div class="l"><span class="pu">estudiante@linux-trainee</span>:<span class="pp">~</span>$ chmod 600 permisos/diario.txt</div>' +
      '<div class="l ok">✓ Reto 2 completado</div>' +
      '<div class="l"><span class="pu">estudiante@linux-trainee</span>:<span class="pp">~</span>$ ps aux | grep minero</div>' +
      '<div class="l">estudiante  3141 97.6  2.1 120400 64000 pts/0  R  03:41  ./minero.sh</div>' +
      '<div class="l"><span class="pu">estudiante@linux-trainee</span>:<span class="pp">~</span>$ kill 3141<span style="background:var(--t-path)"> </span></div>' });
    wrap.append(el('section', { class: 'hero' },
      el('div', {},
        el('h1', { html: 'Aprende Linux escribiendo <em>órdenes de verdad</em>' }),
        el('p', {}, 'Un Ubuntu simulado en tu navegador, con su sistema de archivos, usuarios, permisos y procesos. Cada módulo explica la teoría y te pone retos que se comprueban mirando el estado real del sistema. Sigue el temario de Introduction to Linux (LFS101) y añade lo que se ve en Sistemas Operativos.'),
        el('div', { class: 'cta' },
          el('button', { class: 'btn pri', type: 'button', onclick: () => openLesson(nm.id) }, started ? `Continuar: ${nm.short}` : 'Empezar desde cero'),
          el('button', { class: 'btn', type: 'button', onclick: () => go('free') }, 'Abrir terminal libre')),
        el('div', { class: 'stats' },
          el('div', {}, el('b', {}, String(MODULES.length)), 'módulos'),
          el('div', {}, el('b', {}, String(totalTasks)), 'retos prácticos'),
          el('div', {}, el('b', {}, Object.keys(Engine.CMDS).filter(c => /^[a-z]/.test(c)).length + '+'), 'órdenes simuladas'),
          el('div', {}, el('b', {}, `${Math.round(totalDone() / totalTasks * 100)}%`), 'tu avance'))),
      demo));
    wrap.append(el('div', { class: 'sec-h' }, el('h2', {}, 'Ruta de aprendizaje'), el('p', {}, 'En orden de menor a mayor dificultad. Puedes saltar a cualquier módulo.')));
    let n = 0;
    for (const [title, ids] of PHASES) {
      const g = el('div', { class: 'grid' });
      for (const id of ids) {
        const m = MODULES.find(x => x.id === id);
        const idx = MODULES.indexOf(m) + 1;
        const pct = modPct(m);
        const st = pct === 1 ? el('span', { class: 'st done' }, 'Completado') : pct > 0 ? el('span', { class: 'st go' }, `${doneOf(m).length}/${m.tasks.length}`) : el('span', { class: 'st' }, `${m.mins} min`);
        g.append(el('button', { class: 'card', type: 'button', onclick: () => openLesson(m.id) },
          el('div', { class: 'n' }, el('span', {}, `Módulo ${String(idx).padStart(2, '0')}`), st),
          el('h4', {}, m.title),
          el('p', {}, m.summary),
          el('div', { class: 'tags' }, el('span', { class: 'tag' }, m.ref), el('span', { class: 'tag os' }, m.so)),
          el('div', { class: 'bar' }, el('i', { style: `width:${pct * 100}%` }))));
      }
      wrap.append(el('section', { class: 'phase' }, el('h3', {}, title), g));
      n++;
    }
    v.append(wrap);
  }

  // ---------- lección ----------
  let mobileTab = 'theory';
  function openLesson(id, opts = {}) {
    const m = MODULES.find(x => x.id === id);
    if (!m) return;
    if (current !== m) lessonLog = [];
    current = m;
    progress.last = id; saveProgress();
    if (m.setup && !setupDone[m.id]) { m.setup(sys); setupDone[m.id] = true; saveSystem(); }
    mobileTab = opts.tab || (doneOf(m).length ? 'practice' : 'theory');
    renderLesson();
    show('lesson');
    try { history.replaceState(null, '', '#' + id); } catch (e) { }
    views.lesson.scrollTop = 0;
  }
  function renderLesson() {
    const m = current, v = views.lesson;
    const idx = MODULES.indexOf(m);
    v.innerHTML = '';
    const lay = el('div', { class: 'lesson show-' + mobileTab });
    const left = el('div', { class: 'lesson-l' });
    const tabs = el('div', { class: 'tabs', role: 'tablist' },
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mobileTab === 'theory'), onclick: () => setTab('theory') }, 'Teoría'),
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mobileTab === 'practice'), onclick: () => setTab('practice') }, `Práctica · ${doneOf(m).length}/${m.tasks.length}`));
    left.append(el('div', { class: 'lhead' },
      el('div', { class: 'crumbs' }, el('button', { type: 'button', onclick: () => go('home') }, '← Ruta'), el('span', {}, `Módulo ${idx + 1} de ${MODULES.length}`), el('span', { class: 'tag' }, m.ref), el('span', { class: 'tag os' }, m.so)),
      el('h1', {}, m.title), tabs));
    const th = el('div', { class: 'theory', html: m.theory });
    th.querySelectorAll('pre.try').forEach(p => {
      p.setAttribute('tabindex', '0'); p.setAttribute('role', 'button'); p.setAttribute('aria-label', 'Copiar a la terminal: ' + p.textContent);
      const act = () => { if (m.lab) return; if (mobileTab === 'theory') setTab('practice'); Term.type(p.textContent); };
      p.addEventListener('click', act); p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
    th.append(el('div', { class: 'lnav' },
      idx > 0 ? el('button', { class: 'btn sm ghost', type: 'button', onclick: () => openLesson(MODULES[idx - 1].id) }, '← ' + MODULES[idx - 1].short) : el('span'),
      el('button', { class: 'btn sm pri', type: 'button', onclick: () => { setTab('practice'); if (!m.lab) Term.focus(); } }, 'Ir a la práctica →')));
    left.append(th);
    const right = el('div', { class: 'lesson-r' });
    const tasks = el('div', { class: 'tasks', id: 'tasks' });
    right.append(tasks);
    if (m.lab === 'sched') right.append(SchedLab());
    else if (m.lab === 'mem') right.append(MemLab());
    else {
      const slot = el('div', { style: 'flex:1;min-height:0;min-width:0;display:flex' });
      right.append(slot);
      Term.mount(slot);
      Term.showReset(!!m.setup);
      Term.onReset = () => { if (m.setup) { m.setup(sys); saveSystem(); Term.sysmsg(`(Laboratorio de «${m.short}» preparado de nuevo. Tu avance se conserva.)`); } Term.focus(); };
      if (!m._greeted) { m._greeted = true; Term.sysmsg(`— ${m.title} —  Escribe las órdenes aquí. Los retos se comprueban solos.`); }
    }
    lay.append(left, right);
    v.append(lay);
    renderTasks();
  }
  function setTab(t) {
    mobileTab = t;
    const lay = views.lesson.querySelector('.lesson');
    if (!lay) return;
    lay.className = 'lesson show-' + t;
    lay.querySelectorAll('.tabs button').forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (t === 'theory'))));
    if (t === 'practice' && !current.lab) setTimeout(() => Term.focus(), 50);
  }
  const hintOpen = {};
  function renderTasks() {
    const m = current, box = $('#tasks');
    if (!box) return;
    const sc = box.scrollTop;
    box.innerHTML = '';
    const d = doneOf(m).length, total = m.tasks.length;
    box.append(el('div', { class: 'tasks-h' }, el('b', {}, 'Retos'), el('span', {}, `${d} de ${total}`)));
    const tabBtn = views.lesson.querySelector('.tabs button:last-child');
    if (tabBtn) tabBtn.textContent = `Práctica · ${d}/${total}`;
    let firstOpen = m.tasks.findIndex((t, i) => !isDone(m, i));
    m.tasks.forEach((tk, i) => {
      const done = isDone(m, i);
      const cur = i === firstOpen;
      const row = el('div', { class: 'task ' + (done ? 'done' : cur ? 'cur' : 'todo') });
      const body = el('div', {});
      body.append(el('div', { class: 'tx', html: `<b>${i + 1}.</b> ${tk.t}` }));
      if (!done && (cur || m.lab)) {
        const acts = el('div', { class: 'acts' });
        const key = m.id + ':' + i;
        const hs = hintOpen[key] || 0;
        if (tk.answer !== undefined) {
          const inp = el('input', { type: 'text', inputmode: tk.text ? 'text' : 'decimal', id: 'ans-' + key.replace(':', '-'), 'aria-label': 'Tu respuesta', placeholder: tk.text ? 'Respuesta' : 'Número' });
          const msg = el('span', { class: 'msg' });
          const check = () => {
            const want = typeof tk.answer === 'function' ? tk.answer() : tk.answer;
            const got = inp.value.trim();
            let ok;
            if (tk.text) ok = got.toUpperCase().replace(/\s/g, '') === String(want).toUpperCase();
            else { const n = parseFloat(got.replace(',', '.')); ok = !isNaN(n) && Math.abs(n - want) < 0.011; }
            if (ok) { markDone(m, i); renderTasks(); afterProgress(); toast(`Correcto: reto ${i + 1}`); }
            else { msg.textContent = got ? 'No es correcto. Revisa el cálculo.' : 'Escribe tu respuesta.'; msg.className = 'msg bad'; }
          };
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
          body.append(el('div', { class: 'ans' }, inp, el('button', { class: 'btn sm', type: 'button', onclick: check }, 'Comprobar'), msg));
        }
        if (hs < 1) acts.append(el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { hintOpen[key] = 1; renderTasks(); } }, 'Ver pista'));
        else if (hs < 2 && tk.sol) acts.append(el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { hintOpen[key] = 2; renderTasks(); } }, 'Ver solución'));
        else if (hs < 2 && tk.answer !== undefined) acts.append(el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { hintOpen[key] = 2; renderTasks(); } }, 'Ver respuesta'));
        if (hs >= 1) body.append(el('div', { class: 'hint', html: esc(tk.hint) }));
        if (hs >= 2 && tk.sol) {
          const c = el('code', { class: 'sol', title: 'Copiar a la terminal' }, tk.sol);
          c.addEventListener('click', () => Term.type(tk.sol.includes('PID') ? tk.sol.replace('PID', '') : tk.sol));
          body.append(el('div', { class: 'hint' }, 'Solución: ', c, ' ', el('span', { class: 'a2' }, '(pulsa para copiarla)')));
        }
        if (hs >= 2 && tk.answer !== undefined) {
          const want = typeof tk.answer === 'function' ? tk.answer() : tk.answer;
          body.append(el('div', { class: 'hint' }, 'Respuesta: ', el('b', {}, typeof want === 'number' ? String(+want.toFixed(2)).replace('.', ',') : want)));
        }
        if (acts.children.length) body.append(acts);
      }
      row.append(el('span', { class: 'dot', 'aria-hidden': 'true' }, done ? '✓' : ''), body);
      box.append(row);
    });
    if (d === total) {
      const idx = MODULES.indexOf(m);
      const nx = MODULES[idx + 1];
      box.append(el('div', { class: 'donebox' },
        el('div', {}, el('b', {}, '¡Módulo completado!'), el('span', {}, nx ? `Siguiente: ${nx.title}` : 'Has terminado toda la ruta. La terminal libre sigue disponible para practicar.')),
        el('div', { class: 'cta' },
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => resetModule(m) }, 'Repetir'),
          nx ? el('button', { class: 'btn sm pri', type: 'button', onclick: () => openLesson(nx.id, { tab: 'theory' }) }, 'Siguiente módulo →') : el('button', { class: 'btn sm pri', type: 'button', onclick: () => go('free') }, 'Terminal libre'))));
    }
    box.scrollTop = sc;
    const curEl = box.querySelector('.task.cur');
    if (curEl && (curEl.offsetTop < box.scrollTop || curEl.offsetTop > box.scrollTop + box.clientHeight - 60)) box.scrollTop = curEl.offsetTop - 50;
  }
  function resetModule(m) {
    progress.done[m.id] = []; saveProgress();
    m._celebrated = false;
    Object.keys(hintOpen).forEach(k => { if (k.startsWith(m.id + ':')) delete hintOpen[k]; });
    if (m.setup) { m.setup(sys); saveSystem(); }
    lessonLog = [];
    renderLesson(); renderOverall();
  }

  // ---------- simulador de planificación ----------
  let schedState = { procs: SCHED_EXAMPLE.map(p => ({ ...p })), algo: 'FCFS', q: 2 };
  const COLORS = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)', 'var(--g6)'];
  function SchedLab() {
    const box = el('div', { class: 'lab' });
    const draw = () => {
      box.innerHTML = '';
      box.append(el('h3', {}, 'Simulador de planificación'));
      const algos = [['FCFS', 'FCFS'], ['SJF', 'SJF'], ['SRTF', 'SRTF'], ['RR', 'Round Robin'], ['PRIO', 'Prioridad'], ['PRIOP', 'Prioridad expropiativa']];
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Algoritmo' });
      algos.forEach(([k, l]) => seg.append(el('button', { type: 'button', 'aria-pressed': String(schedState.algo === k), onclick: () => { schedState.algo = k; draw(); } }, l)));
      const q = el('input', { type: 'number', min: '1', max: '50', value: schedState.q, id: 'quantum', style: 'width:64px' });
      q.addEventListener('change', () => { schedState.q = Math.max(1, parseInt(q.value, 10) || 1); draw(); });
      box.append(el('div', { class: 'ctrls' }, seg, schedState.algo === 'RR' ? el('label', { for: 'quantum' }, 'Quantum', q) : null));
      const tb = el('table', { class: 'ptable' });
      tb.append(el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Proceso'), el('th', {}, 'Llegada'), el('th', {}, 'Ráfaga'), el('th', {}, 'Prioridad'), el('th', {}, ''))));
      const tbody = el('tbody');
      schedState.procs.forEach((p, i) => {
        const num = (k, min) => { const inp = el('input', { type: 'number', min: String(min), value: p[k], id: `sp-${i}-${k}`, 'aria-label': `${k} de ${p.name}` }); inp.addEventListener('change', () => { p[k] = Math.max(min, parseInt(inp.value, 10) || min); draw(); }); return inp; };
        tbody.append(el('tr', {}, el('td', {}, el('span', { class: 'sw', style: `background:${COLORS[i % 6]}` })), el('td', {}, p.name), el('td', {}, num('arrival', 0)), el('td', {}, num('burst', 1)), el('td', {}, num('prio', 0)),
          el('td', {}, schedState.procs.length > 1 ? el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Quitar ' + p.name, onclick: () => { schedState.procs.splice(i, 1); draw(); } }, '✕') : null)));
      });
      tb.append(tbody);
      box.append(el('div', { class: 'wrapx' }, tb));
      box.append(el('div', { class: 'cta' },
        schedState.procs.length < 6 ? el('button', { class: 'btn sm', type: 'button', onclick: () => { const n = schedState.procs.length + 1; schedState.procs.push({ name: 'P' + n, arrival: n, burst: 3, prio: n }); draw(); } }, '+ Añadir proceso') : null,
        el('button', { class: 'btn sm', type: 'button', onclick: () => { schedState.procs = SCHED_EXAMPLE.map(p => ({ ...p })); draw(); } }, 'Cargar ejemplo')));
      const r = Sims.schedule(schedState.procs, schedState.algo, schedState.q);
      const total = r.total || 1;
      const colorOf = name => COLORS[schedState.procs.findIndex(p => p.name === name) % 6];
      const gbar = el('div', { class: 'gbar', role: 'img', 'aria-label': 'Diagrama de Gantt: ' + r.gantt.map(g => `${g.name} de ${g.start} a ${g.end}`).join(', ') });
      r.gantt.forEach((g, k) => gbar.append(el('div', { class: g.name === '—' ? 'idle' : '', style: `flex:${g.end - g.start} 0 0;${g.name === '—' ? '' : 'background:' + colorOf(g.name)};animation-delay:${k * 0.06}s`, title: `${g.name}: ${g.start}–${g.end}` }, g.end - g.start >= 1 ? g.name : '')));
      const axis = el('div', { class: 'gaxis' });
      const ticks = [...new Set(r.gantt.flatMap(g => [g.start, g.end]))];
      ticks.forEach(t => axis.append(el('span', { style: `left:${t / total * 100}%` }, String(t))));
      box.append(el('div', { class: 'wrapx' }, el('div', { class: 'gantt' }, gbar, axis)));
      const mt = el('table', { class: 'mtable' });
      mt.append(el('thead', {}, el('tr', {}, ...['Proceso', 'Llegada', 'Ráfaga', 'Fin', 'Retorno', 'Espera', 'Respuesta'].map(h => el('th', {}, h)))));
      const mb = el('tbody');
      r.rows.forEach(x => mb.append(el('tr', {}, el('td', {}, x.name), el('td', {}, x.arrival), el('td', {}, x.burst), el('td', {}, x.finish), el('td', {}, x.turnaround), el('td', {}, x.wait), el('td', {}, x.response))));
      mt.append(mb);
      const f2 = n => String(+n.toFixed(2)).replace('.', ',');
      box.append(el('div', { class: 'wrapx' }, mt));
      box.append(el('div', { class: 'kpis' }, el('div', { class: 'kpi' }, el('small', {}, 'Espera media'), el('b', {}, f2(r.avgWait))), el('div', { class: 'kpi' }, el('small', {}, 'Retorno medio'), el('b', {}, f2(r.avgTurn))), el('div', { class: 'kpi' }, el('small', {}, 'Respuesta media'), el('b', {}, f2(r.avgResp)))));
    };
    draw();
    return box;
  }

  // ---------- simulador de paginación ----------
  let memState = { refs: REF_CLASSIC, frames: 3, algo: 'FIFO' };
  function MemLab() {
    const box = el('div', { class: 'lab' });
    const draw = () => {
      box.innerHTML = '';
      box.append(el('h3', {}, 'Simulador de reemplazo de páginas'));
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Algoritmo' });
      [['FIFO', 'FIFO'], ['LRU', 'LRU'], ['OPT', 'Óptimo']].forEach(([k, l]) => seg.append(el('button', { type: 'button', 'aria-pressed': String(memState.algo === k), onclick: () => { memState.algo = k; draw(); } }, l)));
      const fr = el('input', { type: 'number', min: '1', max: '8', value: memState.frames, id: 'frames', style: 'width:60px' });
      fr.addEventListener('change', () => { memState.frames = Math.min(8, Math.max(1, parseInt(fr.value, 10) || 3)); draw(); });
      const rf = el('input', { type: 'text', value: memState.refs, id: 'refs', style: 'flex:1;min-width:0;max-width:420px;font-family:var(--f-mono)' });
      rf.addEventListener('change', () => { memState.refs = rf.value; draw(); });
      box.append(el('div', { class: 'ctrls' }, seg, el('label', { for: 'frames' }, 'Marcos', fr)));
      box.append(el('div', { class: 'ctrls' }, el('label', { for: 'refs', style: 'flex:1;min-width:0' }, 'Referencias', rf)));
      box.append(el('div', { class: 'cta', style: 'margin-bottom:6px' },
        el('button', { class: 'btn sm', type: 'button', onclick: () => { memState.refs = REF_CLASSIC; memState.frames = 3; draw(); } }, 'Cadena clásica'),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { memState.refs = REF_BELADY; memState.frames = 3; memState.algo = 'FIFO'; draw(); } }, 'Cadena de Belady')));
      const refs = memState.refs.split(/[\s,]+/).filter(Boolean).map(Number).filter(n => !isNaN(n)).slice(0, 40);
      if (!refs.length) { box.append(el('p', {}, 'Escribe números separados por espacios.')); return; }
      const r = Sims.paging(refs, memState.frames, memState.algo);
      const t = el('table', { class: 'pg', 'aria-label': 'Evolución de los marcos de página' });
      t.append(el('tr', {}, el('th', { scope: 'row', style: 'text-align:left;font-family:var(--f-body);font-size:11px;color:var(--muted)' }, 'Ref.'), ...r.steps.map(s => el('th', {}, String(s.ref)))));
      for (let f = 0; f < memState.frames; f++) {
        t.append(el('tr', {}, el('th', { scope: 'row', style: 'font-family:var(--f-body);font-size:11px;color:var(--muted);text-align:left' }, 'M' + f), ...r.steps.map(s => el('td', { class: s.fault && s.slot === f ? 'new' : '' }, s.frames[f] !== undefined ? String(s.frames[f]) : ''))));
      }
      t.append(el('tr', { class: 'flt' }, el('td'), ...r.steps.map(s => el('td', { class: s.fault ? '' : 'hit' }, s.fault ? 'F' : '·'))));
      box.append(el('div', { class: 'wrapx' }, t));
      box.append(el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('small', {}, 'Fallos'), el('b', {}, String(r.faults))),
        el('div', { class: 'kpi' }, el('small', {}, 'Aciertos'), el('b', {}, String(r.hits))),
        el('div', { class: 'kpi' }, el('small', {}, 'Tasa de fallos'), el('b', {}, Math.round(r.faults / refs.length * 100) + '%'))));
      box.append(el('p', { style: 'font-size:13px;color:var(--muted);margin-top:12px' }, 'F = fallo de página (la celda resaltada es la página recién cargada). · = acierto, la página ya estaba en memoria.'));
    };
    draw();
    return box;
  }

  // ---------- terminal libre ----------
  function renderFree() {
    const v = views.free;
    v.innerHTML = '';
    current = null;
    const confirmBox = el('span', { class: 'confirm' });
    const ask = () => {
      confirmBox.innerHTML = '';
      confirmBox.append('¿Borrar todos los archivos y cambios del sistema? Tu avance en los retos se conserva.',
        el('button', { class: 'btn sm', type: 'button', onclick: () => { sys = Engine.createSystem(); setupDone = {}; saveSystem(); confirmBox.innerHTML = ''; Term.clear(); Term.updatePrompt(); Term.sysmsg('(Sistema restablecido a su estado inicial.)'); Term.focus(); } }, 'Sí, restablecer'),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { confirmBox.innerHTML = ''; } }, 'Cancelar'));
    };
    const slot = el('div', { class: 'slot' });
    v.append(el('div', { class: 'free' },
      el('div', { class: 'intro' }, el('p', {}, 'Practica sin retos. Es el mismo sistema que usan los módulos: lo que crees o borres aquí sigue ahí después. Escribe help para ver las órdenes disponibles.'),
        el('div', { class: 'cta' }, confirmBox, el('button', { class: 'btn sm', type: 'button', onclick: ask }, 'Restablecer sistema'))),
      slot));
    Term.mount(slot);
    Term.showReset(false);
    Term.onReset = null;
    setTimeout(() => Term.focus(), 50);
  }

  // ---------- chuleta ----------
  const REF_GROUPS = [
    ['Navegación y archivos', 'pwd cd ls tree mkdir rmdir touch cp mv rm ln file stat find'],
    ['Ver y procesar texto', 'cat less head tail wc grep sort uniq cut tr tee diff echo printf nano'],
    ['Usuarios y permisos', 'whoami id groups sudo su useradd usermod groupadd userdel passwd chmod chown chgrp umask'],
    ['Procesos', 'ps top pstree kill killall pkill pgrep jobs fg bg nice renice sleep'],
    ['Sistema, discos y memoria', 'uname hostname uptime date free df du lsblk mount'],
    ['Paquetes, servicios y red', 'apt systemctl journalctl ip ping ss curl tar gzip'],
    ['El shell y los scripts', 'man history alias type which export env source bash test seq read clear']
  ];
  function renderRef() {
    const v = views.ref;
    v.innerHTML = '';
    const q = el('input', { class: 'q', type: 'search', id: 'ref-q', placeholder: 'Busca una orden o una tarea: "permisos", "comprimir", grep…', 'aria-label': 'Buscar en la chuleta' });
    const list = el('div');
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      list.innerHTML = '';
      for (const [title, names] of REF_GROUPS) {
        const g = el('div', { class: 'refgrid' });
        let count = 0;
        for (const n of names.split(' ')) {
          const m = Engine.MAN[n];
          if (!m) continue;
          if (term && !(n.includes(term) || m[0].toLowerCase().includes(term) || m[2].toLowerCase().includes(term))) continue;
          count++;
          g.append(el('div', { class: 'refc' }, el('h4', {}, n), el('div', { class: 'd' }, m[0]), el('pre', {}, m[3] || m[1]),
            el('details', {}, el('summary', {}, 'Opciones y detalles'), el('pre', {}, m[1] + '\n\n' + m[2]))));
        }
        if (count) list.append(el('section', { class: 'phase' }, el('h3', {}, title), g));
      }
      if (!list.children.length) list.append(el('p', { style: 'color:var(--muted)' }, 'No hay resultados. Prueba con otra palabra.'));
    };
    q.addEventListener('input', draw);
    v.append(el('div', { class: 'ref' }, el('div', { class: 'sec-h' }, el('h2', {}, 'Chuleta de órdenes'), el('p', {}, 'Lo esencial de cada orden. En la terminal, man orden muestra lo mismo.')), q, list));
    draw();
  }

  // ---------- navegación ----------
  function go(name) {
    if (name === 'home') { current = null; renderHome(); show('home'); try { history.replaceState(null, '', '#ruta'); } catch (e) { } }
    else if (name === 'free') { renderFree(); show('free'); try { history.replaceState(null, '', '#terminal'); } catch (e) { } }
    else if (name === 'ref') { renderRef(); show('ref'); try { history.replaceState(null, '', '#chuleta'); } catch (e) { } }
  }
  function refreshAll() {
    renderOverall();
    if (!views.home.hidden) renderHome();
    if (!views.lesson.hidden && current) renderTasks();
  }
  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.v)));
  $('#brand').addEventListener('click', () => go('home'));

  // ---------- arranque ----------
  loadSystem();
  renderOverall();
  const h = (location.hash || '').slice(1);
  if (MODULES.some(m => m.id === h)) openLesson(h);
  else if (h === 'terminal') go('free');
  else if (h === 'chuleta') go('ref');
  else go('home');
  Term.sysmsg('Bienvenido a linux-trainee (Ubuntu 24.04.1 LTS simulado). Escribe help para ver las órdenes.');
})();
