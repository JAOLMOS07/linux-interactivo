# Laboratorio Linux

App web para aprender Linux desde cero con un Ubuntu simulado en el navegador: teoría, retos prácticos que se comprueban contra el estado real del sistema y simuladores de Sistemas Operativos. Sigue el temario de *Introduction to Linux* (LFS101) de la Linux Foundation y lo complementa con temas de la materia de Sistemas Operativos.

- 15 módulos y 113 retos (navegación, archivos, texto, tuberías, usuarios, permisos, procesos, nodos-i, scripts en Bash, paquetes, servicios, red y una misión final).
- Terminal simulada con sistema de archivos virtual, usuarios, permisos, procesos y señales, editor `nano`, `apt`, `systemctl`, `tar`…
- Simuladores de planificación de CPU (FCFS, SJF, SRTF, Round Robin, prioridades) y de reemplazo de páginas (FIFO, LRU, óptimo).
- El avance se guarda en el navegador (`localStorage`).

## Estructura

```
index.html        # la app compilada, un solo archivo (lo que se publica)
src/
  engine.js       # shell y sistema de archivos simulados
  sims.js         # simuladores de planificación y paginación
  lessons.js      # módulos: teoría y retos con sus comprobaciones
  app.js          # interfaz
  style.css       # estilos
  shell.html      # plantilla HTML
  build.py        # une todo en index.html
vercel.json
```

## Desarrollo

Edita los archivos de `src/` y regenera la app:

```bash
python3 src/build.py
```

Abre `index.html` en el navegador para probarla. No hay dependencias.

## Despliegue en Vercel

1. Importa este repositorio en vercel.com (*Add New › Project*).
2. Framework preset: **Other**. Sin comando de build; el directorio de salida es la raíz.
3. Cada `git push` a la rama principal publica una versión nueva.

Recuerda ejecutar `python3 src/build.py` antes de hacer commit si cambiaste algo en `src/`.
