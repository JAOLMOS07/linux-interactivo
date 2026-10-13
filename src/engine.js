// ================= MOTOR: sistema de archivos virtual + shell =================
const Engine = (() => {
  const HOST = 'linux-trainee';
  const ESC = '\x1b[';
  const C = {
    dir: ESC + '1;34m', exe: ESC + '1;32m', lnk: ESC + '1;36m', red: ESC + '1;31m',
    mag: ESC + '35m', grn: ESC + '32m', yel: ESC + '33m', bold: ESC + '1m', dim: ESC + '2m', off: ESC + '0m',
    arc: ESC + '1;31m'
  };
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MONTHS_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DAYS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const E_NOENT = 'No existe el archivo o el directorio';
  const E_ACCES = 'Permiso denegado';
  const E_ISDIR = 'Es un directorio';
  const E_NOTDIR = 'No es un directorio';
  const E_PERM = 'Operación no permitida';

  class ShellError extends Error { constructor(msg, code = 1) { super(msg); this.code = code; } }
  class ExitSignal { constructor(code) { this.code = code; } }
  class Incomplete extends Error { constructor() { super('incompleto'); this.incomplete = true; } }

  // ---------- nodos ----------
  function mk(S, t, owner, group, mode, extra) {
    const n = { t, owner, group: group || owner, mode, mtime: Date.now(), ino: S.nextIno++, nlink: t === 'd' ? 2 : 1 };
    if (t === 'd') n.c = {};
    if (t === 'f') n.data = '';
    return Object.assign(n, extra || {});
  }

  // ---------- rutas ----------
  function norm(abs) {
    const out = [];
    for (const seg of abs.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return '/' + out.join('/');
  }
  function homeOf(S, u) { return (S.users[u] && S.users[u].home) || '/'; }
  function abspath(S, p) {
    if (p === undefined || p === null) p = '';
    if (p === '~' || p.startsWith('~/')) p = homeOf(S, S.user) + p.slice(1);
    else if (/^~[a-z_][\w-]*/.test(p)) {
      const m = p.match(/^~([a-z_][\w-]*)(.*)$/);
      if (S.users[m[1]]) p = S.users[m[1]].home + m[2];
    }
    return norm(p.startsWith('/') ? p : S.cwd + '/' + p);
  }
  function dirname(p) { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  function basename(p) { if (p === '/') return '/'; return p.slice(p.lastIndexOf('/') + 1); }

  function inGroup(S, u, g) {
    if (!S.users[u]) return false;
    const ug = Object.keys(S.groups).find(k => S.groups[k].gid === S.users[u].gid);
    if (ug === g) return true;
    return !!(S.groups[g] && S.groups[g].members.includes(u));
  }
  function can(S, node, bit) {
    if (S.user === 'root') return bit !== 1 || node.t === 'd' || (node.mode & 0o111) !== 0;
    const shift = node.owner === S.user ? 6 : inGroup(S, S.user, node.group) ? 3 : 0;
    return ((node.mode >> shift) & bit) !== 0;
  }

  // Devuelve {node, parent, name, path} o {err}
  function lookup(S, abs, follow = true, depth = 0) {
    if (depth > 30) return { err: 'Demasiados niveles de enlaces simbólicos' };
    const parts = abs.split('/').filter(Boolean);
    let node = S.root, parent = null, cur = [];
    if (!parts.length) return { node, parent: S.root, name: '/', path: '/' };
    for (let i = 0; i < parts.length; i++) {
      if (node.t !== 'd') return { err: E_NOTDIR };
      if (!can(S, node, 1)) return { err: E_ACCES };
      const child = node.c[parts[i]];
      if (!child) return { err: E_NOENT, parent: i === parts.length - 1 ? node : null, name: parts[i] };
      const last = i === parts.length - 1;
      if (child.t === 'l' && (!last || follow)) {
        const base = '/' + cur.join('/');
        const tgt = child.target.startsWith('/') ? child.target : base + '/' + child.target;
        const rest = parts.slice(i + 1).join('/');
        return lookup(S, norm(tgt + (rest ? '/' + rest : '')), follow, depth + 1);
      }
      parent = node; node = child; cur.push(parts[i]);
    }
    return { node, parent, name: parts[parts.length - 1], path: '/' + cur.join('/') };
  }
  function get(S, p, follow = true) { return lookup(S, abspath(S, p), follow); }

  function readFile(S, p) {
    const r = get(S, p);
    if (r.err) throw new ShellError(r.err);
    if (r.node.t === 'd') throw new ShellError(E_ISDIR);
    if (!can(S, r.node, 4)) throw new ShellError(E_ACCES);
    if (r.node.dev === 'null') return '';
    if (r.node.dev === 'zero') return '';
    if (r.node.dev === 'random') return Math.random().toString(36).repeat(3);
    return r.node.data;
  }
  function writeFile(S, p, data, append = false) {
    const abs = abspath(S, p);
    let r = lookup(S, abs);
    if (r.err && r.err !== E_NOENT) throw new ShellError(r.err);
    if (!r.err) {
      if (r.node.t === 'd') throw new ShellError(E_ISDIR);
      if (r.node.dev === 'null') return;
      if (!can(S, r.node, 2)) throw new ShellError(E_ACCES);
      r.node.data = append ? r.node.data + data : data;
      r.node.mtime = Date.now();
      return r.node;
    }
    const pr = lookup(S, dirname(abs));
    if (pr.err) throw new ShellError(pr.err);
    if (pr.node.t !== 'd') throw new ShellError(E_NOTDIR);
    if (!can(S, pr.node, 2) || !can(S, pr.node, 1)) throw new ShellError(E_ACCES);
    const n = mk(S, 'f', S.user, primaryGroup(S, S.user), 0o666 & ~S.umask);
    n.data = data;
    pr.node.c[basename(abs)] = n;
    pr.node.mtime = Date.now();
    return n;
  }
  function primaryGroup(S, u) {
    const gid = S.users[u] ? S.users[u].gid : 0;
    return Object.keys(S.groups).find(k => S.groups[k].gid === gid) || u;
  }

  // Construcción directa (sin comprobar permisos), útil para setup
  function put(S, path, data, opts = {}) {
    const parts = path.split('/').filter(Boolean);
    let node = S.root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.c[parts[i]]) node.c[parts[i]] = mk(S, 'd', opts.owner || 'root', opts.group, 0o755);
      node = node.c[parts[i]];
      if (node.t === 'l') node = lookup(S, abspath(S, node.target)).node;
    }
    const name = parts[parts.length - 1];
    const owner = opts.owner || 'root';
    let n;
    if (data === null) n = node.c[name] && node.c[name].t === 'd' ? node.c[name] : mk(S, 'd', owner, opts.group, opts.mode ?? 0o755);
    else if (opts.link) n = mk(S, 'l', owner, opts.group, 0o777, { target: opts.link });
    else { n = mk(S, 'f', owner, opts.group, opts.mode ?? 0o644); n.data = data; }
    if (opts.dev) n.dev = opts.dev;
    if (data !== null || !node.c[name]) node.c[name] = n;
    if (opts.mode !== undefined) n.mode = opts.mode;
    if (opts.owner) { n.owner = opts.owner; n.group = opts.group || opts.owner; }
    return n;
  }
  function del(S, path) {
    const r = lookup(S, abspath(S, path), false);
    if (!r.err && r.parent) { delete r.parent.c[r.name]; return true; }
    return false;
  }

  // ---------- sistema inicial ----------
  const BIN_CMDS = 'bash cat cp chmod chown chgrp date df du echo find grep gzip gunzip head hostname id kill killall less ln ls man mkdir more mv nano nice ps pwd renice rm rmdir sed sleep sort stat sudo su tail tar tee touch tr uname uniq wc which whoami cut diff file free groups ip ping pstree top uptime useradd userdel usermod groupadd passwd apt systemctl seq basename dirname env printenv cal clear history lsblk mount lscpu tac curl ss pgrep pkill journalctl umask'.split(' ');

  function createSystem() {
    const S = {
      nextIno: 2, user: 'estudiante', cwd: '/home/estudiante', umask: 0o002,
      env: {}, aliases: { ll: 'ls -alF', la: 'ls -A', l: 'ls -CF' }, history: [], lastCode: 0,
      users: {
        root: { uid: 0, gid: 0, home: '/root', shell: '/bin/bash', gecos: 'root' },
        daemon: { uid: 1, gid: 1, home: '/usr/sbin', shell: '/usr/sbin/nologin', gecos: 'daemon' },
        'www-data': { uid: 33, gid: 33, home: '/var/www', shell: '/usr/sbin/nologin', gecos: 'www-data' },
        estudiante: { uid: 1000, gid: 1000, home: '/home/estudiante', shell: '/bin/bash', gecos: 'Estudiante,,,' },
        profesor: { uid: 1001, gid: 1001, home: '/home/profesor', shell: '/bin/bash', gecos: 'Profesor,,,' }
      },
      groups: {
        root: { gid: 0, members: [] }, daemon: { gid: 1, members: [] }, adm: { gid: 4, members: ['estudiante'] },
        sudo: { gid: 27, members: ['estudiante'] }, 'www-data': { gid: 33, members: [] },
        estudiante: { gid: 1000, members: [] }, profesor: { gid: 1001, members: [] }
      },
      procs: [], nextPid: 2300, jobs: [], nextJob: 1, userStack: [],
      installed: [], services: {
        ssh: { desc: 'OpenBSD Secure Shell server', active: true, enabled: true, pid: 812 },
        cron: { desc: 'Regular background program processing daemon', active: true, enabled: true, pid: 790 },
        cups: { desc: 'CUPS Scheduler', active: false, enabled: false }
      },
      bootTime: Date.now() - 3 * 3600e3 - 17 * 60e3
    };
    S.root = mk(S, 'd', 'root', 'root', 0o755);
    const d = (p, o = {}) => put(S, p, null, o);
    ['boot', 'dev', 'etc', 'home', 'media', 'mnt', 'opt', 'proc', 'srv', 'sys', 'usr', 'usr/bin', 'usr/sbin', 'usr/lib', 'usr/local', 'usr/local/bin', 'usr/share', 'usr/share/doc', 'var', 'var/log', 'var/cache', 'var/lib', 'var/tmp', 'var/www', 'var/www/html', 'etc/ssh', 'etc/apt', 'etc/skel', 'boot/grub', 'var/spool', 'var/spool/cron'].forEach(p => d(p));
    d('tmp', { mode: 0o1777 });
    d('root', { mode: 0o700 });
    put(S, 'bin', '', { link: 'usr/bin' });
    put(S, 'sbin', '', { link: 'usr/sbin' });
    put(S, 'lib', '', { link: 'usr/lib' });
    BIN_CMDS.forEach(c => put(S, 'usr/bin/' + c, '\x7fELF (binario ejecutable)', { mode: 0o755 }));
    ['reboot', 'shutdown', 'fdisk', 'mkfs', 'ifconfig-no'].slice(0, 4).forEach(c => put(S, 'usr/sbin/' + c, '\x7fELF', { mode: 0o755 }));
    put(S, 'boot/vmlinuz-6.8.0-45-generic', '\x7fKERNEL', { mode: 0o600 });
    put(S, 'boot/initrd.img-6.8.0-45-generic', '\x7fINITRD', { mode: 0o644 });
    put(S, 'boot/grub/grub.cfg', '# Archivo generado por grub-mkconfig\nset default="0"\nset timeout=5\nmenuentry \'Ubuntu\' {\n  linux /boot/vmlinuz-6.8.0-45-generic root=/dev/sda1 ro quiet splash\n  initrd /boot/initrd.img-6.8.0-45-generic\n}\n', { mode: 0o444 });
    put(S, 'dev/null', '', { dev: 'null', mode: 0o666 });
    put(S, 'dev/zero', '', { dev: 'zero', mode: 0o666 });
    put(S, 'dev/random', '', { dev: 'random', mode: 0o666 });
    put(S, 'dev/sda', '', { dev: 'disk', mode: 0o660 });
    put(S, 'dev/sda1', '', { dev: 'disk', mode: 0o660 });
    put(S, 'dev/tty', '', { dev: 'tty', mode: 0o666 });
    put(S, 'etc/hostname', HOST + '\n');
    put(S, 'etc/hosts', '127.0.0.1\tlocalhost\n127.0.1.1\t' + HOST + '\n192.168.1.20\tservidor-web\n192.168.1.30\tbase-datos\n');
    put(S, 'etc/os-release', 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n');
    put(S, 'etc/fstab', '# <sistema de archivos> <punto de montaje> <tipo> <opciones> <dump> <pass>\nUUID=3f1c-a9e2  /          ext4  errors=remount-ro  0  1\nUUID=7B2E-11F0  /boot/efi  vfat  umask=0077         0  1\n/swap.img       none       swap  sw                 0  0\n');
    put(S, 'etc/resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\n');
    put(S, 'etc/shells', '/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/dash\n');
    put(S, 'etc/timezone', 'America/Bogota\n');
    put(S, 'etc/crontab', '# /etc/crontab: crontab del sistema\n# m h dom mon dow user  command\n17 *  * * *  root  cd / && run-parts --report /etc/cron.hourly\n25 6  * * *  root  test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n');
    put(S, 'etc/ssh/sshd_config', '# Configuración del servidor SSH\nPort 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\nX11Forwarding yes\n');
    put(S, 'etc/apt/sources.list', 'deb http://archive.ubuntu.com/ubuntu noble main restricted universe\ndeb http://security.ubuntu.com/ubuntu noble-security main restricted\n');
    put(S, 'etc/sudoers', '# Solo editar con visudo\nroot    ALL=(ALL:ALL) ALL\n%sudo   ALL=(ALL:ALL) ALL\n', { mode: 0o440 });
    const bashrc = '# ~/.bashrc: ejecutado por bash para shells interactivos\nHISTSIZE=1000\nalias ll=\'ls -alF\'\nalias la=\'ls -A\'\nalias l=\'ls -CF\'\nPS1=\'\\u@\\h:\\w\\$ \'\n';
    put(S, 'etc/skel/.bashrc', bashrc);
    put(S, 'etc/skel/.profile', '# ~/.profile: ejecutado por shells de inicio de sesión\nif [ -f "$HOME/.bashrc" ]; then\n  . "$HOME/.bashrc"\nfi\n');
    // /proc
    put(S, 'proc/cpuinfo', 'processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Core(TM) i5-1135G7 @ 2.40GHz\ncpu MHz\t\t: 2419.200\ncache size\t: 8192 KB\ncpu cores\t: 4\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Core(TM) i5-1135G7 @ 2.40GHz\ncpu MHz\t\t: 2419.200\ncache size\t: 8192 KB\ncpu cores\t: 4\n', { mode: 0o444 });
    put(S, 'proc/meminfo', 'MemTotal:        8034520 kB\nMemFree:         2864212 kB\nMemAvailable:    5321480 kB\nBuffers:          212344 kB\nCached:          2398112 kB\nSwapCached:            0 kB\nActive:          2970460 kB\nInactive:        1650304 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\nDirty:               208 kB\nPageTables:        38212 kB\nHugePages_Total:       0\nHugepagesize:       2048 kB\n', { mode: 0o444 });
    put(S, 'proc/version', 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-075) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC\n', { mode: 0o444 });
    put(S, 'proc/uptime', '11834.52 45120.33\n', { mode: 0o444 });
    put(S, 'proc/loadavg', '0.42 0.35 0.30 2/312 2299\n', { mode: 0o444 });
    // logs
    put(S, 'var/log/syslog', [
      'oct 13 01:10:02 linux-trainee systemd[1]: Started cron.service - Regular background program processing daemon.',
      'oct 13 01:10:03 linux-trainee kernel: [    0.000000] Linux version 6.8.0-45-generic',
      'oct 13 01:10:05 linux-trainee NetworkManager[655]: <info> device (enp0s3): state change: activated',
      'oct 13 02:30:11 linux-trainee CRON[1402]: (root) CMD (run-parts /etc/cron.hourly)',
      'oct 13 03:01:44 linux-trainee kernel: [ 6699.120044] EXT4-fs (sda1): re-mounted. Quota mode: none.',
      'oct 13 03:15:20 linux-trainee systemd[1]: Starting apt-daily.service - Daily apt download activities...'
    ].join('\n') + '\n', { group: 'adm', mode: 0o640 });
    put(S, 'var/log/auth.log', [
      'oct 13 02:01:13 linux-trainee sshd[1301]: Accepted password for estudiante from 192.168.1.15 port 52144 ssh2',
      'oct 13 02:45:52 linux-trainee sshd[1355]: Failed password for root from 203.0.113.7 port 40122 ssh2',
      'oct 13 02:45:55 linux-trainee sshd[1355]: Failed password for root from 203.0.113.7 port 40122 ssh2',
      'oct 13 02:46:01 linux-trainee sshd[1360]: Failed password for invalid user admin from 203.0.113.7 port 40190 ssh2',
      'oct 13 03:12:09 linux-trainee sudo: estudiante : TTY=pts/0 ; PWD=/home/estudiante ; USER=root ; COMMAND=/usr/bin/apt update'
    ].join('\n') + '\n', { group: 'adm', mode: 0o640 });
    put(S, 'var/log/dpkg.log', '2026-10-01 10:12:01 install bash:amd64 5.2.21\n2026-10-01 10:12:09 install coreutils:amd64 9.4\n');
    put(S, 'var/www/html/index.html', '<!DOCTYPE html>\n<html>\n<head><title>Bienvenido</title></head>\n<body>\n<h1>¡Funciona!</h1>\n<p>Servidor web de linux-trainee.</p>\n</body>\n</html>\n');
    // homes
    d('home/estudiante', { owner: 'estudiante', mode: 0o750 });
    ['Documentos', 'Descargas', 'Escritorio', 'Imágenes', 'Música'].forEach(x => d('home/estudiante/' + x, { owner: 'estudiante' }));
    put(S, 'home/estudiante/.bashrc', bashrc, { owner: 'estudiante' });
    put(S, 'home/estudiante/.profile', S.root.c.etc.c.skel.c['.profile'].data, { owner: 'estudiante' });
    put(S, 'home/estudiante/.bash_history', '', { owner: 'estudiante', mode: 0o600 });
    put(S, 'home/estudiante/Documentos/bienvenida.txt', 'Hola, estudiante.\nEste es tu directorio personal: /home/estudiante\nAquí guardas tus archivos. Nadie más puede leerlos sin permiso.\n', { owner: 'estudiante' });
    d('home/profesor', { owner: 'profesor', mode: 0o750 });
    put(S, 'home/profesor/examen_final.txt', 'Pregunta 1: ¿Qué es un proceso zombi?\nRespuesta: un proceso que terminó pero cuyo padre aún no recogió su estado con wait().\n', { owner: 'profesor', mode: 0o600 });
    put(S, 'root/.bashrc', bashrc);
    put(S, 'root/nota.txt', 'Solo root puede leer esto. Si lo estás leyendo, usaste sudo correctamente.\n');
    syncEtc(S);
    // procesos
    const P = (pid, ppid, user, cmd, o = {}) => S.procs.push(Object.assign({ pid, ppid, user, cmd, state: 'S', cpu: 0, mem: 0.1, nice: 0, tty: '?', start: '01:10', vsz: 16000, rss: 6000 }, o));
    P(1, 0, 'root', '/sbin/init splash', { cpu: 0.0, mem: 0.1, start: '01:10' });
    P(2, 0, 'root', '[kthreadd]');
    P(14, 2, 'root', '[ksoftirqd/0]');
    P(312, 1, 'root', '/lib/systemd/systemd-journald', { mem: 0.4 });
    P(355, 1, 'root', '/lib/systemd/systemd-udevd', { mem: 0.2 });
    P(655, 1, 'root', '/usr/sbin/NetworkManager --no-daemon', { mem: 0.3 });
    P(790, 1, 'root', '/usr/sbin/cron -f -P');
    P(812, 1, 'root', 'sshd: /usr/sbin/sshd -D [listener]');
    P(1301, 812, 'root', 'sshd: estudiante [priv]');
    P(1320, 1301, 'estudiante', 'sshd: estudiante@pts/0');
    P(1321, 1320, 'estudiante', '-bash', { tty: 'pts/0', start: '02:01' });
    P(1450, 1, 'profesor', '/usr/bin/python3 /home/profesor/servidor_notas.py', { cpu: 0.3, mem: 1.2, tty: '?', start: '02:10' });
    S.shellPid = 1321;
    return S;
  }

  function syncEtc(S) {
    const pw = Object.entries(S.users).map(([n, u]) => `${n}:x:${u.uid}:${u.gid}:${u.gecos}:${u.home}:${u.shell}`).join('\n') + '\n';
    const gr = Object.entries(S.groups).map(([n, g]) => `${n}:x:${g.gid}:${g.members.join(',')}`).join('\n') + '\n';
    const sh = Object.entries(S.users).map(([n, u]) => `${n}:${u.uid >= 1000 || n === 'root' ? '$y$j9T$' + btoaSafe(n).slice(0, 10) + '...' : '*'}:20000:0:99999:7:::`).join('\n') + '\n';
    put(S, 'etc/passwd', pw);
    put(S, 'etc/group', gr);
    put(S, 'etc/shadow', sh, { group: 'shadow', mode: 0o640 });
  }
  function btoaSafe(s) { try { return btoa(s + 'sal'); } catch (e) { return 'abcdefghijklmnop'; } }

  // ---------- serialización (con enlaces duros) ----------
  function serialize(S) {
    const nodes = {};
    const walk = n => {
      if (nodes[n.ino]) return n.ino;
      const o = Object.assign({}, n);
      nodes[n.ino] = o;
      if (n.t === 'd') { o.c = {}; for (const k in n.c) o.c[k] = walk(n.c[k]); }
      return n.ino;
    };
    const rootIno = walk(S.root);
    const copy = Object.assign({}, S);
    delete copy.root; delete copy.hooks;
    return JSON.stringify({ v: 3, S: copy, nodes, rootIno });
  }
  function deserialize(txt) {
    const o = JSON.parse(txt);
    if (o.v !== 3) return null;
    const built = {};
    const build = ino => {
      if (built[ino]) return built[ino];
      const src = o.nodes[ino];
      const n = Object.assign({}, src);
      built[ino] = n;
      if (n.t === 'd') { n.c = {}; for (const k in src.c) n.c[k] = build(src.c[k]); }
      return n;
    };
    const S = o.S;
    S.root = build(o.rootIno);
    return S;
  }

  // ---------- formato ----------
  function modeStr(n) {
    const t = n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : n.dev === 'disk' ? 'b' : n.dev ? 'c' : '-';
    let s = '';
    for (let i = 2; i >= 0; i--) {
      const b = (n.mode >> (i * 3)) & 7;
      s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-');
    }
    if (n.mode & 0o1000) s = s.slice(0, 8) + (s[8] === 'x' ? 't' : 'T');
    return t + s;
  }
  function fsize(n) { return n.t === 'd' ? 4096 : n.t === 'l' ? n.target.length : n.dev ? 0 : utf8len(n.data); }
  function utf8len(s) { let l = 0; for (const ch of s) { const c = ch.codePointAt(0); l += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return l; }
  function human(b) {
    if (b < 1024) return String(b);
    const u = ['K', 'M', 'G', 'T']; let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < 3);
    return (b < 10 ? b.toFixed(1).replace('.0', '') : Math.round(b)) + u[i];
  }
  function pad(s, n, right) { s = String(s); const w = [...s].length; return w >= n ? s : right ? ' '.repeat(n - w) + s : s + ' '.repeat(n - w); }
  function two(n) { return String(n).padStart(2, '0'); }
  function lsDate(t) { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${pad(d.getDate(), 2, true)} ${two(d.getHours())}:${two(d.getMinutes())}`; }
  function fullDate(t) { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.000000000 -0500`; }
  function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
  function lines(s) { if (!s) return []; const a = s.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; }
  function colorName(n, name, tty) {
    if (!tty) return name;
    if (n.t === 'd') return C.dir + name + C.off;
    if (n.t === 'l') return C.lnk + name + C.off;
    if (/\.(tar|gz|tgz|zip)$/.test(name)) return C.arc + name + C.off;
    if (n.mode & 0o111) return C.exe + name + C.off;
    return name;
  }

  // ---------- tokenizador ----------
  const KW = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until']);
  function findClose(src, i, open, close) { // i apunta justo después del primer open
    let depth = 1;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === "'") { const j = src.indexOf("'", i + 1); if (j < 0) throw new Incomplete(); i = j + 1; continue; }
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) return i; }
      i++;
    }
    throw new Incomplete();
  }
  function tokenize(src) {
    const toks = [];
    let word = null;
    const ensure = () => { if (!word) word = { type: 'w', segs: [] }; };
    const pushSeg = (seg) => {
      ensure();
      const last = word.segs[word.segs.length - 1];
      if (seg.text !== undefined && last && last.text !== undefined && last.q === seg.q) last.text += seg.text;
      else word.segs.push(seg);
    };
    const endWord = () => { if (word) { toks.push(word); word = null; } };
    const op = v => { endWord(); toks.push({ type: 'op', v }); };
    let i = 0;
    const n = src.length;
    const dollar = (q) => { // en src[i] == '$'
      if (src[i + 1] === '(' && src[i + 2] === '(') {
        const end = findClose(src, i + 3, '(', ')');
        if (src[end + 1] !== ')') throw new ShellError('error sintáctico en la expresión aritmética');
        pushSeg({ arith: src.slice(i + 3, end), q }); i = end + 2; return;
      }
      if (src[i + 1] === '(') {
        const end = findClose(src, i + 2, '(', ')');
        pushSeg({ sub: src.slice(i + 2, end), q }); i = end + 1; return;
      }
      if (src[i + 1] === '{') {
        const end = src.indexOf('}', i);
        if (end < 0) throw new Incomplete();
        pushSeg({ text: src.slice(i, end + 1), q }); i = end + 1; return;
      }
      pushSeg({ text: '$', q }); i++;
    };
    while (i < n) {
      const ch = src[i];
      if (ch === '\n') { op('\n'); i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { endWord(); i++; continue; }
      if (ch === '#' && !word) { while (i < n && src[i] !== '\n') i++; continue; }
      if (ch === '\\') {
        if (i + 1 >= n) throw new Incomplete();
        if (src[i + 1] === '\n') { i += 2; continue; }
        pushSeg({ text: src[i + 1], q: "'" }); i += 2; continue;
      }
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new Incomplete();
        pushSeg({ text: src.slice(i + 1, j), q: "'" }); i = j + 1; continue;
      }
      if (ch === '"') {
        ensure();
        let empty = true;
        i++;
        let buf = '';
        const flush = () => { if (buf) { pushSeg({ text: buf, q: '"' }); buf = ''; empty = false; } };
        while (true) {
          if (i >= n) throw new Incomplete();
          const c = src[i];
          if (c === '"') { i++; break; }
          if (c === '\\' && '"\\$`\n'.includes(src[i + 1])) {
            flush();
            if (src[i + 1] !== '\n') { pushSeg({ text: src[i + 1], q: "'" }); empty = false; }
            i += 2; continue;
          }
          if (c === '$' && (src[i + 1] === '(' || src[i + 1] === '{')) { flush(); dollar('"'); empty = false; continue; }
          if (c === '`') { flush(); const j = src.indexOf('`', i + 1); if (j < 0) throw new Incomplete(); pushSeg({ sub: src.slice(i + 1, j), q: '"' }); i = j + 1; empty = false; continue; }
          buf += c; i++;
        }
        flush();
        if (empty) pushSeg({ text: '', q: '"' });
        continue;
      }
      if (ch === '$') { dollar(''); continue; }
      if (ch === '`') { const j = src.indexOf('`', i + 1); if (j < 0) throw new Incomplete(); pushSeg({ sub: src.slice(i + 1, j), q: '' }); i = j + 1; continue; }
      const two_ = src.slice(i, i + 2), four = src.slice(i, i + 4);
      if (!word && four === '2>&1') { op('2>&1'); i += 4; continue; }
      if (!word && src.slice(i, i + 3) === '2>>') { op('2>>'); i += 3; continue; }
      if (!word && two_ === '2>') { op('2>'); i += 2; continue; }
      if (two_ === '&&' || two_ === '||' || two_ === '>>' || two_ === '&>' || two_ === ';;') { op(two_); i += 2; continue; }
      if ('|&;<>()'.includes(ch)) { op(ch); i++; continue; }
      pushSeg({ text: ch, q: '' }); i++;
    }
    endWord();
    return toks;
  }
  function wordLit(w) { return w.segs.map(s => s.text !== undefined ? s.text : '').join(''); }
  function isKw(t, k) { return t && t.type === 'w' && t.segs.length === 1 && t.segs[0].q === '' && t.segs[0].text !== undefined && (k ? t.segs[0].text === k : KW.has(t.segs[0].text)); }

  // ---------- parser ----------
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].type === 'op' && toks[p].v === v;
    const skipNl = () => { while (isOp('\n')) p++; };
    const expectKw = (k) => {
      skipNl();
      if (p >= toks.length) throw new Incomplete();
      if (!isKw(peek(), k)) throw new ShellError(`error sintáctico cerca del elemento inesperado «${peek().type === 'op' ? peek().v : wordLit(peek())}»`, 2);
      p++;
    };
    function parseList(stops) {
      const items = [];
      while (true) {
        while (isOp('\n') || isOp(';')) p++;
        if (p >= toks.length) { if (stops.length) throw new Incomplete(); break; }
        const t = peek();
        if (stops.some(s => isKw(t, s))) break;
        if (t.type === 'op' && !['!'].includes(t.v) && t.v !== '(' && t.v !== '<' && t.v !== '>' && t.v !== '>>' && t.v !== '2>' && t.v !== '2>>' && t.v !== '&>')
          throw new ShellError(`error sintáctico cerca del elemento inesperado «${t.v === '\n' ? 'nueva línea' : t.v}»`, 2);
        const ao = parseAndOr();
        let bg = false;
        if (isOp('&')) { bg = true; p++; }
        else if (isOp(';') || isOp('\n')) p++;
        else if (p < toks.length && !stops.some(s => isKw(peek(), s))) {
          const tt = peek();
          throw new ShellError(`error sintáctico cerca del elemento inesperado «${tt.type === 'op' ? tt.v : wordLit(tt)}»`, 2);
        }
        items.push({ ao, bg, src: ao.src });
      }
      return { type: 'list', items };
    }
    function parseAndOr() {
      const start = p;
      const first = parsePipe();
      const rest = [];
      while (isOp('&&') || isOp('||')) {
        const o = peek().v; p++; skipNl();
        if (p >= toks.length) throw new Incomplete();
        rest.push({ op: o, pipe: parsePipe() });
      }
      return { first, rest, toks: toks.slice(start, p) };
    }
    function parsePipe() {
      const cmds = [parseCmd()];
      while (isOp('|')) { p++; skipNl(); if (p >= toks.length) throw new Incomplete(); cmds.push(parseCmd()); }
      return { cmds };
    }
    function parseCmd() {
      const t = peek();
      if (isKw(t, 'if')) {
        p++;
        const clauses = [];
        const cond = parseList(['then']); expectKw('then');
        const body = parseList(['elif', 'else', 'fi']);
        clauses.push({ cond, body });
        let els = null;
        while (true) {
          skipNl();
          if (isKw(peek(), 'elif')) { p++; const c = parseList(['then']); expectKw('then'); const b = parseList(['elif', 'else', 'fi']); clauses.push({ cond: c, body: b }); continue; }
          if (isKw(peek(), 'else')) { p++; els = parseList(['fi']); }
          break;
        }
        expectKw('fi');
        return { type: 'if', clauses, els };
      }
      if (isKw(t, 'for')) {
        p++;
        const v = peek();
        if (!v || v.type !== 'w') throw new Incomplete();
        p++;
        let words = null;
        skipNl();
        if (isKw(peek(), 'in')) {
          p++; words = [];
          while (peek() && peek().type === 'w') { words.push(peek()); p++; }
        }
        if (isOp(';')) p++;
        expectKw('do');
        const body = parseList(['done']);
        expectKw('done');
        return { type: 'for', v: wordLit(v), words, body };
      }
      if (isKw(t, 'while') || isKw(t, 'until')) {
        const until = isKw(t, 'until'); p++;
        const cond = parseList(['do']); expectKw('do');
        const body = parseList(['done']); expectKw('done');
        return { type: 'while', cond, body, until };
      }
      if (t && t.type === 'w' && isKw(t) && !['in'].includes(wordLit(t)))
        throw new ShellError(`error sintáctico cerca del elemento inesperado «${wordLit(t)}»`, 2);
      const cmd = { type: 'simple', assigns: [], words: [], redirs: [] };
      while (p < toks.length) {
        const tk = peek();
        if (tk.type === 'op' && ['>', '>>', '<', '2>', '2>>', '&>'].includes(tk.v)) {
          p++;
          const target = peek();
          if (!target || target.type !== 'w') throw new ShellError('error sintáctico cerca del elemento inesperado «nueva línea»', 2);
          p++;
          cmd.redirs.push({ op: tk.v, target });
          continue;
        }
        if (tk.type === 'op' && tk.v === '2>&1') { p++; cmd.redirs.push({ op: '2>&1' }); continue; }
        if (tk.type !== 'w') break;
        if (!cmd.words.length && tk.segs[0].q === '' && tk.segs[0].text !== undefined && /^[A-Za-z_]\w*=/.test(tk.segs[0].text)) {
          const s0 = tk.segs[0].text;
          const eq = s0.indexOf('=');
          const val = { type: 'w', segs: [{ text: s0.slice(eq + 1), q: '' }, ...tk.segs.slice(1)] };
          cmd.assigns.push({ name: s0.slice(0, eq), val });
          p++; continue;
        }
        cmd.words.push(tk); p++;
      }
      if (!cmd.words.length && !cmd.assigns.length && !cmd.redirs.length) {
        const tk = peek();
        if (!tk) throw new Incomplete();
        throw new ShellError(`error sintáctico cerca del elemento inesperado «${tk.type === 'op' ? (tk.v === '\n' ? 'nueva línea' : tk.v) : wordLit(tk)}»`, 2);
      }
      return cmd;
    }
    const list = parseList([]);
    return list;
  }

  // ---------- aritmética ----------
  function arith(expr, ctx) {
    const s = expr.replace(/\$?\b([A-Za-z_]\w*)\b/g, (m, v) => String(parseInt(getVar(ctx, v), 10) || 0)).replace(/\$(\d)/g, (m, d) => String(parseInt(getVar(ctx, d), 10) || 0));
    let i = 0;
    const toks = s.match(/\d+|==|!=|<=|>=|&&|\|\||[-+*/%()<>!]/g) || [];
    if (s.replace(/\s|\d+|==|!=|<=|>=|&&|\|\||[-+*/%()<>!]/g, '').length) throw new ShellError(`${expr}: error sintáctico en la expresión`);
    const prec = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function lvl(k) {
      if (k === prec.length) return unary();
      let v = lvl(k + 1);
      while (prec[k].includes(toks[i])) {
        const o = toks[i++]; const r = lvl(k + 1);
        switch (o) {
          case '||': v = (v || r) ? 1 : 0; break; case '&&': v = (v && r) ? 1 : 0; break;
          case '==': v = +(v === r); break; case '!=': v = +(v !== r); break;
          case '<': v = +(v < r); break; case '>': v = +(v > r); break; case '<=': v = +(v <= r); break; case '>=': v = +(v >= r); break;
          case '+': v += r; break; case '-': v -= r; break; case '*': v *= r; break;
          case '/': if (r === 0) throw new ShellError('división por cero'); v = Math.trunc(v / r); break;
          case '%': if (r === 0) throw new ShellError('división por cero'); v %= r; break;
        }
      }
      return v;
    }
    function unary() {
      const t = toks[i];
      if (t === '-') { i++; return -unary(); }
      if (t === '+') { i++; return unary(); }
      if (t === '!') { i++; return +!unary(); }
      if (t === '(') { i++; const v = lvl(0); if (toks[i] !== ')') throw new ShellError('falta «)»'); i++; return v; }
      if (t === undefined) throw new ShellError('se esperaba un operando');
      i++;
      const v = parseInt(t, 10);
      if (isNaN(v)) throw new ShellError(`error sintáctico: operando esperado (el elemento de error es «${t}»)`);
      return v;
    }
    const v = lvl(0);
    if (i < toks.length) throw new ShellError(`error sintáctico en la expresión (el elemento de error es «${toks[i]}»)`);
    return v;
  }

  // ---------- expansión ----------
  function getVar(ctx, name) {
    const S = ctx.S, f = ctx.frame;
    if (/^\d$/.test(name)) return name === '0' ? (f.name || 'bash') : (f.args[+name - 1] ?? '');
    if (name === '#') return String(f.args.length);
    if (name === '@' || name === '*') return f.args.join(' ');
    if (name === '?') return String(S.lastCode);
    if (name === '$') return String(S.shellPid);
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    if (name === 'HOME') return homeOf(S, S.user);
    if (name === 'USER' || name === 'LOGNAME') return S.user;
    if (name === 'PWD') return S.cwd;
    if (name === 'SHELL') return '/bin/bash';
    if (name === 'HOSTNAME') return HOST;
    if (name === 'UID') return String(S.users[S.user].uid);
    if (name === 'PATH' && f.env.PATH === undefined) return '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    if (name === 'LANG' && f.env.LANG === undefined) return 'es_ES.UTF-8';
    if (name === 'TERM' && f.env.TERM === undefined) return 'xterm-256color';
    return f.env[name] ?? '';
  }
  function expandVars(text, ctx) {
    return text.replace(/\$(\{([^}]*)\}|[A-Za-z_]\w*|[0-9#?@$*])/g, (m, a, b) => {
      if (b !== undefined) {
        if (b.startsWith('#')) return String(getVar(ctx, b.slice(1)).length);
        const dm = b.match(/^(\w+):-(.*)$/);
        if (dm) return getVar(ctx, dm[1]) || dm[2];
        return getVar(ctx, b);
      }
      return getVar(ctx, a);
    });
  }
  function runSub(src, ctx) {
    const buf = [];
    const sub = Object.assign({}, ctx, { out: s => buf.push(s), tty: false });
    try { runSource(src, sub); } catch (e) { if (!(e instanceof ExitSignal)) throw e; }
    return buf.join('').replace(/\n+$/, '');
  }
  function expandWord(w, ctx) {
    if (w.segs.length === 1 && w.segs[0].q === '"' && (w.segs[0].text === '$@' || w.segs[0].text === '$*')) return ctx.frame.args.slice();
    const fields = [];
    let cur = '', has = false, glob = false;
    for (let si = 0; si < w.segs.length; si++) {
      const seg = w.segs[si];
      let val;
      if (si === 0 && seg.q === '' && seg.text !== undefined && seg.text[0] === '~') {
        const tm = seg.text.match(/^~([a-z_][\w-]*)?(?=\/|$)/);
        if (tm && (!tm[1] || ctx.S.users[tm[1]])) {
          const rest = seg.text.slice(tm[0].length);
          cur += tm[1] ? ctx.S.users[tm[1]].home : homeOf(ctx.S, ctx.S.user);
          has = true;
          if (/[*?]/.test(rest)) glob = true;
          cur += expandVars(rest, ctx);
          continue;
        }
      }
      if (seg.sub !== undefined) val = runSub(seg.sub, ctx);
      else if (seg.arith !== undefined) val = String(arith(expandVars(seg.arith, ctx), ctx));
      else if (seg.q === "'") val = seg.text;
      else val = expandVars(seg.text, ctx);
      if (seg.q === '') {
        if (seg.text !== undefined && /[*?]|\[.+\]/.test(seg.text)) glob = true;
        const literalOnly = seg.text !== undefined && !seg.text.includes('$');
        if (literalOnly) { cur += val; has = has || val.length > 0; }
        else {
          const parts = val.split(/[ \t\n]+/);
          parts.forEach((pt, k) => {
            if (k > 0) { if (has || cur) fields.push({ v: cur, glob }); cur = ''; has = false; glob = false; }
            cur += pt; if (pt) has = true;
          });
        }
      } else { cur += val; has = true; }
    }
    if (has || cur) fields.push({ v: cur, glob });
    const out = [];
    for (const f of fields) {
      if (f.glob) { const g = globExpand(f.v, ctx.S); if (g.length) { out.push(...g); continue; } }
      out.push(f.v);
    }
    return out;
  }
  function globRe(pat) {
    let re = '^';
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else if (c === '[') { const j = pat.indexOf(']', i + 1); if (j > i) { let cls = pat.slice(i + 1, j); if (cls[0] === '!') cls = '^' + cls.slice(1); re += '[' + cls + ']'; i = j; } else re += '\\['; }
      else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  }
  function globExpand(pat, S) {
    const absStart = pat.startsWith('/');
    const tilde = pat.startsWith('~');
    let base = absStart ? '/' : tilde ? homeOf(S, S.user) : S.cwd;
    let parts = pat.split('/').filter(Boolean);
    if (tilde) parts = parts.slice(1);
    let results = [{ abs: base, rel: absStart ? '/' : tilde ? '~/' : '' }];
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      const next = [];
      const isGlob = /[*?\[]/.test(part);
      for (const r of results) {
        const lr = lookup(S, r.abs);
        if (lr.err || lr.node.t !== 'd') continue;
        if (!isGlob) { if (lr.node.c[part] || part === '..' || part === '.') next.push({ abs: norm(r.abs + '/' + part), rel: r.rel + part + (k < parts.length - 1 ? '/' : '') }); continue; }
        if (!can(S, lr.node, 4)) continue;
        const re = globRe(part);
        Object.keys(lr.node.c).sort(cmpName).forEach(name => {
          if (name.startsWith('.') && !part.startsWith('.')) return;
          if (re.test(name)) next.push({ abs: norm(r.abs + '/' + name), rel: r.rel + name + (k < parts.length - 1 ? '/' : '') });
        });
      }
      results = next;
    }
    return results.map(r => r.rel).filter(x => x !== '' && x !== '/' && x !== '~/');
  }
  function cmpName(a, b) {
    const x = a.replace(/^\./, '').toLowerCase(), y = b.replace(/^\./, '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // ---------- ejecución ----------
  function runSource(src, ctx) {
    const ast = parse(src);
    return execList(ast, ctx);
  }
  function step(ctx) { ctx.counter.n++; if (ctx.counter.n > 20000) throw new ShellError('demasiadas operaciones: ¿un bucle infinito? (límite del simulador)', 130); }
  function execList(list, ctx) {
    let code = 0;
    for (const it of list.items) {
      if (it.bg) code = execBackground(it, ctx);
      else code = execAndOr(it.ao, ctx);
    }
    return code;
  }
  function execAndOr(ao, ctx) {
    let code = execPipe(ao.first, ctx);
    for (const r of ao.rest) {
      if ((r.op === '&&' && code === 0) || (r.op === '||' && code !== 0)) code = execPipe(r.pipe, ctx);
    }
    return code;
  }
  function execPipe(pipe, ctx) {
    let input = ctx.stdin;
    let code = 0;
    for (let i = 0; i < pipe.cmds.length; i++) {
      const last = i === pipe.cmds.length - 1;
      const buf = [];
      const box = pipe.cmds.length > 1 || i > 0 ? { v: input } : ctx.stdinBox;
      const sub = last ? Object.assign({}, ctx, { stdin: input, stdinBox: box }) : Object.assign({}, ctx, { stdin: input, stdinBox: box, out: s => buf.push(s), tty: false });
      if (!last && pipe.cmds.length > 1) sub.piped = true;
      code = execCmd(pipe.cmds[i], sub);
      input = buf.join('');
    }
    ctx.S.lastCode = code;
    return code;
  }
  function execCmd(cmd, ctx) {
    step(ctx);
    if (cmd.type === 'if') {
      for (const cl of cmd.clauses) {
        if (execList(cl.cond, ctx) === 0) return execList(cl.body, ctx);
      }
      return cmd.els ? execList(cmd.els, ctx) : 0;
    }
    if (cmd.type === 'for') {
      const items = cmd.words ? cmd.words.flatMap(w => expandWord(w, ctx)) : ctx.frame.args.slice();
      let code = 0;
      for (const v of items) { step(ctx); ctx.frame.env[cmd.v] = v; code = execList(cmd.body, ctx); }
      return code;
    }
    if (cmd.type === 'while') {
      let code = 0;
      while (true) {
        step(ctx);
        const c = execList(cmd.cond, ctx);
        if (cmd.until ? c === 0 : c !== 0) break;
        code = execList(cmd.body, ctx);
      }
      return code;
    }
    return execSimple(cmd, ctx);
  }

  function execSimple(cmd, ctx) {
    const S = ctx.S;
    let argv = [];
    for (const w of cmd.words) argv.push(...expandWord(w, ctx));
    // alias
    if (argv.length && S.aliases[argv[0]] && !ctx.noAlias) {
      const a = S.aliases[argv[0]];
      const extra = tokenize(a).filter(t => t.type === 'w').flatMap(w => expandWord(w, ctx));
      argv = extra.concat(argv.slice(1));
    }
    if (!argv.length) {
      for (const a of cmd.assigns) ctx.frame.env[a.name] = expandWord(a.val, ctx).join(' ');
      if (!cmd.redirs.length) return 0;
    } else {
      for (const a of cmd.assigns) ctx.frame.env[a.name] = expandWord(a.val, ctx).join(' ');
    }
    // redirecciones
    let stdin = ctx.stdin;
    let outFile = null, errFile = null, mergeErr = false;
    const outBuf = [], errBuf = [];
    try {
      for (const r of cmd.redirs) {
        if (r.op === '2>&1') { mergeErr = true; continue; }
        const target = expandWord(r.target, ctx).join(' ');
        if (r.op === '<') {
          try { stdin = readFile(S, target); } catch (e) { ctx.err(`bash: ${target}: ${e.message}\n`); return 1; }
        } else if (r.op === '>' || r.op === '>>') {
          outFile = { path: target, append: r.op === '>>' };
          try { writeFile(S, target, '', r.op === '>>'); } catch (e) { ctx.err(`bash: ${target}: ${e.message}\n`); return 1; }
        } else if (r.op === '2>' || r.op === '2>>') {
          errFile = { path: target, append: r.op === '2>>' };
          try { writeFile(S, target, '', r.op === '2>>'); } catch (e) { ctx.err(`bash: ${target}: ${e.message}\n`); return 1; }
        } else if (r.op === '&>') {
          outFile = { path: target, append: false }; mergeErr = true;
          try { writeFile(S, target, ''); } catch (e) { ctx.err(`bash: ${target}: ${e.message}\n`); return 1; }
        }
      }
    } catch (e) { if (e instanceof ShellError) { ctx.err('bash: ' + e.message + '\n'); return 1; } throw e; }
    if (!argv.length) return 0;
    const sub = Object.assign({}, ctx, { stdin: ctx.stdinBox && stdin === ctx.stdin ? ctx.stdinBox.v : stdin });
    if (stdin !== ctx.stdin) sub.stdinBox = { v: stdin };
    if (outFile) { sub.out = s => outBuf.push(s); sub.tty = false; }
    if (errFile) sub.err = s => errBuf.push(s);
    if (mergeErr) sub.err = outFile ? (s => outBuf.push(s)) : ctx.out;
    let code;
    try {
      code = runCommand(argv, sub);
    } finally {
      if (outFile) { try { writeFile(S, outFile.path, stripAnsi(outBuf.join('')), true); } catch (e) { ctx.err(`bash: ${outFile.path}: ${e.message}\n`); } }
      if (errFile) { try { writeFile(S, errFile.path, errBuf.join(''), true); } catch (e) { ctx.err(`bash: ${errFile.path}: ${e.message}\n`); } }
    }
    return code;
  }

  function runCommand(argv, ctx) {
    const S = ctx.S;
    const name = argv[0], args = argv.slice(1);
    ctx.log.push({ name, args: args.slice(), user: S.user, cwd: S.cwd });
    const entry = ctx.log[ctx.log.length - 1];
    let code;
    try {
      if (name.includes('/')) code = execPath(name, args, ctx);
      else {
        const fn = CMDS[name];
        if (!fn || (PKG_CMDS[name] && !S.installed.includes(PKG_CMDS[name]))) {
          const pkg = PKG_CMDS[name] || NOT_INSTALLED[name];
          if (pkg) ctx.err(`No se ha encontrado la orden «${name}», pero se puede instalar con:\nsudo apt install ${pkg}\n`);
          else if (ctx.S.cmdMissingHook && SUGGEST[name]) ctx.err(`${name}: orden no encontrada. ¿Quisiste decir «${SUGGEST[name]}»?\n`);
          else ctx.err(`${name}: orden no encontrada\n`);
          code = 127;
        } else code = fn(args, ctx);
      }
    } catch (e) {
      if (e instanceof ShellError) { ctx.err(`${name}: ${e.message}\n`); code = e.code; }
      else throw e;
    }
    code = code || 0;
    entry.code = code;
    return code;
  }
  const SUGGEST = { sl: 'ls', cd: 'cd', dc: 'cd', pdw: 'pwd', claer: 'clear', grpe: 'grep', mkidr: 'mkdir', cta: 'cat', ecoh: 'echo', dir: 'ls', cls: 'clear', type_: 'type', copy: 'cp', move: 'mv', del: 'rm', ipconfig: 'ip a' };
  const PKG_CMDS = { tree: 'tree', htop: 'htop', cowsay: 'cowsay', neofetch: 'neofetch', sl: 'sl', nginx: 'nginx', zip: 'zip', unzip: 'unzip' };
  const NOT_INSTALLED = { ifconfig: 'net-tools', netstat: 'net-tools', vim: 'vim', gcc: 'gcc', python: 'python-is-python3', git: 'git', make: 'make' };

  function execPath(path, args, ctx) {
    const S = ctx.S;
    const r = get(S, path);
    if (r.err) { ctx.err(`bash: ${path}: ${r.err}\n`); return 127; }
    if (r.node.t === 'd') { ctx.err(`bash: ${path}: ${E_ISDIR}\n`); return 126; }
    if (!can(S, r.node, 1) || !(r.node.mode & 0o111)) { ctx.err(`bash: ${path}: ${E_ACCES}\n`); return 126; }
    if (r.node.data.startsWith('\x7fELF')) {
      const cmdname = basename(path);
      if (CMDS[cmdname]) return CMDS[cmdname](args, ctx);
      return 0;
    }
    if (!can(S, r.node, 4)) { ctx.err(`bash: ${path}: ${E_ACCES}\n`); return 126; }
    return runScript(r.node.data, path, args, ctx, false);
  }
  function runScript(src, name, args, ctx, sourced) {
    const frame = sourced ? ctx.frame : { args, name, env: Object.assign({}, ctx.frame.env) };
    if (sourced && args.length) frame.args = args;
    const sub = Object.assign({}, ctx, { frame, script: true });
    const savedCwd = ctx.S.cwd;
    let code = 0;
    try { code = runSource(src, sub); }
    catch (e) {
      if (e instanceof ExitSignal) code = e.code;
      else if (e instanceof Incomplete) { ctx.err(`${name}: error sintáctico: no se esperaba el final del archivo\n`); code = 2; }
      else if (e instanceof ShellError) { ctx.err(`${name}: ${e.message}\n`); code = e.code || 1; }
      else throw e;
    }
    if (!sourced) ctx.S.cwd = savedCwd; // un script no cambia el directorio del shell padre
    return code;
  }

  function execBackground(it, ctx) {
    const S = ctx.S;
    const first = it.ao.first.cmds[0];
    const text = it.ao.toks.map(t => t.type === 'op' ? t.v : tokText(t)).join(' ');
    const pid = S.nextPid++;
    const job = { id: S.nextJob++, pid, cmd: text, state: 'Ejecutando' };
    let duration = 0;
    let isSleep = false;
    let niceVal = 0;
    let sleepCmd = null;
    if (first.type === 'simple' && it.ao.rest.length === 0) {
      const argv = first.words.flatMap(w => expandWord(w, ctx));
      let a = argv;
      if (a[0] === 'nice') {
        niceVal = 10;
        if (a[1] === '-n') { niceVal = parseInt(a[2], 10) || 10; a = a.slice(3); }
        else if (/^-\d+$/.test(a[1] || '')) { niceVal = parseInt(a[1].slice(1), 10); a = a.slice(2); }
        else a = a.slice(1);
        ctx.log.push({ name: 'nice', args: argv.slice(1), user: S.user, cwd: S.cwd, code: 0 });
      }
      if (a[0] === 'sleep') { isSleep = true; sleepCmd = a.join(' '); duration = parseDur(a[1]); ctx.log.push({ name: 'sleep', args: a.slice(1), user: S.user, cwd: S.cwd, code: 0, bg: true }); }
      else if (a[0] === 'yes' || (a[0] && /\.sh$/.test(a[0]) && /bucle|infinito|minero/.test(a[0]))) { isSleep = true; duration = 1e9; }
    }
    ctx.out(`[${job.id}] ${pid}\n`);
    if (isSleep) {
      S.procs.push({ pid, ppid: S.shellPid, user: S.user, cmd: (sleepCmd || text).replace(/\s*$/, ''), state: 'S', cpu: duration > 1e8 ? 99.0 : 0.0, mem: 0.0, nice: niceVal, tty: 'pts/0', start: hhmm(), vsz: 8400, rss: 1800, end: duration > 1e8 ? null : Date.now() + duration * 1000, job: job.id });
      S.jobs.push(job);
    } else {
      // se ejecuta de inmediato (la salida aparece) y termina
      execAndOr(it.ao, ctx);
      job.state = 'Hecho';
      S.jobs.push(job);
    }
    S.lastCode = 0;
    return 0;
  }
  function tokText(t) {
    return t.segs.map(s => s.sub !== undefined ? `$(${s.sub})` : s.arith !== undefined ? `$((${s.arith}))` : s.q === "'" ? (/[\s$"]/.test(s.text) ? `'${s.text}'` : s.text) : s.q === '"' ? `"${s.text}"` : s.text).join('');
  }
  function parseDur(s) {
    const m = String(s || '').match(/^(\d+(?:\.\d+)?)([smhd]?)$/);
    if (!m) return NaN;
    return parseFloat(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]);
  }
  function hhmm() { const d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function reapProcs(S) {
    const now = Date.now();
    const finished = [];
    S.procs = S.procs.filter(p => {
      if (p.end && p.end <= now && p.state !== 'T') {
        const j = S.jobs.find(j => j.pid === p.pid);
        if (j && j.state !== 'Hecho') { j.state = 'Hecho'; finished.push(j); }
        return false;
      }
      return true;
    });
    return finished;
  }

  // ---------- utilidades de comandos ----------
  function getopt(args, flags, withVal = '', longMap = {}, allowNum = false) {
    const o = {}, rest = [];
    let stop = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (stop || a === '-' || !a.startsWith('-') || (allowNum && /^-\d+$/.test(a))) {
        if (allowNum && !stop && /^-\d+$/.test(a)) { o.num = parseInt(a.slice(1), 10); continue; }
        rest.push(a); continue;
      }
      if (a === '--') { stop = true; continue; }
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
        const v = eq > 0 ? a.slice(eq + 1) : undefined;
        if (!(k in longMap)) throw new ShellError(`opción no reconocida «${a}»\nPruebe '--help' para más información.`, 2);
        const m = longMap[k];
        if (withVal.includes(m)) o[m] = v !== undefined ? v : args[++i];
        else o[m] = true;
        continue;
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (withVal.includes(c)) {
          const v = a.slice(j + 1) || args[++i];
          if (v === undefined) throw new ShellError(`la opción requiere un argumento -- '${c}'`, 2);
          o[c] = v; break;
        }
        if (!flags.includes(c)) throw new ShellError(`opción inválida -- '${c}'\nPruebe '--help' para más información.`, 2);
        o[c] = true;
      }
    }
    return { o, rest };
  }
  function inputs(files, ctx, name, cb) { // llama cb(texto, nombre) para cada archivo o stdin
    let code = 0;
    if (!files.length) { cb(ctx.stdin || '', '-'); return 0; }
    for (const f of files) {
      if (f === '-') { cb(ctx.stdin || '', '-'); continue; }
      try { cb(readFile(ctx.S, f), f); }
      catch (e) { ctx.err(`${name}: ${f}: ${e.message}\n`); code = 1; }
    }
    return code;
  }
  function needRoot(ctx, name) {
    if (ctx.S.user !== 'root') { throw new ShellError('Permiso denegado. ¿Olvidaste usar sudo?', 1); }
  }
  function nodeSizeRec(n, seen = new Set()) {
    if (seen.has(n.ino)) return 0; seen.add(n.ino);
    if (n.t !== 'd') return Math.max(4096, Math.ceil(fsize(n) / 4096) * 4096);
    let s = 4096;
    for (const k in n.c) s += nodeSizeRec(n.c[k], seen);
    return s;
  }
  function walk(S, abs, node, cb, depth = 0, seenDenied) {
    cb(abs, node, depth);
    if (node.t === 'd') {
      if (!can(S, node, 4) || !can(S, node, 1)) { if (seenDenied) seenDenied(abs); return; }
      for (const k of Object.keys(node.c).sort(cmpName)) walk(S, abs === '/' ? '/' + k : abs + '/' + k, node.c[k], cb, depth + 1, seenDenied);
    }
  }

  // ---------- COMANDOS ----------
  const CMDS = {};
  const def = (names, fn) => names.split(' ').forEach(n => CMDS[n] = fn);

  def('pwd', (a, ctx) => { ctx.out(ctx.S.cwd + '\n'); });
  def('cd', (a, ctx) => {
    const S = ctx.S;
    let t = a[0];
    if (t === undefined || t === '') t = homeOf(S, S.user);
    if (t === '-') { t = S.oldpwd || S.cwd; ctx.out(t + '\n'); }
    if (a.length > 1) { ctx.err('bash: cd: demasiados argumentos\n'); return 1; }
    const abs = abspath(S, t);
    const r = lookup(S, abs);
    if (r.err) { ctx.err(`bash: cd: ${t}: ${r.err}\n`); return 1; }
    if (r.node.t !== 'd') { ctx.err(`bash: cd: ${t}: ${E_NOTDIR}\n`); return 1; }
    if (!can(S, r.node, 1)) { ctx.err(`bash: cd: ${t}: ${E_ACCES}\n`); return 1; }
    S.oldpwd = S.cwd;
    S.cwd = abs;
    return 0;
  });
  def('ls dir', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'lahAR1idtrSFC', '', { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', inode: 'i', directory: 'd', help: 'H', color: 'x' });
    if (o.H) { ctx.out('Modo de empleo: ls [OPCIÓN]... [ARCHIVO]...\nMuestra información sobre los ARCHIVOS (el directorio actual por defecto).\n  -a  no oculta las entradas que empiezan con .\n  -l  usa un formato de listado largo\n  -h  con -l, muestra los tamaños en formato legible (1K 234M 2G)\n  -R  lista los subdirectorios recursivamente\n  -i  muestra el número de nodo-i de cada archivo\n  -t  ordena por fecha de modificación\n  -r  invierte el orden\n'); return 0; }
    const targets = rest.length ? rest : ['.'];
    let code = 0;
    const files = [], dirs = [];
    for (const t of targets) {
      const r = get(S, t, !(o.l && !o.d && false));
      const rl = get(S, t, false);
      if (r.err && rl.err) { ctx.err(`ls: no se puede acceder a '${t}': ${r.err}\n`); code = 2; continue; }
      const node = r.err ? rl.node : r.node;
      if (node.t === 'd' && !o.d && !(rl.node && rl.node.t === 'l' && o.l)) dirs.push({ t, node, abs: abspath(S, t) });
      else files.push({ name: t, node: rl.node || node });
    }
    const fmtEntries = (entries, dirAbs) => {
      let ents = entries;
      if (o.t) ents.sort((x, y) => y.node.mtime - x.node.mtime);
      else if (o.S) ents.sort((x, y) => fsize(y.node) - fsize(x.node));
      if (o.r) ents.reverse();
      if (o.l) {
        const rows = ents.map(e => {
          const n = e.node;
          const size = o.h ? human(fsize(n)) : String(fsize(n));
          const nlink = n.t === 'd' ? 2 + Object.values(n.c).filter(c => c.t === 'd').length : n.nlink;
          let nm = colorName(n, e.name, ctx.tty);
          if (o.F && n.t === 'd') nm += '/';
          else if (o.F && n.t === 'f' && (n.mode & 0o111)) nm += '*';
          if (n.t === 'l') nm += ' -> ' + n.target;
          return [o.i ? String(n.ino) : null, modeStr(n), String(nlink), n.owner, n.group, size, lsDate(n.mtime), nm];
        });
        const w = [0, 1, 2, 3, 4, 5].map(k => Math.max(0, ...rows.map(r => (r[k] || '').length)));
        const total = Math.round(ents.reduce((s, e) => s + (e.node.t === 'd' ? 4 : Math.ceil(fsize(e.node) / 4096) * 4), 0));
        let out = dirAbs !== undefined ? `total ${total}\n` : '';
        for (const r of rows) out += (r[0] !== null ? pad(r[0], w[0], true) + ' ' : '') + `${r[1]} ${pad(r[2], w[2], true)} ${pad(r[3], w[3])} ${pad(r[4], w[4])} ${pad(r[5], w[5], true)} ${r[6]} ${r[7]}\n`;
        return out;
      }
      const names = ents.map(e => (o.i ? e.node.ino + ' ' : '') + colorName(e.node, e.name, ctx.tty) + (o.F ? (e.node.t === 'd' ? '/' : e.node.t === 'l' ? '@' : (e.node.mode & 0o111) ? '*' : '') : ''));
      if (!names.length) return '';
      return (ctx.tty && !o['1'] ? names.join('  ') : names.join('\n')) + '\n';
    };
    if (files.length) ctx.out(fmtEntries(files));
    const listDir = (d, header) => {
      if (!can(S, d.node, 4)) { ctx.err(`ls: no se puede abrir el directorio '${d.t}': ${E_ACCES}\n`); code = 2; return; }
      let ents = Object.keys(d.node.c).filter(k => o.a || o.A || !k.startsWith('.')).sort(cmpName).map(k => ({ name: k, node: d.node.c[k] }));
      if (o.a) ents = [{ name: '.', node: d.node }, { name: '..', node: lookup(S, dirname(d.abs)).node || d.node }].concat(ents);
      if (header) ctx.out(`${d.t}:\n`);
      ctx.out(fmtEntries(ents, d.abs));
      if (o.R) {
        for (const e of ents) {
          if (e.node.t === 'd' && e.name !== '.' && e.name !== '..') {
            ctx.out('\n');
            const sub = d.t === '.' ? './' + e.name : d.t.replace(/\/$/, '') + '/' + e.name;
            listDir({ t: sub, node: e.node, abs: norm(d.abs + '/' + e.name) }, true);
          }
        }
      }
    };
    dirs.forEach((d, i) => {
      if (i > 0 || files.length) ctx.out('\n');
      listDir(d, targets.length > 1 || o.R);
    });
    return code;
  });
  def('mkdir', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'pv', 'm', { parents: 'p', verbose: 'v' });
    if (!rest.length) { ctx.err('mkdir: falta un operando\nPruebe \'mkdir --help\' para más información.\n'); return 1; }
    let code = 0;
    for (const t of rest) {
      const abs = abspath(S, t);
      const parts = abs.split('/').filter(Boolean);
      let cur = '';
      for (let i = 0; i < parts.length; i++) {
        cur += '/' + parts[i];
        const last = i === parts.length - 1;
        const r = lookup(S, cur);
        if (!r.err) {
          if (last && !o.p) { ctx.err(`mkdir: no se puede crear el directorio «${t}»: El archivo ya existe\n`); code = 1; }
          else if (r.node.t !== 'd') { ctx.err(`mkdir: no se puede crear el directorio «${t}»: ${E_NOTDIR}\n`); code = 1; break; }
          continue;
        }
        if (r.err !== E_NOENT) { ctx.err(`mkdir: no se puede crear el directorio «${t}»: ${r.err}\n`); code = 1; break; }
        if (!last && !o.p) { ctx.err(`mkdir: no se puede crear el directorio «${t}»: ${E_NOENT}\n`); code = 1; break; }
        const pr = lookup(S, dirname(cur));
        if (!can(S, pr.node, 2)) { ctx.err(`mkdir: no se puede crear el directorio «${t}»: ${E_ACCES}\n`); code = 1; break; }
        pr.node.c[parts[i]] = mk(S, 'd', S.user, primaryGroup(S, S.user), o.m ? parseInt(o.m, 8) : 0o777 & ~S.umask);
        pr.node.mtime = Date.now();
        if (o.v) ctx.out(`mkdir: se ha creado el directorio '${cur}'\n`);
      }
    }
    return code;
  });
  def('rmdir', (a, ctx) => {
    const S = ctx.S;
    const { rest } = getopt(a, 'pv');
    if (!rest.length) { ctx.err('rmdir: falta un operando\n'); return 1; }
    let code = 0;
    for (const t of rest) {
      const r = get(S, t, false);
      if (r.err) { ctx.err(`rmdir: fallo al borrar '${t}': ${r.err}\n`); code = 1; continue; }
      if (r.node.t !== 'd') { ctx.err(`rmdir: fallo al borrar '${t}': ${E_NOTDIR}\n`); code = 1; continue; }
      if (Object.keys(r.node.c).length) { ctx.err(`rmdir: fallo al borrar '${t}': El directorio no está vacío\n`); code = 1; continue; }
      if (!can(S, r.parent, 2)) { ctx.err(`rmdir: fallo al borrar '${t}': ${E_ACCES}\n`); code = 1; continue; }
      if (abspath(S, t) === S.cwd) { ctx.err(`rmdir: fallo al borrar '${t}': Dispositivo o recurso ocupado\n`); code = 1; continue; }
      delete r.parent.c[r.name];
    }
    return code;
  });
  def('touch', (a, ctx) => {
    const S = ctx.S;
    const { rest } = getopt(a, 'acm');
    if (!rest.length) { ctx.err('touch: falta un operando de archivo\n'); return 1; }
    let code = 0;
    for (const t of rest) {
      const r = get(S, t);
      if (!r.err) { if (!can(S, r.node, 2) && r.node.owner !== S.user && S.user !== 'root') { ctx.err(`touch: no se puede efectuar 'touch' sobre '${t}': ${E_ACCES}\n`); code = 1; } else r.node.mtime = Date.now(); continue; }
      try { writeFile(S, t, ''); } catch (e) { ctx.err(`touch: no se puede efectuar 'touch' sobre '${t}': ${e.message}\n`); code = 1; }
    }
    return code;
  });
  def('rm', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'rRfvid', '', { recursive: 'r', force: 'f', verbose: 'v', 'no-preserve-root': 'N' });
    const rec = o.r || o.R;
    if (!rest.length) { if (o.f) return 0; ctx.err('rm: falta un operando\nPruebe \'rm --help\' para más información.\n'); return 1; }
    let code = 0;
    for (const t of rest) {
      const abs = abspath(S, t);
      if (abs === '/' && rec) { ctx.err("rm: es peligroso operar recursivamente sobre '/'\nrm: use --no-preserve-root para evitar esta comprobación\n(en un sistema real, esto habría borrado TODO. Aquí te protegemos.)\n"); code = 1; continue; }
      const r = lookup(S, abs, false);
      if (r.err) { if (!o.f) { ctx.err(`rm: no se puede borrar '${t}': ${r.err}\n`); code = 1; } continue; }
      if (r.node.t === 'd' && !rec && !o.d) { ctx.err(`rm: no se puede borrar '${t}': ${E_ISDIR}\n`); code = 1; continue; }
      if (r.node.t === 'd' && o.d && !rec && Object.keys(r.node.c).length) { ctx.err(`rm: no se puede borrar '${t}': El directorio no está vacío\n`); code = 1; continue; }
      if (!can(S, r.parent, 2)) { ctx.err(`rm: no se puede borrar '${t}': ${E_ACCES}\n`); code = 1; continue; }
      if ((r.parent.mode & 0o1000) && S.user !== 'root' && r.node.owner !== S.user) { ctx.err(`rm: no se puede borrar '${t}': ${E_PERM}\n`); code = 1; continue; }
      if (r.node.t === 'd') {
        let denied = false;
        walk(S, abs, r.node, (p, n) => { if (n.t === 'd' && !can(S, n, 2) && Object.keys(n.c).length) denied = true; });
        if (denied) { ctx.err(`rm: no se puede borrar '${t}': ${E_ACCES}\n`); code = 1; continue; }
        if (S.cwd === abs || S.cwd.startsWith(abs + '/')) { /* permitido en linux, el cwd queda huérfano */ }
      }
      if (r.node.t !== 'd') r.node.nlink = Math.max(0, r.node.nlink - 1);
      delete r.parent.c[r.name];
      if (o.v) ctx.out(`se ha borrado '${t}'\n`);
    }
    if (lookup(S, S.cwd).err) { /* cwd borrado */ }
    return code;
  });
  function cloneNode(S, n) {
    const c = mk(S, n.t, S.user, primaryGroup(S, S.user), n.mode);
    if (n.t === 'f') { c.data = n.data; if (n.dev) c.dev = n.dev; }
    if (n.t === 'l') c.target = n.target;
    if (n.t === 'd') for (const k in n.c) c.c[k] = cloneNode(S, n.c[k]);
    return c;
  }
  function copyOrMove(a, ctx, move) {
    const S = ctx.S;
    const name = move ? 'mv' : 'cp';
    const { o, rest } = getopt(a, 'rRvfinpau', '', { recursive: 'r', verbose: 'v', force: 'f' });
    if (rest.length < 2) { ctx.err(`${name}: falta ${rest.length ? 'el archivo de destino' : 'un operando de archivo'} ${rest.length ? "después de '" + rest[0] + "'" : ''}\n`); return 1; }
    const dest = rest.pop();
    const destAbs = abspath(S, dest);
    const dr = lookup(S, destAbs);
    const destIsDir = !dr.err && dr.node.t === 'd';
    if (rest.length > 1 && !destIsDir) { ctx.err(`${name}: el destino '${dest}' no es un directorio\n`); return 1; }
    let code = 0;
    for (const src of rest) {
      const sAbs = abspath(S, src);
      const sr = lookup(S, sAbs, move ? false : true);
      if (sr.err) { ctx.err(`${name}: no se puede efectuar \`stat' sobre '${src}': ${sr.err}\n`); code = 1; continue; }
      if (!move && sr.node.t === 'd' && !(o.r || o.R || o.a)) { ctx.err(`cp: -r no especificado; se omite el directorio '${src}'\n`); code = 1; continue; }
      if (!move && !can(S, sr.node, 4)) { ctx.err(`cp: no se puede abrir '${src}' para lectura: ${E_ACCES}\n`); code = 1; continue; }
      const target = destIsDir ? norm(destAbs + '/' + basename(sAbs)) : destAbs;
      if (target === sAbs) { ctx.err(`${name}: '${src}' y '${dest}' son el mismo archivo\n`); code = 1; continue; }
      if (sr.node.t === 'd' && (target + '/').startsWith(sAbs + '/')) { ctx.err(`${name}: no se puede ${move ? 'mover' : 'copiar'} un directorio, '${src}', dentro de sí mismo, '${dest}'\n`); code = 1; continue; }
      const tp = lookup(S, dirname(target));
      if (tp.err) { ctx.err(`${name}: no se puede crear el fichero regular '${dest}': ${tp.err}\n`); code = 1; continue; }
      if (!can(S, tp.node, 2)) { ctx.err(`${name}: no se puede crear el fichero regular '${dest}': ${E_ACCES}\n`); code = 1; continue; }
      const existing = tp.node.c[basename(target)];
      if (existing && existing.t === 'd' && sr.node.t !== 'd') { ctx.err(`${name}: no se puede sobrescribir el directorio '${target}' con un no-directorio\n`); code = 1; continue; }
      if (existing && o.n) continue;
      if (move) {
        if (!can(S, sr.parent, 2)) { ctx.err(`mv: no se puede mover '${src}': ${E_ACCES}\n`); code = 1; continue; }
        delete sr.parent.c[sr.name];
        tp.node.c[basename(target)] = sr.node;
        sr.node.mtime = sr.node.mtime;
      } else {
        if (existing && existing.t === 'f' && sr.node.t === 'f') { existing.data = sr.node.data; existing.mtime = Date.now(); }
        else { const c = cloneNode(S, sr.node); if (o.p || o.a) { c.mtime = sr.node.mtime; c.mode = sr.node.mode; } tp.node.c[basename(target)] = c; }
      }
      if (o.v) ctx.out(`'${src}' -> '${destIsDir ? dest.replace(/\/$/, '') + '/' + basename(sAbs) : dest}'${move ? ' (movido)' : ''}\n`);
    }
    return code;
  }
  def('cp', (a, ctx) => copyOrMove(a, ctx, false));
  def('mv', (a, ctx) => copyOrMove(a, ctx, true));
  def('cat', (a, ctx) => {
    const { o, rest } = getopt(a, 'nAbEs', '', { number: 'n' });
    let n = 0;
    return inputs(rest, ctx, 'cat', (txt) => {
      if (/^\x00(TAR|GZ)/.test(txt)) { ctx.out('\u00bf\u00c4\u0003\u00dd\u00ff\u0000\u001f\u008b(datos binarios comprimidos: usa tar -tf o gunzip)\n'); return; }
      if (txt.startsWith('\x7fELF')) { ctx.out('\u007fELF\u0002\u0001\u0001\u0000\u0000\u0000\u0000>\u0000\u0001\u0000... (binario ejecutable; no es texto legible)\n'); return; }
      if (o.n || o.b) { ctx.out(lines(txt).map(l => pad(++n, 6, true) + '\t' + l).join('\n') + (txt ? '\n' : '')); }
      else if (o.A || o.E) ctx.out(txt.replace(/\t/g, '^I').replace(/\n/g, '$\n'));
      else ctx.out(txt);
    });
  });
  def('tac', (a, ctx) => inputs(a, ctx, 'tac', t => { const l = lines(t).reverse(); if (l.length) ctx.out(l.join('\n') + '\n'); }));
  def('less more most', (a, ctx) => {
    const { rest } = getopt(a, 'NSRFX');
    return inputs(rest, ctx, 'less', t => ctx.out(t));
  });
  def('echo', (a, ctx) => {
    let n = false, e = false, i = 0;
    while (i < a.length && /^-[neE]+$/.test(a[i])) { if (a[i].includes('n')) n = true; if (a[i].includes('e')) e = true; i++; }
    let s = a.slice(i).join(' ');
    if (e) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\').replace(/\\e\[/g, '\x1b[').replace(/\\033\[/g, '\x1b[');
    ctx.out(s + (n ? '' : '\n'));
  });
  def('printf', (a, ctx) => {
    if (!a.length) { ctx.err('printf: modo de empleo: printf formato [argumentos]\n'); return 2; }
    const fmt = a[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    let args = a.slice(1);
    let out = '';
    do {
      let used = 0;
      out += fmt.replace(/%(-?\d*)(\.\d+)?([sdfi%])/g, (m, w, prec, t) => {
        if (t === '%') return '%';
        let v = args[used++] ?? '';
        if (t === 'd' || t === 'i') v = String(parseInt(v, 10) || 0);
        if (t === 'f') v = (parseFloat(v) || 0).toFixed(prec ? parseInt(prec.slice(1)) : 6);
        const width = parseInt(w, 10);
        if (width) v = width < 0 ? pad(v, -width) : pad(v, width, true);
        return v;
      });
      args = args.slice(used || args.length);
      if (!used) break;
    } while (args.length);
    ctx.out(out);
  });
  def('head tail', null);
  const headTail = (isTail) => (a, ctx) => {
    const name = isTail ? 'tail' : 'head';
    const { o, rest } = getopt(a, 'fqvF', 'nc', { lines: 'n', bytes: 'c', follow: 'f' }, true);
    let n = o.num ?? (o.n !== undefined ? o.n : 10);
    let fromStart = false;
    if (typeof n === 'string') { if (isTail && n.startsWith('+')) fromStart = true; n = parseInt(n, 10); }
    if (isNaN(n)) { ctx.err(`${name}: número de líneas inválido\n`); return 1; }
    const multi = rest.length > 1;
    let first = true;
    const code = inputs(rest, ctx, name, (t, f) => {
      if (multi) { ctx.out((first ? '' : '\n') + `==> ${f} <==\n`); first = false; }
      if (o.c) { const k = parseInt(o.c, 10); ctx.out(isTail ? t.slice(-k) : t.slice(0, k)); return; }
      const l = lines(t);
      let sel;
      if (isTail) sel = fromStart ? l.slice(n - 1) : (n === 0 ? [] : l.slice(-n));
      else sel = n < 0 ? l.slice(0, n) : l.slice(0, n);
      if (sel.length) ctx.out(sel.join('\n') + '\n');
    });
    if (isTail && o.f) ctx.out(ctx.tty ? C.dim + '(tail -f seguiría mostrando las líneas nuevas en tiempo real; en el simulador termina aquí)' + C.off + '\n' : '');
    return code;
  };
  CMDS.head = headTail(false);
  CMDS.tail = headTail(true);
  def('wc', (a, ctx) => {
    const { o, rest } = getopt(a, 'lwcm', '', { lines: 'l', words: 'w', bytes: 'c', chars: 'm' });
    const all = !o.l && !o.w && !o.c && !o.m;
    const rows = [];
    const tot = [0, 0, 0];
    const code = inputs(rest, ctx, 'wc', (t, f) => {
      const v = [(t.match(/\n/g) || []).length, (t.match(/\S+/g) || []).length, o.m ? [...t].length : utf8len(t)];
      v.forEach((x, i) => tot[i] += x);
      rows.push([v, f === '-' ? '' : f]);
    });
    if (rows.length > 1) rows.push([tot, 'total']);
    const sel = v => [all || o.l ? v[0] : null, all || o.w ? v[1] : null, all || o.c || o.m ? v[2] : null].filter(x => x !== null);
    const width = rows.length === 1 && !rest.length && sel(rows[0][0]).length === 1 ? 0 : Math.max(1, ...rows.map(r => String(Math.max(...sel(r[0]))).length));
    rows.forEach(([v, f]) => ctx.out(sel(v).map(x => pad(x, width, true)).join(' ') + (f ? ' ' + f : '') + '\n'));
    return code;
  });
  def('grep egrep fgrep', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'ivnclrRwEFohsxHq', 'eAB', { 'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', color: 'z', colour: 'z', 'files-with-matches': 'l', 'only-matching': 'o' });
    let pat = o.e;
    if (pat === undefined) { if (!rest.length) { ctx.err('Modo de empleo: grep [OPCIÓN]... PATRONES [ARCHIVO]...\nPruebe \'grep --help\' para más información.\n'); return 2; } pat = rest.shift(); }
    let re;
    let src = o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : (o.E ? pat : pat.replace(/\\\|/g, '|').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/(^|[^\\])\+/g, '$1\\+').replace(/(^|[^\\])\?/g, '$1\\?'));
    if (o.w) src = '\\b(?:' + src + ')\\b';
    if (o.x) src = '^(?:' + src + ')$';
    try { re = new RegExp(src, o.i ? 'gi' : 'g'); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.i ? 'gi' : 'g'); }
    let files = rest.slice();
    const rec = o.r || o.R;
    if (rec && !files.length) files = ['.'];
    const expanded = [];
    let code = 0;
    if (rec) {
      for (const f of files) {
        const r = get(S, f);
        if (r.err) { ctx.err(`grep: ${f}: ${r.err}\n`); code = 2; continue; }
        if (r.node.t === 'd') walk(S, abspath(S, f), r.node, (p, n) => { if (n.t === 'f' && !n.dev) expanded.push(f === '.' ? p.replace(S.cwd === '/' ? '/' : S.cwd + '/', '') : (f.replace(/\/$/, '') + p.slice(abspath(S, f).length))); }, 0, p => { if (!o.s) ctx.err(`grep: ${p}: ${E_ACCES}\n`); });
        else expanded.push(f);
      }
      files = expanded;
    }
    const showName = o.H || files.length > 1 || rec;
    let any = false;
    const c2 = (s) => ctx.tty ? C.mag + s + C.off + (ctx.tty ? '\x1b[36m:\x1b[0m' : ':') : s + ':';
    const hl = s => ctx.tty ? s.replace(re, m => C.red + m + C.off) : s;
    if (!files.length) files = ['-'];
    for (const f of files) {
      let t;
      if (f === '-') t = ctx.stdin || '';
      else {
        const r = get(S, f);
        if (r.err) { if (!o.s) ctx.err(`grep: ${f}: ${r.err}\n`); code = 2; continue; }
        if (r.node.t === 'd') { ctx.err(`grep: ${f}: ${E_ISDIR}\n`); continue; }
        if (!can(S, r.node, 4)) { if (!o.s) ctx.err(`grep: ${f}: ${E_ACCES}\n`); code = 2; continue; }
        t = r.node.data;
        if (t.startsWith('\x7fELF') || t.startsWith('\x00')) { re.lastIndex = 0; if (re.test(t)) { ctx.out(`grep: ${f}: coincidencia en fichero binario\n`); any = true; } continue; }
      }
      const ls = lines(t);
      let count = 0;
      ls.forEach((l, idx) => {
        re.lastIndex = 0;
        const m = re.test(l);
        if (m !== !!o.v) {
          count++;
          if (o.c || o.l || o.q) return;
          if (o.o && !o.v) { const ms = l.match(re) || []; ms.forEach(x => ctx.out((showName ? c2(f) : '') + (o.n ? (ctx.tty ? C.grn + (idx + 1) + C.off + ':' : idx + 1 + ':') : '') + (ctx.tty ? C.red + x + C.off : x) + '\n')); return; }
          ctx.out((showName && !o.h ? c2(f) : '') + (o.n ? (ctx.tty ? C.grn + (idx + 1) + C.off + '\x1b[36m:\x1b[0m' : idx + 1 + ':') : '') + (o.v ? l : hl(l)) + '\n');
        }
      });
      if (count) any = true;
      if (o.c) ctx.out((showName && !o.h ? c2(f) : '') + count + '\n');
      if (o.l && count) ctx.out((ctx.tty ? C.mag + f + C.off : f) + '\n');
    }
    if (code === 2 && !any) return 2;
    return any ? 0 : 1;
  });
  def('sort', (a, ctx) => {
    const { o, rest } = getopt(a, 'rnufhbM', 'kt', { reverse: 'r', numeric: 'n', unique: 'u', 'ignore-case': 'f' });
    let all = [];
    const code = inputs(rest, ctx, 'sort', t => { all = all.concat(lines(t)); });
    const key = l => {
      if (!o.k) return l;
      const k = parseInt(o.k, 10);
      const parts = o.t ? l.split(o.t) : l.trim().split(/\s+/);
      return parts.slice(k - 1).join(o.t || ' ');
    };
    const hnum = s => { const m = String(s).trim().match(/^([\d.]+)([KMGT]?)/i); if (!m) return 0; return parseFloat(m[1]) * Math.pow(1024, 'KMGT'.indexOf(m[2].toUpperCase()) + 1); };
    const coll = new Intl.Collator('es', { sensitivity: o.f ? 'base' : 'variant', numeric: false });
    all.sort((x, y) => {
      const a1 = key(x), b1 = key(y);
      let r;
      if (o.n) r = (parseFloat(a1) || 0) - (parseFloat(b1) || 0);
      else if (o.h) r = hnum(a1) - hnum(b1);
      else r = coll.compare(a1, b1);
      if (r === 0 && !o.u) r = coll.compare(x, y);
      return r;
    });
    if (o.r) all.reverse();
    if (o.u) all = all.filter((l, i) => i === 0 || (o.n ? parseFloat(key(l)) !== parseFloat(key(all[i - 1])) : key(l) !== key(all[i - 1])));
    if (all.length) ctx.out(all.join('\n') + '\n');
    return code;
  });
  def('uniq', (a, ctx) => {
    const { o, rest } = getopt(a, 'cdui', '', { count: 'c' });
    return inputs(rest.slice(0, 1), ctx, 'uniq', t => {
      const l = lines(t);
      const groups = [];
      for (const x of l) {
        const g = groups[groups.length - 1];
        if (g && (o.i ? g.v.toLowerCase() === x.toLowerCase() : g.v === x)) g.n++;
        else groups.push({ v: x, n: 1 });
      }
      const sel = groups.filter(g => o.d ? g.n > 1 : o.u ? g.n === 1 : true);
      const out = sel.map(g => o.c ? pad(g.n, 7, true) + ' ' + g.v : g.v);
      if (out.length) ctx.out(out.join('\n') + '\n');
    });
  });
  function parseRanges(spec) {
    const r = [];
    for (const part of spec.split(',')) {
      const m = part.match(/^(\d*)-(\d*)$/);
      if (m) r.push([m[1] ? +m[1] : 1, m[2] ? +m[2] : Infinity]);
      else if (/^\d+$/.test(part)) r.push([+part, +part]);
      else throw new ShellError('lista de campos inválida');
    }
    return i => r.some(([x, y]) => i >= x && i <= y);
  }
  def('cut', (a, ctx) => {
    const { o, rest } = getopt(a, 's', 'dfc', { delimiter: 'd', fields: 'f', characters: 'c' });
    if (!o.f && !o.c) { ctx.err('cut: debe especificar una lista de bytes, caracteres o campos\nPruebe \'cut --help\' para más información.\n'); return 1; }
    const d = o.d ?? '\t';
    if (d.length !== 1) { ctx.err('cut: el delimitador debe ser un único carácter\n'); return 1; }
    const sel = parseRanges(o.f || o.c);
    return inputs(rest, ctx, 'cut', t => {
      const out = lines(t).map(l => {
        if (o.c) return [...l].filter((ch, i) => sel(i + 1)).join('');
        if (!l.includes(d)) return o.s ? null : l;
        return l.split(d).filter((x, i) => sel(i + 1)).join(d);
      }).filter(x => x !== null);
      if (out.length) ctx.out(out.join('\n') + '\n');
    });
  });
  function trSet(s) {
    s = s.replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:digit:\]/g, '0-9').replace(/\[:space:\]/g, ' \t\n').replace(/\[:alpha:\]/g, 'a-zA-Z').replace(/\[:punct:\]/g, '!-/:-@[-`{-~').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    const out = [];
    const ch = [...s];
    for (let i = 0; i < ch.length; i++) {
      if (ch[i + 1] === '-' && ch[i + 2] !== undefined) { for (let c = ch[i].codePointAt(0); c <= ch[i + 2].codePointAt(0); c++) out.push(String.fromCodePoint(c)); i += 2; }
      else out.push(ch[i]);
    }
    return out;
  }
  def('tr', (a, ctx) => {
    const { o, rest } = getopt(a, 'dsc');
    const t = ctx.stdin || '';
    if (!rest.length) { ctx.err('tr: falta un operando\n'); return 1; }
    const s1 = trSet(rest[0]);
    let out;
    if (o.d) out = [...t].filter(c => !s1.includes(c)).join('');
    else if (rest.length > 1) {
      const s2 = trSet(rest[1]);
      out = [...t].map(c => { const i = s1.indexOf(c); return i < 0 ? c : (s2[Math.min(i, s2.length - 1)]); }).join('');
      if (o.s) { const set = new Set(s2); out = out.replace(/(.)\1+/gs, (m, c) => set.has(c) ? c : m); }
    } else if (o.s) { const set = new Set(s1); out = t.replace(/(.)\1+/gs, (m, c) => set.has(c) ? c : m); }
    else { ctx.err('tr: falta un operando después de «' + rest[0] + '»\n'); return 1; }
    ctx.out(out);
  });
  def('tee', (a, ctx) => {
    const { o, rest } = getopt(a, 'a', '', { append: 'a' });
    const t = ctx.stdin || '';
    let code = 0;
    for (const f of rest) { try { writeFile(ctx.S, f, t, !!o.a); } catch (e) { ctx.err(`tee: ${f}: ${e.message}\n`); code = 1; } }
    ctx.out(t);
    return code;
  });
  def('find', (a, ctx) => {
    const S = ctx.S;
    const paths = [];
    let i = 0;
    while (i < a.length && !a[i].startsWith('-') && a[i] !== '!' && a[i] !== '(') paths.push(a[i++]);
    if (!paths.length) paths.push('.');
    const tests = [];
    let maxd = Infinity, mind = 0, negate = false, execCmd = null, del_ = false;
    while (i < a.length) {
      const t = a[i++];
      const v = a[i];
      const push = f => { const neg = negate; tests.push(neg ? (...x) => !f(...x) : f); negate = false; };
      switch (t) {
        case '!': case '-not': negate = true; break;
        case '-name': i++; { const re = globRe(v); push((p, n) => re.test(basename(p))); } break;
        case '-iname': i++; { const re = new RegExp(globRe(v).source, 'i'); push((p, n) => re.test(basename(p))); } break;
        case '-path': i++; { const re = new RegExp(globRe(v).source.replace(/\[\^\/\]\*/g, '.*')); push(p => re.test(p)); } break;
        case '-type': i++; push((p, n) => (v === 'f' && n.t === 'f') || (v === 'd' && n.t === 'd') || (v === 'l' && n.t === 'l')); break;
        case '-user': i++; push((p, n) => n.owner === v); break;
        case '-group': i++; push((p, n) => n.group === v); break;
        case '-perm': i++; { const want = parseInt(v.replace(/^[-\/]/, ''), 8); const mode = v[0]; push((p, n) => mode === '-' ? (n.mode & want) === want : mode === '/' ? (n.mode & want) !== 0 : (n.mode & 0o7777) === want); } break;
        case '-empty': push((p, n) => n.t === 'd' ? !Object.keys(n.c).length : n.t === 'f' && !n.data.length); break;
        case '-size': i++; {
          const m = v.match(/^([+-]?)(\d+)([ckMG]?)$/);
          if (!m) throw new ShellError(`argumento inválido «${v}» para «-size»`);
          const mult = { '': 512, c: 1, k: 1024, M: 1048576, G: 1073741824 }[m[3]];
          const lim = +m[2] * mult;
          push((p, n) => { if (n.t !== 'f') return false; const s = fsize(n); return m[1] === '+' ? s > lim : m[1] === '-' ? s < lim : Math.ceil(s / mult) === +m[2]; });
        } break;
        case '-mmin': case '-mtime': i++; { const m = v.match(/^([+-]?)(\d+)$/); const unit = t === '-mmin' ? 60e3 : 86400e3; push((p, n) => { const age = (Date.now() - n.mtime) / unit; return m[1] === '-' ? age < +m[2] : m[1] === '+' ? age > +m[2] : Math.floor(age) === +m[2]; }); } break;
        case '-maxdepth': i++; maxd = parseInt(v, 10); break;
        case '-mindepth': i++; mind = parseInt(v, 10); break;
        case '-print': break;
        case '-delete': del_ = true; break;
        case '-exec': {
          const parts = [];
          while (i < a.length && a[i] !== ';' && a[i] !== '+') parts.push(a[i++]);
          if (i >= a.length) throw new ShellError("falta el argumento de «-exec»");
          i++;
          execCmd = parts;
        } break;
        default: throw new ShellError(`predicado desconocido «${t}»`);
      }
    }
    let code = 0;
    const toDelete = [];
    for (const p of paths) {
      const r = get(S, p);
      if (r.err) { ctx.err(`find: '${p}': ${r.err}\n`); code = 1; continue; }
      const absP = abspath(S, p);
      walk(S, absP, r.node, (abs, n, depth) => {
        if (depth > maxd || depth < mind) return;
        const shown = p === '/' ? abs : (p.replace(/\/$/, '') + abs.slice(absP.length)) || p;
        if (tests.every(f => f(abs, n))) {
          if (execCmd) {
            const argv = execCmd.map(x => x === '{}' ? shown : x);
            runCommand(argv, ctx);
          } else if (del_) toDelete.push(abs);
          else ctx.out(shown + '\n');
        }
      }, 0, (abs) => { ctx.err(`find: '${p === '/' ? abs : p.replace(/\/$/, '') + abs.slice(absP.length)}': ${E_ACCES}\n`); code = 1; });
    }
    toDelete.reverse().forEach(x => { const r = lookup(S, x, false); if (!r.err && r.parent && (r.node.t !== 'd' || !Object.keys(r.node.c).length)) delete r.parent.c[r.name]; });
    return code;
  });
  def('file', (a, ctx) => {
    const S = ctx.S;
    if (!a.length) { ctx.err('Modo de empleo: file [-bchikLlNnprsSvzZ0] [archivo]...\n'); return 1; }
    for (const f of a) {
      const r = get(S, f, false);
      if (r.err) { ctx.out(`${f}: cannot open \`${f}' (${r.err})\n`); continue; }
      const n = r.node;
      let d;
      if (n.t === 'd') d = 'directory';
      else if (n.t === 'l') d = `symbolic link to ${n.target}`;
      else if (n.dev === 'disk') d = 'block special';
      else if (n.dev) d = 'character special';
      else if (!can(S, n, 4)) d = `regular file, no read permission`;
      else if (!n.data.length) d = 'empty';
      else if (n.data.startsWith('\x7fELF')) d = 'ELF 64-bit LSB pie executable, x86-64, dynamically linked';
      else if (n.data.startsWith('\x00TAR')) d = 'POSIX tar archive (GNU)';
      else if (n.data.startsWith('\x00GZ')) d = 'gzip compressed data';
      else if (/^#!.*(bash|sh)/.test(n.data)) d = 'Bourne-Again shell script, ' + (/[^\x00-\x7f]/.test(n.data) ? 'Unicode text, UTF-8 text' : 'ASCII text') + ' executable';
      else if (/^#!.*python/.test(n.data)) d = 'Python script, ASCII text executable';
      else if (/^<!DOCTYPE html|<html/i.test(n.data)) d = 'HTML document, ' + (/[^\x00-\x7f]/.test(n.data) ? 'Unicode text, UTF-8 text' : 'ASCII text');
      else if (/^[^,\n]+(,[^,\n]+)+\n/.test(n.data) && f.endsWith('.csv')) d = 'CSV ASCII text';
      else d = /[^\x00-\x7f]/.test(n.data) ? 'Unicode text, UTF-8 text' : 'ASCII text';
      ctx.out(`${f}: ${d}\n`);
    }
  });
  def('stat', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'Lf', 'c', { format: 'c' });
    let code = 0;
    for (const f of rest) {
      const r = get(S, f, !!o.L);
      if (r.err) { ctx.err(`stat: no se puede efectuar \`stat' sobre '${f}': ${r.err}\n`); code = 1; continue; }
      const n = r.node;
      const u = S.users[n.owner] || { uid: 0 }, g = S.groups[n.group] || { gid: 0 };
      if (o.c) {
        ctx.out(o.c.replace(/%a/g, (n.mode & 0o7777).toString(8)).replace(/%A/g, modeStr(n)).replace(/%U/g, n.owner).replace(/%G/g, n.group).replace(/%s/g, fsize(n)).replace(/%i/g, n.ino).replace(/%n/g, f).replace(/%h/g, n.nlink) + '\n');
        continue;
      }
      const tipo = n.t === 'd' ? 'directorio' : n.t === 'l' ? 'enlace simbólico' : n.dev ? 'fichero especial' : fsize(n) ? 'fichero regular' : 'fichero regular vacío';
      ctx.out(`  Fichero: ${f}${n.t === 'l' ? ' -> ' + n.target : ''}\n  Tamaño: ${pad(fsize(n), 10)}\tBloques: ${Math.ceil(fsize(n) / 512)}          Bloque E/S: 4096   ${tipo}\nDispositivo: 8,1\tNodo-i: ${n.ino}        Enlaces: ${n.t === 'd' ? 2 + Object.values(n.c).filter(x => x.t === 'd').length : n.nlink}\n  Acceso: (${(n.mode & 0o7777).toString(8).padStart(4, '0')}/${modeStr(n)})  Uid: (${pad(u.uid, 5, true)}/${pad(n.owner, 8)})   Gid: (${pad(g.gid, 5, true)}/${pad(n.group, 8)})\n  Acceso: ${fullDate(n.mtime)}\nModificación: ${fullDate(n.mtime)}\n  Cambio: ${fullDate(n.mtime)}\n`);
    }
    return code;
  });
  def('ln', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'sfvn', '', { symbolic: 's', force: 'f' });
    if (!rest.length) { ctx.err('ln: falta un operando de archivo\n'); return 1; }
    const target = rest[0];
    let linkName = rest[1] || basename(target);
    let la = abspath(S, linkName);
    const lr = lookup(S, la);
    if (!lr.err && lr.node.t === 'd') { la = norm(la + '/' + basename(target)); }
    const ex = lookup(S, la, false);
    if (!ex.err) { if (o.f) delete ex.parent.c[ex.name]; else { ctx.err(`ln: no se pudo crear el enlace ${o.s ? 'simbólico ' : 'duro '}'${linkName}': El archivo ya existe\n`); return 1; } }
    const pr = lookup(S, dirname(la));
    if (pr.err) { ctx.err(`ln: no se pudo crear el enlace '${linkName}': ${pr.err}\n`); return 1; }
    if (!can(S, pr.node, 2)) { ctx.err(`ln: no se pudo crear el enlace '${linkName}': ${E_ACCES}\n`); return 1; }
    if (o.s) {
      pr.node.c[basename(la)] = mk(S, 'l', S.user, primaryGroup(S, S.user), 0o777, { target });
    } else {
      const tr = get(S, target, false);
      if (tr.err) { ctx.err(`ln: fallo al acceder a '${target}': ${tr.err}\n`); return 1; }
      if (tr.node.t === 'd') { ctx.err(`ln: '${target}': no se permiten enlaces duros para directorios\n`); return 1; }
      tr.node.nlink++;
      pr.node.c[basename(la)] = tr.node;
    }
    if (o.v) ctx.out(`'${linkName}' -> '${target}'\n`);
    return 0;
  });
  function applyMode(mode, spec, isDir) {
    if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
    for (const clause of spec.split(',')) {
      const m = clause.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/);
      if (!m) return null;
      let who = m[1] || 'a';
      if (who.includes('a')) who = 'ugo';
      let bits = 0;
      for (const c of m[3]) bits |= c === 'r' ? 4 : c === 'w' ? 2 : (c === 'x' || (c === 'X' && (isDir || (mode & 0o111)))) ? 1 : 0;
      let mask = 0, sp = 0;
      for (const w of who) { const sh = w === 'u' ? 6 : w === 'g' ? 3 : 0; mask |= bits << sh; if (m[2] === '=') sp |= 7 << sh; }
      if (m[3].includes('t')) mask |= 0o1000;
      if (m[2] === '+') mode |= mask;
      else if (m[2] === '-') mode &= ~mask;
      else mode = (mode & ~sp) | mask;
    }
    return mode;
  }
  def('chmod', (a, ctx) => {
    const S = ctx.S;
    const o = {};
    const args = [];
    for (const x of a) { if (/^-[Rvc]+$/.test(x)) { for (const c of x.slice(1)) o[c] = true; } else if (x === '--recursive') o.R = true; else args.push(x); }
    if (args.length < 2) { ctx.err(`chmod: falta un operando${args.length ? ' después de «' + args[0] + '»' : ''}\nPruebe 'chmod --help' para más información.\n`); return 1; }
    const spec = args[0];
    let code = 0;
    for (const f of args.slice(1)) {
      const r = get(S, f);
      if (r.err) { ctx.err(`chmod: no se puede acceder a '${f}': ${r.err}\n`); code = 1; continue; }
      const apply = (n, name) => {
        if (S.user !== 'root' && n.owner !== S.user) { ctx.err(`chmod: cambiando los permisos de '${name}': ${E_PERM}\n`); code = 1; return; }
        const nm = applyMode(n.mode & 0o7777, spec, n.t === 'd');
        if (nm === null) { ctx.err(`chmod: modo inválido: «${spec}»\n`); code = 1; return; }
        if (o.v || (o.c && nm !== n.mode)) ctx.out(`el modo de '${name}' cambia de ${(n.mode & 0o7777).toString(8).padStart(4, '0')} (${modeStr(n).slice(1)}) a ${nm.toString(8).padStart(4, '0')} (${modeStr({ t: 'f', mode: nm }).slice(1)})\n`);
        n.mode = nm;
      };
      if (o.R) walk(S, abspath(S, f), r.node, (p, n) => apply(n, p)); else apply(r.node, f);
    }
    return code;
  });
  function chownImpl(a, ctx, onlyGroup) {
    const S = ctx.S;
    const name = onlyGroup ? 'chgrp' : 'chown';
    const { o, rest } = getopt(a, 'Rvh', '', { recursive: 'R' });
    if (rest.length < 2) { ctx.err(`${name}: falta un operando\n`); return 1; }
    let user = null, group = null;
    if (onlyGroup) group = rest[0];
    else { const m = rest[0].split(/[:.]/); user = m[0] || null; group = m.length > 1 ? (m[1] || (user ? primaryGroup(S, user) : null)) : null; }
    if (user && !S.users[user]) { ctx.err(`${name}: usuario inválido: «${rest[0]}»\n`); return 1; }
    if (group && !S.groups[group]) { ctx.err(`${name}: grupo inválido: «${rest[0]}»\n`); return 1; }
    let code = 0;
    for (const f of rest.slice(1)) {
      const r = get(S, f);
      if (r.err) { ctx.err(`${name}: no se puede acceder a '${f}': ${r.err}\n`); code = 1; continue; }
      const apply = (n, nm) => {
        const allowed = S.user === 'root' || (!user && n.owner === S.user && inGroup(S, S.user, group));
        if (!allowed) { ctx.err(`${name}: cambiando el propietario de '${nm}': ${E_PERM}\n`); code = 1; return; }
        if (user) n.owner = user;
        if (group) n.group = group;
      };
      if (o.R) walk(S, abspath(S, f), r.node, (p, n) => apply(n, p)); else apply(r.node, f);
    }
    return code;
  }
  def('chown', (a, ctx) => chownImpl(a, ctx, false));
  def('chgrp', (a, ctx) => chownImpl(a, ctx, true));
  def('umask', (a, ctx) => {
    if (!a.length) { ctx.out(ctx.S.umask.toString(8).padStart(4, '0') + '\n'); return; }
    if (a[0] === '-S') { const m = ~ctx.S.umask & 0o777; ctx.out(`u=${rwx(m >> 6)},g=${rwx(m >> 3)},o=${rwx(m)}\n`); return; }
    if (!/^[0-7]{1,4}$/.test(a[0])) { ctx.err(`bash: umask: ${a[0]}: número octal fuera de rango\n`); return 1; }
    ctx.S.umask = parseInt(a[0], 8);
  });
  function rwx(b) { return (b & 4 ? 'r' : '') + (b & 2 ? 'w' : '') + (b & 1 ? 'x' : ''); }

  // ---- usuarios ----
  def('whoami', (a, ctx) => { ctx.out(ctx.S.user + '\n'); });
  def('id', (a, ctx) => {
    const S = ctx.S;
    const u = a.filter(x => !x.startsWith('-'))[0] || S.user;
    if (!S.users[u]) { ctx.err(`id: «${u}»: no existe ese usuario\n`); return 1; }
    const info = S.users[u];
    const pg = primaryGroup(S, u);
    const gs = [[pg, S.groups[pg]?.gid ?? info.gid]].concat(Object.entries(S.groups).filter(([n, g]) => g.members.includes(u) && n !== pg).map(([n, g]) => [n, g.gid]));
    if (a.includes('-u')) { ctx.out(info.uid + '\n'); return; }
    if (a.includes('-g')) { ctx.out(info.gid + '\n'); return; }
    if (a.includes('-G')) { ctx.out(gs.map(g => g[1]).join(' ') + '\n'); return; }
    if (a.includes('-un') || a.includes('-nu')) { ctx.out(u + '\n'); return; }
    if (a.includes('-Gn') || a.includes('-nG')) { ctx.out(gs.map(g => g[0]).join(' ') + '\n'); return; }
    ctx.out(`uid=${info.uid}(${u}) gid=${info.gid}(${pg}) grupos=${gs.map(g => `${g[1]}(${g[0]})`).join(',')}\n`);
  });
  def('groups', (a, ctx) => {
    const S = ctx.S;
    const users = a.length ? a : [S.user];
    for (const u of users) {
      if (!S.users[u]) { ctx.err(`groups: «${u}»: no existe ese usuario\n`); return 1; }
      const pg = primaryGroup(S, u);
      const gs = [pg].concat(Object.entries(S.groups).filter(([n, g]) => g.members.includes(u) && n !== pg).map(([n]) => n));
      ctx.out((a.length ? u + ' : ' : '') + gs.join(' ') + '\n');
    }
  });
  def('who w users', (a, ctx) => {
    ctx.out(`estudiante pts/0        ${new Date(ctx.S.bootTime + 51 * 60e3).toISOString().slice(0, 16).replace('T', ' ')} (192.168.1.15)\nprofesor  pts/1        ${new Date(ctx.S.bootTime + 60 * 60e3).toISOString().slice(0, 16).replace('T', ' ')} (192.168.1.40)\n`);
  });
  def('sudo', (a, ctx) => {
    const S = ctx.S;
    if (!a.length) { ctx.err('uso: sudo -h | -K | -k | -V\nuso: sudo [-u usuario] orden\n'); return 1; }
    if (S.user !== 'root' && !inGroup(S, S.user, 'sudo')) { ctx.err(`${S.user} no está en el archivo sudoers. Se informará de este incidente.\n`); return 1; }
    let args = a.slice();
    let asUser = 'root';
    if (args[0] === '-u') { asUser = args[1]; args = args.slice(2); }
    if (args[0] === '-i' || args[0] === '-s' || (args[0] === 'su' && (args.length === 1 || args[1] === '-'))) {
      S.userStack.push({ user: S.user, cwd: S.cwd });
      S.user = 'root';
      if (args[0] !== '-s') S.cwd = '/root';
      return 0;
    }
    if (args[0] === '-l') { ctx.out(`El usuario ${S.user} puede ejecutar los siguientes comandos en ${HOST}:\n    (ALL : ALL) ALL\n`); return 0; }
    if (!S.users[asUser]) { ctx.err(`sudo: usuario desconocido ${asUser}\n`); return 1; }
    if (!args.length) return 0;
    const prev = S.user;
    S.user = asUser;
    try { return runCommand(args, ctx); }
    finally { if (S.user === asUser) S.user = prev; }
  });
  def('su', (a, ctx) => {
    const S = ctx.S;
    const login = a.includes('-') || a.includes('-l') || a.includes('--login');
    const user = a.filter(x => !x.startsWith('-'))[0] || 'root';
    if (!S.users[user]) { ctx.err(`su: el usuario ${user} no existe o la entrada de usuario no contiene todos los campos requeridos\n`); return 1; }
    if (S.users[user].shell.includes('nologin')) { ctx.out('This account is currently not available.\n'); return 1; }
    if (S.user !== 'root' && user === 'root') { ctx.err('Contraseña: \nsu: Fallo de autenticación\n' + (ctx.tty ? C.dim + '(En Ubuntu la cuenta root no tiene contraseña. Usa «sudo -i» o «sudo su» para obtener un shell de root.)' + C.off + '\n' : '')); return 1; }
    if (S.user !== 'root') ctx.out(ctx.tty ? C.dim + 'Contraseña: (simulada: se acepta automáticamente)' + C.off + '\n' : '');
    S.userStack.push({ user: S.user, cwd: S.cwd });
    S.user = user;
    if (login) S.cwd = S.users[user].home;
    return 0;
  });
  def('exit logout', (a, ctx) => {
    if (ctx.script) throw new ExitSignal(parseInt(a[0], 10) || 0);
    const S = ctx.S;
    if (S.userStack.length) { const p = S.userStack.pop(); S.user = p.user; S.cwd = p.cwd; ctx.out('exit\n'); return 0; }
    ctx.out('logout\n' + (ctx.tty ? C.dim + '(Esta es tu sesión principal; en el simulador no se cierra.)' + C.off + '\n' : ''));
    return 0;
  });
  function nextUid(S) { let u = 1000; const used = new Set(Object.values(S.users).map(x => x.uid).concat(Object.values(S.groups).map(g => g.gid))); while (used.has(u)) u++; return u; }
  def('useradd adduser', (a, ctx) => {
    const S = ctx.S;
    const name = ctx.log[ctx.log.length - 1].name;
    needRoot(ctx);
    const { o, rest } = getopt(a, 'mMr', 'sGgcd', { 'create-home': 'm', shell: 's', groups: 'G' });
    const u = rest[0];
    if (!u) { ctx.err(`Modo de empleo: ${name} [opciones] USUARIO\n`); return 2; }
    if (!/^[a-z_][a-z0-9_-]*$/.test(u)) { ctx.err(`${name}: nombre de usuario «${u}» inválido\n`); return 3; }
    if (S.users[u]) { ctx.err(`${name}: el usuario «${u}» ya existe\n`); return 9; }
    const uid = nextUid(S);
    S.groups[u] = { gid: uid, members: [] };
    const home = o.d || '/home/' + u;
    S.users[u] = { uid, gid: uid, home, shell: o.s || (name === 'adduser' ? '/bin/bash' : '/bin/sh'), gecos: ',,,' };
    if (o.G) for (const g of o.G.split(',')) { if (!S.groups[g]) { ctx.err(`useradd: el grupo «${g}» no existe\n`); continue; } S.groups[g].members.push(u); }
    if (o.m || name === 'adduser') {
      put(S, home.slice(1), null, { owner: u, mode: 0o750 });
      put(S, home.slice(1) + '/.bashrc', S.root.c.etc.c.skel.c['.bashrc'].data, { owner: u });
      put(S, home.slice(1) + '/.profile', S.root.c.etc.c.skel.c['.profile'].data, { owner: u });
    }
    if (name === 'adduser') ctx.out(`info: Añadiendo el usuario «${u}» ...\ninfo: Añadiendo el nuevo grupo «${u}» (${uid}) ...\ninfo: Añadiendo el nuevo usuario «${u}» (${uid}) con grupo «${u} (${uid})» ...\ninfo: Creando el directorio personal «${home}» ...\ninfo: Copiando los ficheros desde «/etc/skel» ...\nNueva contraseña: (simulada)\npasswd: contraseña actualizada correctamente\n`);
    syncEtc(S);
    return 0;
  });
  def('userdel deluser', (a, ctx) => {
    const S = ctx.S;
    needRoot(ctx);
    const { o, rest } = getopt(a, 'rf', '', { remove: 'r', 'remove-home': 'r' });
    const u = rest[0];
    if (!S.users[u]) { ctx.err(`userdel: el usuario «${u}» no existe\n`); return 6; }
    if (u === 'root' || u === 'estudiante') { ctx.err(`userdel: el usuario ${u} está conectado actualmente (el simulador no permite borrarlo)\n`); return 8; }
    if (o.r) del(S, S.users[u].home);
    delete S.users[u];
    if (S.groups[u] && !S.groups[u].members.length) delete S.groups[u];
    Object.values(S.groups).forEach(g => g.members = g.members.filter(m => m !== u));
    syncEtc(S);
  });
  def('groupadd addgroup', (a, ctx) => {
    const S = ctx.S;
    needRoot(ctx);
    const g = a.filter(x => !x.startsWith('-'))[0];
    if (!g) { ctx.err('Modo de empleo: groupadd [opciones] GRUPO\n'); return 2; }
    if (S.groups[g]) { ctx.err(`groupadd: el grupo «${g}» ya existe\n`); return 9; }
    S.groups[g] = { gid: nextUid(S), members: [] };
    syncEtc(S);
  });
  def('groupdel', (a, ctx) => { needRoot(ctx); const g = a[0]; if (!ctx.S.groups[g]) { ctx.err(`groupdel: el grupo «${g}» no existe\n`); return 6; } delete ctx.S.groups[g]; syncEtc(ctx.S); });
  def('usermod', (a, ctx) => {
    const S = ctx.S;
    needRoot(ctx);
    const { o, rest } = getopt(a, 'aL U', 'Ggsdl', { append: 'a', groups: 'G', shell: 's' });
    const u = rest[0];
    if (!S.users[u]) { ctx.err(`usermod: el usuario «${u}» no existe\n`); return 6; }
    if (o.G) {
      const gs = o.G.split(',');
      for (const g of gs) if (!S.groups[g]) { ctx.err(`usermod: el grupo «${g}» no existe\n`); return 6; }
      if (!o.a) Object.values(S.groups).forEach(g => g.members = g.members.filter(m => m !== u));
      gs.forEach(g => { if (!S.groups[g].members.includes(u)) S.groups[g].members.push(u); });
    }
    if (o.s) S.users[u].shell = o.s;
    if (o.g) { if (!S.groups[o.g]) { ctx.err(`usermod: el grupo «${o.g}» no existe\n`); return 6; } S.users[u].gid = S.groups[o.g].gid; }
    syncEtc(S);
  });
  def('gpasswd', (a, ctx) => {
    const S = ctx.S; needRoot(ctx);
    if (a[0] === '-a' && S.users[a[1]] && S.groups[a[2]]) { if (!S.groups[a[2]].members.includes(a[1])) S.groups[a[2]].members.push(a[1]); ctx.out(`Añadiendo al usuario ${a[1]} al grupo ${a[2]}\n`); syncEtc(S); return 0; }
    if (a[0] === '-d' && S.groups[a[2]]) { S.groups[a[2]].members = S.groups[a[2]].members.filter(m => m !== a[1]); ctx.out(`Eliminando al usuario ${a[1]} del grupo ${a[2]}\n`); syncEtc(S); return 0; }
    ctx.err('Modo de empleo: gpasswd [-a USUARIO | -d USUARIO] GRUPO\n'); return 2;
  });
  def('passwd', (a, ctx) => {
    const S = ctx.S;
    const u = a.filter(x => !x.startsWith('-'))[0] || S.user;
    if (u !== S.user && S.user !== 'root') { ctx.err(`passwd: No puede ver o modificar la información de la contraseña para ${u}.\n`); return 1; }
    if (!S.users[u]) { ctx.err(`passwd: el usuario «${u}» no existe\n`); return 1; }
    ctx.out(`${S.user !== 'root' ? 'Cambiando la contraseña de ' + u + '.\nContraseña actual: (simulada)\n' : ''}Nueva contraseña: (simulada)\nVuelva a escribir la nueva contraseña: (simulada)\npasswd: contraseña actualizada correctamente\n`);
  });
  def('chsh', (a, ctx) => { ctx.out('Contraseña: (simulada)\n'); });

  // ---- procesos ----
  function procsVisible(S) { reapProcs(S); return S.procs; }
  function procName(p) { if (p.pid === 1) return 'systemd'; if (p.cmd.startsWith('[')) return p.cmd.slice(1, p.cmd.indexOf(']')); return p.cmd.split(' ')[0].replace(/^-/, '').replace(/:$/, '').split('/').pop(); }
  function cpuTime(p) { const s = Math.floor((p.cpu || 0) * 7 + (p.pid % 13)); return `00:${two(Math.floor(s / 60))}:${two(s % 60)}`; }
  def('ps', (a, ctx) => {
    const S = ctx.S;
    const ps = procsVisible(S);
    const joined = a.join(' ');
    const self = { pid: S.nextPid++, ppid: S.shellPid, user: S.user, cmd: 'ps ' + joined, state: 'R', cpu: 0, mem: 0.0, nice: 0, tty: 'pts/0', start: hhmm(), vsz: 11000, rss: 4200 };
    const all = ps.concat([self]).sort((x, y) => x.pid - y.pid);
    const statStr = p => p.state + (p.nice > 0 ? 'N' : p.nice < 0 ? '<' : '') + (p.pid === S.shellPid ? 's' : '') + (p.job ? '' : p.tty === 'pts/0' && p.pid !== S.shellPid ? '+' : '');
    let uFilter = null;
    const um = joined.match(/-u\s+(\S+)/);
    if (um) uFilter = um[1];
    if (/(^|\s)-?aux\b|(^|\s)aux/.test(joined) || /^-?ax/.test(joined)) {
      let out = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
      for (const p of all) out += `${pad(p.user.slice(0, 8), 8)} ${pad(p.pid, 7, true)} ${pad(p.cpu.toFixed(1), 4, true)} ${pad(p.mem.toFixed(1), 4, true)} ${pad(p.vsz, 6, true)} ${pad(p.rss, 5, true)} ${pad(p.tty, 8)} ${pad(statStr(p), 4)} ${p.start}   ${cpuTime(p).slice(3)} ${p.cmd}\n`;
      ctx.out(out); return 0;
    }
    if (/-e|-A/.test(joined)) {
      const full = /f/.test(joined);
      const long = /l/.test(joined.replace('-e', ''));
      let out = full ? 'UID          PID    PPID  C STIME TTY          TIME CMD\n' : long ? 'F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD\n' : '    PID TTY          TIME CMD\n';
      for (const p of all) {
        if (full) out += `${pad(p.user.slice(0, 8), 8)} ${pad(p.pid, 7, true)} ${pad(p.ppid, 7, true)}  ${Math.round(p.cpu)} ${p.start} ${pad(p.tty, 8)} ${cpuTime(p)} ${p.cmd}\n`;
        else if (long) out += `4 ${p.state} ${pad(S.users[p.user]?.uid ?? 0, 5, true)} ${pad(p.pid, 7, true)} ${pad(p.ppid, 7, true)}  0 ${pad(80 + p.nice, 3, true)} ${pad(p.nice, 3, true)} -  ${pad(Math.round(p.vsz / 4), 5, true)} -      ${pad(p.tty, 8)} ${cpuTime(p)} ${p.cmd.split(' ')[0].split('/').pop()}\n`;
        else out += `${pad(p.pid, 7, true)} ${pad(p.tty, 8)} ${cpuTime(p)} ${procName(p)}\n`;
      }
      ctx.out(out); return 0;
    }
    const mine = all.filter(p => uFilter ? p.user === uFilter : (p.tty === 'pts/0'));
    if (/-l|l/.test(joined) && !uFilter) {
      let out = 'F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD\n';
      for (const p of mine) out += `0 ${p.state} ${pad(S.users[p.user]?.uid ?? 0, 5, true)} ${pad(p.pid, 7, true)} ${pad(p.ppid, 7, true)}  0 ${pad(80 + p.nice, 3, true)} ${pad(p.nice, 3, true)} -  ${pad(Math.round(p.vsz / 4), 5, true)} -      ${pad(p.tty, 8)} ${cpuTime(p)} ${procName(p)}\n`;
      ctx.out(out); return 0;
    }
    if (/-f/.test(joined)) {
      let out = 'UID          PID    PPID  C STIME TTY          TIME CMD\n';
      for (const p of mine) out += `${pad(p.user.slice(0, 8), 8)} ${pad(p.pid, 7, true)} ${pad(p.ppid, 7, true)}  0 ${p.start} ${pad(p.tty, 8)} ${cpuTime(p)} ${p.cmd}\n`;
      ctx.out(out); return 0;
    }
    let out = '    PID TTY          TIME CMD\n';
    for (const p of mine) out += `${pad(p.pid, 7, true)} ${pad(p.tty, 8)} ${cpuTime(p)} ${procName(p)}\n`;
    ctx.out(out);
  });
  def('top htop', (a, ctx) => {
    const S = ctx.S;
    const ps = procsVisible(S).slice();
    const name = ctx.log[ctx.log.length - 1].name;
    ps.forEach(p => { p._c = p.cpu > 50 ? p.cpu - Math.random() * 2 : p.cpu + Math.random() * 0.4; });
    ps.sort((x, y) => y._c - x._c);
    const up = Math.floor((Date.now() - S.bootTime) / 60000);
    const tasks = ps.length, run = ps.filter(p => p.state === 'R' || p.cpu > 50).length, stop = ps.filter(p => p.state === 'T').length, zomb = ps.filter(p => p.state === 'Z').length;
    const us = Math.min(99, ps.reduce((s, p) => s + p._c, 0) / 4).toFixed(1);
    let out = `top - ${hhmm()}:${two(new Date().getSeconds())} up ${Math.floor(up / 60)}:${two(up % 60)},  2 users,  load average: ${(us / 25).toFixed(2)}, 0.48, 0.31\n`;
    out += `Tareas: ${pad(tasks, 3, true)} total,  ${run} ejecutar,  ${tasks - run - stop - zomb} hibernar,  ${stop} detener,  ${zomb} zombie\n`;
    out += `%Cpu(s): ${pad(us, 4, true)} us,  0.8 sy,  ${ps.some(p => p.nice > 0 && p.cpu > 1) ? '3.0' : '0.0'} ni, ${pad((100 - us - 0.8).toFixed(1), 4, true)} id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st\n`;
    out += `MiB Mem :   7846.2 total,   2797.1 free,   2610.4 used,   2438.7 buff/cache\nMiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   5196.8 avail Mem\n\n`;
    out += (ctx.tty ? '\x1b[7m' : '') + '    PID USUARIO   PR  NI    VIRT    RES  S  %CPU  %MEM     HORA+ ORDEN     ' + (ctx.tty ? C.off : '') + '\n';
    for (const p of ps.slice(0, 16)) {
      const line = `${pad(p.pid, 7, true)} ${pad(p.user.slice(0, 9), 9)} ${pad(20 + p.nice, 3, true)} ${pad(p.nice, 3, true)} ${pad(p.vsz, 7, true)} ${pad(p.rss, 6, true)}  ${p.state}  ${pad(p._c.toFixed(1), 4, true)}  ${pad(p.mem.toFixed(1), 4, true)}   ${cpuTime(p).slice(3)}.${two(p.pid % 100)} ${procName(p)}`;
      out += (p._c > 50 && ctx.tty ? C.bold + line + C.off : line) + '\n';
    }
    ps.forEach(p => delete p._c);
    if (ctx.tty) out += C.dim + `(Instantánea de ${name}. En un sistema real se actualiza cada 3 s; se sale con la tecla q. Atajos útiles: k = matar, r = renice, P = ordenar por CPU, M = por memoria.)` + C.off + '\n';
    ctx.out(out);
  });
  const SIGS = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15, STOP: 19, CONT: 18, TSTP: 20, USR1: 10, USR2: 12 };
  function sigNum(s) {
    if (/^\d+$/.test(s)) return +s;
    s = s.toUpperCase().replace(/^SIG/, '');
    return SIGS[s];
  }
  function signalProc(S, p, sig, ctx, label) {
    if (S.user !== 'root' && p.user !== S.user) { ctx.err(`bash: kill: (${p.pid}) - ${E_PERM}\n`); return 1; }
    if (p.pid === 1 || p.pid === 2 || p.cmd.startsWith('[')) { return 0; } // init y los hilos del kernel ignoran señales
    const record = { pid: p.pid, sig, cmd: p.cmd, user: p.user };
    (S.killed = S.killed || []).push(record);
    if (sig === 0) return 0;
    if (p.state === 'Z') return 0; // un zombi ya está muerto: ninguna señal le afecta
    if (sig === 19 || sig === 20) { p.state = 'T'; const j = S.jobs.find(j => j.pid === p.pid); if (j) j.state = 'Detenido'; return 0; }
    if (sig === 18) { p.state = p.cpu > 50 ? 'R' : 'S'; const j = S.jobs.find(j => j.pid === p.pid); if (j) j.state = 'Ejecutando'; return 0; }
    if (sig === 10 || sig === 12) return 0;
    if (p.ignoreTerm && sig !== 9) { return 0; }
    if (p.pid === S.shellPid) { if (sig === 9) ctx.out(ctx.tty ? C.dim + '(Acabas de intentar matar tu propio shell. En un sistema real se cerraría la sesión. Aquí lo ignoramos.)' + C.off + '\n' : ''); return 0; }
    S.procs = S.procs.filter(x => x.pid !== p.pid && !(x.ppid === p.pid && x.state === 'Z'));
    const kids = S.procs.filter(x => x.ppid === p.pid);
    kids.forEach(k => k.ppid = 1);
    const j = S.jobs.find(j => j.pid === p.pid);
    if (j) { j.state = sig === 9 ? 'Terminado (killed)' : 'Terminado'; j.notify = true; }
    for (const [svc, info] of Object.entries(S.services)) if (info.pid === p.pid) { info.active = false; info.failed = true; }
    return 0;
  }
  def('kill', (a, ctx) => {
    const S = ctx.S;
    reapProcs(S);
    if (!a.length) { ctx.err('kill: modo de empleo: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... o kill -l [sigspec]\n'); return 2; }
    if (a[0] === '-l' || a[0] === '-L') { ctx.out(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE\t 9) SIGKILL\t10) SIGUSR1\n11) SIGSEGV\t12) SIGUSR2\t13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\n17) SIGCHLD\t18) SIGCONT\t19) SIGSTOP\t20) SIGTSTP\t21) SIGTTIN\n'); return 0; }
    let sig = 15, i = 0;
    if (a[0] === '-s' || a[0] === '-n') { sig = sigNum(a[1]); i = 2; }
    else if (a[0].startsWith('-')) { sig = sigNum(a[0].slice(1)); i = 1; }
    if (sig === undefined) { ctx.err(`bash: kill: ${a[i - 1]}: especificación de señal inválida\n`); return 1; }
    let code = 0;
    for (const t of a.slice(i)) {
      let pid;
      if (t.startsWith('%')) {
        const j = S.jobs.find(j => j.id === parseInt(t.slice(1), 10) && !/Hecho|Terminado/.test(j.state));
        if (!j) { ctx.err(`bash: kill: ${t}: no existe ese trabajo\n`); code = 1; continue; }
        pid = j.pid;
      } else pid = parseInt(t, 10);
      if (isNaN(pid)) { ctx.err(`bash: kill: ${t}: los argumentos deben ser IDs de procesos o trabajos\n`); code = 1; continue; }
      const p = S.procs.find(p => p.pid === pid);
      if (!p) { ctx.err(`bash: kill: (${pid}) - No existe el proceso\n`); code = 1; continue; }
      code = signalProc(S, p, sig, ctx) || code;
    }
    return code;
  });
  def('killall pkill', (a, ctx) => {
    const S = ctx.S;
    reapProcs(S);
    const name = ctx.log[ctx.log.length - 1].name;
    let sig = 15; let args = a;
    if (args[0] && args[0].startsWith('-') && args[0] !== '-u' && args[0] !== '-f') { sig = sigNum(args[0].slice(1)); args = args.slice(1); }
    if (args[0] === '-s') { sig = sigNum(args[1]); args = args.slice(2); }
    const full = args[0] === '-f'; if (full) args = args.slice(1);
    const pat = args[0];
    if (!pat) { ctx.err(`${name}: falta el nombre del proceso\n`); return 2; }
    const matches = S.procs.filter(p => { const base = p.cmd.split(' ')[0].split('/').pop(); return name === 'killall' ? (base === pat || p.cmd.split(' ').some(w => w.split('/').pop() === pat)) : (full ? p.cmd.includes(pat) : base.includes(pat) || p.cmd.includes(pat)); });
    if (!matches.length) { if (name === 'killall') ctx.err(`${pat}: no se ha encontrado ningún proceso\n`); return 1; }
    let code = 0;
    matches.forEach(p => { if (S.user !== 'root' && p.user !== S.user) { if (name === 'killall') ctx.err(`${pat}(${p.pid}): ${E_PERM}\n`); code = 1; return; } signalProc(S, p, sig, ctx); });
    return code;
  });
  def('pgrep pidof', (a, ctx) => {
    const S = ctx.S; reapProcs(S);
    const l = a.includes('-l'), u = a.indexOf('-u');
    const pat = a.filter((x, i) => !x.startsWith('-') && i !== u + 1 || (u < 0 && !x.startsWith('-')))[0];
    let ms = S.procs.filter(p => !pat || p.cmd.includes(pat));
    if (u >= 0) ms = ms.filter(p => p.user === a[u + 1]);
    if (!ms.length) return 1;
    ctx.out(ms.map(p => l ? `${p.pid} ${p.cmd.split(' ')[0].split('/').pop()}` : p.pid).join(ctx.log[ctx.log.length - 1].name === 'pidof' ? ' ' : '\n') + '\n');
  });
  def('jobs', (a, ctx) => {
    const S = ctx.S;
    reapProcs(S);
    const showPid = a.includes('-l');
    const active = S.jobs.filter(j => !j.shown);
    active.forEach((j, idx) => {
      const mark = idx === active.length - 1 ? '+' : idx === active.length - 2 ? '-' : ' ';
      ctx.out(`[${j.id}]${mark}  ${showPid ? j.pid + ' ' : ''}${pad(j.state, 22)} ${j.cmd}${j.state === 'Ejecutando' ? ' &' : ''}\n`);
      if (/Hecho|Terminado/.test(j.state)) j.shown = true;
    });
  });
  def('fg', (a, ctx) => {
    const S = ctx.S; reapProcs(S);
    const id = a[0] ? parseInt(a[0].replace('%', ''), 10) : null;
    const j = (id ? S.jobs.filter(j => j.id === id) : S.jobs.slice().reverse()).find(j => !/Hecho|Terminado/.test(j.state));
    if (!j) { ctx.err(`bash: fg: ${a[0] || 'actual'}: no existe ese trabajo\n`); return 1; }
    ctx.out(j.cmd + '\n');
    const p = S.procs.find(p => p.pid === j.pid);
    if (p) { p.state = 'S'; }
    ctx.out(ctx.tty ? C.dim + '(El trabajo está ahora en primer plano y bloquearía la terminal hasta terminar. Simulamos que pulsas Ctrl+C: se envía SIGINT.)' + C.off + '\n^C\n' : '');
    if (p) signalProc(S, p, 2, ctx);
    j.state = 'Terminado'; j.shown = true;
    return 130;
  });
  def('bg', (a, ctx) => {
    const S = ctx.S;
    const id = a[0] ? parseInt(a[0].replace('%', ''), 10) : null;
    const j = (id ? S.jobs.filter(j => j.id === id) : S.jobs.slice().reverse()).find(j => j.state === 'Detenido');
    if (!j) { ctx.err(`bash: bg: el trabajo ya está en segundo plano o no existe\n`); return 1; }
    const p = S.procs.find(p => p.pid === j.pid);
    if (p) p.state = 'S';
    j.state = 'Ejecutando';
    ctx.out(`[${j.id}]+ ${j.cmd} &\n`);
  });
  def('sleep', (a, ctx) => {
    const d = parseDur(a[0]);
    if (isNaN(d)) { ctx.err(`sleep: falta un operando\n`); return 1; }
    if (d > 3 && ctx.tty && !ctx.script) ctx.out(C.dim + `(sleep ${a[0]} bloquearía la terminal ${a[0]}. Para que corra en segundo plano escribe: sleep ${a[0]} &)` + C.off + '\n');
  });
  def('yes', (a, ctx) => { const s = (a.join(' ') || 'y') + '\n'; ctx.out(s.repeat(ctx.piped ? 200 : 20) + (ctx.tty ? C.dim + '(yes imprime sin parar hasta Ctrl+C; aquí cortamos)' + C.off + '\n' : '')); });
  def('nice', (a, ctx) => {
    if (!a.length) { ctx.out('0\n'); return; }
    let n = 10, rest = a;
    if (a[0] === '-n') { n = parseInt(a[1], 10); rest = a.slice(2); }
    else if (/^-\-?\d+$/.test(a[0])) { n = parseInt(a[0].slice(1), 10); rest = a.slice(1); }
    if (n < 0 && ctx.S.user !== 'root') { ctx.err('nice: no se puede establecer la prioridad: Permiso denegado\n'); n = 0; }
    if (!rest.length) { ctx.out(n + '\n'); return; }
    return runCommand(rest, ctx);
  });
  def('renice', (a, ctx) => {
    const S = ctx.S; reapProcs(S);
    let n, i = 0, pids = [];
    if (a[0] === '-n') { n = parseInt(a[1], 10); i = 2; } else { n = parseInt(a[0], 10); i = 1; }
    for (; i < a.length; i++) { if (a[i] === '-p') continue; pids.push(parseInt(a[i], 10)); }
    if (isNaN(n) || !pids.length) { ctx.err('renice: modo de empleo: renice [-n] prioridad [-p] pid...\n'); return 1; }
    let code = 0;
    for (const pid of pids) {
      const p = S.procs.find(p => p.pid === pid);
      if (!p) { ctx.err(`renice: fallo al obtener la prioridad de ${pid} (process ID): No existe el proceso\n`); code = 1; continue; }
      if (S.user !== 'root' && (p.user !== S.user || n < p.nice)) { ctx.err(`renice: fallo al establecer la prioridad de ${pid} (process ID): Permiso denegado\n`); code = 1; continue; }
      const old = p.nice;
      p.nice = Math.max(-20, Math.min(19, n));
      ctx.out(`${pid} (process ID) prioridad anterior ${old}, nueva prioridad ${p.nice}\n`);
    }
    return code;
  });
  def('pstree', (a, ctx) => {
    const S = ctx.S; reapProcs(S);
    const showPid = a.includes('-p');
    const nm = p => procName(p) + (showPid ? `(${p.pid})` : '');
    const kids = pid => S.procs.filter(p => p.ppid === pid && p.pid !== pid);
    let out = '';
    const rec = (p, prefix, isLast, root) => {
      out += root ? nm(p) + '\n' : prefix + (isLast ? '└─' : '├─') + nm(p) + '\n';
      const ks = kids(p.pid);
      ks.forEach((k, i) => rec(k, root ? '' : prefix + (isLast ? '  ' : '│ '), i === ks.length - 1, false));
    };
    const init = S.procs.find(p => p.pid === 1);
    rec(init, '', true, true);
    ctx.out(out.replace(/^(.)/gm, '$1'));
  });

  // ---- información del sistema ----
  def('history', (a, ctx) => {
    const S = ctx.S;
    if (a[0] === '-c') { S.history = []; return; }
    const n = parseInt(a[0], 10);
    const h = S.history.map((c, i) => pad(i + 1, 5, true) + '  ' + c);
    ctx.out((n ? h.slice(-n) : h).join('\n') + (h.length ? '\n' : ''));
  });
  def('clear reset', (a, ctx) => { ctx.clear = true; if (ctx.onClear) ctx.onClear(); });
  def('date', (a, ctx) => {
    const d = new Date();
    if (a[0] && a[0].startsWith('+')) {
      const f = a.join(' ').slice(1);
      ctx.out(f.replace(/%([YmdHMSAaBbjuFTsZ%n])/g, (m, c) => ({ Y: d.getFullYear(), m: two(d.getMonth() + 1), d: two(d.getDate()), H: two(d.getHours()), M: two(d.getMinutes()), S: two(d.getSeconds()), A: DAYS_L[d.getDay()], a: DAYS[d.getDay()], B: MONTHS_L[d.getMonth()], b: MONTHS[d.getMonth()], j: String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5)).padStart(3, '0'), u: d.getDay() || 7, F: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, T: `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`, s: Math.floor(d / 1000), Z: '-05', '%': '%', n: '\n' }[c])) + '\n');
      return;
    }
    ctx.out(`${DAYS[d.getDay()]} ${pad(d.getDate(), 2, true)} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} -05\n`);
  });
  def('cal ncal', (a, ctx) => {
    const now = new Date();
    const m = a[0] ? parseInt(a[0], 10) - 1 : now.getMonth(), y = a[1] ? parseInt(a[1], 10) : now.getFullYear();
    const title = `${MONTHS_L[m]} ${y}`;
    let out = pad('', Math.floor((20 - title.length) / 2)) + title + '\nlu ma mi ju vi sá do\n';
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    let line = '   '.repeat(first);
    for (let d = 1; d <= days; d++) {
      const s = pad(d, 2, true);
      line += (ctx.tty && d === now.getDate() && m === now.getMonth() && y === now.getFullYear() ? '\x1b[7m' + s + C.off : s) + ' ';
      if ((first + d) % 7 === 0) { out += line.trimEnd() + '\n'; line = ''; }
    }
    if (line) out += line.trimEnd() + '\n';
    ctx.out(out);
  });
  def('uname', (a, ctx) => {
    const { o } = getopt(a, 'asnrvmoip', '', { all: 'a', 'kernel-name': 's', 'kernel-release': 'r' });
    const info = { s: 'Linux', n: HOST, r: '6.8.0-45-generic', v: '#45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024', m: 'x86_64', p: 'x86_64', i: 'x86_64', o: 'GNU/Linux' };
    if (o.a) { ctx.out(`${info.s} ${info.n} ${info.r} ${info.v} ${info.m} ${info.p} ${info.i} ${info.o}\n`); return; }
    const sel = 'snrvmpio'.split('').filter(k => o[k]);
    ctx.out((sel.length ? sel.map(k => info[k]) : [info.s]).join(' ') + '\n');
  });
  def('hostname', (a, ctx) => {
    if (a[0] === '-I') ctx.out('192.168.1.50 \n');
    else if (a[0] === '-i') ctx.out('127.0.1.1\n');
    else if (a[0] && !a[0].startsWith('-')) { if (ctx.S.user !== 'root') { ctx.err('hostname: no tiene permisos para cambiar el nombre del equipo\n'); return 1; } ctx.out(ctx.tty ? C.dim + '(cambio de nombre simulado)' + C.off + '\n' : ''); }
    else ctx.out(HOST + '\n');
  });
  def('hostnamectl', (a, ctx) => { ctx.out(` Static hostname: ${HOST}\n       Icon name: computer-vm\n         Chassis: vm\n Virtualization: kvm\nOperating System: Ubuntu 24.04.1 LTS\n          Kernel: Linux 6.8.0-45-generic\n    Architecture: x86-64\n`); });
  def('uptime', (a, ctx) => {
    const up = Math.floor((Date.now() - ctx.S.bootTime) / 60000);
    if (a[0] === '-p') { ctx.out(`up ${Math.floor(up / 60)} hours, ${up % 60} minutes\n`); return; }
    ctx.out(` ${hhmm()}:${two(new Date().getSeconds())} up ${Math.floor(up / 60)}:${two(up % 60)},  2 users,  load average: 0.42, 0.35, 0.30\n`);
  });
  def('free', (a, ctx) => {
    const h = a.some(x => /h/.test(x)), m = a.includes('-m'), g = a.includes('-g');
    const v = [8034520, 2673080, 2864212, 41232, 2497228, 5321480], sw = [2097148, 0, 2097148];
    const f = x => h ? human(x * 1024).replace(/([KMGT])$/, '$1i') : m ? Math.round(x / 1024) : g ? Math.round(x / 1048576) : x;
    const w = 12;
    ctx.out(`${pad('', 15)}${pad('total', w, true)}${pad('usado', w, true)}${pad('libre', w, true)}${pad('compartido', w, true)}${pad('búf/caché', w, true)}${pad('disponible', w, true)}\nMem:${pad('', 11)}${v.map(x => pad(f(x), w, true)).join('')}\nInter:${pad('', 9)}${sw.map(x => pad(f(x), w, true)).join('')}\n`);
  });
  def('df', (a, ctx) => {
    const h = a.some(x => /h/.test(x)) || a.includes('-H');
    const T = a.some(x => /T/.test(x));
    const rows = [['tmpfs', 'tmpfs', 803452, 1660, 801792, '/run'], ['/dev/sda1', 'ext4', 51290592, 18733240, 29919040, '/'], ['tmpfs', 'tmpfs', 4017260, 0, 4017260, '/dev/shm'], ['/dev/sda15', 'vfat', 106832, 6186, 100646, '/boot/efi']];
    const f = x => h ? human(x * 1024) : x;
    let out = `S.ficheros${T ? '     Tipo' : ''} ${pad(h ? 'Tamaño' : 'bloques de 1K', h ? 7 : 14, true)} ${pad('Usados', 9, true)} ${pad('Disp', 9, true)} Uso% Montado en\n`;
    for (const r of rows) out += `${pad(r[0], 10)}${T ? ' ' + pad(r[1], 8, true) : ''} ${pad(f(r[2]), h ? 7 : 14, true)} ${pad(f(r[3]), 9, true)} ${pad(f(r[4]), 9, true)} ${pad(Math.ceil(r[3] / r[2] * 100) + '%', 4, true)} ${r[5]}\n`;
    ctx.out(out);
  });
  def('du', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'shac', 'd', { summarize: 's', 'human-readable': 'h', 'max-depth': 'd' });
    const targets = rest.length ? rest : ['.'];
    const f = b => o.h ? human(b) : String(Math.ceil(b / 1024));
    let code = 0;
    let total = 0;
    for (const t of targets) {
      const r = get(S, t);
      if (r.err) { ctx.err(`du: no se puede acceder a '${t}': ${r.err}\n`); code = 1; continue; }
      if (o.s || r.node.t !== 'd') { const s = nodeSizeRec(r.node); total += s; ctx.out(`${f(s)}\t${t}\n`); continue; }
      const maxd = o.d !== undefined ? parseInt(o.d, 10) : Infinity;
      const recd = (n, path, depth) => {
        if (!can(S, n, 4)) { ctx.err(`du: no se puede leer el directorio '${path}': ${E_ACCES}\n`); code = 1; return 4096; }
        let s = 4096;
        for (const k of Object.keys(n.c).sort(cmpName)) {
          const c = n.c[k];
          if (c.t === 'd') s += recd(c, path.replace(/\/$/, '') + '/' + k, depth + 1);
          else { const cs = nodeSizeRec(c); s += cs; if (o.a) ctx.out(`${f(cs)}\t${path.replace(/\/$/, '')}/${k}\n`); }
        }
        if (depth <= maxd) ctx.out(`${f(s)}\t${path}\n`);
        return s;
      };
      total += recd(r.node, t, 0);
    }
    if (o.c) ctx.out(`${f(total)}\ttotal\n`);
    return code;
  });
  def('lsblk', (a, ctx) => { ctx.out('NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nsda       8:0    0   50G  0 disk \n├─sda1    8:1    0 49.9G  0 part /\n├─sda14   8:14   0    4M  0 part \n└─sda15   8:15   0  106M  0 part /boot/efi\nsr0      11:0    1 1024M  0 rom  \n'); });
  def('mount', (a, ctx) => {
    if (a.length) { needRoot(ctx); ctx.out(ctx.tty ? C.dim + '(montaje simulado)' + C.off + '\n' : ''); return; }
    ctx.out('sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\nudev on /dev type devtmpfs (rw,nosuid,relatime,size=3988220k)\n/dev/sda1 on / type ext4 (rw,relatime,discard,errors=remount-ro)\ntmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=803452k,mode=755)\n/dev/sda15 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077)\n');
  });
  def('lscpu', (a, ctx) => { ctx.out('Arquitectura:                     x86_64\n  modo(s) de operación de las CPUs: 32-bit, 64-bit\n  Orden de los bytes:              Little Endian\nCPU(s):                           4\n  Lista de la(s) CPU(s) en línea:  0-3\nID de fabricante:                 GenuineIntel\n  Nombre del modelo:               Intel(R) Core(TM) i5-1135G7 @ 2.40GHz\n    Hilo(s) de procesamiento por núcleo: 1\n    Núcleo(s) por «socket»:        4\nCachés (suma de todas):\n  L1d:                            192 KiB (4 instances)\n  L2:                             5 MiB (4 instances)\n  L3:                             8 MiB (1 instance)\n'); });
  def('which', (a, ctx) => {
    let code = 0;
    for (const n of a.filter(x => !x.startsWith('-'))) {
      if (CMDS[n] && !BUILTINS.has(n) && (!PKG_CMDS[n] || ctx.S.installed.includes(PKG_CMDS[n]))) ctx.out(`/usr/bin/${n}\n`);
      else code = 1;
    }
    return code;
  });
  const BUILTINS = new Set('cd export unset alias unalias history exit logout source . type echo printf pwd test [ true false read jobs fg bg kill umask help let'.split(' '));
  def('type', (a, ctx) => {
    let code = 0;
    for (const n of a.filter(x => !x.startsWith('-'))) {
      if (ctx.S.aliases[n]) ctx.out(`${n} es un alias de «${ctx.S.aliases[n]}»\n`);
      else if (KW.has(n)) ctx.out(`${n} es una palabra clave del shell\n`);
      else if (BUILTINS.has(n)) ctx.out(`${n} es una orden interna del shell\n`);
      else if (CMDS[n] && (!PKG_CMDS[n] || ctx.S.installed.includes(PKG_CMDS[n]))) ctx.out(`${n} es /usr/bin/${n}\n`);
      else { ctx.err(`bash: type: ${n}: no se encontró\n`); code = 1; }
    }
    return code;
  });
  def('export', (a, ctx) => {
    if (!a.length || a[0] === '-p') { Object.entries(ctx.frame.env).forEach(([k, v]) => ctx.out(`declare -x ${k}="${v}"\n`)); return; }
    for (const x of a) { const eq = x.indexOf('='); if (eq > 0) ctx.frame.env[x.slice(0, eq)] = x.slice(eq + 1); else if (ctx.frame.env[x] === undefined) ctx.frame.env[x] = ''; }
  });
  def('unset', (a, ctx) => { a.forEach(k => delete ctx.frame.env[k]); });
  def('env printenv', (a, ctx) => {
    const S = ctx.S;
    const base = { SHELL: '/bin/bash', PWD: S.cwd, LOGNAME: S.user, HOME: homeOf(S, S.user), LANG: 'es_ES.UTF-8', TERM: 'xterm-256color', USER: S.user, SHLVL: '1', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', OLDPWD: S.oldpwd || S.cwd, _: '/usr/bin/env' };
    const all = Object.assign(base, ctx.frame.env);
    if (a.length && ctx.log[ctx.log.length - 1].name === 'printenv') { a.forEach(k => { if (all[k] !== undefined) ctx.out(all[k] + '\n'); }); return; }
    ctx.out(Object.entries(all).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  });
  def('alias', (a, ctx) => {
    const S = ctx.S;
    if (!a.length) { Object.entries(S.aliases).sort().forEach(([k, v]) => ctx.out(`alias ${k}='${v}'\n`)); return; }
    for (const x of a) { const eq = x.indexOf('='); if (eq > 0) S.aliases[x.slice(0, eq)] = x.slice(eq + 1); else if (S.aliases[x]) ctx.out(`alias ${x}='${S.aliases[x]}'\n`); else { ctx.err(`bash: alias: ${x}: no se encontró\n`); return 1; } }
  });
  def('unalias', (a, ctx) => { a.forEach(k => delete ctx.S.aliases[k]); });
  def('source .', (a, ctx) => {
    if (!a.length) { ctx.err('bash: source: se requiere un argumento de nombre de archivo\n'); return 2; }
    let txt;
    try { txt = readFile(ctx.S, a[0]); } catch (e) { ctx.err(`bash: ${a[0]}: ${e.message}\n`); return 1; }
    return runScript(txt, a[0], a.slice(1), ctx, true);
  });
  def('bash sh', (a, ctx) => {
    const args = a.filter(x => x !== '-x');
    if (!args.length) { ctx.out(ctx.tty ? C.dim + '(Abrirías un shell hijo. En el simulador sigues en el mismo.)' + C.off + '\n' : ''); return 0; }
    if (args[0] === '-c') { return runScript(args[1] || '', 'bash', args.slice(2), ctx, false); }
    let txt;
    try { txt = readFile(ctx.S, args[0]); } catch (e) { ctx.err(`bash: ${args[0]}: ${e.message}\n`); return 127; }
    return runScript(txt, args[0], args.slice(1), ctx, false);
  });
  function testExpr(a, ctx) {
    const S = ctx.S;
    if (!a.length) return false;
    if (a[0] === '!') return !testExpr(a.slice(1), ctx);
    const oi = a.findIndex(x => x === '-a' || x === '-o');
    if (oi > 0) { const l = testExpr(a.slice(0, oi), ctx), r = testExpr(a.slice(oi + 1), ctx); return a[oi] === '-a' ? l && r : l || r; }
    if (a.length === 1) return a[0] !== '';
    if (a.length === 2) {
      const [op, v] = a;
      const r = get(S, v);
      switch (op) {
        case '-z': return v === ''; case '-n': return v !== '';
        case '-e': return !r.err; case '-f': return !r.err && r.node.t === 'f';
        case '-d': return !r.err && r.node.t === 'd'; case '-L': case '-h': { const rl = get(S, v, false); return !rl.err && rl.node.t === 'l'; }
        case '-r': return !r.err && can(S, r.node, 4); case '-w': return !r.err && can(S, r.node, 2);
        case '-x': return !r.err && can(S, r.node, 1) && (r.node.t === 'd' || (r.node.mode & 0o111) !== 0);
        case '-s': return !r.err && fsize(r.node) > 0;
      }
      throw new ShellError(`${op}: se esperaba un operador unario`, 2);
    }
    const [x, op, y] = a;
    const nx = parseInt(x, 10), ny = parseInt(y, 10);
    const numOp = ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op);
    if (numOp && (isNaN(nx) || isNaN(ny) || !/^-?\d+$/.test(x.trim()) || !/^-?\d+$/.test(y.trim()))) throw new ShellError(`${isNaN(nx) || !/^-?\d+$/.test(x.trim()) ? x : y}: se esperaba una expresión entera`, 2);
    switch (op) {
      case '=': case '==': return x === y; case '!=': return x !== y;
      case '-eq': return nx === ny; case '-ne': return nx !== ny; case '-lt': return nx < ny;
      case '-le': return nx <= ny; case '-gt': return nx > ny; case '-ge': return nx >= ny;
      case '<': return x < y; case '>': return x > y;
    }
    throw new ShellError(`${op}: se esperaba un operador binario`, 2);
  }
  def('test', (a, ctx) => testExpr(a, ctx) ? 0 : 1);
  CMDS['['] = (a, ctx) => {
    if (a[a.length - 1] !== ']') { ctx.err("bash: [: falta «]»\n"); return 2; }
    return testExpr(a.slice(0, -1), ctx) ? 0 : 1;
  };
  CMDS['[['] = (a, ctx) => {
    if (a[a.length - 1] !== ']]') { ctx.err("bash: error sintáctico: se esperaba «]]»\n"); return 2; }
    const args = a.slice(0, -1).map(x => x === '&&' ? '-a' : x === '||' ? '-o' : x);
    return testExpr(args, ctx) ? 0 : 1;
  };
  def('true :', () => 0);
  def('false', () => 1);
  def('let', (a, ctx) => {
    let v = 0;
    for (const x of a) { const m = x.match(/^(\w+)(\+\+|--|=(.*))$/); if (m) { if (m[2] === '++') v = (parseInt(getVar(ctx, m[1]), 10) || 0) + 1; else if (m[2] === '--') v = (parseInt(getVar(ctx, m[1]), 10) || 0) - 1; else v = arith(m[3], ctx); ctx.frame.env[m[1]] = String(v); } else v = arith(x, ctx); }
    return v === 0 ? 1 : 0;
  });
  def('read', (a, ctx) => {
    const { o, rest } = getopt(a, 'rs', 'p');
    if (o.p) ctx.out(o.p);
    const box = ctx.stdinBox;
    if (!box || box.v === null || box.v === undefined) {
      ctx.out(ctx.tty ? '\n' + C.dim + '(read espera que escribas algo. En el simulador pásale la entrada con una tubería, p. ej.: echo "Ana" | ./script.sh)' + C.off + '\n' : '');
      assignRead(rest, '', ctx); return 1;
    }
    if (box.v === '') { assignRead(rest, '', ctx); return 1; }
    const nl = box.v.indexOf('\n');
    const line = nl < 0 ? box.v : box.v.slice(0, nl);
    box.v = nl < 0 ? '' : box.v.slice(nl + 1);
    assignRead(rest, line, ctx);
    return 0;
  });
  function assignRead(names, line, ctx) {
    if (!names.length) names = ['REPLY'];
    const parts = line.trim().split(/\s+/);
    names.forEach((n, i) => ctx.frame.env[n] = i === names.length - 1 ? parts.slice(i).join(' ') : (parts[i] || ''));
  }
  def('seq', (a, ctx) => {
    const n = a.map(Number);
    let [s, st, e] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
    if (n.some(isNaN) || !n.length) { ctx.err('seq: falta un operando\n'); return 1; }
    const out = [];
    for (let x = s; st > 0 ? x <= e : x >= e; x += st) { out.push(x); if (out.length > 10000) break; }
    if (out.length) ctx.out(out.join('\n') + '\n');
  });
  def('expr', (a, ctx) => {
    try { const v = arith(a.join(' ').replace(/\\\*/g, '*'), ctx); ctx.out(v + '\n'); return v === 0 ? 1 : 0; } catch (e) { ctx.err('expr: error sintáctico\n'); return 2; }
  });
  def('basename', (a, ctx) => { if (!a[0]) { ctx.err('basename: falta un operando\n'); return 1; } let b = basename(a[0].replace(/\/+$/, '') || '/'); if (a[1] && b.endsWith(a[1])) b = b.slice(0, -a[1].length); ctx.out(b + '\n'); });
  def('dirname', (a, ctx) => { if (!a[0]) { ctx.err('dirname: falta un operando\n'); return 1; } const p = a[0].replace(/\/+$/, ''); ctx.out((p.includes('/') ? dirname(p) || '/' : '.') + '\n'); });
  def('tree', (a, ctx) => {
    const S = ctx.S;
    const { o, rest } = getopt(a, 'adfL', 'L');
    const t = rest[0] || '.';
    const r = get(S, t);
    if (r.err) { ctx.err(`${t}  [error al abrir el directorio]\n`); return 2; }
    let nd = 0, nf = 0;
    let out = colorName(r.node, t, ctx.tty) + '\n';
    const maxL = o.L ? parseInt(o.L, 10) : Infinity;
    const rec = (n, prefix, depth) => {
      if (depth > maxL || !can(S, n, 4)) return;
      const ks = Object.keys(n.c).filter(k => o.a || !k.startsWith('.')).filter(k => !o.d || n.c[k].t === 'd').sort(cmpName);
      ks.forEach((k, i) => {
        const c = n.c[k], last = i === ks.length - 1;
        out += prefix + (last ? '└── ' : '├── ') + colorName(c, k, ctx.tty) + (c.t === 'l' ? ' -> ' + c.target : '') + '\n';
        if (c.t === 'd') { nd++; rec(c, prefix + (last ? '    ' : '│   '), depth + 1); } else nf++;
      });
    };
    rec(r.node, '', 1);
    out += `\n${nd} director${nd === 1 ? 'y' : 'ies'}${o.d ? '' : `, ${nf} file${nf === 1 ? '' : 's'}`}\n`;
    ctx.out(out);
  });
  def('nano pico editor', (a, ctx) => {
    const S = ctx.S;
    const f = a.filter(x => !x.startsWith('-'))[0];
    if (ctx.script || !ctx.tty) { ctx.err('nano: requiere una terminal interactiva\n'); return 1; }
    if (!f) { ctx.err('nano: indica el archivo a editar, p. ej.: nano notas.txt\n'); return 1; }
    const r = get(S, f);
    if (!r.err && r.node.t === 'd') { ctx.err(`nano: «${f}» es un directorio\n`); return 1; }
    if (!r.err && !can(S, r.node, 4)) { ctx.err(`nano: Error leyendo ${f}: ${E_ACCES}\n`); return 1; }
    if (r.err && r.err !== E_NOENT) { ctx.err(`nano: ${f}: ${r.err}\n`); return 1; }
    ctx.shared.editor = { path: abspath(S, f), name: f, data: r.err ? '' : r.node.data, isNew: !!r.err, readonly: !r.err && !can(S, r.node, 2) };
  });
  def('vi vim', (a, ctx) => { ctx.err(`No se ha encontrado la orden «${ctx.log[ctx.log.length - 1].name}» en este simulador.\nUsa nano, que es más sencillo para empezar: nano ${a[0] || 'archivo.txt'}\n`); return 127; });
  def('man', (a, ctx) => {
    const page = a.filter(x => !x.startsWith('-'))[0];
    if (!page) { ctx.err('¿Qué página de manual desea?\nPor ejemplo, pruebe «man man».\n'); return 1; }
    const m = MAN[page];
    if (!m) { ctx.err(`No hay ninguna entrada de manual para ${page}\n`); return 16; }
    const b = s => ctx.tty ? C.bold + s + C.off : s;
    ctx.out(`${b(page.toUpperCase() + '(1)')}${pad('', 20)}Manual del usuario${pad('', 20)}${b(page.toUpperCase() + '(1)')}\n\n${b('NOMBRE')}\n       ${page} - ${m[0]}\n\n${b('SINOPSIS')}\n       ${m[1]}\n\n${b('DESCRIPCIÓN')}\n${m[2].split('\n').map(l => '       ' + l).join('\n')}\n` + (m[3] ? `\n${b('EJEMPLOS')}\n${m[3].split('\n').map(l => '       ' + l).join('\n')}\n` : '') + (ctx.tty ? '\n' + C.dim + '(En un sistema real man abre un visor: flechas para moverte, /palabra para buscar, q para salir.)' + C.off + '\n' : ''));
  });
  def('help', (a, ctx) => {
    const b = s => ctx.tty ? C.bold + s + C.off : s;
    ctx.out(`${b('Comandos disponibles en este simulador')} (escribe ${b('man comando')} para ver su manual)\n\n` +
      `${b('Navegación')}     pwd cd ls tree find\n${b('Archivos')}       touch mkdir cp mv rm rmdir ln file stat\n${b('Ver/editar')}     cat less head tail nano wc diff\n${b('Texto')}          grep sort uniq cut tr tee echo printf\n` +
      `${b('Usuarios')}       whoami id groups sudo su useradd usermod groupadd passwd\n${b('Permisos')}       chmod chown chgrp umask\n${b('Procesos')}       ps top kill killall pgrep jobs fg bg nice renice pstree sleep\n` +
      `${b('Sistema')}        uname hostname uptime date cal free df du lsblk lscpu mount\n${b('Paquetes')}       apt (update, install, remove, search, list)\n${b('Servicios')}      systemctl (status, start, stop, restart, enable)\n${b('Red')}            ip ping ss curl\n${b('Comprimir')}      tar gzip gunzip\n${b('Shell')}          history alias export env echo source bash test seq read\n\n` +
      `Atajos: ${b('Tab')} autocompleta, ${b('↑/↓')} recorre el historial, ${b('Ctrl+L')} limpia, ${b('Ctrl+C')} cancela la línea.\n`);
  });
  def('diff', (a, ctx) => {
    const files = a.filter(x => !x.startsWith('-'));
    if (files.length < 2) { ctx.err('diff: falta un operando después de «' + (files[0] || 'diff') + '»\n'); return 2; }
    let A, B;
    try { A = lines(readFile(ctx.S, files[0])); B = lines(readFile(ctx.S, files[1])); } catch (e) { ctx.err(`diff: ${e.message}\n`); return 2; }
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push(['=', i, j]); i++; j++; }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { ops.push(['+', i, j]); j++; }
      else { ops.push(['-', i, j]); i++; }
    }
    let out = '';
    for (let k = 0; k < ops.length;) {
      if (ops[k][0] === '=') { k++; continue; }
      const start = k; while (k < ops.length && ops[k][0] !== '=') k++;
      const chunk = ops.slice(start, k);
      const dels = chunk.filter(x => x[0] === '-'), adds = chunk.filter(x => x[0] === '+');
      const r = (arr, idx) => arr.length === 1 ? String(arr[0][idx] + 1) : `${arr[0][idx] + 1},${arr[arr.length - 1][idx] + 1}`;
      if (dels.length && adds.length) out += `${r(dels, 1)}c${r(adds, 2)}\n`;
      else if (dels.length) out += `${r(dels, 1)}d${chunk[0][2]}\n`;
      else out += `${chunk[0][1]}a${r(adds, 2)}\n`;
      dels.forEach(x => out += (ctx.tty ? C.red : '') + '< ' + A[x[1]] + (ctx.tty ? C.off : '') + '\n');
      if (dels.length && adds.length) out += '---\n';
      adds.forEach(x => out += (ctx.tty ? C.grn : '') + '> ' + B[x[2]] + (ctx.tty ? C.off : '') + '\n');
    }
    ctx.out(out);
    return out ? 1 : 0;
  });

  // ---- paquetes y servicios ----
  const PKGS = {
    tree: ['2.1.1-2', 'muestra el contenido de directorios en forma de árbol', 47],
    htop: ['3.3.0-4', 'visor interactivo de procesos', 377],
    cowsay: ['3.03+dfsg2-8', 'una vaca configurable que habla', 93],
    neofetch: ['7.1.0-4', 'muestra información del sistema junto al logo de la distro', 360],
    sl: ['5.02-1', 'corrige el error de escribir «sl» en vez de «ls»', 24],
    nginx: ['1.24.0-2ubuntu7', 'servidor web y proxy inverso pequeño y potente', 1340],
    vim: ['2:9.1.0016-1ubuntu7', 'Vi IMproved, editor de texto avanzado', 3948],
    git: ['1:2.43.0-1ubuntu7', 'sistema de control de versiones distribuido', 21404],
    'net-tools': ['2.10-0.1ubuntu4', 'herramientas de red clásicas (ifconfig, netstat)', 812],
    gcc: ['4:13.2.0-7ubuntu1', 'compilador de C de GNU', 51200],
    curl: ['8.5.0-2ubuntu10', 'herramienta para transferir datos con URLs', 0],
    python3: ['3.12.3-0ubuntu2', 'intérprete de Python 3', 0]
  };
  def('apt apt-get', (a, ctx) => {
    const S = ctx.S;
    const sub = a[0];
    const pkgs = a.slice(1).filter(x => !x.startsWith('-'));
    const yes = a.includes('-y');
    const lockErr = () => { ctx.err('E: No se pudo abrir el fichero de bloqueo «/var/lib/dpkg/lock-frontend» - open (13: Permiso denegado)\nE: No se pudo obtener el bloqueo de la interfaz de dpkg (/var/lib/dpkg/lock-frontend). ¿Es usted superusuario?\n'); return 100; };
    switch (sub) {
      case 'update':
        if (S.user !== 'root') return lockErr();
        S.aptUpdated = true;
        ctx.out('Obj:1 http://archive.ubuntu.com/ubuntu noble InRelease\nDes:2 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nDes:3 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\nDescargados 252 kB en 1s (305 kB/s)\nLeyendo lista de paquetes... Hecho\nCreando árbol de dependencias... Hecho\nLeyendo la información de estado... Hecho\nSe pueden actualizar 3 paquetes. Ejecute «apt list --upgradable» para verlos.\n');
        return 0;
      case 'upgrade': case 'full-upgrade':
        if (S.user !== 'root') return lockErr();
        ctx.out('Leyendo lista de paquetes... Hecho\nCreando árbol de dependencias... Hecho\nCalculando la actualización... Hecho\nSe actualizarán los siguientes paquetes:\n  libssl3t64 openssl tzdata\n3 actualizados, 0 nuevos se instalarán, 0 para eliminar y 0 no actualizados.\n' + (yes ? '' : '¿Desea continuar? [S/n] S\n') + 'Configurando openssl (3.0.13-0ubuntu3.4) ...\nConfigurando tzdata (2024b-0ubuntu0.24.04) ...\n');
        return 0;
      case 'install': case 'reinstall': {
        if (S.user !== 'root') return lockErr();
        if (!pkgs.length) { ctx.out('Leyendo lista de paquetes... Hecho\n0 actualizados, 0 nuevos se instalarán, 0 para eliminar y 3 no actualizados.\n'); return 0; }
        let code = 0;
        ctx.out('Leyendo lista de paquetes... Hecho\nCreando árbol de dependencias... Hecho\nLeyendo la información de estado... Hecho\n');
        const todo = [];
        for (const p of pkgs) {
          if (!PKGS[p]) { ctx.err(`E: No se ha podido localizar el paquete ${p}\n`); code = 100; continue; }
          if (S.installed.includes(p) || PKGS[p][2] === 0) { ctx.out(`${p} ya está en su versión más reciente (${PKGS[p][0]}).\n`); continue; }
          todo.push(p);
        }
        if (code) return code;
        if (todo.length) {
          ctx.out(`Se instalarán los siguientes paquetes NUEVOS:\n  ${todo.join(' ')}\n0 actualizados, ${todo.length} nuevos se instalarán, 0 para eliminar y 3 no actualizados.\nSe necesita descargar ${todo.reduce((s, p) => s + PKGS[p][2], 0)} kB de archivos.\n` + (yes ? '' : '¿Desea continuar? [S/n] S\n'));
          for (const p of todo) {
            ctx.out(`Des:1 http://archive.ubuntu.com/ubuntu noble/universe amd64 ${p} amd64 ${PKGS[p][0]}\nSeleccionando el paquete ${p} previamente no seleccionado.\nDesempaquetando ${p} (${PKGS[p][0]}) ...\nConfigurando ${p} (${PKGS[p][0]}) ...\n`);
            S.installed.push(p);
            put(S, 'usr/bin/' + p, '\x7fELF', { mode: 0o755 });
            if (p === 'nginx') {
              S.services.nginx = { desc: 'A high performance web server and a reverse proxy server', active: true, enabled: true, pid: S.nextPid++ };
              S.procs.push({ pid: S.services.nginx.pid, ppid: 1, user: 'root', cmd: 'nginx: master process /usr/sbin/nginx -g daemon on;', state: 'S', cpu: 0, mem: 0.1, nice: 0, tty: '?', start: hhmm(), vsz: 55000, rss: 1600 });
              put(S, 'etc/nginx/nginx.conf', 'user www-data;\nworker_processes auto;\nevents { worker_connections 768; }\nhttp {\n  include /etc/nginx/sites-enabled/*;\n}\n');
              put(S, 'etc/nginx/sites-enabled/default', 'server {\n  listen 80 default_server;\n  root /var/www/html;\n  index index.html;\n}\n');
              put(S, 'var/log/nginx/access.log', '');
              ctx.out('Created symlink /etc/systemd/system/multi-user.target.wants/nginx.service → /usr/lib/systemd/system/nginx.service.\n');
            }
          }
          ctx.out('Procesando disparadores para man-db (2.12.0-4build2) ...\n');
        }
        return 0;
      }
      case 'remove': case 'purge': case 'autoremove': {
        if (S.user !== 'root') return lockErr();
        for (const p of pkgs) {
          if (!S.installed.includes(p)) { ctx.out(`El paquete «${p}» no está instalado, no se eliminará\n`); continue; }
          S.installed = S.installed.filter(x => x !== p);
          del(S, '/usr/bin/' + p);
          if (p === 'nginx') { const pid = S.services.nginx && S.services.nginx.pid; S.procs = S.procs.filter(x => x.pid !== pid); delete S.services.nginx; if (sub === 'purge') del(S, '/etc/nginx'); }
          ctx.out(`Leyendo lista de paquetes... Hecho\nSe ELIMINARÁN los siguientes paquetes:\n  ${p}\nDesinstalando ${p} (${PKGS[p][0]}) ...\n`);
        }
        return 0;
      }
      case 'search': {
        const q = (pkgs[0] || '').toLowerCase();
        ctx.out('Ordenando... Hecho\nBúsqueda en todo el texto... Hecho\n');
        Object.entries(PKGS).filter(([n, v]) => n.includes(q) || v[1].includes(q)).forEach(([n, v]) => ctx.out(`${ctx.tty ? C.grn + n + C.off : n}/noble ${v[0]} amd64${S.installed.includes(n) || !v[2] ? ' [instalado]' : ''}\n  ${v[1]}\n\n`));
        return 0;
      }
      case 'show': {
        const p = pkgs[0];
        if (!PKGS[p]) { ctx.err(`N: No se ha podido localizar el paquete ${p}\nE: No se encontró ningún paquete\n`); return 100; }
        ctx.out(`Package: ${p}\nVersion: ${PKGS[p][0]}\nPriority: optional\nSection: universe\nInstalled-Size: ${PKGS[p][2]} kB\nDescription: ${PKGS[p][1]}\n`);
        return 0;
      }
      case 'list': {
        const inst = ['bash', 'coreutils', 'curl', 'grep', 'nano', 'openssh-server', 'python3', 'sudo', 'tar'].concat(S.installed).sort();
        ctx.out('Listando... Hecho\n');
        if (a.includes('--installed')) inst.forEach(p => ctx.out(`${ctx.tty ? C.grn + p + C.off : p}/noble,now ${(PKGS[p] || ['5.2.21-2ubuntu4'])[0]} amd64 [instalado]\n`));
        else if (a.includes('--upgradable')) ctx.out('libssl3t64/noble-updates 3.0.13-0ubuntu3.4 amd64 [actualizable desde: 3.0.13-0ubuntu3.1]\nopenssl/noble-updates 3.0.13-0ubuntu3.4 amd64 [actualizable desde: 3.0.13-0ubuntu3.1]\ntzdata/noble-updates 2024b-0ubuntu0.24.04 all [actualizable desde: 2024a-3ubuntu1]\n');
        else Object.keys(PKGS).forEach(p => ctx.out(`${p}/noble ${PKGS[p][0]} amd64${S.installed.includes(p) || !PKGS[p][2] ? ' [instalado]' : ''}\n`));
        return 0;
      }
      default:
        ctx.out('apt 2.7.14 (amd64)\nUso: apt [opciones] orden\n\nÓrdenes más usadas:\n  list - lista paquetes\n  search - busca en las descripciones\n  show - muestra detalles de un paquete\n  install - instala paquetes\n  remove - elimina paquetes\n  update - actualiza la lista de paquetes disponibles\n  upgrade - actualiza el sistema instalando/actualizando paquetes\n');
        return sub ? 1 : 0;
    }
  });
  def('dpkg', (a, ctx) => {
    if (a[0] === '-l') { ctx.out('Deseado=desconocido(U)/Instalar/eliminar/Purgar/retener(H)\n||/ Nombre         Versión          Arquitectura Descripción\n+++-==============-================-============-=================================\n' + ['bash', 'coreutils', 'curl', 'nano', 'sudo'].concat(ctx.S.installed).map(p => `ii  ${pad(p, 14)} ${pad((PKGS[p] || ['5.2.21'])[0], 16)} amd64        ${(PKGS[p] || [0, 'paquete base del sistema'])[1]}`).join('\n') + '\n'); return; }
    ctx.err('dpkg: necesita una opción de acción (en el simulador: dpkg -l)\n'); return 2;
  });
  def('systemctl service', (a, ctx) => {
    const S = ctx.S;
    let [sub, svc] = a.filter(x => !x.startsWith('--') || x === '--failed');
    const isService = ctx.log[ctx.log.length - 1].name === 'service';
    if (isService) { [svc, sub] = [sub, svc]; }
    if (svc) svc = svc.replace(/\.service$/, '');
    if (!sub || sub === 'list-units' || sub === '--failed') {
      let out = '  UNIT                     LOAD   ACTIVE   SUB     DESCRIPTION\n';
      for (const [n, s] of Object.entries(S.services)) if (s.active || s.failed || a.includes('--all')) out += `${s.failed ? (ctx.tty ? C.red + '●' + C.off : '●') : ' '} ${pad(n + '.service', 24)} loaded ${pad(s.active ? 'active' : s.failed ? 'failed' : 'inactive', 8)} ${pad(s.active ? 'running' : s.failed ? 'failed' : 'dead', 7)} ${s.desc}\n`;
      ctx.out(out); return 0;
    }
    if (sub === 'list-unit-files') { let out = 'UNIT FILE         STATE\n'; for (const [n, s] of Object.entries(S.services)) out += `${pad(n + '.service', 17)} ${s.enabled ? 'enabled' : 'disabled'}\n`; ctx.out(out); return 0; }
    const s = S.services[svc];
    if (!s) { ctx.err(`Unit ${svc}.service could not be found.\n`); return 4; }
    const needR = () => { if (S.user !== 'root') { ctx.err(`Failed to ${sub} ${svc}.service: Access denied\nSee system logs and 'systemctl status ${svc}.service' for details.\n` + (ctx.tty ? C.dim + '(Necesitas sudo para gestionar servicios.)' + C.off + '\n' : '')); return true; } return false; };
    const startProc = () => { s.pid = S.nextPid++; S.procs.push({ pid: s.pid, ppid: 1, user: 'root', cmd: svc === 'nginx' ? 'nginx: master process /usr/sbin/nginx' : svc === 'ssh' ? 'sshd: /usr/sbin/sshd -D [listener]' : '/usr/sbin/' + svc, state: 'S', cpu: 0, mem: 0.1, nice: 0, tty: '?', start: hhmm(), vsz: 20000, rss: 2000 }); };
    const stopProc = () => { S.procs = S.procs.filter(p => p.pid !== s.pid); s.pid = null; };
    switch (sub) {
      case 'status': {
        const dot = s.active ? (ctx.tty ? C.grn + '●' + C.off : '●') : s.failed ? (ctx.tty ? C.red + '×' + C.off : '×') : '○';
        const act = s.active ? (ctx.tty ? C.grn + 'active (running)' + C.off : 'active (running)') : s.failed ? (ctx.tty ? C.red + 'failed' + C.off : 'failed') + ' (Result: signal)' : 'inactive (dead)';
        ctx.out(`${dot} ${svc}.service - ${s.desc}\n     Loaded: loaded (/usr/lib/systemd/system/${svc}.service; ${s.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n     Active: ${act} since ${new Date(S.bootTime).toString().slice(0, 24)}\n` + (s.active ? `   Main PID: ${s.pid} (${svc === 'ssh' ? 'sshd' : svc})\n      Tasks: ${svc === 'nginx' ? 3 : 1} (limit: 9354)\n     Memory: ${svc === 'nginx' ? '4.1M' : '2.3M'}\n` : '') + '\n');
        return s.active ? 0 : 3;
      }
      case 'is-active': ctx.out((s.active ? 'active' : s.failed ? 'failed' : 'inactive') + '\n'); return s.active ? 0 : 3;
      case 'is-enabled': ctx.out((s.enabled ? 'enabled' : 'disabled') + '\n'); return s.enabled ? 0 : 1;
      case 'start': if (needR()) return 1; if (!s.active) { s.active = true; s.failed = false; startProc(); } return 0;
      case 'stop': if (needR()) return 1; if (s.active) { s.active = false; stopProc(); } return 0;
      case 'restart': case 'reload': if (needR()) return 1; if (s.active) stopProc(); s.active = true; s.failed = false; startProc(); return 0;
      case 'enable': if (needR()) return 1; s.enabled = true; ctx.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${svc}.service → /usr/lib/systemd/system/${svc}.service.\n`); if (a.includes('--now') && !s.active) { s.active = true; startProc(); } return 0;
      case 'disable': if (needR()) return 1; s.enabled = false; ctx.out(`Removed "/etc/systemd/system/multi-user.target.wants/${svc}.service".\n`); return 0;
    }
    ctx.err(`Unknown command verb '${sub}'.\n`); return 1;
  });
  def('journalctl', (a, ctx) => {
    const S = ctx.S;
    const ui = a.indexOf('-u');
    const svc = ui >= 0 ? (a[ui + 1] || '').replace('.service', '') : null;
    if (S.user !== 'root' && !inGroup(S, S.user, 'adm')) { ctx.out('Hint: You are currently not seeing messages from other users and the system.\n'); return 0; }
    const s = svc && S.services[svc];
    if (svc && !s) { ctx.out('-- No entries --\n'); return 0; }
    const d = lsDate(S.bootTime);
    if (svc) ctx.out(`${d} ${HOST} systemd[1]: Starting ${svc}.service - ${s.desc}...\n${d} ${HOST} systemd[1]: Started ${svc}.service - ${s.desc}.\n` + (s.failed ? `${lsDate(Date.now())} ${HOST} systemd[1]: ${svc}.service: Main process exited, code=killed, status=9/KILL\n${lsDate(Date.now())} ${HOST} systemd[1]: ${svc}.service: Failed with result 'signal'.\n` : ''));
    else ctx.out(S.root.c.var.c.log.c.syslog.data);
  });

  // ---- red ----
  def('ip', (a, ctx) => {
    const sub = a[0] || '';
    if (/^a/.test(sub)) ctx.out(`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether 08:00:27:3a:9c:51 brd ff:ff:ff:ff:ff:ff\n    inet ${ctx.tty ? C.bold + '192.168.1.50' + C.off : '192.168.1.50'}/24 brd 192.168.1.255 scope global dynamic enp0s3\n       valid_lft 85421sec preferred_lft 85421sec\n    inet6 fe80::a00:27ff:fe3a:9c51/64 scope link\n       valid_lft forever preferred_lft forever\n`);
    else if (/^r/.test(sub)) ctx.out('default via 192.168.1.1 dev enp0s3 proto dhcp src 192.168.1.50 metric 100\n192.168.1.0/24 dev enp0s3 proto kernel scope link src 192.168.1.50 metric 100\n');
    else if (/^l/.test(sub)) ctx.out('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT\n    link/ether 08:00:27:3a:9c:51 brd ff:ff:ff:ff:ff:ff\n');
    else { ctx.out('Uso: ip [ OPCIONES ] OBJETO { ORDEN | help }\ndonde OBJETO := { address | route | link | neigh }\n'); return sub ? 1 : 0; }
  });
  const HOSTS = { localhost: '127.0.0.1', [HOST]: '127.0.1.1', 'servidor-web': '192.168.1.20', 'base-datos': '192.168.1.30', 'google.com': '142.250.78.14', 'www.google.com': '142.250.78.4', 'linuxfoundation.org': '3.13.31.214', 'ubuntu.com': '185.125.190.20', 'kernel.org': '139.178.84.217', 'github.com': '140.82.112.3', 'wikipedia.org': '208.80.154.224', 'router': '192.168.1.1' };
  def('ping', (a, ctx) => {
    const { o, rest } = getopt(a, '46qv', 'cWi');
    const h = rest[0];
    if (!h) { ctx.err('ping: dirección de destino requerida\n'); return 1; }
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h : HOSTS[h];
    if (!ip) { ctx.err(`ping: ${h}: Nombre o servicio desconocido\n`); return 2; }
    const unreachable = ip.startsWith('10.') || ip === '192.168.1.99';
    const n = o.c ? parseInt(o.c, 10) : 4;
    const base = ip.startsWith('127.') ? 0.04 : ip.startsWith('192.168.') ? 0.6 : 18;
    let out = `PING ${h} (${ip}) 56(84) bytes of data.\n`;
    const times = [];
    for (let i = 1; i <= Math.min(n, 20); i++) {
      if (unreachable) { out += `From 192.168.1.50 icmp_seq=${i} Destination Host Unreachable\n`; continue; }
      const t = +(base * (0.8 + Math.random() * 0.5)).toFixed(base < 1 ? 3 : 1);
      times.push(t);
      if (!o.q) out += `64 bytes from ${h === ip ? ip : h + ' (' + ip + ')'}: icmp_seq=${i} ttl=${ip.startsWith('127.') ? 64 : ip.startsWith('192.') ? 64 : 115} time=${t} ms\n`;
    }
    const recv = times.length;
    out += `\n--- ${h} ping statistics ---\n${n} packets transmitted, ${recv} received, ${Math.round((1 - recv / n) * 100)}% packet loss, time ${n * 1000 - 999}ms\n`;
    if (recv) out += `rtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${(times.reduce((s, x) => s + x, 0) / recv).toFixed(3)}/${Math.max(...times).toFixed(3)}/0.112 ms\n`;
    if (!o.c && ctx.tty) out += C.dim + '(En Linux real, ping sin -c sigue enviando paquetes hasta que pulsas Ctrl+C.)' + C.off + '\n';
    ctx.out(out);
    return recv ? 0 : 1;
  });
  def('ss netstat', (a, ctx) => {
    const S = ctx.S;
    let out = 'Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n';
    out += 'udp   UNCONN 0      0      127.0.0.53%lo:53         0.0.0.0:*\n';
    if (S.services.ssh.active) out += 'tcp   LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*\n';
    out += 'tcp   LISTEN 0      4096       127.0.0.1:631        0.0.0.0:*\n'.replace(/.*/, S.services.cups.active ? '$&' : '').replace(/^\n?$/, '');
    if (S.services.nginx && S.services.nginx.active) out += 'tcp   LISTEN 0      511          0.0.0.0:80         0.0.0.0:*\n';
    ctx.out(out.replace(/\n\n/g, '\n'));
  });
  def('curl wget', (a, ctx) => {
    const S = ctx.S;
    const url = a.filter(x => !x.startsWith('-'))[0];
    if (!url) { ctx.err('curl: try \'curl --help\' for more information\n'); return 2; }
    const h = url.replace(/^https?:\/\//, '').split(/[/:]/)[0];
    const head = a.includes('-I');
    if (h === 'localhost' || h === '127.0.0.1' || h === '192.168.1.50' || h === HOST) {
      if (!S.services.nginx || !S.services.nginx.active) { ctx.err(`curl: (7) Failed to connect to ${h} port 80 after 0 ms: Couldn't connect to server\n`); return 7; }
      const body = S.root.c.var.c.www.c.html.c['index.html'] ? S.root.c.var.c.www.c.html.c['index.html'].data : '';
      ctx.out(head ? 'HTTP/1.1 200 OK\nServer: nginx/1.24.0 (Ubuntu)\nContent-Type: text/html\n' : body);
      try { writeFile(Object.assign({}, S, { user: 'root' }), '/var/log/nginx/access.log', `127.0.0.1 - - [${new Date().toUTCString()}] "GET / HTTP/1.1" 200 ${body.length} "-" "curl/8.5.0"\n`, true); } catch (e) { }
      return 0;
    }
    if (!HOSTS[h]) { ctx.err(`curl: (6) Could not resolve host: ${h}\n`); return 6; }
    ctx.out(head ? 'HTTP/2 200\ncontent-type: text/html; charset=utf-8\n' : `<!doctype html><html><head><title>${h}</title></head><body>(contenido simulado de ${h})</body></html>\n`);
  });

  // ---- tar / gzip ----
  def('tar', (a, ctx) => {
    const S = ctx.S;
    let flags = '', rest = [], file = null, dir = null;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-C') { dir = a[++i]; continue; }
      if (x.startsWith('--')) continue;
      if (i === 0 && /^[a-zA-Z]+$/.test(x) && !x.includes('.')) flags += x;
      else if (x.startsWith('-')) flags += x.slice(1);
      else rest.push(x);
    }
    if (flags.includes('f')) {
      // el archivo va tras f (o es el primer operando libre)
      file = rest.shift();
    }
    const v = flags.includes('v');
    if (!/[cxt]/.test(flags)) { ctx.err('tar: Debe especificar una de las opciones «-Acdtrux»\nPruebe «tar --help» para más información.\n'); return 2; }
    if (!file) { ctx.err('tar: Se rehúsa a escribir datos de archivo en una terminal.\n'); return 2; }
    if (flags.includes('c')) {
      if (!rest.length) { ctx.err('tar: Cobardemente se rehúsa a crear un archivo vacío\n'); return 2; }
      const entries = [];
      for (const src of rest) {
        const r = get(S, src);
        if (r.err) { ctx.err(`tar: ${src}: No se puede efectuar stat: ${r.err}\n`); continue; }
        const absS = abspath(S, src);
        walk(S, absS, r.node, (p, n) => {
          const rel = (src.replace(/\/$/, '') + p.slice(absS.length)).replace(/^\//, '');
          entries.push({ p: rel + (n.t === 'd' ? '/' : ''), t: n.t, d: n.data || '', m: n.mode, o: n.owner, l: n.target });
          if (v) ctx.out(rel + (n.t === 'd' ? '/' : '') + '\n');
        });
      }
      if (/^\//.test(rest[0]) && ctx.tty) ctx.err('tar: Eliminando la «/» inicial de los nombres\n');
      const blob = '\x00TAR' + JSON.stringify(entries);
      try { writeFile(S, file, flags.includes('z') ? '\x00GZ' + blob : blob); } catch (e) { ctx.err(`tar: ${file}: ${e.message}\n`); return 2; }
      return 0;
    }
    let data;
    try { data = readFile(S, file); } catch (e) { ctx.err(`tar: ${file}: No se puede abrir: ${e.message}\n`); return 2; }
    if (data.startsWith('\x00GZ')) data = data.slice(3);
    if (!data.startsWith('\x00TAR')) { ctx.err('tar: Esto no parece un archivo tar\n'); return 2; }
    const entries = JSON.parse(data.slice(4));
    if (flags.includes('t')) { entries.forEach(e => ctx.out(v ? `${modeStr({ t: e.t, mode: e.m })} ${e.o}/${e.o} ${pad(e.d.length, 6, true)} ${lsDate(Date.now())} ${e.p}\n` : e.p + '\n')); return 0; }
    const base = dir ? abspath(S, dir) : S.cwd;
    for (const e of entries) {
      const target = norm(base + '/' + e.p);
      const pr = lookup(S, dirname(target));
      if (pr.err) { ctx.err(`tar: ${e.p}: ${pr.err}\n`); continue; }
      if (!can(S, pr.node, 2)) { ctx.err(`tar: ${e.p}: No se puede crear: ${E_ACCES}\n`); continue; }
      const nm = basename(target);
      if (e.t === 'd') { if (!pr.node.c[nm]) pr.node.c[nm] = mk(S, 'd', S.user, primaryGroup(S, S.user), e.m); }
      else if (e.t === 'l') pr.node.c[nm] = mk(S, 'l', S.user, primaryGroup(S, S.user), 0o777, { target: e.l });
      else { const n = mk(S, 'f', S.user, primaryGroup(S, S.user), e.m); n.data = e.d; pr.node.c[nm] = n; }
      if (v) ctx.out(e.p + '\n');
    }
    return 0;
  });
  def('gzip gunzip', (a, ctx) => {
    const S = ctx.S;
    const name = ctx.log[ctx.log.length - 1].name;
    const dec = name === 'gunzip' || a.includes('-d');
    const keep = a.includes('-k');
    let code = 0;
    for (const f of a.filter(x => !x.startsWith('-'))) {
      const r = get(S, f);
      if (r.err) { ctx.err(`${name}: ${f}: ${r.err}\n`); code = 1; continue; }
      if (r.node.t === 'd') { ctx.err(`${name}: ${f} es un directorio -- ignorado\n`); code = 2; continue; }
      if (dec) {
        if (!f.endsWith('.gz')) { ctx.err(`gunzip: ${f}: unknown suffix -- ignored\n`); code = 2; continue; }
        if (!r.node.data.startsWith('\x00GZ')) { ctx.err(`gunzip: ${f}: not in gzip format\n`); code = 1; continue; }
        try { writeFile(S, f.slice(0, -3), r.node.data.slice(3)); if (!keep) del(S, f); } catch (e) { ctx.err(`gunzip: ${e.message}\n`); code = 1; }
      } else {
        if (f.endsWith('.gz')) { ctx.err(`gzip: ${f} already has .gz suffix -- unchanged\n`); code = 2; continue; }
        try { writeFile(S, f + '.gz', '\x00GZ' + r.node.data); if (!keep) del(S, f); } catch (e) { ctx.err(`gzip: ${e.message}\n`); code = 1; }
      }
    }
    return code;
  });
  def('zcat', (a, ctx) => inputs(a, ctx, 'zcat', t => ctx.out(t.startsWith('\x00GZ') ? t.slice(3) : t)));

  // ---- divertidos (paquetes) ----
  def('cowsay', (a, ctx) => {
    const msg = a.join(' ') || (ctx.stdin || '').trim() || 'Muuu';
    const line = '-'.repeat(msg.length + 2);
    ctx.out(` ${'_'.repeat(msg.length + 2)}\n< ${msg} >\n ${line}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n`);
  });
  def('neofetch', (a, ctx) => {
    const S = ctx.S;
    const o = ctx.tty ? C.yel : '', x = ctx.tty ? C.off : '', b = ctx.tty ? C.bold : '';
    const up = Math.floor((Date.now() - S.bootTime) / 60000);
    const logo = ['            .-/+oossssoo+/-.', '        `:+ssssssssssssssssss+:`', '      -+ssssssssssssssssssyyssss+-', '    .ossssssssssssssssssdMMMNysssso.', '   /ssssssssssshdmmNNmmyNMMMMhssssss/', '  +ssssssssshmydMMMMMMMNddddyssssssss+', ' /sssssssshNMMMyhhyyyyhmNMMMNhssssssss/', '.ssssssssdMMMNhsssssssssshNMMMdssssssss.', '+sssshhhyNMMNyssssssssssssyNMMMysssssss+', 'ossyNMMMNyMMhsssssssssssssshmmmhssssssso'];
    const info = [`${b}${S.user}@${HOST}${x}`, '-'.repeat(S.user.length + HOST.length + 1), `${b}SO${x}: Ubuntu 24.04.1 LTS x86_64`, `${b}Kernel${x}: 6.8.0-45-generic`, `${b}Uptime${x}: ${Math.floor(up / 60)} horas, ${up % 60} min`, `${b}Paquetes${x}: ${1734 + S.installed.length} (dpkg)`, `${b}Shell${x}: bash 5.2.21`, `${b}CPU${x}: Intel i5-1135G7 (4) @ 2.400GHz`, `${b}Memoria${x}: 2610MiB / 7846MiB`, ''];
    ctx.out(logo.map((l, i) => o + pad(l, 42) + x + info[i]).join('\n') + '\n');
  });
  def('sl', (a, ctx) => { ctx.out('      ====        ________                ___________\n  _D _|  |_______/        \\__I_I_____===__|_________|\n   |(_)---  |   H\\________/ |   |        =|___ ___|\n   /     |  |   H  |  |     |   |         ||_| |_||\n  |      |  |   H  |__--------------------| [___] |\n  | ________|___H__/__|_____/[][]~\\_______|       |\n  |/ |   |-----------I_____I [][] []  D   |=======|_\n__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__\n |/-=|___|=    ||    ||    ||    |_____/~\\___/\n  \\_/      \\O=====O=====O=====O_/      \\_/\n(¡Querías escribir ls!)\n'); });

  // ---------- páginas de manual ----------
  const MAN = {
    ls: ['lista el contenido de directorios', 'ls [OPCIÓN]... [ARCHIVO]...', 'Muestra información sobre los archivos (por defecto, el directorio actual).\n-a   muestra también los archivos ocultos (los que empiezan por .)\n-l   formato largo: permisos, enlaces, dueño, grupo, tamaño, fecha, nombre\n-h   tamaños legibles (K, M, G), junto con -l\n-R   recursivo\n-i   muestra el número de nodo-i\n-t   ordena por fecha de modificación, -r invierte el orden, -S por tamaño', 'ls -la ~\nls -lh /var/log\nls -R proyectos'],
    cd: ['cambia el directorio de trabajo', 'cd [DIRECTORIO]', 'Orden interna del shell. Sin argumentos vuelve a tu directorio personal (~).\ncd ..   sube un nivel\ncd -    vuelve al directorio anterior\ncd /    va a la raíz del sistema de archivos', 'cd /etc\ncd ..\ncd ~/Documentos'],
    pwd: ['muestra el directorio de trabajo actual', 'pwd', 'Imprime la ruta absoluta del directorio en el que estás (print working directory).', 'pwd'],
    mkdir: ['crea directorios', 'mkdir [OPCIÓN]... DIRECTORIO...', 'Crea los directorios si no existen.\n-p   crea también los directorios padre necesarios y no da error si ya existen\n-v   informa de cada directorio creado\n-m   establece los permisos (modo), p. ej. -m 700', 'mkdir fotos\nmkdir -p proyectos/web/css'],
    rmdir: ['borra directorios vacíos', 'rmdir DIRECTORIO...', 'Elimina directorios solo si están vacíos. Para borrar un directorio con contenido usa rm -r.', 'rmdir vacio'],
    touch: ['cambia la fecha de un archivo o lo crea vacío', 'touch ARCHIVO...', 'Actualiza la fecha de modificación. Si el archivo no existe, lo crea vacío.', 'touch notas.txt\ntouch a.txt b.txt c.txt'],
    rm: ['borra archivos o directorios', 'rm [OPCIÓN]... ARCHIVO...', 'Borra archivos. En Linux no hay papelera: lo borrado con rm no se recupera.\n-r   borra directorios y su contenido de forma recursiva\n-f   no pregunta y no da error si el archivo no existe\n-i   pide confirmación antes de cada borrado\n-v   muestra lo que se borra', 'rm viejo.txt\nrm *.tmp\nrm -r carpeta'],
    cp: ['copia archivos y directorios', 'cp [OPCIÓN]... ORIGEN... DESTINO', 'Copia ORIGEN a DESTINO, o varios orígenes a un DIRECTORIO.\n-r   copia directorios recursivamente\n-i   pregunta antes de sobrescribir\n-p   conserva permisos y fechas\n-v   muestra lo que se copia', 'cp informe.txt informe.bak\ncp -r proyecto proyecto_copia\ncp *.txt Documentos/'],
    mv: ['mueve o renombra archivos', 'mv [OPCIÓN]... ORIGEN... DESTINO', 'Renombra ORIGEN a DESTINO, o mueve ORIGEN(es) a un DIRECTORIO. No necesita -r para directorios.', 'mv viejo.txt nuevo.txt\nmv foto.png Imágenes/'],
    cat: ['concatena archivos y los muestra', 'cat [OPCIÓN]... [ARCHIVO]...', 'Muestra el contenido de los archivos. Sin archivo, lee la entrada estándar.\n-n   numera las líneas', 'cat /etc/hostname\ncat -n script.sh\ncat a.txt b.txt > juntos.txt'],
    less: ['visor de archivos página a página', 'less ARCHIVO', 'Permite recorrer archivos largos. Teclas: espacio (página siguiente), b (anterior), /texto (buscar), q (salir).\nEn el simulador muestra el archivo completo.', 'less /var/log/syslog'],
    head: ['muestra el principio de un archivo', 'head [-n N] [ARCHIVO]...', 'Muestra las primeras 10 líneas (o N con -n N).', 'head /etc/passwd\nhead -n 3 ventas.csv'],
    tail: ['muestra el final de un archivo', 'tail [-n N] [-f] [ARCHIVO]...', 'Muestra las últimas 10 líneas (o N).\n-f   sigue el archivo y muestra las líneas nuevas (muy útil con logs)\n-n +N  muestra desde la línea N', 'tail -n 5 /var/log/syslog\ntail -f /var/log/auth.log'],
    wc: ['cuenta líneas, palabras y bytes', 'wc [-lwc] [ARCHIVO]...', '-l   líneas\n-w   palabras\n-c   bytes\nSin opciones muestra las tres.', 'wc -l /etc/passwd\nls | wc -l'],
    grep: ['busca líneas que coinciden con un patrón', 'grep [OPCIÓN]... PATRÓN [ARCHIVO]...', 'Imprime las líneas que contienen el PATRÓN (una expresión regular).\n-i   ignora mayúsculas/minúsculas\n-v   invierte: muestra las líneas que NO coinciden\n-n   muestra el número de línea\n-c   cuenta las coincidencias\n-r   busca recursivamente en directorios\n-l   solo muestra los nombres de archivo\n-w   coincide con palabras completas\n-E   expresiones regulares extendidas\n-o   muestra solo la parte que coincide', 'grep error app.log\ngrep -i "failed" /var/log/auth.log\ngrep -rn TODO proyecto/\ngrep -c ^ventas datos.csv'],
    find: ['busca archivos en una jerarquía de directorios', 'find [RUTA...] [EXPRESIÓN]', 'Recorre los directorios y muestra los archivos que cumplen todas las condiciones.\n-name PATRÓN    por nombre (usa comillas: "*.txt")\n-iname PATRÓN   igual, sin distinguir mayúsculas\n-type f|d|l     archivo, directorio o enlace\n-size +N[kMG]   tamaño mayor que N\n-user USUARIO   por propietario\n-perm MODO      por permisos\n-mmin -N        modificado hace menos de N minutos\n-empty          vacíos\n-maxdepth N     profundidad máxima\n-exec ORDEN {} \\;  ejecuta ORDEN sobre cada resultado\n-delete         borra los resultados', 'find ~ -name "*.txt"\nfind /etc -type f -name "*.conf"\nfind . -empty -type f -delete'],
    sort: ['ordena líneas de texto', 'sort [OPCIÓN]... [ARCHIVO]...', '-n   orden numérico\n-r   orden inverso\n-u   elimina duplicados\n-k N ordena por el campo N\n-t C usa C como separador de campos\n-h   orden por tamaños legibles (2K, 1G)', 'sort nombres.txt\nsort -t, -k3 -n ventas.csv\ndu -sh * | sort -h'],
    uniq: ['elimina líneas repetidas consecutivas', 'uniq [OPCIÓN]... [ARCHIVO]', 'Solo detecta repeticiones contiguas: casi siempre se usa después de sort.\n-c   antepone el número de repeticiones\n-d   muestra solo las repetidas\n-u   muestra solo las únicas', 'sort lista.txt | uniq\nsort ips.txt | uniq -c | sort -rn'],
    cut: ['extrae columnas de cada línea', 'cut -d DELIM -f CAMPOS [ARCHIVO]...', '-d C   delimitador (por defecto tabulador)\n-f L   campos a mostrar: 1  1,3  2-4\n-c L   caracteres a mostrar', 'cut -d: -f1 /etc/passwd\ncut -d, -f2,3 ventas.csv'],
    tr: ['traduce o elimina caracteres', 'tr [-ds] CONJUNTO1 [CONJUNTO2]', 'Lee de la entrada estándar.\ntr a-z A-Z        pasa a mayúsculas\ntr -d "0-9"       elimina dígitos\ntr -s " "         comprime espacios repetidos', 'echo hola | tr a-z A-Z\ncat datos.txt | tr -s " "'],
    tee: ['lee la entrada y la escribe en pantalla y en archivos', 'tee [-a] ARCHIVO...', 'Como una T de fontanería: la salida sigue por la tubería y además se guarda.\n-a   añade al final en vez de sobrescribir', 'ls -l | tee listado.txt'],
    echo: ['muestra una línea de texto', 'echo [-ne] [TEXTO]...', 'Imprime sus argumentos. Muy usado en scripts y con redirecciones.\n-n   no añade salto de línea final\n-e   interpreta \\n, \\t', 'echo "Hola $USER"\necho "linea" >> archivo.txt'],
    chmod: ['cambia los permisos de archivos', 'chmod [-R] MODO ARCHIVO...', 'MODO puede ser octal o simbólico.\nOctal: cada dígito suma r=4, w=2, x=1 para dueño, grupo y otros. 755 = rwxr-xr-x, 644 = rw-r--r--, 600 = rw-------\nSimbólico: [ugoa][+-=][rwx]  u=dueño g=grupo o=otros a=todos\n-R   recursivo', 'chmod 644 notas.txt\nchmod u+x script.sh\nchmod go-rwx privado/\nchmod -R 750 proyecto'],
    chown: ['cambia el propietario y el grupo de archivos', 'chown [-R] USUARIO[:GRUPO] ARCHIVO...', 'Solo root puede cambiar el dueño de un archivo (usa sudo).', 'sudo chown ana informe.txt\nsudo chown ana:devs -R proyecto/'],
    chgrp: ['cambia el grupo de archivos', 'chgrp [-R] GRUPO ARCHIVO...', 'Un usuario puede cambiar el grupo de sus archivos a un grupo al que pertenece.', 'chgrp devs informe.txt'],
    sudo: ['ejecuta una orden como otro usuario (root por defecto)', 'sudo [-u USUARIO] ORDEN', 'Permite a los usuarios autorizados (grupo sudo) ejecutar órdenes con privilegios de administrador. Pide TU contraseña, no la de root.\nsudo -i   abre un shell de root (sal con exit)\nsudo -l   lista lo que puedes hacer', 'sudo apt update\nsudo cat /etc/shadow\nsudo -u ana whoami'],
    su: ['cambia de usuario', 'su [-] [USUARIO]', 'Abre un shell como otro usuario (root por defecto). Con - carga su entorno y va a su directorio personal. Sal con exit.', 'su - ana\nexit'],
    whoami: ['muestra el nombre del usuario efectivo', 'whoami', 'Imprime el nombre del usuario con el que estás trabajando.', 'whoami\nsudo whoami'],
    id: ['muestra identificadores de usuario y grupos', 'id [USUARIO]', 'Muestra el UID, el GID del grupo principal y todos los grupos.', 'id\nid ana'],
    groups: ['muestra los grupos de un usuario', 'groups [USUARIO]', 'Lista los grupos a los que pertenece el usuario.', 'groups\ngroups ana'],
    useradd: ['crea un usuario', 'useradd [-m] [-s SHELL] [-G GRUPOS] USUARIO', 'Requiere root.\n-m   crea el directorio personal en /home\n-s   shell de inicio\n-G   grupos suplementarios separados por comas', 'sudo useradd -m -s /bin/bash ana'],
    usermod: ['modifica una cuenta de usuario', 'usermod [-aG GRUPOS] [-s SHELL] USUARIO', '-aG GRUPO   añade el usuario a un grupo SIN quitarlo de los demás (¡no olvides la -a!)', 'sudo usermod -aG devs ana'],
    groupadd: ['crea un grupo', 'groupadd GRUPO', 'Requiere root.', 'sudo groupadd devs'],
    userdel: ['borra una cuenta de usuario', 'userdel [-r] USUARIO', '-r   borra también su directorio personal', 'sudo userdel -r ana'],
    passwd: ['cambia la contraseña de un usuario', 'passwd [USUARIO]', 'Sin argumentos cambia tu propia contraseña. Root puede cambiar la de cualquiera. Las contraseñas cifradas se guardan en /etc/shadow.', 'passwd\nsudo passwd ana'],
    ps: ['muestra los procesos', 'ps [OPCIONES]', 'Sin opciones: los procesos de tu terminal.\nps aux   todos los procesos con usuario, %CPU, %MEM, estado (STAT) y orden\nps -ef   todos, con PID y PPID (padre)\nps -u USUARIO   los de un usuario\nEstados (STAT): R ejecutando, S durmiendo, T detenido, Z zombi, N prioridad baja (nice)', 'ps\nps aux\nps aux | grep python\nps -ef'],
    top: ['muestra los procesos en tiempo real', 'top', 'Panel que se actualiza con la carga, la memoria y los procesos ordenados por %CPU. Teclas: q salir, k matar, r renice, M ordenar por memoria.\nEn el simulador muestra una instantánea.', 'top'],
    kill: ['envía una señal a un proceso', 'kill [-SEÑAL] PID... | %TRABAJO', 'Por defecto envía SIGTERM (15): pide al proceso que termine limpiamente.\n-9 / -KILL   SIGKILL: lo mata sin posibilidad de ignorarla\n-STOP / -19  lo detiene;  -CONT / -18 lo reanuda\n-HUP / -1    suele usarse para recargar configuración\nkill -l lista las señales.', 'kill 1234\nkill -9 1234\nkill %1'],
    killall: ['mata procesos por nombre', 'killall [-SEÑAL] NOMBRE', 'Envía la señal a todos los procesos con ese nombre.', 'killall sleep'],
    pkill: ['envía señales a procesos por patrón', 'pkill [-SEÑAL] PATRÓN', 'Como killall pero el patrón puede ser parte del nombre.', 'pkill -9 minero'],
    pgrep: ['busca procesos por nombre', 'pgrep [-l] [-u USUARIO] PATRÓN', 'Imprime los PID de los procesos que coinciden.', 'pgrep -l sshd'],
    jobs: ['lista los trabajos del shell', 'jobs [-l]', 'Muestra los trabajos lanzados desde esta terminal (con & o detenidos con Ctrl+Z).', 'sleep 100 &\njobs'],
    fg: ['pasa un trabajo a primer plano', 'fg [%N]', 'El trabajo ocupa la terminal hasta que termina.', 'fg %1'],
    bg: ['reanuda un trabajo detenido en segundo plano', 'bg [%N]', 'Continúa un trabajo detenido (Ctrl+Z o SIGSTOP) sin ocupar la terminal.', 'bg %1'],
    nice: ['ejecuta una orden con otra prioridad', 'nice [-n N] ORDEN', 'N va de -20 (máxima prioridad) a 19 (mínima). Por defecto 10. Solo root puede usar valores negativos.', 'nice -n 15 sleep 600 &'],
    renice: ['cambia la prioridad de un proceso en ejecución', 'renice [-n] N -p PID', 'Un usuario normal solo puede bajar la prioridad (subir el número) de sus propios procesos.', 'renice -n 10 -p 2345'],
    pstree: ['muestra los procesos en forma de árbol', 'pstree [-p]', 'Visualiza la jerarquía padre-hijo. Todo proceso desciende de init/systemd (PID 1).\n-p   muestra los PID', 'pstree -p'],
    sleep: ['espera un tiempo', 'sleep N[smhd]', 'No hace nada durante N segundos. Muy útil para practicar con procesos en segundo plano.', 'sleep 300 &'],
    man: ['muestra el manual de una orden', 'man ORDEN', 'Abre la página de manual. Secciones: 1 órdenes de usuario, 5 formatos de archivo, 8 administración.', 'man ls\nman grep'],
    history: ['muestra el historial de órdenes', 'history [N]', 'Lista las órdenes anteriores numeradas. !! repite la última orden, !N la número N.', 'history\nhistory 5'],
    tar: ['empaqueta y desempaqueta archivos', 'tar [-cxtvzf] ARCHIVO [ARCHIVOS...]', '-c crear  -x extraer  -t listar contenido\n-v detallado  -z comprimir con gzip  -f ARCHIVO nombre del paquete\n-C DIR  extraer en DIR', 'tar -czvf copia.tar.gz proyecto/\ntar -tzf copia.tar.gz\ntar -xzvf copia.tar.gz -C /tmp'],
    gzip: ['comprime archivos', 'gzip [-dk] ARCHIVO...', 'Sustituye el archivo por ARCHIVO.gz. -d descomprime, -k conserva el original.', 'gzip registro.log\ngunzip registro.log.gz'],
    apt: ['gestor de paquetes de Debian/Ubuntu', 'apt ORDEN [PAQUETES]', 'update   actualiza la lista de paquetes disponibles (no instala nada)\nupgrade  actualiza los paquetes instalados\ninstall  instala   remove  desinstala   search  busca   show  detalles\nlist --installed   lista los instalados\nRequiere sudo para modificar el sistema.', 'sudo apt update\nsudo apt install tree\napt search web'],
    systemctl: ['controla systemd y los servicios', 'systemctl ORDEN [SERVICIO]', 'status   estado de un servicio\nstart / stop / restart   arranca, detiene, reinicia (sudo)\nenable / disable         arranque automático al encender (sudo)\nlist-units --type=service   servicios activos', 'systemctl status ssh\nsudo systemctl restart nginx\nsudo systemctl enable nginx'],
    ip: ['muestra y configura la red', 'ip OBJETO ORDEN', 'ip a (address)   interfaces y direcciones IP\nip r (route)     tabla de rutas y puerta de enlace\nip link          interfaces de red', 'ip a\nip r'],
    ping: ['comprueba la conectividad con otro equipo', 'ping [-c N] HOST', 'Envía paquetes ICMP ECHO_REQUEST y mide el tiempo de respuesta.\n-c N   envía N paquetes y termina', 'ping -c 4 google.com\nping 192.168.1.1'],
    df: ['muestra el uso del espacio en disco', 'df [-hT]', 'Muestra los sistemas de archivos montados, su tamaño y el espacio libre.\n-h legible  -T muestra el tipo', 'df -h'],
    du: ['estima el espacio usado por archivos', 'du [-sh] [RUTA]...', '-s   solo el total\n-h   legible\n-d N profundidad', 'du -sh ~\ndu -h -d 1 /var'],
    free: ['muestra la memoria libre y usada', 'free [-h]', 'Memoria RAM y área de intercambio (swap). La memoria "búf/caché" el kernel la libera cuando hace falta; mira la columna "disponible".', 'free -h'],
    uname: ['muestra información del sistema', 'uname [-asrm]', '-a todo  -r versión del kernel  -m arquitectura  -s nombre del kernel', 'uname -a\nuname -r'],
    ln: ['crea enlaces entre archivos', 'ln [-s] DESTINO NOMBRE_ENLACE', 'Sin -s crea un enlace DURO: otro nombre para el mismo nodo-i (mismos datos).\nCon -s crea un enlace SIMBÓLICO: un archivo pequeño que apunta a una ruta (como un acceso directo). Si el original se borra, queda roto.', 'ln -s /var/log/syslog milog\nln datos.txt datos_dura.txt'],
    stat: ['muestra el estado detallado de un archivo', 'stat ARCHIVO', 'Muestra tamaño, nodo-i, número de enlaces, permisos en octal, dueño y fechas.', 'stat /etc/passwd'],
    file: ['determina el tipo de un archivo', 'file ARCHIVO...', 'Examina el contenido (no la extensión) para decir qué tipo de archivo es.', 'file /bin/ls\nfile script.sh'],
    nano: ['editor de texto sencillo para la terminal', 'nano ARCHIVO', 'Abre el archivo para editarlo. Atajos: Ctrl+O guarda, Ctrl+X sale, Ctrl+K corta una línea, Ctrl+W busca.', 'nano notas.txt'],
    which: ['localiza el ejecutable de una orden', 'which ORDEN', 'Busca la orden en los directorios del PATH.', 'which ls'],
    type: ['indica cómo se interpretaría una orden', 'type ORDEN', 'Dice si es un alias, una orden interna del shell, una palabra clave o un ejecutable.', 'type cd\ntype ll'],
    export: ['define variables de entorno', 'export NOMBRE=valor', 'Las variables exportadas las heredan los procesos hijos.', 'export EDITOR=nano\necho $EDITOR'],
    env: ['muestra las variables de entorno', 'env', 'Lista todas las variables de entorno del proceso.', 'env | grep HOME'],
    alias: ['define atajos de órdenes', "alias NOMBRE='orden'", 'Sin argumentos lista los alias. Para hacerlos permanentes, añádelos a ~/.bashrc.', "alias ll='ls -alF'\nalias"],
    test: ['evalúa una expresión condicional', 'test EXPR   o   [ EXPR ]', '-f ARCH existe y es archivo   -d DIR es directorio   -e existe\n-z CAD vacía   -n CAD no vacía   A = B iguales   A != B distintas\nN -eq M  -ne  -lt  -le  -gt  -ge   comparaciones numéricas\n¡Los espacios dentro de los corchetes son obligatorios!', '[ -f notas.txt ] && echo existe\nif [ "$1" -gt 10 ]; then echo grande; fi'],
    bash: ['intérprete de órdenes GNU Bourne-Again SHell', 'bash [SCRIPT] [ARGUMENTOS]', 'Ejecuta un script. Dentro del script: $1 $2... argumentos, $# número de argumentos, $@ todos, $? código de salida de la última orden, $0 nombre del script.', 'bash saludo.sh Ana\n./saludo.sh Ana'],
    seq: ['imprime una secuencia de números', 'seq [INICIO [PASO]] FIN', 'Muy útil en bucles for.', 'seq 5\nseq 0 10 100'],
    date: ['muestra la fecha y la hora', 'date [+FORMATO]', '%Y año, %m mes, %d día, %H hora, %M minuto, %S segundo, %F = %Y-%m-%d', 'date\ndate +%F\ndate "+%H:%M"'],
    diff: ['compara archivos línea a línea', 'diff ARCHIVO1 ARCHIVO2', 'Muestra qué cambia: < líneas del primero, > líneas del segundo. Código de salida 0 si son iguales.', 'diff config.old config.new'],
    curl: ['transfiere datos desde o hacia una URL', 'curl [-I] URL', 'Descarga el contenido de una URL y lo muestra. -I solo las cabeceras.', 'curl localhost\ncurl -I google.com'],
    ss: ['muestra los sockets (puertos abiertos)', 'ss -tuln', '-t TCP -u UDP -l en escucha -n numérico', 'ss -tuln'],
    umask: ['muestra o fija la máscara de permisos por defecto', 'umask [MODO]', 'Los archivos nuevos se crean con 666 y los directorios con 777, menos la máscara. Con umask 022 → archivos 644, directorios 755.', 'umask\numask 027'],
    tree: ['muestra directorios en forma de árbol', 'tree [-a] [-d] [-L N] [DIR]', 'Hay que instalarlo: sudo apt install tree\n-a ocultos  -d solo directorios  -L N niveles', 'tree ~\ntree -L 2 /etc'],
    journalctl: ['consulta el registro de systemd', 'journalctl [-u SERVICIO]', 'Muestra los mensajes del sistema y de los servicios.', 'journalctl -u ssh'],
    source: ['ejecuta un archivo en el shell actual', 'source ARCHIVO  o  . ARCHIVO', 'A diferencia de ./script, los cambios (variables, cd) afectan a tu shell actual.', 'source ~/.bashrc'],
    read: ['lee una línea de la entrada estándar', 'read [-p MENSAJE] VARIABLE...', 'Guarda lo leído en la variable. En el simulador, pásale datos con una tubería.', 'echo Ana | (read nombre; echo $nombre)'],
    clear: ['limpia la pantalla de la terminal', 'clear', 'Atajo de teclado: Ctrl+L.', 'clear'],
    hostname: ['muestra el nombre del equipo', 'hostname [-I]', '-I muestra las direcciones IP.', 'hostname\nhostname -I'],
    uptime: ['indica cuánto tiempo lleva encendido el sistema', 'uptime [-p]', 'Muestra la hora, el tiempo encendido, los usuarios conectados y la carga media (1, 5 y 15 minutos).', 'uptime'],
    printf: ['imprime con formato', 'printf FORMATO [ARGUMENTOS]', '%s cadena  %d entero  %f decimal  \\n salto de línea', 'printf "%s tiene %d años\\n" Ana 20'],
    lsblk: ['lista los dispositivos de bloque', 'lsblk', 'Muestra discos y particiones y dónde están montados.', 'lsblk'],
    mount: ['monta sistemas de archivos', 'mount [DISPOSITIVO DIR]', 'Sin argumentos muestra lo que está montado.', 'mount | grep sda'],
    alias_: ['', '', '']
  };
  delete MAN.alias_;
  MAN.gunzip = MAN.gzip; MAN.more = MAN.less; MAN['['] = MAN.test; MAN.sh = MAN.bash; MAN.adduser = MAN.useradd; MAN['apt-get'] = MAN.apt; MAN.htop = MAN.top; MAN.dir = MAN.ls;

  // ---------- API pública ----------
  function execLine(S, line, hooks = {}) {
    const out = [];
    const log = [];
    const ctx = {
      S, log, tty: true, stdin: null, counter: { n: 0 }, shared: { editor: null },
      frame: S.frame || (S.frame = { args: [], name: 'bash', env: S.env }),
      out: s => out.push({ t: 'o', s }), err: s => out.push({ t: 'e', s }),
      onClear: () => { out.length = 0; out.push({ t: 'clear' }); }
    };
    S.frame.env = S.env;
    let code = 0;
    try {
      const ast = parse(line);
      code = execList(ast, ctx);
    } catch (e) {
      if (e instanceof Incomplete) return { incomplete: true };
      if (e instanceof ShellError) { out.push({ t: 'e', s: 'bash: ' + e.message + '\n' }); code = e.code || 2; }
      else if (e instanceof ExitSignal) code = e.code;
      else { out.push({ t: 'e', s: 'error interno del simulador: ' + e.message + '\n' }); console.error(e); code = 1; }
    }
    S.lastCode = code;
    return { out, log, code, editor: ctx.shared.editor };
  }

  function complete(S, line) {
    // devuelve {replace: texto completado, options: [...]}
    const m = line.match(/(^|[\s|;&<>]+)([^\s|;&<>]*)$/);
    const word = m ? m[2] : '';
    const before = line.slice(0, line.length - word.length);
    const isCmd = /^\s*(sudo\s+)?$/.test(before) || /[|;&]\s*$/.test(before);
    let cands = [];
    if (isCmd && !word.includes('/')) {
      cands = Object.keys(CMDS).filter(c => c.startsWith(word) && /^[a-z]/.test(c) && (!PKG_CMDS[c] || S.installed.includes(PKG_CMDS[c]))).concat(Object.keys(S.aliases).filter(c => c.startsWith(word)));
      cands = [...new Set(cands)].sort();
      if (word.startsWith('.')) cands = [];
    }
    if (!cands.length || word.includes('/') || !isCmd) {
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const filePart = slash >= 0 ? word.slice(slash + 1) : word;
      const r = get(S, dirPart || '.');
      if (!r.err && r.node.t === 'd' && can(S, r.node, 4)) {
        cands = Object.keys(r.node.c).filter(k => k.startsWith(filePart) && (filePart.startsWith('.') || !k.startsWith('.'))).sort(cmpName).map(k => {
          let n = r.node.c[k];
          if (n.t === 'l') { const t = get(S, (dirPart || '') + k); if (!t.err) n = t.node; }
          return dirPart + k + (n.t === 'd' ? '/' : '');
        });
        const cmdName = before.trim().split(/\s+/)[0];
        if (cmdName === 'cd' || cmdName === 'rmdir') cands = cands.filter(c => c.endsWith('/'));
      }
    }
    if (!cands.length) return { line, options: [] };
    if (cands.length === 1) {
      const c = cands[0];
      return { line: before + c + (c.endsWith('/') ? '' : ' '), options: [] };
    }
    let pre = cands[0];
    for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
    return { line: before + (pre.length > word.length ? pre : word), options: cands.map(c => c.replace(/.*\/(?=.)/, '')) };
  }

  function prompt(S) {
    const home = homeOf(S, S.user);
    let p = S.cwd;
    if (p === home) p = '~'; else if (p.startsWith(home + '/')) p = '~' + p.slice(home.length);
    return { user: S.user, host: HOST, path: p, sym: S.user === 'root' ? '#' : '$' };
  }

  return {
    createSystem, execLine, serialize, deserialize, complete, prompt, reapProcs, put, del, get, lookup, abspath, readFile, writeFile, syncEtc, can, modeStr, MAN, CMDS, stripAnsi, homeOf, PKGS, HOST
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
