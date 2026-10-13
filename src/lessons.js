// ================= MÓDULOS: teoría + retos =================
const HOME = '/home/estudiante';
const SCHED_EXAMPLE = [
  { name: 'P1', arrival: 0, burst: 8, prio: 2 },
  { name: 'P2', arrival: 1, burst: 4, prio: 4 },
  { name: 'P3', arrival: 2, burst: 9, prio: 1 },
  { name: 'P4', arrival: 3, burst: 5, prio: 3 }
];
const REF_CLASSIC = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1';
const REF_BELADY = '1 2 3 4 1 2 5 1 2 3 4 5';

// utilidades para preparar laboratorios
function H(S, rel, data, opts = {}) { // crea bajo el home del estudiante con dueño estudiante
  return Engine.put(S, (HOME + '/' + rel).slice(1), data, Object.assign({ owner: 'estudiante' }, opts));
}
function wipe(S, rel) { Engine.del(S, rel.startsWith('/') ? rel : HOME + '/' + rel); }
function removeUser(S, u) { if (S.users[u]) { delete S.users[u]; Engine.del(S, '/home/' + u); } if (S.groups[u]) delete S.groups[u]; Object.values(S.groups).forEach(g => g.members = g.members.filter(m => m !== u)); }
function addProc(S, p) { S.procs = S.procs.filter(x => x.pid !== p.pid); S.procs.push(Object.assign({ ppid: 1321, state: 'S', cpu: 0, mem: 0.2, nice: 0, tty: 'pts/0', start: '03:58', vsz: 24000, rss: 9000 }, p)); }
function makeLog(n) {
  const lv = ['INFO', 'INFO', 'INFO', 'WARN', 'INFO', 'ERROR', 'INFO', 'DEBUG'];
  const msgs = { INFO: ['Petición atendida en 23 ms', 'Usuario autenticado', 'Caché actualizada', 'Conexión cerrada'], WARN: ['Uso de memoria al 85%', 'Respuesta lenta de la base de datos', 'Reintentando conexión'], ERROR: ['No se pudo conectar a la base de datos', 'Tiempo de espera agotado', 'Archivo de configuración no encontrado'], DEBUG: ['Variable x=42', 'Entrando en procesar_pedido()'] };
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = lv[(i * 7 + 3) % lv.length];
    const m = msgs[l][i % msgs[l].length];
    out.push(`2026-10-13 0${3 + Math.floor(i / 30)}:${String((i * 2) % 60).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')} [${l}] ${m}`);
  }
  return out.join('\n') + '\n';
}

const MODULES = [
  // ------------------------------------------------------------------ 1
  {
    id: 'inicio', title: 'Primeros pasos en la terminal', short: 'Primeros pasos',
    ref: 'LFS101 · Cap. 1–3', so: 'Introducción a los SO', mins: 15,
    summary: 'Qué es Linux, qué es el shell y cómo se escribe una orden.',
    theory: `
<h2>Linux en una frase</h2>
<p><strong>Linux es un núcleo (kernel)</strong>: el programa que controla el hardware y reparte la CPU, la memoria y los dispositivos entre los programas. Lo creó Linus Torvalds en 1991. Lo que llamamos "un Linux" (Ubuntu, Fedora, Debian…) es una <strong>distribución</strong>: el kernel más las herramientas GNU, un gestor de paquetes, un sistema de arranque y, a veces, un escritorio.</p>
<table class="t">
<tr><th>Familia</th><th>Distribuciones</th><th>Paquetes</th></tr>
<tr><td>Debian</td><td>Debian, Ubuntu, Linux Mint</td><td><code>.deb</code> con <code>apt</code></td></tr>
<tr><td>Red Hat</td><td>RHEL, Fedora, Rocky, CentOS Stream</td><td><code>.rpm</code> con <code>dnf</code></td></tr>
<tr><td>SUSE</td><td>openSUSE, SLES</td><td><code>.rpm</code> con <code>zypper</code></td></tr>
</table>
<p>Este laboratorio simula un <strong>Ubuntu 24.04</strong>, de la familia Debian.</p>
<h2>Kernel, shell y terminal</h2>
<ul>
<li>El <strong>kernel</strong> trabaja en modo privilegiado; los programas le piden cosas mediante <em>llamadas al sistema</em> (<code>open</code>, <code>read</code>, <code>fork</code>…).</li>
<li>El <strong>shell</strong> (aquí <code>bash</code>) es un programa normal que lee lo que escribes, lo interpreta y lanza otros programas.</li>
<li>La <strong>terminal</strong> es la ventana donde escribes y ves la salida.</li>
</ul>
<div class="so"><b>Para tu clase de SO</b> El SO cumple dos papeles: <em>máquina extendida</em> (oculta el hardware tras abstracciones como archivos y procesos) y <em>administrador de recursos</em> (decide quién usa la CPU, la memoria y los discos). El shell es la interfaz de usuario de ese sistema, no parte del kernel.</div>
<h2>Cómo leer el prompt</h2>
<pre class="ex"><span class="pu">estudiante</span>@<span class="ph">linux-trainee</span>:<span class="pp">~</span>$</pre>
<p>Usuario <code>estudiante</code>, en el equipo <code>linux-trainee</code>, dentro del directorio <code>~</code> (tu carpeta personal). El <code>$</code> indica usuario normal; <code>#</code> indica <strong>root</strong>, el administrador.</p>
<h2>Anatomía de una orden</h2>
<pre class="ex">orden  -opciones  argumentos
ls     -l         /etc</pre>
<p>Linux distingue mayúsculas: <code>ls</code> funciona, <code>LS</code> no. Las opciones cortas se pueden juntar (<code>ls -la</code> es lo mismo que <code>ls -l -a</code>).</p>
<p>Pulsa en cualquier orden marcada con ▸ para copiarla a la terminal:</p>
<pre class="try">whoami</pre>
<pre class="try">date</pre>
<pre class="try">echo "Hola, Linux"</pre>
<pre class="try">uname -r</pre>
<h2>Pedir ayuda</h2>
<p><code>man orden</code> abre el manual. Casi todas las órdenes aceptan también <code>--help</code>. Escribe <code>help</code> para ver todo lo que entiende este simulador.</p>
<h2>Atajos que usarás siempre</h2>
<table class="t"><tr><td><kbd>Tab</kbd></td><td>autocompleta órdenes y rutas (púlsalo dos veces para ver opciones)</td></tr><tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>recorre las órdenes anteriores</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>L</kbd></td><td>limpia la pantalla (igual que <code>clear</code>)</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td>cancela la línea o el programa actual</td></tr></table>`,
    tasks: [
      { t: 'Averigua con qué usuario estás trabajando.', hint: 'La orden se pregunta literalmente "¿quién soy?" en inglés.', sol: 'whoami', check: c => c.ran('whoami') },
      { t: 'Muestra la fecha y la hora del sistema.', hint: 'Es una palabra en inglés de 4 letras.', sol: 'date', check: c => c.ran('date') },
      { t: 'Haz que la terminal imprima el texto <code>Hola, Linux</code>.', hint: 'echo repite lo que le pases. Usa comillas para que la coma y el espacio formen parte del texto.', sol: 'echo "Hola, Linux"', check: c => c.ran('echo', a => /hola,? *linux/i.test(a.join(' '))) },
      { t: 'Descubre la versión del kernel que está ejecutando esta máquina.', hint: 'uname muestra datos del sistema; la opción -r da la versión (release) del kernel.', sol: 'uname -r', check: c => c.ran('uname', a => a.some(x => /r|a/.test(x))) },
      { t: 'Abre el manual de la orden <code>ls</code>.', hint: 'man seguido del nombre de la orden.', sol: 'man ls', check: c => c.ran('man', a => a.includes('ls')) },
      { t: 'Muestra el historial de las órdenes que has escrito.', hint: 'La orden se llama igual que "historia" en inglés.', sol: 'history', check: c => c.ran('history') }
    ]
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'navegar', title: 'Moverse por el sistema de archivos', short: 'Navegar',
    ref: 'LFS101 · Cap. 3 y 7', so: 'Sistemas de archivos', mins: 25,
    summary: 'El árbol de directorios, rutas absolutas y relativas, ls y cd.',
    setup(S) { H(S, '.mensaje_oculto', 'Lo encontraste. Los archivos ocultos empiezan por un punto.\nPalabra clave: PINGUINO\n'); },
    theory: `
<h2>Todo cuelga de <code>/</code></h2>
<p>En Linux no hay letras de unidad como <code>C:</code>. Hay un único árbol que empieza en la <strong>raíz</strong> <code>/</code>; discos, memorias USB y particiones se <em>montan</em> en alguna carpeta de ese árbol. La organización la fija el estándar <strong>FHS</strong> (Filesystem Hierarchy Standard):</p>
<table class="t">
<tr><td><code>/bin</code>, <code>/usr/bin</code></td><td>Programas (órdenes) del sistema. En Ubuntu moderno <code>/bin</code> es un enlace a <code>/usr/bin</code>.</td></tr>
<tr><td><code>/sbin</code></td><td>Programas de administración.</td></tr>
<tr><td><code>/boot</code></td><td>El kernel (<code>vmlinuz</code>) y el cargador de arranque.</td></tr>
<tr><td><code>/dev</code></td><td>Dispositivos representados como archivos (<code>/dev/sda</code> es el disco).</td></tr>
<tr><td><code>/etc</code></td><td>Configuración del sistema, en archivos de texto.</td></tr>
<tr><td><code>/home</code></td><td>Directorios personales de los usuarios.</td></tr>
<tr><td><code>/root</code></td><td>Directorio personal del administrador.</td></tr>
<tr><td><code>/proc</code></td><td>Sistema de archivos virtual: el kernel expone ahí información de procesos y hardware.</td></tr>
<tr><td><code>/tmp</code></td><td>Archivos temporales; se vacía al reiniciar.</td></tr>
<tr><td><code>/var</code></td><td>Datos que cambian: registros (<code>/var/log</code>), colas, cachés, webs.</td></tr>
<tr><td><code>/usr</code></td><td>Programas, bibliotecas y documentación instalados.</td></tr>
</table>
<h2>Dónde estoy y qué hay aquí</h2>
<pre class="try">pwd</pre>
<pre class="try">ls</pre>
<pre class="try">ls -l</pre>
<pre class="try">ls -a</pre>
<p><code>-l</code> da el formato largo (permisos, dueño, tamaño, fecha). <code>-a</code> muestra también los <strong>archivos ocultos</strong>: cualquier nombre que empiece por punto, como <code>.bashrc</code>.</p>
<h2>Rutas absolutas y relativas</h2>
<ul>
<li><strong>Absoluta</strong>: empieza por <code>/</code> y vale desde cualquier sitio: <code>/home/estudiante/Documentos</code>.</li>
<li><strong>Relativa</strong>: parte del directorio actual: <code>Documentos</code>, <code>../profesor</code>.</li>
</ul>
<table class="t">
<tr><td><code>.</code></td><td>el directorio actual</td></tr>
<tr><td><code>..</code></td><td>el directorio padre (un nivel arriba)</td></tr>
<tr><td><code>~</code></td><td>tu directorio personal, <code>/home/estudiante</code></td></tr>
<tr><td><code>-</code></td><td>con <code>cd</code>, el directorio donde estabas antes</td></tr>
</table>
<pre class="try">cd /etc</pre>
<pre class="try">cd ..</pre>
<pre class="try">cd ~/Documentos</pre>
<pre class="try">cd</pre>
<p><code>cd</code> sin nada te devuelve a casa. Usa <kbd>Tab</kbd> para no escribir nombres completos: <code>cd Doc</code> + <kbd>Tab</kbd> se completa solo.</p>
<div class="so"><b>Para tu clase de SO</b> Un directorio es un archivo especial que contiene una tabla de pares <em>nombre → número de nodo-i</em>. Resolver la ruta <code>/home/estudiante</code> significa leer el directorio raíz, buscar <code>home</code>, leer ese directorio y buscar <code>estudiante</code>. Por eso <code>.</code> y <code>..</code> son entradas reales dentro de cada directorio.</div>`,
    tasks: [
      { t: 'Muestra la ruta del directorio en el que estás.', hint: 'print working directory.', sol: 'pwd', check: c => c.ran('pwd') },
      { t: 'Lista el contenido de la raíz del sistema, <code>/</code>.', hint: 'ls acepta una ruta como argumento.', sol: 'ls /', check: c => c.ran('ls', (a, e) => a.includes('/') || (e.cwd === '/' && !a.some(x => !x.startsWith('-')))) },
      { t: 'Entra en el directorio de configuración <code>/etc</code> usando una ruta absoluta.', hint: 'cd seguido de una ruta que empieza por /.', sol: 'cd /etc', check: c => c.S.cwd === '/etc' },
      { t: 'Estando en <code>/etc</code>, muestra el contenido del archivo <code>hostname</code>.', hint: 'cat muestra el contenido de un archivo.', sol: 'cat hostname', check: c => c.ran('cat') && c.out.includes('linux-trainee') },
      { t: 'Sube un nivel con <code>..</code> (deberías quedar en la raíz).', hint: 'cd .. sube al directorio padre.', sol: 'cd ..', check: c => c.S.cwd === '/' && c.ran('cd', a => a[0] === '..' || a[0] === '../') },
      { t: 'Vuelve a tu directorio personal de la forma más corta posible.', hint: 'cd sin argumentos, o cd ~.', sol: 'cd', check: c => c.S.cwd === HOME },
      { t: 'Lista también los archivos ocultos de tu directorio personal.', hint: 'Añade a ls la opción que muestra "all", todos.', sol: 'ls -a', check: c => c.ran('ls', a => a.some(x => /^-\w*[aA]/.test(x))) },
      { t: 'Hay un archivo oculto con un mensaje. Muestra su contenido.', hint: 'Su nombre empieza por .mensaje. Usa cat y Tab para completarlo.', sol: 'cat .mensaje_oculto', check: c => c.out.includes('PINGUINO') },
      { t: 'Entra en <code>Documentos</code> usando una ruta <em>relativa</em> y lista sus archivos en formato largo.', hint: 'Desde ~ basta con cd Documentos (sin barra inicial). Luego ls -l.', sol: 'cd Documentos && ls -l', check: c => c.S.cwd === HOME + '/Documentos' && c.ranEver('cd', a => a[0] && !a[0].startsWith('/') && !a[0].startsWith('~')) && c.ran('ls', a => a.some(x => /^-\w*l/.test(x))) }
    ]
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'archivos', title: 'Crear, copiar, mover y borrar', short: 'Archivos',
    ref: 'LFS101 · Cap. 7–8', so: 'Sistemas de archivos', mins: 25,
    summary: 'mkdir, touch, cp, mv, rm y los comodines * y ?.',
    setup(S) {
      wipe(S, 'proyecto'); wipe(S, 'proyecto_respaldo'); wipe(S, 'Descargas');
      H(S, 'Descargas', null);
      ['foto_playa.jpg', 'foto_cumple.jpg', 'cancion.mp3', 'temp1.tmp', 'temp2.tmp', 'temp3.tmp', 'informe_final.txt'].forEach(f => H(S, 'Descargas/' + f, f.endsWith('.txt') ? 'Informe del semestre\n' : f.endsWith('.tmp') ? 'basura\n' : '\x00datos binarios\n'));
      if (!Engine.get(S, HOME + '/Documentos/bienvenida.txt').node) H(S, 'Documentos/bienvenida.txt', 'Hola, estudiante.\n');
    },
    theory: `
<h2>Crear</h2>
<pre class="try">mkdir pruebas</pre>
<pre class="try">mkdir -p proyecto/src/img</pre>
<pre class="try">touch notas.txt</pre>
<p><code>mkdir</code> crea directorios; con <code>-p</code> crea también los intermedios que falten. <code>touch</code> crea un archivo vacío (o actualiza su fecha si ya existe).</p>
<h2>Copiar y mover</h2>
<pre class="ex">cp origen destino        # copia un archivo
cp -r carpeta copia      # copia un directorio entero (recursivo)
mv viejo.txt nuevo.txt   # renombra
mv archivo.txt carpeta/  # mueve a otra carpeta</pre>
<p>En Linux <strong>renombrar es mover</strong>: <code>mv</code> hace las dos cosas. Si el destino es un directorio existente, el archivo entra en él con el mismo nombre.</p>
<h2>Borrar</h2>
<pre class="ex">rm archivo.txt     # borra un archivo
rmdir vacia/       # borra un directorio vacío
rm -r carpeta/     # borra un directorio y todo su contenido</pre>
<div class="warn"><b>Cuidado</b> En la terminal no hay papelera: lo que borra <code>rm</code> desaparece. <code>rm -i</code> pide confirmación. Nunca ejecutes <code>rm -rf /</code> ni <code>rm -rf *</code> sin mirar dos veces dónde estás.</div>
<h2>Comodines (globbing)</h2>
<p>El shell expande los comodines <em>antes</em> de ejecutar la orden; el programa recibe la lista de nombres ya resuelta.</p>
<table class="t">
<tr><td><code>*</code></td><td>cualquier cadena, incluso vacía: <code>*.txt</code></td></tr>
<tr><td><code>?</code></td><td>exactamente un carácter: <code>temp?.tmp</code></td></tr>
<tr><td><code>[abc]</code></td><td>un carácter de la lista: <code>foto[12].jpg</code></td></tr>
</table>
<pre class="try">ls ~/Descargas/*.jpg</pre>
<pre class="try">echo ~/Descargas/temp?.tmp</pre>
<p>Truco: antes de un <code>rm</code> con comodines, prueba el mismo patrón con <code>ls</code> o <code>echo</code> para ver qué se borraría.</p>
<div class="so"><b>Para tu clase de SO</b> <code>mv</code> dentro del mismo sistema de archivos no copia datos: solo cambia la entrada de directorio (llamada al sistema <code>rename()</code>), por eso es instantáneo aunque el archivo pese gigas. <code>cp</code> en cambio lee y escribe todos los bloques.</div>`,
    tasks: [
      { t: 'Crea de una sola vez la estructura <code>~/proyecto/src</code>.', hint: 'mkdir con la opción que crea los directorios padre.', sol: 'mkdir -p ~/proyecto/src', check: c => c.isDir(HOME + '/proyecto/src') },
      { t: 'Crea un archivo vacío llamado <code>README.md</code> dentro de <code>~/proyecto</code>.', hint: 'touch ruta/al/archivo', sol: 'touch ~/proyecto/README.md', check: c => c.isFile(HOME + '/proyecto/README.md') },
      { t: 'Copia <code>~/Documentos/bienvenida.txt</code> dentro de <code>~/proyecto</code>.', hint: 'cp origen destino. Si el destino es un directorio, el archivo conserva su nombre.', sol: 'cp ~/Documentos/bienvenida.txt ~/proyecto/', check: c => c.isFile(HOME + '/proyecto/bienvenida.txt') && c.isFile(HOME + '/Documentos/bienvenida.txt') },
      { t: 'Renombra <code>~/proyecto/bienvenida.txt</code> a <code>LEEME.txt</code>.', hint: 'Renombrar es mover: mv viejo nuevo.', sol: 'mv ~/proyecto/bienvenida.txt ~/proyecto/LEEME.txt', check: c => c.isFile(HOME + '/proyecto/LEEME.txt') && !c.exists(HOME + '/proyecto/bienvenida.txt') },
      { t: 'En <code>~/Descargas</code> hay tres archivos <code>.tmp</code>. Bórralos con una sola orden usando un comodín, sin tocar los demás.', hint: 'rm con el patrón *.tmp. Antes puedes probar el patrón con ls.', sol: 'rm ~/Descargas/*.tmp', check: c => c.ls(HOME + '/Descargas').filter(n => n.endsWith('.tmp')).length === 0 && c.isFile(HOME + '/Descargas/informe_final.txt') && /\*|\?|\[/.test(c.line) },
      { t: 'Crea <code>~/Descargas/fotos</code> y mueve ahí todas las imágenes <code>.jpg</code>.', hint: 'Dos órdenes: mkdir y luego mv con *.jpg. Puedes unirlas con &&.', sol: 'mkdir ~/Descargas/fotos && mv ~/Descargas/*.jpg ~/Descargas/fotos/', check: c => c.isFile(HOME + '/Descargas/fotos/foto_playa.jpg') && c.isFile(HOME + '/Descargas/fotos/foto_cumple.jpg') && !c.ls(HOME + '/Descargas').some(n => n.endsWith('.jpg')) },
      { t: 'Haz una copia completa del directorio <code>~/proyecto</code> llamada <code>~/proyecto_respaldo</code>.', hint: 'cp necesita una opción para copiar directorios con su contenido.', sol: 'cp -r ~/proyecto ~/proyecto_respaldo', check: c => c.isFile(HOME + '/proyecto_respaldo/LEEME.txt') && c.isDir(HOME + '/proyecto_respaldo/src') },
      { t: 'Ahora borra <code>~/proyecto_respaldo</code> por completo.', hint: 'rmdir solo borra directorios vacíos; necesitas rm recursivo.', sol: 'rm -r ~/proyecto_respaldo', check: c => !c.exists(HOME + '/proyecto_respaldo') && c.isDir(HOME + '/proyecto') }
    ]
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'leer', title: 'Leer y editar archivos de texto', short: 'Leer y editar',
    ref: 'LFS101 · Cap. 12–13', so: 'E/S y archivos', mins: 25,
    summary: 'cat, less, head, tail, wc, el editor nano y la redirección > y >>.',
    setup(S) {
      wipe(S, 'registros'); wipe(S, 'notas.txt'); wipe(S, 'saludo.txt');
      H(S, 'registros/servidor.log', makeLog(40));
    },
    theory: `
<h2>Mirar sin modificar</h2>
<table class="t">
<tr><td><code>cat archivo</code></td><td>vuelca todo el archivo (ideal si es corto)</td></tr>
<tr><td><code>less archivo</code></td><td>lo muestra por páginas: <kbd>espacio</kbd> avanza, <kbd>/</kbd> busca, <kbd>q</kbd> sale</td></tr>
<tr><td><code>head -n 5 archivo</code></td><td>las primeras 5 líneas (10 por defecto)</td></tr>
<tr><td><code>tail -n 5 archivo</code></td><td>las últimas 5 líneas</td></tr>
<tr><td><code>tail -f archivo</code></td><td>sigue el archivo en vivo: el clásico para vigilar registros</td></tr>
<tr><td><code>wc -l archivo</code></td><td>cuenta líneas (<code>-w</code> palabras, <code>-c</code> bytes)</td></tr>
</table>
<pre class="try">head -n 3 ~/registros/servidor.log</pre>
<pre class="try">wc ~/registros/servidor.log</pre>
<h2>Editar con nano</h2>
<p><code>nano</code> es el editor más amable para empezar. Se abre ocupando la terminal:</p>
<pre class="try">nano ~/notas.txt</pre>
<table class="t"><tr><td><kbd>Ctrl</kbd>+<kbd>O</kbd></td><td>guardar (Write <b>O</b>ut)</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>X</kbd></td><td>salir</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>U</kbd></td><td>cortar / pegar línea</td></tr></table>
<p>En servidores también encontrarás <code>vi</code>/<code>vim</code>, más potente pero con modos (inserción y órdenes). Aprende nano primero; vim cuando te sientas cómodo.</p>
<h2>Escribir sin editor: redirección</h2>
<pre class="ex">echo "texto" &gt; archivo    # crea o SOBRESCRIBE
echo "más"   &gt;&gt; archivo   # AÑADE al final</pre>
<div class="warn"><b>Ojo</b> Un solo <code>&gt;</code> vacía el archivo antes de escribir. Confundir <code>&gt;</code> con <code>&gt;&gt;</code> es una de las formas más comunes de perder datos.</div>
<div class="so"><b>Para tu clase de SO</b> Para el kernel un archivo es una secuencia de bytes sin formato. Cuando un programa abre un archivo recibe un <em>descriptor de archivo</em> (un número pequeño). <code>&gt;</code> le pide al shell que abra el archivo con <code>O_TRUNC</code> (truncar) y <code>&gt;&gt;</code> con <code>O_APPEND</code> (añadir).</div>`,
    tasks: [
      { t: 'Muestra solo las primeras 5 líneas de <code>~/registros/servidor.log</code>.', hint: 'head con -n 5.', sol: 'head -n 5 ~/registros/servidor.log', check: c => c.ran('head', a => a.some(x => /^-?5$/.test(x) || x === '-5' || x === '-n5')) },
      { t: 'Muestra las últimas 3 líneas del mismo registro.', hint: 'tail funciona igual que head pero por el final.', sol: 'tail -n 3 ~/registros/servidor.log', check: c => c.ran('tail', a => a.some(x => /^-?3$/.test(x) || x === '-n3')) },
      { t: '¿Cuántas líneas tiene el registro? Cuéntalas con una orden.', hint: 'wc con la opción de líneas.', sol: 'wc -l ~/registros/servidor.log', check: c => c.ran('wc') && /\b40\b/.test(c.out) },
      { t: 'Usa <code>nano</code> para crear <code>~/notas.txt</code> con una frase que contenga la palabra <code>kernel</code>. Guarda con Ctrl+O y sal con Ctrl+X.', hint: 'nano ~/notas.txt, escribe, Ctrl+O, Enter, Ctrl+X. En el móvil también tienes botones de Guardar y Salir.', sol: 'nano ~/notas.txt', check: c => /kernel/i.test(c.read(HOME + '/notas.txt') || '') },
      { t: 'Añade la línea <code>Linux es libre</code> al final de <code>~/notas.txt</code> sin borrar lo que ya tenía.', hint: 'echo con >> (dos signos) añade al final.', sol: 'echo "Linux es libre" >> ~/notas.txt', check: c => { const t = c.read(HOME + '/notas.txt') || ''; return /kernel/i.test(t) && /linux es libre/i.test(t); } },
      { t: 'Crea <code>~/saludo.txt</code> que contenga exactamente <code>Hola</code> usando echo y redirección, y luego muéstralo.', hint: 'echo "Hola" > ~/saludo.txt, después cat.', sol: 'echo "Hola" > ~/saludo.txt && cat ~/saludo.txt', check: c => (c.read(HOME + '/saludo.txt') || '').trim() === 'Hola' && c.ran('cat') }
    ]
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'buscar', title: 'Buscar archivos y texto', short: 'Buscar',
    ref: 'LFS101 · Cap. 7 y 13', so: 'Sistemas de archivos', mins: 25,
    summary: 'find para localizar archivos y grep para buscar dentro de ellos.',
    setup(S) {
      wipe(S, 'web');
      H(S, 'web/index.html', '<!DOCTYPE html>\n<html>\n<body>\n<h1>Mi sitio</h1>\n<!-- TODO: añadir menú -->\n</body>\n</html>\n');
      H(S, 'web/css/estilo.css', 'body { font-family: sans-serif; }\nh1 { color: navy; }\n');
      H(S, 'web/js/app.js', 'function iniciar() {\n  // TODO: validar formulario\n  console.log("listo");\n}\n// TODO: manejar errores de red\n');
      H(S, 'web/config/app.conf', 'puerto=8080\nmodo=produccion\n');
      H(S, 'web/config/db.conf', 'host=base-datos\nusuario=web\nclave=********\n');
      H(S, 'web/respaldo.sql', ('INSERT INTO pedidos VALUES (1, \'teclado\', 25.50);\n').repeat(80));
      H(S, 'web/vacio.txt', '');
      H(S, 'registros/app.log', [
        '[INFO] Servicio iniciado', '[WARN] Disco al 80%', '[INFO] Usuario ana inició sesión', '[ERROR] Fallo al conectar con base-datos:5432',
        '[warn] Certificado caduca en 10 días', '[INFO] Copia de seguridad completada', '[ERROR] Permiso denegado al escribir /var/www/cache', '[Warn] Respuesta lenta: 2300 ms', '[INFO] Usuario luis cerró sesión'
      ].join('\n') + '\n');
    },
    theory: `
<h2>find: buscar archivos por sus propiedades</h2>
<pre class="ex">find DÓNDE  CONDICIONES</pre>
<table class="t">
<tr><td><code>find ~ -name "*.txt"</code></td><td>por nombre (entre comillas, para que el shell no expanda el *)</td></tr>
<tr><td><code>find . -iname "readme*"</code></td><td>igual, sin distinguir mayúsculas</td></tr>
<tr><td><code>find /etc -type d</code></td><td>solo directorios (<code>f</code> archivos, <code>l</code> enlaces)</td></tr>
<tr><td><code>find . -size +2k</code></td><td>más de 2 KB (<code>M</code>, <code>G</code>…)</td></tr>
<tr><td><code>find . -empty</code></td><td>vacíos</td></tr>
<tr><td><code>find . -mmin -30</code></td><td>modificados hace menos de 30 minutos</td></tr>
<tr><td><code>find . -name "*.log" -exec wc -l {} \\;</code></td><td>ejecuta una orden sobre cada resultado</td></tr>
</table>
<pre class="try">find ~/web -type f</pre>
<h2>grep: buscar texto dentro de archivos</h2>
<pre class="ex">grep PATRÓN archivo</pre>
<table class="t">
<tr><td><code>-i</code></td><td>ignora mayúsculas/minúsculas</td></tr>
<tr><td><code>-n</code></td><td>muestra el número de línea</td></tr>
<tr><td><code>-c</code></td><td>cuenta las líneas que coinciden</td></tr>
<tr><td><code>-v</code></td><td>muestra las que NO coinciden</td></tr>
<tr><td><code>-r</code></td><td>busca en todos los archivos de un directorio</td></tr>
<tr><td><code>-l</code></td><td>solo los nombres de los archivos con coincidencias</td></tr>
</table>
<pre class="try">grep INFO ~/registros/app.log</pre>
<p>El patrón es una <strong>expresión regular</strong>: <code>^</code> es inicio de línea, <code>$</code> fin, <code>.</code> cualquier carácter y <code>[0-9]</code> un dígito. <code>grep "^\\[ERROR"</code> busca líneas que empiezan por <code>[ERROR</code>.</p>
<div class="so"><b>Para tu clase de SO</b> <code>find</code> recorre el árbol leyendo directorios y pidiendo los metadatos de cada entrada con <code>stat()</code>: no abre los archivos. <code>grep</code> sí los abre y lee su contenido. Por eso buscar por nombre es mucho más barato que buscar por contenido.</div>`,
    tasks: [
      { t: 'Encuentra todos los archivos que terminan en <code>.conf</code> dentro de tu directorio personal.', hint: 'find ~ -name con el patrón entre comillas.', sol: 'find ~ -name "*.conf"', check: c => c.ran('find') && c.out.includes('app.conf') && c.out.includes('db.conf') },
      { t: 'Lista solo los <em>directorios</em> que hay dentro de <code>~/web</code>.', hint: 'find con -type d.', sol: 'find ~/web -type d', check: c => c.ran('find', a => a.includes('-type') && a.includes('d')) && c.out.includes('config') },
      { t: 'Muestra las líneas de <code>~/registros/app.log</code> que contienen <code>ERROR</code>.', hint: 'grep PATRÓN archivo.', sol: 'grep ERROR ~/registros/app.log', check: c => c.ran('grep') && c.out.includes('Fallo al conectar') && !c.out.includes('Servicio iniciado') },
      { t: 'Cuenta cuántas líneas del registro contienen <code>warn</code>, sin importar mayúsculas (hay WARN, warn y Warn).', hint: 'grep con -i (ignorar mayúsculas) y -c (contar).', sol: 'grep -ic warn ~/registros/app.log', check: c => c.ran('grep') && c.out.trim().split('\n').pop().trim() === '3' },
      { t: 'Busca <code>TODO</code> en todos los archivos de <code>~/web</code>, mostrando el número de línea.', hint: 'grep con -r (recursivo) y -n (número de línea).', sol: 'grep -rn TODO ~/web', check: c => c.ran('grep', a => a.some(x => /^-\w*[rR]/.test(x)) && a.some(x => /^-\w*n/.test(x))) && c.out.includes('app.js') && c.out.includes('index.html') },
      { t: 'Encuentra en <code>~/web</code> los archivos de más de 2 KB.', hint: 'find con -size +2k.', sol: 'find ~/web -size +2k', check: c => c.ran('find', a => a.includes('-size')) && c.out.includes('respaldo.sql') && !c.out.includes('app.js') },
      { t: 'Encuentra los archivos vacíos de <code>~/web</code>.', hint: 'find tiene una condición -empty.', sol: 'find ~/web -empty', check: c => c.ran('find', a => a.includes('-empty')) && c.out.includes('vacio.txt') }
    ]
  },
  // ------------------------------------------------------------------ 6
  {
    id: 'tuberias', title: 'Tuberías, redirección y filtros', short: 'Tuberías',
    ref: 'LFS101 · Cap. 7 y 13', so: 'Procesos y E/S', mins: 30,
    summary: 'stdin, stdout, stderr; el operador | y filtros como sort, uniq, cut y tr.',
    setup(S) {
      wipe(S, 'datos'); wipe(S, 'errores.txt');
      H(S, 'datos/ventas.csv', 'fecha,producto,ciudad,unidades\n2026-10-01,teclado,Bogotá,3\n2026-10-01,ratón,Medellín,10\n2026-10-02,monitor,Bogotá,2\n2026-10-02,teclado,Cali,5\n2026-10-03,ratón,Bogotá,7\n2026-10-03,portátil,Medellín,1\n2026-10-04,teclado,Medellín,4\n2026-10-04,monitor,Cali,3\n2026-10-05,ratón,Cali,12\n');
      const ips = ['192.168.1.15', '10.0.0.7', '192.168.1.15', '203.0.113.7', '192.168.1.15', '10.0.0.7', '203.0.113.7', '203.0.113.7', '203.0.113.7', '192.168.1.40', '203.0.113.7', '192.168.1.15'];
      H(S, 'datos/accesos.log', ips.map((ip, i) => `${ip} - - [13/Oct/2026:03:${String(10 + i).padStart(2, '0')}:00] "GET /${['', 'login', 'admin', 'productos'][i % 4]} HTTP/1.1" ${[200, 200, 404, 403][i % 4]} ${500 + i * 13}`).join('\n') + '\n');
      H(S, 'datos/frase.txt', 'el software libre es conocimiento compartido\n');
    },
    theory: `
<h2>Tres canales por proceso</h2>
<table class="t">
<tr><th>Descriptor</th><th>Nombre</th><th>Por defecto</th></tr>
<tr><td>0</td><td>stdin (entrada estándar)</td><td>el teclado</td></tr>
<tr><td>1</td><td>stdout (salida estándar)</td><td>la pantalla</td></tr>
<tr><td>2</td><td>stderr (salida de errores)</td><td>la pantalla</td></tr>
</table>
<h2>Redirección</h2>
<table class="t">
<tr><td><code>orden &gt; f</code></td><td>stdout a un archivo (sobrescribe)</td></tr>
<tr><td><code>orden &gt;&gt; f</code></td><td>stdout al final de un archivo</td></tr>
<tr><td><code>orden 2&gt; f</code></td><td>solo los errores a un archivo</td></tr>
<tr><td><code>orden &gt; f 2&gt;&amp;1</code></td><td>salida y errores al mismo archivo (también <code>&amp;&gt; f</code>)</td></tr>
<tr><td><code>orden &lt; f</code></td><td>stdin desde un archivo</td></tr>
<tr><td><code>orden 2&gt; /dev/null</code></td><td>tira los errores (<code>/dev/null</code> es un agujero negro)</td></tr>
</table>
<h2>Tuberías: la idea central de Unix</h2>
<p>El operador <code>|</code> conecta la stdout de una orden con la stdin de la siguiente. Cada programa hace una sola cosa bien, y los combinas:</p>
<pre class="try">cat ~/datos/ventas.csv | cut -d, -f3 | sort | uniq -c</pre>
<table class="t">
<tr><td><code>sort</code></td><td>ordena líneas (<code>-n</code> numérico, <code>-r</code> inverso, <code>-t, -k4</code> por la 4ª columna separada por comas)</td></tr>
<tr><td><code>uniq</code></td><td>quita repetidas <em>consecutivas</em> (por eso va después de sort); <code>-c</code> cuenta</td></tr>
<tr><td><code>cut -d, -f2</code></td><td>extrae la columna 2 usando la coma como separador</td></tr>
<tr><td><code>tr a-z A-Z</code></td><td>sustituye caracteres (aquí: a mayúsculas)</td></tr>
<tr><td><code>wc -l</code></td><td>cuenta líneas</td></tr>
<tr><td><code>head</code>, <code>tail</code></td><td>se quedan con el principio o el final</td></tr>
<tr><td><code>tee f</code></td><td>deja pasar los datos y además los guarda en <code>f</code></td></tr>
</table>
<pre class="try">ls /etc | wc -l</pre>
<pre class="try">tail -n +2 ~/datos/ventas.csv | sort -t, -k4 -n | tail -1</pre>
<div class="so"><b>Para tu clase de SO</b> Una tubería es un mecanismo de <strong>comunicación entre procesos (IPC)</strong>. El shell crea un <code>pipe()</code> (un búfer en el kernel con un extremo de escritura y otro de lectura), hace <code>fork()</code> para cada orden y conecta los descriptores con <code>dup2()</code>. Todas las órdenes corren a la vez; si el búfer se llena, el escritor se bloquea, y si está vacío, se bloquea el lector. Es el problema clásico de <em>productor-consumidor</em> resuelto por el kernel.</div>`,
    tasks: [
      { t: 'Muestra solo la columna de productos (la 2ª) de <code>~/datos/ventas.csv</code>.', hint: 'cut con -d, (separador coma) y -f2 (campo 2).', sol: 'cut -d, -f2 ~/datos/ventas.csv', check: c => c.ran('cut', a => a.some(x => /f\s*2|^2$/.test(x))) && c.out.includes('teclado') && !c.out.includes('Bogotá') },
      { t: 'Obtén la lista de productos distintos, ordenada alfabéticamente y sin repetir.', hint: 'Encadena cut | sort | uniq (o sort -u).', sol: 'cut -d, -f2 ~/datos/ventas.csv | sort | uniq', check: c => { const l = c.out.trim().split('\n').map(x => x.trim()).filter(x => x && x !== 'producto'); return c.ran('sort') && JSON.stringify(l) === JSON.stringify(['monitor', 'portátil', 'ratón', 'teclado']); } },
      { t: 'En <code>~/datos/accesos.log</code>, cuenta cuántas peticiones hizo cada IP, ordenadas de más a menos.', hint: 'La IP es el campo 1 separado por espacios: cut -d" " -f1 | sort | uniq -c | sort -rn', sol: 'cut -d" " -f1 ~/datos/accesos.log | sort | uniq -c | sort -rn', check: c => { const f = c.out.trim().split('\n')[0] || ''; return c.ran('uniq', a => a.some(x => /c/.test(x))) && /5\s+203\.0\.113\.7/.test(f); } },
      { t: 'Guarda ese mismo resultado en <code>~/datos/top_ips.txt</code>.', hint: 'Repite la orden (flecha ↑) y añade > ~/datos/top_ips.txt al final.', sol: 'cut -d" " -f1 ~/datos/accesos.log | sort | uniq -c | sort -rn > ~/datos/top_ips.txt', check: c => /^\s*5\s+203\.0\.113\.7/.test(c.read(HOME + '/datos/top_ips.txt') || '') },
      { t: 'Ejecuta <code>ls /root ~</code>: una parte falla. Envía solo los errores a <code>~/errores.txt</code> y deja que el resto salga por pantalla.', hint: 'El descriptor de errores es el 2: 2> archivo.', sol: 'ls /root ~ 2> ~/errores.txt', check: c => /Permiso denegado/.test(c.read(HOME + '/errores.txt') || '') && c.ran('ls') },
      { t: 'Convierte a mayúsculas el contenido de <code>~/datos/frase.txt</code> y guárdalo en <code>~/datos/frase_mayus.txt</code>.', hint: 'cat archivo | tr a-z A-Z > nuevo', sol: 'cat ~/datos/frase.txt | tr a-z A-Z > ~/datos/frase_mayus.txt', check: c => (c.read(HOME + '/datos/frase_mayus.txt') || '').trim() === 'EL SOFTWARE LIBRE ES CONOCIMIENTO COMPARTIDO' },
      { t: 'Cuenta cuántas entradas tiene el directorio <code>/etc</code> conectando dos órdenes con una tubería.', hint: 'ls /etc | wc -l', sol: 'ls /etc | wc -l', check: c => c.ran('ls') && c.ran('wc') && c.line.includes('|') }
    ]
  },
  // ------------------------------------------------------------------ 7
  {
    id: 'usuarios', title: 'Usuarios, grupos y sudo', short: 'Usuarios',
    ref: 'LFS101 · Cap. 17–18', so: 'Protección y seguridad', mins: 25,
    summary: 'UID y GID, /etc/passwd, sudo frente a su y gestión de cuentas.',
    setup(S) { removeUser(S, 'carlos'); delete S.groups.desarrollo; while (S.userStack.length) { const p = S.userStack.pop(); S.user = p.user; S.cwd = p.cwd; } Engine.syncEtc(S); },
    theory: `
<h2>Linux es multiusuario</h2>
<p>Cada usuario tiene un número, el <strong>UID</strong>, y pertenece a un grupo principal (<strong>GID</strong>) y a otros grupos secundarios. El kernel solo entiende números; los nombres están en archivos de texto:</p>
<pre class="ex">estudiante:x:1000:1000:Estudiante,,,:/home/estudiante:/bin/bash
   │       │  │    │        │              │               └ shell
   │       │  │    │        │              └ directorio personal
   │       │  │    │        └ comentario (nombre completo)
   │       │  │    └ GID del grupo principal
   │       │  └ UID
   │       └ la contraseña está en /etc/shadow
   └ nombre de usuario</pre>
<table class="t">
<tr><td><code>/etc/passwd</code></td><td>cuentas (lo puede leer cualquiera)</td></tr>
<tr><td><code>/etc/shadow</code></td><td>contraseñas cifradas (solo root)</td></tr>
<tr><td><code>/etc/group</code></td><td>grupos y sus miembros</td></tr>
</table>
<p><strong>root</strong> tiene UID 0 y puede hacerlo todo. Los usuarios del sistema (UID &lt; 1000) ejecutan servicios; las personas empiezan en 1000.</p>
<pre class="try">id</pre>
<pre class="try">groups</pre>
<h2>sudo y su</h2>
<ul>
<li><code>sudo orden</code> ejecuta UNA orden como root. Pide <em>tu</em> contraseña y queda registrado en <code>/var/log/auth.log</code>. Solo funciona si estás en el grupo <code>sudo</code>.</li>
<li><code>su - usuario</code> abre un shell completo como otro usuario. Se sale con <code>exit</code>.</li>
<li><code>sudo -i</code> abre un shell de root. El prompt cambia a <code>#</code> para recordártelo.</li>
</ul>
<p>Trabajar siempre como root es mala idea: un error tipográfico puede destruir el sistema. Es el <strong>principio de mínimo privilegio</strong>.</p>
<h2>Gestionar cuentas (requiere sudo)</h2>
<pre class="ex">sudo useradd -m -s /bin/bash ana   # -m crea /home/ana
sudo passwd ana                     # le pone contraseña
sudo groupadd devs                  # crea un grupo
sudo usermod -aG devs ana           # añade ana a devs (¡la -a es clave!)
sudo userdel -r ana                 # borra la cuenta y su home</pre>
<div class="warn"><b>Error clásico</b> <code>usermod -G devs ana</code> sin <code>-a</code> <em>sustituye</em> todos los grupos secundarios de ana por devs. Si se lo haces a tu propio usuario, pierdes el grupo sudo.</div>
<div class="so"><b>Para tu clase de SO</b> Esto es <strong>protección</strong>: el SO asocia a cada proceso unas credenciales (UID/GID efectivos) y en cada acceso a un recurso comprueba la política. Las matrices de acceso se implementan en Linux como listas por objeto (los permisos de cada archivo, siguiente módulo). sudo es un ejemplo de cambio de dominio de protección controlado.</div>`,
    tasks: [
      { t: 'Muestra tu UID, tu GID y los grupos a los que perteneces.', hint: 'Una orden de dos letras.', sol: 'id', check: c => c.ran('id') },
      { t: 'Muestra solo tu línea del archivo <code>/etc/passwd</code>.', hint: 'grep tu_usuario /etc/passwd', sol: 'grep estudiante /etc/passwd', check: c => c.out.includes('estudiante:x:1000:1000') && !c.out.includes('root:x:0') },
      { t: 'Intenta leer <code>/etc/shadow</code>. Fallará; repite la orden con privilegios de administrador.', hint: 'Pon sudo delante. Truco: sudo !! repite la orden anterior con sudo.', sol: 'sudo cat /etc/shadow', check: c => c.ranEver('cat', a => a.includes('/etc/shadow'), 'root') || c.ranEver('head', a => a.includes('/etc/shadow'), 'root') || c.ranEver('less', a => a.includes('/etc/shadow'), 'root') || c.ranEver('tail', a => a.includes('/etc/shadow'), 'root') },
      { t: 'Crea el usuario <code>carlos</code> con su directorio personal.', hint: 'sudo useradd con la opción que crea el home.', sol: 'sudo useradd -m carlos', check: c => !!c.S.users.carlos && c.isDir('/home/carlos') },
      { t: 'Crea el grupo <code>desarrollo</code>.', hint: 'sudo groupadd nombre', sol: 'sudo groupadd desarrollo', check: c => !!c.S.groups.desarrollo },
      { t: 'Añade a <code>carlos</code> al grupo <code>desarrollo</code> sin quitarle otros grupos.', hint: 'sudo usermod -aG grupo usuario', sol: 'sudo usermod -aG desarrollo carlos', check: c => c.S.groups.desarrollo && c.S.groups.desarrollo.members.includes('carlos') },
      { t: 'Conviértete en <code>carlos</code> y comprueba quién eres.', hint: 'Desde tu usuario: su - carlos (en este simulador la contraseña se acepta). Luego whoami.', sol: 'su - carlos', check: c => c.ranEver('whoami', null, 'carlos') || c.ranEver('id', null, 'carlos') },
      { t: 'Vuelve a tu usuario <code>estudiante</code>.', hint: 'exit cierra el shell de carlos y te devuelve al anterior.', sol: 'exit', check: c => c.S.user === 'estudiante' && c.ranEver('whoami', null, 'carlos') !== undefined && c.ran('exit') }
    ]
  },
  // ------------------------------------------------------------------ 8
  {
    id: 'permisos', title: 'Permisos de archivos', short: 'Permisos',
    ref: 'LFS101 · Cap. 18', so: 'Protección y seguridad', mins: 30,
    summary: 'rwx, notación octal y simbólica, chmod, chown y umask.',
    setup(S) {
      wipe(S, 'permisos');
      H(S, 'permisos/diario.txt', 'Querido diario: hoy aprendí chmod.\n', { mode: 0o644 });
      H(S, 'permisos/script.sh', '#!/bin/bash\necho "¡El script se ejecutó! Tienes permiso de ejecución."\n', { mode: 0o644 });
      H(S, 'permisos/compartido', null, { mode: 0o775 });
      H(S, 'permisos/informe.txt', 'Informe para el profesor.\n', { mode: 0o644 });
      S.umask = 0o002;
    },
    theory: `
<h2>Leer los permisos</h2>
<pre class="ex">-rwxr-x---  1 estudiante devs  2048 oct 13 09:30 script.sh
│└┬┘└┬┘└┬┘     └──┬─────┘ └┬─┘
│ │  │  │         dueño   grupo
│ │  │  └ otros (o):  ---  nada
│ │  └ grupo (g):     r-x  leer y ejecutar
│ └ dueño (u):        rwx  leer, escribir y ejecutar
└ tipo: - archivo, d directorio, l enlace</pre>
<table class="t">
<tr><th></th><th>En un archivo</th><th>En un directorio</th></tr>
<tr><td><b>r</b></td><td>leer el contenido</td><td>listar los nombres (<code>ls</code>)</td></tr>
<tr><td><b>w</b></td><td>modificarlo</td><td>crear, borrar y renombrar archivos dentro</td></tr>
<tr><td><b>x</b></td><td>ejecutarlo como programa</td><td>entrar (<code>cd</code>) y acceder a lo que contiene</td></tr>
</table>
<h2>Notación octal</h2>
<p>Cada trío se escribe como la suma <strong>r=4, w=2, x=1</strong>:</p>
<table class="t">
<tr><td><code>7</code> = rwx</td><td><code>6</code> = rw-</td><td><code>5</code> = r-x</td><td><code>4</code> = r--</td><td><code>0</code> = ---</td></tr>
</table>
<table class="t">
<tr><td><code>644</code></td><td>rw-r--r--</td><td>archivos normales</td></tr>
<tr><td><code>600</code></td><td>rw-------</td><td>privados (claves SSH)</td></tr>
<tr><td><code>755</code></td><td>rwxr-xr-x</td><td>programas y directorios públicos</td></tr>
<tr><td><code>750</code></td><td>rwxr-x---</td><td>directorio solo para el equipo</td></tr>
</table>
<h2>chmod, chown y chgrp</h2>
<pre class="ex">chmod 640 archivo        # octal
chmod u+x script.sh      # simbólico: al dueño (u) le añade (+) ejecución (x)
chmod go-w archivo       # a grupo y otros les quita escritura
chmod -R 750 carpeta     # recursivo
sudo chown ana archivo   # cambiar dueño (solo root)
chgrp devs archivo       # cambiar grupo (a uno al que perteneces)</pre>
<p>Para ejecutar un script del directorio actual escribe <code>./script.sh</code>: el shell no busca programas en el directorio actual por seguridad.</p>
<h2>umask: los permisos por defecto</h2>
<p>Un archivo nuevo parte de <code>666</code> y un directorio de <code>777</code>; la <strong>umask</strong> indica qué bits quitar. Con <code>umask 022</code>: archivos <code>644</code>, directorios <code>755</code>. Con <code>027</code>: <code>640</code> y <code>750</code>.</p>
<h2>Bits especiales</h2>
<ul><li><b>sticky</b> (<code>t</code>): en <code>/tmp</code> (<code>drwxrwxrwt</code>) todos escriben, pero cada uno solo borra lo suyo.</li><li><b>setuid</b> (<code>s</code>): el programa corre con los permisos de su dueño. <code>/usr/bin/passwd</code> lo usa para poder escribir en <code>/etc/shadow</code>.</li></ul>
<div class="so"><b>Para tu clase de SO</b> El nodo-i guarda dueño, grupo y 12 bits de modo. En cada <code>open()</code> el kernel compara el UID efectivo del proceso: si es el dueño usa el primer trío, si comparte grupo el segundo, y si no, el tercero. Solo se mira un trío: si eres el dueño y tu trío es <code>---</code>, no puedes leer aunque "otros" tenga <code>r</code>.</div>`,
    tasks: [
      { t: 'Lista en formato largo el contenido de <code>~/permisos</code> y observa los permisos.', hint: 'ls -l ruta', sol: 'ls -l ~/permisos', check: c => c.ran('ls', a => a.some(x => /^-\w*l/.test(x))) && c.out.includes('diario.txt') },
      { t: 'Haz que <code>diario.txt</code> solo lo puedas leer y escribir tú (nadie más puede hacer nada).', hint: 'rw- para ti, --- para grupo y otros. En octal: 6, 0, 0.', sol: 'chmod 600 ~/permisos/diario.txt', check: c => c.mode(HOME + '/permisos/diario.txt') === 0o600 },
      { t: 'Intenta ejecutar <code>./script.sh</code> desde <code>~/permisos</code>. Fallará: dale permiso de ejecución al dueño y ejecútalo.', hint: 'cd ~/permisos, luego chmod u+x script.sh y ./script.sh', sol: 'cd ~/permisos && chmod u+x script.sh && ./script.sh', check: c => c.out.includes('El script se ejecutó') },
      { t: 'Pon al directorio <code>compartido</code> los permisos rwx para ti, r-x para el grupo y nada para otros.', hint: '7 = rwx, 5 = r-x, 0 = ---.', sol: 'chmod 750 ~/permisos/compartido', check: c => c.mode(HOME + '/permisos/compartido') === 0o750 },
      { t: 'Cambia el grupo de <code>compartido</code> a <code>adm</code> (perteneces a ese grupo, así que no necesitas sudo).', hint: 'chgrp grupo archivo', sol: 'chgrp adm ~/permisos/compartido', check: c => c.group(HOME + '/permisos/compartido') === 'adm' },
      { t: 'Haz que el dueño de <code>informe.txt</code> sea el usuario <code>profesor</code>.', hint: 'Solo root puede regalar archivos: sudo chown usuario archivo', sol: 'sudo chown profesor ~/permisos/informe.txt', check: c => c.owner(HOME + '/permisos/informe.txt') === 'profesor' },
      { t: 'Cambia tu umask a <code>027</code> y crea <code>~/permisos/nuevo.txt</code>. Fíjate en los permisos con los que nace.', hint: 'umask 027 y luego touch. Debería salir rw-r----- (640).', sol: 'umask 027 && touch ~/permisos/nuevo.txt && ls -l ~/permisos/nuevo.txt', check: c => c.mode(HOME + '/permisos/nuevo.txt') === 0o640 },
      { t: 'Deja la umask como estaba: <code>002</code>.', hint: 'umask 002', sol: 'umask 002', check: c => c.S.umask === 0o002 && c.ran('umask') }
    ]
  },
  // ------------------------------------------------------------------ 9
  {
    id: 'procesos', title: 'Procesos y señales', short: 'Procesos',
    ref: 'LFS101 · Cap. 9', so: 'Gestión de procesos', mins: 35,
    summary: 'PID, estados, ps y top, primer y segundo plano, kill, nice y zombis.',
    setup(S) {
      S.procs = S.procs.filter(p => !(p.user === 'estudiante' && p.pid !== 1321 && p.pid !== 1320));
      S.jobs = []; S.nextJob = 1; S.killed = [];
      addProc(S, { pid: 3141, user: 'estudiante', cmd: './minero.sh --hilos 4', state: 'R', cpu: 97.6, mem: 2.1, start: '03:41', vsz: 120400, rss: 64000 });
      addProc(S, { pid: 3150, user: 'estudiante', cmd: 'python3 terco.py', state: 'S', cpu: 0.7, mem: 0.6, ignoreTerm: true, start: '03:44' });
      addProc(S, { pid: 3155, user: 'estudiante', cmd: './generador', state: 'S', cpu: 0.1, mem: 0.3, start: '03:50' });
      addProc(S, { pid: 3156, ppid: 3155, user: 'estudiante', cmd: '[informe] <defunct>', state: 'Z', cpu: 0, mem: 0, vsz: 0, rss: 0, start: '03:51' });
    },
    theory: `
<h2>Programa frente a proceso</h2>
<p>Un <strong>programa</strong> es un archivo en disco. Un <strong>proceso</strong> es un programa en ejecución: tiene su memoria, sus archivos abiertos, su estado y un identificador único, el <strong>PID</strong>. Del mismo programa puede haber muchos procesos a la vez.</p>
<p>Cada proceso tiene un padre (<strong>PPID</strong>). Todos descienden del proceso 1, <code>systemd</code> (antes <code>init</code>), que arranca el kernel.</p>
<pre class="try">ps</pre>
<pre class="try">ps aux</pre>
<pre class="try">pstree -p</pre>
<h2>Estados</h2>
<svg class="diag" viewBox="0 0 520 210" role="img" aria-label="Diagrama de estados de un proceso">
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>
<g class="st"><rect x="10" y="80" width="80" height="40" rx="6"/><text x="50" y="104">Nuevo</text></g>
<g class="st"><rect x="150" y="20" width="96" height="40" rx="6"/><text x="198" y="38">Listo</text><text x="198" y="53" class="s">R (en cola)</text></g>
<g class="st on"><rect x="310" y="20" width="110" height="40" rx="6"/><text x="365" y="38">Ejecución</text><text x="365" y="53" class="s">R (en CPU)</text></g>
<g class="st"><rect x="230" y="140" width="110" height="40" rx="6"/><text x="285" y="158">Bloqueado</text><text x="285" y="173" class="s">S / D (esperando E/S)</text></g>
<g class="st"><rect x="430" y="140" width="84" height="40" rx="6"/><text x="472" y="158">Terminado</text><text x="472" y="173" class="s">Z si nadie hace wait</text></g>
<path class="ln" d="M90,92 L150,48" marker-end="url(#ar)"/>
<path class="ln" d="M246,34 L310,34" marker-end="url(#ar)"/><text x="278" y="28" class="s">planificador</text>
<path class="ln" d="M310,50 L246,50" marker-end="url(#ar)"/><text x="278" y="66" class="s">quantum agotado</text>
<path class="ln" d="M350,60 L310,140" marker-end="url(#ar)"/><text x="350" y="108" class="s">pide E/S</text>
<path class="ln" d="M240,140 L198,60" marker-end="url(#ar)"/><text x="178" y="108" class="s">E/S lista</text>
<path class="ln" d="M405,60 L460,140" marker-end="url(#ar)"/><text x="450" y="96" class="s">exit()</text>
</svg>
<p>En la columna <code>STAT</code> de <code>ps</code> verás: <b>R</b> ejecutándose o listo, <b>S</b> durmiendo (esperando algo), <b>D</b> espera de disco no interrumpible, <b>T</b> detenido, <b>Z</b> zombi. Las letras extra: <b>N</b> prioridad baja, <b>&lt;</b> prioridad alta, <b>s</b> líder de sesión, <b>+</b> en primer plano.</p>
<h2>Primer y segundo plano</h2>
<pre class="ex">sleep 300 &amp;     # el &amp; lo lanza en segundo plano: [1] 2345
jobs            # trabajos de esta terminal
fg %1           # lo trae a primer plano
Ctrl+Z          # detiene el proceso en primer plano
bg %1           # lo reanuda en segundo plano</pre>
<h2>Señales</h2>
<table class="t">
<tr><td><code>kill PID</code></td><td>envía <b>SIGTERM</b> (15): "termina, por favor". El proceso puede limpiar o incluso ignorarla.</td></tr>
<tr><td><code>kill -9 PID</code></td><td><b>SIGKILL</b>: el kernel lo elimina. No se puede capturar ni ignorar.</td></tr>
<tr><td><code>kill -STOP</code> / <code>-CONT</code></td><td>pausa / reanuda</td></tr>
<tr><td><code>Ctrl+C</code></td><td>envía <b>SIGINT</b> (2) al proceso en primer plano</td></tr>
<tr><td><code>killall nombre</code></td><td>envía la señal a todos los procesos con ese nombre</td></tr>
</table>
<p>Buena práctica: primero <code>kill</code> (TERM) y solo si no responde, <code>kill -9</code>.</p>
<h2>Prioridad: nice</h2>
<p>El valor <strong>nice</strong> va de <b>-20</b> (más prioridad) a <b>19</b> (menos). <code>nice -n 10 orden</code> lanza con menos prioridad; <code>renice -n 15 -p PID</code> cambia uno en marcha. Un usuario normal solo puede ser "más amable" (subir el número).</p>
<div class="so"><b>Para tu clase de SO</b> El kernel guarda cada proceso en un <strong>PCB</strong> (en Linux, <code>struct task_struct</code>): PID, estado, registros, información de memoria, archivos abiertos, prioridad. Un proceso nuevo se crea con <code>fork()</code> (copia del padre, con copy-on-write) y suele cambiar de programa con <code>exec()</code>. Cuando termina con <code>exit()</code> queda como <strong>zombi</strong> hasta que el padre recoge su código de salida con <code>wait()</code>. Si el padre muere antes, el hijo queda <strong>huérfano</strong> y lo adopta el PID 1, que sí hace <code>wait()</code>.</div>`,
    tasks: [
      { t: 'Muestra los procesos de tu terminal.', hint: 'Dos letras: process status.', sol: 'ps', check: c => c.ran('ps') },
      { t: 'Muestra <em>todos</em> los procesos del sistema con su usuario, %CPU y estado.', hint: 'ps aux (o ps -ef).', sol: 'ps aux', check: c => c.ran('ps', a => /aux|ax|-e|-A/.test(a.join(' '))) },
      { t: 'Un proceso tuyo está acaparando la CPU. Encuéntralo con <code>top</code> o <code>ps aux</code> y termínalo con una señal TERM normal.', hint: 'Mira la columna %CPU, apunta su PID y usa kill PID.', sol: 'kill 3141', check: c => !c.S.procs.some(p => p.cmd.includes('minero')) },
      { t: 'El proceso <code>python3 terco.py</code> ignora SIGTERM. Compruébalo con kill y, cuando veas que sigue vivo, elimínalo con la señal que no se puede ignorar.', hint: 'Busca su PID con ps aux | grep terco. kill PID no hace nada; kill -9 PID sí.', sol: 'kill -9 3150', check: c => !c.S.procs.some(p => p.cmd.includes('terco')) },
      { t: 'Lanza <code>sleep 600</code> en segundo plano.', hint: 'Añade & al final.', sol: 'sleep 600 &', check: c => c.S.procs.some(p => /^sleep 600/.test(p.cmd)) },
      { t: 'Lista los trabajos de esta terminal.', hint: 'jobs', sol: 'jobs', check: c => c.ran('jobs') },
      { t: 'Lanza <code>sleep 900</code> en segundo plano con valor nice 15.', hint: 'nice -n 15 sleep 900 &', sol: 'nice -n 15 sleep 900 &', check: c => c.S.procs.some(p => /sleep 900/.test(p.cmd) && p.nice === 15) },
      { t: 'Bájale todavía más la prioridad a ese proceso, a nice 19, sin reiniciarlo.', hint: 'Busca su PID con ps -l o jobs -l y usa renice -n 19 -p PID.', sol: 'renice -n 19 -p PID', check: c => c.S.procs.some(p => /sleep 900/.test(p.cmd) && p.nice === 19) },
      { t: 'Hay un proceso zombi (estado <code>Z</code>). Encuéntralo. Ninguna señal lo elimina porque ya está muerto: termina a su <em>padre</em> para que sea recogido.', hint: 'ps -ef muestra el PPID. El zombi es <defunct>; su padre es ./generador.', sol: 'kill 3155', check: c => !c.S.procs.some(p => p.state === 'Z') },
      { t: 'Termina de golpe todos tus procesos <code>sleep</code>.', hint: 'killall sleep (o pkill sleep).', sol: 'killall sleep', check: c => !c.S.procs.some(p => /^sleep/.test(p.cmd)) && (c.ran('killall') || c.ran('pkill') || c.ran('kill')) }
    ]
  },
  // ------------------------------------------------------------------ 10
  {
    id: 'planificacion', title: 'Planificación de la CPU', short: 'Planificación', lab: 'sched',
    ref: 'Complemento de SO', so: 'Planificación de CPU', mins: 40,
    summary: 'FCFS, SJF, SRTF, Round Robin y prioridades con un simulador de diagramas de Gantt.',
    theory: `
<h2>El problema</h2>
<p>Hay más procesos listos que núcleos. El <strong>planificador</strong> decide cuál usa la CPU y durante cuánto. Cada proceso alterna <em>ráfagas de CPU</em> y esperas de E/S; aquí simulamos una sola ráfaga por proceso.</p>
<h2>Métricas</h2>
<table class="t">
<tr><td><b>Llegada</b> (A)</td><td>cuándo entra en la cola de listos</td></tr>
<tr><td><b>Ráfaga</b> (B)</td><td>tiempo de CPU que necesita</td></tr>
<tr><td><b>Finalización</b> (F)</td><td>cuándo termina</td></tr>
<tr><td><b>Retorno</b> = F − A</td><td>tiempo total en el sistema (<em>turnaround</em>)</td></tr>
<tr><td><b>Espera</b> = Retorno − B</td><td>tiempo en la cola de listos sin usar la CPU</td></tr>
<tr><td><b>Respuesta</b></td><td>desde que llega hasta que usa la CPU por primera vez</td></tr>
</table>
<h2>Algoritmos</h2>
<table class="t">
<tr><td><b>FCFS</b></td><td>Primero en llegar, primero en ser servido. Simple pero sufre el <em>efecto convoy</em>: un proceso largo retrasa a todos los cortos.</td></tr>
<tr><td><b>SJF</b></td><td>El trabajo más corto primero (no expropiativo). Minimiza la espera media, pero hay que conocer o estimar las ráfagas, y los largos pueden sufrir <em>inanición</em>.</td></tr>
<tr><td><b>SRTF</b></td><td>Versión expropiativa de SJF: si llega uno con menos tiempo restante, expulsa al actual.</td></tr>
<tr><td><b>Round Robin</b></td><td>Cada proceso usa la CPU como máximo un <em>quantum</em> y vuelve al final de la cola. Buen tiempo de respuesta. Quantum muy pequeño = mucho cambio de contexto; muy grande = se parece a FCFS.</td></tr>
<tr><td><b>Prioridades</b></td><td>Se elige el de mayor prioridad (aquí: número menor = más prioridad). Riesgo de inanición; se corrige con <em>envejecimiento</em> (aging).</td></tr>
</table>
<p>Usa el simulador de la derecha: cambia el algoritmo, el quantum o la tabla y mira cómo cambia el diagrama. Los retos usan el <strong>escenario de ejemplo</strong> (botón "Cargar ejemplo").</p>
<div class="so"><b>¿Y Linux?</b> Desde el kernel 6.6 Linux usa <strong>EEVDF</strong> (antes CFS): reparte la CPU de forma proporcional a un peso que depende del valor <code>nice</code>, y prioriza a quien menos ha recibido respecto a lo que le corresponde. Para tareas de tiempo real existen las políticas <code>SCHED_FIFO</code> y <code>SCHED_RR</code>, que son justo FCFS y Round Robin con prioridades fijas.</div>`,
    tasks: [
      { t: 'Simula <b>FCFS</b> con el escenario de ejemplo. ¿Cuál es el tiempo de espera promedio?', hint: 'Elige FCFS y lee "Espera media" bajo la tabla. Compruébalo a mano: espera = retorno − ráfaga.', answer: () => Sims.schedule(SCHED_EXAMPLE, 'FCFS').avgWait },
      { t: 'Ahora <b>SJF</b> (no expropiativo). ¿Tiempo de espera promedio?', hint: 'En t=0 solo está P1, así que corre entero aunque sea largo.', answer: () => Sims.schedule(SCHED_EXAMPLE, 'SJF').avgWait },
      { t: 'Con <b>SRTF</b> (expropiativo). ¿Tiempo de espera promedio?', hint: 'P2 llega en t=1 con ráfaga 4, menor que lo que le queda a P1 (7): lo expulsa.', answer: () => Sims.schedule(SCHED_EXAMPLE, 'SRTF').avgWait },
      { t: 'Con <b>Round Robin</b> y quantum 4. ¿Tiempo de <em>retorno</em> promedio?', hint: 'Convención: los procesos que llegan durante un quantum entran a la cola antes que el proceso expulsado.', answer: () => Sims.schedule(SCHED_EXAMPLE, 'RR', 4).avgTurn },
      { t: 'Con <b>Prioridades</b> no expropiativas (número menor = más prioridad). ¿Tiempo de espera promedio?', hint: 'Prioridades del ejemplo: P1=2, P2=4, P3=1, P4=3.', answer: () => Sims.schedule(SCHED_EXAMPLE, 'PRIO').avgWait },
      { t: 'Prueba Round Robin con quantum 20. ¿A qué algoritmo se reduce cuando el quantum es mayor que cualquier ráfaga? Escribe su sigla.', hint: 'Si nadie agota el quantum, cada uno corre completo por orden de llegada.', answer: 'FCFS', text: true }
    ]
  },
  // ------------------------------------------------------------------ 11
  {
    id: 'memoria', title: 'Memoria virtual y paginación', short: 'Memoria', lab: 'mem',
    ref: 'Complemento de SO', so: 'Gestión de memoria', mins: 40,
    summary: 'Páginas y marcos, fallos de página y los algoritmos FIFO, LRU y óptimo.',
    theory: `
<h2>Direcciones lógicas y físicas</h2>
<p>Cada proceso cree tener toda la memoria para él: trabaja con <strong>direcciones lógicas (virtuales)</strong>. La <strong>MMU</strong> del procesador las traduce a <strong>direcciones físicas</strong> usando la <strong>tabla de páginas</strong> que mantiene el SO. Así los procesos quedan aislados entre sí.</p>
<h2>Paginación</h2>
<p>La memoria virtual se divide en <strong>páginas</strong> y la física en <strong>marcos</strong> del mismo tamaño (en Linux, normalmente 4 KB). Una dirección lógica se parte en dos:</p>
<pre class="ex">página        = dirección ÷ tamaño_página   (parte entera)
desplazamiento = dirección mod tamaño_página
física        = marco × tamaño_página + desplazamiento</pre>
<p>Ejemplo con páginas de 4096 bytes: la dirección 8200 está en la página 2 (8200 ÷ 4096 = 2,0…) con desplazamiento 8 (8200 − 8192).</p>
<h2>Fallos de página y memoria virtual</h2>
<p>No todas las páginas tienen que estar en RAM. Si el proceso accede a una que no está, la MMU genera un <strong>fallo de página</strong>; el SO la trae del disco (del área de <em>swap</em> o del archivo ejecutable) a un marco libre. Si no hay marcos libres, debe <strong>reemplazar</strong> una página: ¿cuál?</p>
<table class="t">
<tr><td><b>FIFO</b></td><td>la que lleva más tiempo cargada. Fácil, pero puede expulsar páginas muy usadas y sufre la <em>anomalía de Belady</em>: más marcos pueden dar más fallos.</td></tr>
<tr><td><b>LRU</b></td><td>la que lleva más tiempo sin usarse. Muy buena en la práctica; exacta es cara, así que se aproxima (algoritmo del reloj, bit de referencia).</td></tr>
<tr><td><b>Óptimo (OPT)</b></td><td>la que tardará más en volver a usarse. Imposible en la realidad (requiere conocer el futuro); sirve como cota para comparar.</td></tr>
</table>
<p>Si los procesos necesitan más marcos de los que hay, el sistema pasa más tiempo trayendo páginas que trabajando: es la <strong>hiperpaginación</strong> (<em>thrashing</em>).</p>
<h2>En Linux</h2>
<p><code>free -h</code> muestra la RAM y la swap; <code>/proc/meminfo</code> da el detalle. La columna "búf/caché" es memoria que el kernel usa como caché de disco y devuelve cuando hace falta: fíjate en "disponible". Si la memoria se agota del todo, el <em>OOM killer</em> elige un proceso y lo mata.</p>
<p>Usa el simulador: escribe una cadena de referencias, elige el número de marcos y el algoritmo. Las celdas resaltadas son fallos.</p>`,
    tasks: [
      { t: 'Cadena clásica (botón "Cadena clásica"), <b>3 marcos</b>, <b>FIFO</b>. ¿Cuántos fallos de página hay?', hint: 'Cuenta las columnas marcadas como fallo. Los 3 primeros accesos siempre fallan (marcos vacíos).', answer: () => Sims.paging(REF_CLASSIC.split(' ').map(Number), 3, 'FIFO').faults },
      { t: 'Misma cadena y 3 marcos con <b>LRU</b>. ¿Fallos?', hint: 'Al reemplazar, mira hacia atrás: sale la página usada hace más tiempo.', answer: () => Sims.paging(REF_CLASSIC.split(' ').map(Number), 3, 'LRU').faults },
      { t: 'Ahora con el algoritmo <b>óptimo</b>. ¿Fallos?', hint: 'Al reemplazar, mira hacia delante: sale la que tardará más en volver a usarse (o la que no vuelve).', answer: () => Sims.paging(REF_CLASSIC.split(' ').map(Number), 3, 'OPT').faults },
      { t: 'Carga la "Cadena de Belady" con FIFO. Con 3 marcos hay 9 fallos. ¿Cuántos hay con <b>4 marcos</b>?', hint: 'Si salen más de 9, acabas de ver la anomalía de Belady.', answer: () => Sims.paging(REF_BELADY.split(' ').map(Number), 4, 'FIFO').faults },
      { t: 'Con páginas de 4 KB (4096 bytes), ¿en qué número de página está la dirección lógica <b>20500</b>?', hint: 'División entera: 20500 ÷ 4096.', answer: 5 },
      { t: '¿Y cuál es su desplazamiento dentro de esa página?', hint: '20500 − 5 × 4096.', answer: 20 }
    ]
  },
  // ------------------------------------------------------------------ 12
  {
    id: 'fs', title: 'El sistema de archivos por dentro', short: 'Nodos-i y enlaces',
    ref: 'LFS101 · Cap. 10', so: 'Implementación de sistemas de archivos', mins: 30,
    summary: 'Nodos-i, enlaces duros y simbólicos, montaje, df y du.',
    setup(S) { wipe(S, 'enlaces'); H(S, 'enlaces/original.txt', 'Contenido del archivo original. Los datos viven en el nodo-i, no en el nombre.\n'); },
    theory: `
<h2>Nombre, nodo-i y datos</h2>
<p>En los sistemas de archivos de Unix (ext4, XFS…), un archivo tiene tres partes:</p>
<ul>
<li>El <strong>nodo-i</strong> (inode): un registro con el tipo, permisos, dueño, tamaño, fechas, número de enlaces y punteros a los bloques de datos. Tiene un número único dentro del sistema de archivos. <em>No guarda el nombre.</em></li>
<li>Los <strong>bloques de datos</strong> con el contenido.</li>
<li>Una o más <strong>entradas de directorio</strong> que asocian un nombre a ese número de nodo-i.</li>
</ul>
<pre class="try">ls -i ~/enlaces</pre>
<pre class="try">stat ~/enlaces/original.txt</pre>
<h2>Enlaces duros y simbólicos</h2>
<table class="t">
<tr><th></th><th>Enlace duro <code>ln a b</code></th><th>Enlace simbólico <code>ln -s a b</code></th></tr>
<tr><td>Qué es</td><td>otro nombre para el mismo nodo-i</td><td>un archivo pequeño que contiene una ruta</td></tr>
<tr><td>Nodo-i</td><td>el mismo que el original</td><td>uno propio</td></tr>
<tr><td>Si borras el original</td><td>los datos siguen ahí</td><td>queda roto (apunta a nada)</td></tr>
<tr><td>Directorios / otros discos</td><td>no se permite</td><td>sí</td></tr>
</table>
<p>Los datos de un archivo solo se liberan cuando su <strong>contador de enlaces</strong> llega a 0 y nadie lo tiene abierto. Por eso la llamada al sistema para borrar se llama <code>unlink()</code>.</p>
<h2>Discos, particiones y montaje</h2>
<p>Un disco (<code>/dev/sda</code>) se divide en particiones (<code>/dev/sda1</code>), cada una con su sistema de archivos. Para usarlo se <strong>monta</strong> en un directorio: <code>mount /dev/sdb1 /mnt</code>. Los montajes automáticos al arrancar se definen en <code>/etc/fstab</code>.</p>
<pre class="try">lsblk</pre>
<pre class="try">df -h</pre>
<pre class="try">du -sh ~/*</pre>
<p><code>df</code> dice cuánto espacio queda en cada sistema de archivos; <code>du</code> cuánto ocupa un directorio.</p>
<div class="so"><b>Para tu clase de SO</b> ext4 usa <strong>extents</strong> (rangos contiguos de bloques) en lugar de la vieja tabla de punteros directos e indirectos, y un <strong>journal</strong>: antes de modificar metadatos escribe lo que va a hacer en un registro, para poder recuperar la consistencia tras un corte de luz sin revisar todo el disco. Linux añade encima el <strong>VFS</strong> (sistema de archivos virtual), una capa común que permite que <code>ls</code> funcione igual sobre ext4, FAT, NFS o <code>/proc</code>.</div>`,
    tasks: [
      { t: 'Muestra el número de nodo-i de <code>~/enlaces/original.txt</code>.', hint: 'ls con la opción -i.', sol: 'ls -i ~/enlaces/original.txt', check: c => c.ran('ls', a => a.some(x => /^-\w*i/.test(x))) },
      { t: 'Crea un enlace <b>duro</b> llamado <code>~/enlaces/duro.txt</code> que apunte a <code>original.txt</code>.', hint: 'ln origen nombre_enlace (sin -s).', sol: 'ln ~/enlaces/original.txt ~/enlaces/duro.txt', check: c => c.ino(HOME + '/enlaces/duro.txt') && c.ino(HOME + '/enlaces/duro.txt') === c.ino(HOME + '/enlaces/original.txt') },
      { t: 'Crea un enlace <b>simbólico</b> llamado <code>~/enlaces/simbolico.txt</code> que apunte a <code>original.txt</code>.', hint: 'ln -s. Si estás dentro de ~/enlaces, usa nombres relativos: ln -s original.txt simbolico.txt', sol: 'cd ~/enlaces && ln -s original.txt simbolico.txt', check: c => c.isLink(HOME + '/enlaces/simbolico.txt') },
      { t: 'Compara los tres con <code>ls -li</code>: fíjate en los números de nodo-i y en el contador de enlaces.', hint: 'ls -li ~/enlaces', sol: 'ls -li ~/enlaces', check: c => c.ran('ls', a => a.some(x => /^-\w*i/.test(x)) && a.some(x => /^-\w*l/.test(x))) && c.out.includes('simbolico.txt') },
      { t: 'Borra <code>original.txt</code> y demuestra que <code>duro.txt</code> sigue teniendo los datos.', hint: 'rm original.txt y luego cat duro.txt.', sol: 'rm ~/enlaces/original.txt && cat ~/enlaces/duro.txt', check: c => !c.exists(HOME + '/enlaces/original.txt') && c.out.includes('Contenido del archivo original') },
      { t: 'Intenta leer <code>simbolico.txt</code>: comprobarás que el enlace quedó roto.', hint: 'cat simbolico.txt dará "No existe el archivo".', sol: 'cat ~/enlaces/simbolico.txt', check: c => c.ranEver('cat', (a, e) => a.some(x => x.includes('simbolico')) && e.code !== 0) },
      { t: 'Muestra el espacio libre de los sistemas de archivos en formato legible.', hint: 'df con -h.', sol: 'df -h', check: c => c.ran('df') },
      { t: 'Muestra cuánto ocupa en total tu directorio personal.', hint: 'du -sh ~', sol: 'du -sh ~', check: c => c.ran('du', a => a.some(x => /s/.test(x))) }
    ]
  },
  // ------------------------------------------------------------------ 13
  {
    id: 'scripts', title: 'Programar en Bash', short: 'Scripts',
    ref: 'LFS101 · Cap. 15–16', so: 'Interfaz del SO', mins: 45,
    summary: 'Variables, argumentos, if, for, while y aritmética en scripts.',
    setup(S) { H(S, 'scripts', null); },
    theory: `
<h2>Un script es una lista de órdenes en un archivo</h2>
<pre class="ex">#!/bin/bash
# Mi primer script
echo "Hola Mundo"</pre>
<p>La primera línea, el <strong>shebang</strong> <code>#!</code>, indica qué intérprete lo ejecuta. Para lanzarlo: <code>chmod +x hola.sh</code> y luego <code>./hola.sh</code>. También puedes hacer <code>bash hola.sh</code> sin dar permisos.</p>
<h2>Variables</h2>
<pre class="ex">nombre="Ana"           # ¡sin espacios alrededor del =!
echo "Hola, $nombre"
hoy=$(date +%F)        # guarda la salida de una orden
total=$((3 + 4 * 2))   # aritmética entera: 11</pre>
<p>Comillas dobles <code>"..."</code> expanden variables; simples <code>'...'</code> no expanden nada.</p>
<h2>Argumentos</h2>
<table class="t"><tr><td><code>$1</code>, <code>$2</code>…</td><td>argumentos</td></tr><tr><td><code>$#</code></td><td>cuántos argumentos hay</td></tr><tr><td><code>$@</code></td><td>todos los argumentos</td></tr><tr><td><code>$0</code></td><td>nombre del script</td></tr><tr><td><code>$?</code></td><td>código de salida de la última orden (0 = éxito)</td></tr></table>
<h2>Condiciones</h2>
<pre class="ex">if [ "$1" -gt 10 ]; then
  echo "mayor que 10"
elif [ "$1" -eq 10 ]; then
  echo "igual a 10"
else
  echo "menor que 10"
fi</pre>
<p>Dentro de <code>[ ]</code> los espacios son obligatorios. Números: <code>-eq -ne -lt -le -gt -ge</code>. Texto: <code>=</code>, <code>!=</code>, <code>-z</code> (vacío). Archivos: <code>-f</code> existe y es archivo, <code>-d</code> directorio, <code>-x</code> ejecutable.</p>
<h2>Bucles</h2>
<pre class="ex">for f in *.txt; do
  echo "Procesando $f"
done

for i in $(seq 1 5); do echo $i; done

n=3
while [ $n -gt 0 ]; do
  echo $n
  n=$((n - 1))
done</pre>
<p>Para escribir los scripts usa <code>nano</code>. También puedes probar bucles directamente en la terminal, en una sola línea separando con <code>;</code>.</p>
<pre class="try">for i in 1 2 3; do echo "vuelta $i"; done</pre>
<div class="so"><b>Para tu clase de SO</b> Al ejecutar <code>./script.sh</code>, el kernel lee el <code>#!</code> en la llamada <code>execve()</code> y lanza el intérprete indicado pasándole la ruta del script. El script corre en un proceso hijo: un <code>cd</code> dentro de él no cambia el directorio de tu terminal. Si quieres que sí lo haga, usa <code>source script.sh</code>.</div>`,
    tasks: [
      { t: 'Con nano, crea <code>~/scripts/hola.sh</code> con el shebang <code>#!/bin/bash</code> y una línea que imprima <code>Hola Mundo</code>.', hint: 'nano ~/scripts/hola.sh. Primera línea #!/bin/bash, segunda echo "Hola Mundo". Ctrl+O, Ctrl+X.', sol: 'nano ~/scripts/hola.sh', check: c => { const t = c.read(HOME + '/scripts/hola.sh') || ''; return /^#!\s*\/(usr\/)?bin\/(env )?(ba)?sh/.test(t) && /echo/.test(t) && /hola mundo/i.test(t); } },
      { t: 'Dale permiso de ejecución y ejecútalo con <code>./hola.sh</code>.', hint: 'cd ~/scripts && chmod +x hola.sh && ./hola.sh', sol: 'cd ~/scripts && chmod +x hola.sh && ./hola.sh', check: c => c.ran(/hola\.sh$/, (a, e) => e.code === 0) && /hola mundo/i.test(c.out) },
      { t: 'Crea <code>~/scripts/saludo.sh</code> que salude al nombre que reciba como primer argumento: <code>./saludo.sh Ana</code> debe imprimir <code>Hola, Ana</code>.', hint: 'Usa $1: echo "Hola, $1". No olvides chmod +x.', sol: 'nano ~/scripts/saludo.sh', check: c => { const r = c.trial('bash ~/scripts/saludo.sh Zoila'); return /hola,?\s*zoila/i.test(r) && c.exists(HOME + '/scripts/saludo.sh'); } },
      { t: 'Crea <code>~/scripts/par.sh</code> que reciba un número y diga <code>par</code> o <code>impar</code>.', hint: 'if [ $(($1 % 2)) -eq 0 ]; then echo "par"; else echo "impar"; fi', sol: 'nano ~/scripts/par.sh', check: c => { const a = c.trial('bash ~/scripts/par.sh 14').toLowerCase(), b = c.trial('bash ~/scripts/par.sh 7').toLowerCase(); return /\bpar\b/.test(a) && !/impar/.test(a) && /impar/.test(b); } },
      { t: 'Crea <code>~/scripts/crear.sh</code> que, con un bucle <code>for</code>, cree los archivos <code>archivo1.txt</code> a <code>archivo5.txt</code> dentro de <code>~/scripts/salida</code>. Ejecútalo.', hint: 'mkdir -p ~/scripts/salida; for i in $(seq 1 5); do touch ~/scripts/salida/archivo$i.txt; done', sol: 'nano ~/scripts/crear.sh', check: c => [1, 2, 3, 4, 5].every(i => c.isFile(`${HOME}/scripts/salida/archivo${i}.txt`)) && /for|while/.test(c.read(HOME + '/scripts/crear.sh') || '') },
      { t: 'Crea <code>~/scripts/cuenta_atras.sh</code> que use un <code>while</code> para imprimir de 5 a 1 y después <code>¡Despegue!</code>.', hint: 'n=5; while [ $n -gt 0 ]; do echo $n; n=$((n - 1)); done; echo "¡Despegue!"', sol: 'nano ~/scripts/cuenta_atras.sh', check: c => { const r = c.trial('bash ~/scripts/cuenta_atras.sh').trim().split('\n').map(x => x.trim()); return r.slice(0, 5).join(',') === '5,4,3,2,1' && /despegue/i.test(r[5] || '') && /while|until/.test(c.read(HOME + '/scripts/cuenta_atras.sh') || ''); } }
    ]
  },
  // ------------------------------------------------------------------ 14
  {
    id: 'admin', title: 'Paquetes, servicios y red', short: 'Administración',
    ref: 'LFS101 · Cap. 6, 11 y 14', so: 'Servicios del SO', mins: 35,
    summary: 'apt, systemd, ip, ping, puertos y compresión con tar.',
    setup(S) {
      S.installed = S.installed.filter(p => p !== 'nginx');
      if (S.services.nginx) { const pid = S.services.nginx.pid; S.procs = S.procs.filter(p => p.pid !== pid); delete S.services.nginx; }
      S.aptUpdated = false; wipe(S, 'respaldo.tar.gz');
    },
    theory: `
<h2>Gestión de paquetes</h2>
<p>En Linux el software se instala desde <strong>repositorios</strong>: servidores de la distribución con paquetes firmados. En la familia Debian, <code>dpkg</code> instala archivos <code>.deb</code> y <code>apt</code> resuelve dependencias y los descarga.</p>
<pre class="ex">sudo apt update          # actualiza la LISTA de paquetes (no instala nada)
sudo apt upgrade         # actualiza lo instalado
sudo apt install tree    # instala
sudo apt remove tree     # desinstala
apt search servidor web  # busca
apt show nginx           # detalles</pre>
<p>En la familia Red Hat el equivalente es <code>sudo dnf install paquete</code>.</p>
<h2>Servicios con systemd</h2>
<p>Un <strong>servicio</strong> (o <em>demonio</em>) es un proceso que corre en segundo plano: el servidor web, SSH, cron… <code>systemd</code> (PID 1) los arranca y vigila.</p>
<pre class="ex">systemctl status ssh            # ¿está activo?
sudo systemctl start nginx      # arrancar
sudo systemctl stop nginx       # detener
sudo systemctl restart nginx    # reiniciar
sudo systemctl enable nginx     # arrancar al encender el equipo
journalctl -u nginx             # sus registros</pre>
<h2>Red</h2>
<table class="t">
<tr><td><code>ip a</code></td><td>interfaces y direcciones IP</td></tr>
<tr><td><code>ip r</code></td><td>rutas; la <em>default</em> es la puerta de enlace</td></tr>
<tr><td><code>ping -c 4 host</code></td><td>¿responde ese equipo? ¿con qué latencia?</td></tr>
<tr><td><code>cat /etc/hosts</code></td><td>nombres resueltos localmente, antes que el DNS</td></tr>
<tr><td><code>ss -tuln</code></td><td>puertos en escucha (22 SSH, 80 HTTP, 443 HTTPS)</td></tr>
<tr><td><code>curl URL</code></td><td>pide una página web desde la terminal</td></tr>
</table>
<h2>Empaquetar y comprimir</h2>
<pre class="ex">tar -czvf copia.tar.gz carpeta/   # c crear, z gzip, v ver, f archivo
tar -tzf copia.tar.gz             # t listar contenido
tar -xzvf copia.tar.gz            # x extraer</pre>
<div class="so"><b>Para tu clase de SO</b> Un demonio es un proceso sin terminal asociada (TTY <code>?</code> en <code>ps</code>) cuyo padre es el PID 1. La red es otro recurso que administra el kernel: un programa pide un <em>socket</em>, y el kernel implementa TCP/IP y multiplexa los paquetes entre procesos según el puerto.</div>`,
    tasks: [
      { t: 'Actualiza la lista de paquetes disponibles.', hint: 'sudo apt update', sol: 'sudo apt update', check: c => !!c.S.aptUpdated },
      { t: 'Instala el paquete <code>tree</code> y úsalo para ver tu directorio personal en forma de árbol.', hint: 'sudo apt install tree, luego tree ~', sol: 'sudo apt install tree && tree ~', check: c => c.S.installed.includes('tree') && c.ran('tree') },
      { t: 'Instala el servidor web <code>nginx</code>.', hint: 'sudo apt install nginx', sol: 'sudo apt install nginx', check: c => c.S.installed.includes('nginx') },
      { t: 'Comprueba con <code>systemctl</code> que nginx está activo y luego pide la página con <code>curl localhost</code>.', hint: 'systemctl status nginx; curl localhost', sol: 'systemctl status nginx && curl localhost', check: c => c.ranEver('systemctl', a => a.includes('status')) && c.ran('curl', (a, e) => e.code === 0) && c.out.includes('Funciona') },
      { t: 'Detén nginx y comprueba que <code>curl localhost</code> ahora falla.', hint: 'sudo systemctl stop nginx; curl localhost', sol: 'sudo systemctl stop nginx; curl localhost', check: c => c.S.services.nginx && !c.S.services.nginx.active && c.ran('curl', (a, e) => e.code !== 0) },
      { t: 'Arranca nginx de nuevo y configúralo para que se inicie al encender el equipo.', hint: 'sudo systemctl start nginx y sudo systemctl enable nginx (o enable --now).', sol: 'sudo systemctl enable --now nginx', check: c => c.S.services.nginx && c.S.services.nginx.active && c.S.services.nginx.enabled && c.ranEver('systemctl', a => a.includes('enable')) },
      { t: 'Muestra la dirección IP de esta máquina.', hint: 'ip a (o hostname -I).', sol: 'ip a', check: c => c.out.includes('192.168.1.50') },
      { t: 'Comprueba si responde el equipo <code>servidor-web</code> enviando exactamente 3 paquetes.', hint: 'ping -c 3 nombre', sol: 'ping -c 3 servidor-web', check: c => c.ran('ping', a => a.includes('servidor-web') && (a.includes('3') || a.includes('-c3'))) },
      { t: 'Muestra qué puertos están en escucha. Deberías ver el 22 (SSH) y el 80 (nginx).', hint: 'ss -tuln', sol: 'ss -tuln', check: c => c.ran('ss') || c.ran('netstat') },
      { t: 'Crea una copia comprimida de <code>~/Documentos</code> en <code>~/respaldo.tar.gz</code> y lista su contenido.', hint: 'tar -czvf ~/respaldo.tar.gz ~/Documentos y luego tar -tzf ~/respaldo.tar.gz', sol: 'tar -czvf ~/respaldo.tar.gz ~/Documentos && tar -tzf ~/respaldo.tar.gz', check: c => (c.read(HOME + '/respaldo.tar.gz') || '').startsWith('\x00GZ') && c.ranEver('tar', a => a.join('').includes('t')) }
    ]
  },
  // ------------------------------------------------------------------ 15
  {
    id: 'mision', title: 'Misión final: servidor en apuros', short: 'Misión final',
    ref: 'Repaso integrador', so: 'Todo el curso', mins: 40,
    summary: 'Un caso real: diagnostica y arregla un servidor usando todo lo aprendido.',
    setup(S) {
      S.procs = S.procs.filter(p => !/criptominero|app_server/.test(p.cmd));
      addProc(S, { pid: 6660, ppid: 1, user: 'www-data', cmd: '/tmp/.x/criptominero -o pool.malo.net', state: 'R', cpu: 99.1, mem: 8.4, tty: '?', start: '02:12', vsz: 560000, rss: 680000 });
      Engine.put(S, 'var/log/app', null);
      const lines = [];
      for (let i = 0; i < 30; i++) lines.push(`2026-10-13 0${2 + Math.floor(i / 12)}:${String(i * 2).padStart(2, '0')}:11 app_server[${2000 + i}]: ${i % 5 === 2 ? 'ERROR Out of memory: no se pudo reservar 512 MB' : i % 7 === 3 ? 'WARN cola de peticiones llena' : 'INFO petición /api/pedidos atendida'}`);
      Engine.put(S, 'var/log/app/app.log', lines.join('\n') + '\n', { owner: 'root', group: 'adm', mode: 0o640 });
      Engine.del(S, '/tmp/cache_vieja');
      Engine.put(S, 'tmp/cache_vieja', null, { owner: 'www-data', mode: 0o777 });
      ['sesion_a.tmp', 'sesion_b.tmp', 'sesion_c.tmp', 'img_492.tmp', 'img_493.tmp'].forEach(f => Engine.put(S, 'tmp/cache_vieja/' + f, 'x'.repeat(3000), { owner: 'www-data', mode: 0o666 }));
      Engine.put(S, 'tmp/cache_vieja/importante.dat', 'NO BORRAR: índice de la caché\n', { owner: 'www-data', mode: 0o666 });
      Engine.put(S, 'opt/app', null);
      Engine.put(S, 'opt/app/arrancar.sh', '#!/bin/bash\necho "Comprobando configuración... OK"\necho "Aplicación arrancada correctamente"\n', { owner: 'root', mode: 0o644 });
      Engine.put(S, 'opt/app/config.ini', '[servidor]\npuerto=8080\nmemoria_max=2G\n');
      S.services.app = { desc: 'Servidor de la aplicación de pedidos', active: false, enabled: true, failed: true, pid: null };
      removeUser(S, 'becario'); Engine.syncEtc(S);
      wipe(S, 'respaldo_app.tar.gz');
    },
    theory: `
<h2>La situación</h2>
<p>Son las 4 de la mañana y suena el teléfono: <em>"La web de pedidos no responde y el servidor va lentísimo"</em>. Te conectas por SSH a <code>linux-trainee</code>. Esta vez no hay instrucciones paso a paso: tienes una lista de problemas y todo lo que has practicado.</p>
<h2>Método de diagnóstico</h2>
<ol>
<li><b>Carga y procesos</b>: <code>uptime</code>, <code>top</code>, <code>ps aux --sort</code>. ¿Quién se come la CPU o la memoria? ¿De qué usuario es?</li>
<li><b>Registros</b>: <code>/var/log</code>, <code>journalctl -u servicio</code>, <code>grep</code> para filtrar errores.</li>
<li><b>Disco</b>: <code>df -h</code> y <code>du</code> para encontrar lo que ocupa espacio.</li>
<li><b>Servicios</b>: <code>systemctl status</code>, <code>systemctl --failed</code>.</li>
<li><b>Permisos</b>: si algo "no se ejecuta" o "no puede escribir", mira <code>ls -l</code>.</li>
</ol>
<div class="warn"><b>Recuerda</b> Antes de borrar con comodines, prueba el patrón con <code>ls</code> o <code>find</code> sin <code>-delete</code>. En producción, un rm de más es peor que el problema original.</div>
<p>Pistas generales: algunos archivos y procesos pertenecen a otros usuarios, así que necesitarás <code>sudo</code>. Puedes ver las pistas de cada reto, pero intenta resolverlo primero.</p>
<div class="so"><b>Lo que estás repasando</b> Procesos y señales (módulo 9), usuarios y sudo (7), permisos (8), búsqueda (5), tuberías (6), servicios y empaquetado (14).</div>`,
    tasks: [
      { t: 'Algo consume casi toda la CPU. Encuéntralo y elimínalo (no es tuyo).', hint: 'top o ps aux. Pertenece a www-data, así que kill necesita sudo. Si no muere con TERM, ya sabes qué señal usar.', sol: 'sudo kill -9 6660', check: c => !c.S.procs.some(p => p.cmd.includes('criptominero')) },
      { t: 'El proceso salía de <code>/tmp/.x</code>, un directorio oculto. Comprueba si existe con <code>ls -la /tmp</code>.', hint: 'ls -la /tmp. (En este caso el atacante ya lo había borrado: suele pasar.)', sol: 'ls -la /tmp', check: c => c.ran('ls', (a, e) => (a.includes('/tmp') || a.includes('/tmp/') || (e.cwd === '/tmp' && !a.some(x => !x.startsWith('-')))) && a.some(x => /^-\w*a/.test(x))) },
      { t: '¿Cuántas veces aparece <code>Out of memory</code> en <code>/var/log/app/app.log</code>? Obtén el número con una orden.', hint: 'El registro es del grupo adm, al que perteneces. grep -c "Out of memory" archivo', sol: 'grep -c "Out of memory" /var/log/app/app.log', check: c => c.ran('grep') && c.out.trim().split('\n').pop().trim().endsWith('6') },
      { t: 'Borra todos los archivos <code>.tmp</code> de <code>/tmp/cache_vieja</code>, pero conserva <code>importante.dat</code>.', hint: 'find /tmp/cache_vieja -name "*.tmp" (míralos primero) y luego añade -delete. También vale rm /tmp/cache_vieja/*.tmp', sol: 'find /tmp/cache_vieja -name "*.tmp" -delete', check: c => c.ls('/tmp/cache_vieja').filter(n => n.endsWith('.tmp')).length === 0 && c.isFile('/tmp/cache_vieja/importante.dat') },
      { t: 'El script <code>/opt/app/arrancar.sh</code> no se puede ejecutar. Arregla sus permisos y ejecútalo.', hint: 'Es de root con permisos 644: sudo chmod +x /opt/app/arrancar.sh y luego /opt/app/arrancar.sh', sol: 'sudo chmod 755 /opt/app/arrancar.sh && /opt/app/arrancar.sh', check: c => (c.mode('/opt/app/arrancar.sh') & 0o111) !== 0 && c.out.includes('Aplicación arrancada') },
      { t: 'El servicio <code>app</code> está caído. Mira su estado y vuelve a ponerlo en marcha.', hint: 'systemctl status app y luego sudo systemctl restart app', sol: 'sudo systemctl restart app', check: c => c.S.services.app && c.S.services.app.active },
      { t: 'Mañana empieza un becario. Crea el usuario <code>becario</code> con directorio personal y añádelo al grupo <code>www-data</code>.', hint: 'sudo useradd -m becario y sudo usermod -aG www-data becario', sol: 'sudo useradd -m becario && sudo usermod -aG www-data becario', check: c => !!c.S.users.becario && c.isDir('/home/becario') && c.S.groups['www-data'].members.includes('becario') },
      { t: 'Antes de irte, guarda una copia comprimida de <code>/opt/app</code> en <code>~/respaldo_app.tar.gz</code>.', hint: 'tar -czf ~/respaldo_app.tar.gz /opt/app', sol: 'tar -czf ~/respaldo_app.tar.gz /opt/app', check: c => (c.read(HOME + '/respaldo_app.tar.gz') || '').startsWith('\x00GZ') && (c.read(HOME + '/respaldo_app.tar.gz') || '').includes('arrancar.sh') }
    ]
  }
];
