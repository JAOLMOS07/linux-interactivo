"""Une los fuentes de src/ en un único index.html en la raíz del repositorio.
Uso: python3 src/build.py
"""
import os
d = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(d)
r = lambda f: open(os.path.join(d, f), encoding='utf8').read()
body = r('shell.html').replace('/*CSS*/', r('style.css'))
js = '\n'.join(r(f) for f in ['engine.js', 'sims.js', 'lessons.js', 'app.js']).replace('</script', '<\\/script')
body = body.replace('/*JS*/', js)
html = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
        + body + '\n</body>\n</html>\n')
open(os.path.join(root, 'index.html'), 'w', encoding='utf8').write(html)
print('index.html generado:', len(html), 'bytes')
