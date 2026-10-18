/* ==========================================================================
   PDF Studio — lógica de la aplicación
   Todo se procesa en el navegador; no hay servidor.
   ========================================================================== */
'use strict';

const { PDFDocument } = PDFLib;

// pdf.js necesita su worker; se sirve desde la carpeta vendor/
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
} catch (e) { /* pdf.js no cargó: solo afectará a "Comprimir" */ }


/* --------------------------------------------------------------------------
   Configuración de herramientas
   -------------------------------------------------------------------------- */
const TOOLS = {
  merge: {
    n: 'Unir',
    t: 'Une PDFs en uno solo.',
    s: 'Combina varios archivos en un documento y ordénalos como quieras.',
    acc: '.pdf',
    multi: true,
    btn: 'Unir PDF',
    dt: 'Selecciona tus PDFs',
    min: 2,
  },
  split: {
    n: 'Dividir',
    t: 'Divide tu PDF.',
    s: 'Extrae páginas o separa el documento en varios archivos.',
    acc: '.pdf',
    multi: false,
    btn: 'Dividir PDF',
    dt: 'Selecciona un PDF',
    min: 1,
  },
  compress: {
    n: 'Comprimir',
    t: 'Reduce el tamaño.',
    s: 'Optimiza tu PDF para enviarlo por correo o subirlo a la web.',
    acc: '.pdf',
    multi: false,
    btn: 'Comprimir PDF',
    dt: 'Selecciona un PDF',
    min: 1,
  },
  img: {
    n: 'Imagen a PDF',
    t: 'Imágenes a PDF.',
    s: 'Convierte JPG, PNG, WebP o GIF en un PDF; una imagen por página.',
    acc: '.jpg,.jpeg,.png,.webp,.gif',
    multi: true,
    btn: 'Crear PDF',
    dt: 'Selecciona tus imágenes',
    min: 1,
  },
  office: {
    n: 'Office a PDF',
    t: 'Convierte a PDF.',
    s: 'Documentos Word (.docx) y hojas de cálculo (.xlsx, .xls, .csv).',
    acc: '.docx,.xlsx,.xls,.csv',
    multi: true,
    btn: 'Convertir a PDF',
    dt: 'Selecciona documentos',
    min: 1,
  },
};

// Estado de la aplicación
let tool = 'merge'; // herramienta activa
let files = [];     // archivos seleccionados
let busy = false;   // true mientras se procesa


/* --------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

/** Formatea bytes: 1536 -> "1.5 KB" */
function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

/** Escapa texto para insertarlo de forma segura en HTML */
function esc(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return s.replace(/[&<>"]/g, (c) => map[c]);
}

function showError(msg) {
  $('err').textContent = msg;
}

/** Barra de progreso: valor entre 0 y 1, o null para ocultarla */
function setProgress(p) {
  $('prog').hidden = p == null;
  if (p != null) $('prog').firstChild.style.width = p * 100 + '%';
}

/** Muestra la tarjeta de resultado con el botón de descarga */
function showResult(blob, name, note) {
  const url = URL.createObjectURL(blob);
  $('res').innerHTML = `
    <div class="res">
      <b class="ok">Listo</b>
      <p>${esc(name)} · ${fmt(blob.size)}${note ? '<br>' + note : ''}</p>
      <a class="btn" href="${url}" download="${esc(name)}"
         style="display:inline-block;text-decoration:none">Descargar</a>
    </div>`;
}

/** Convierte un canvas a JPEG (ArrayBuffer) */
async function canvasToJpeg(canvas, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob.arrayBuffer();
}

/** Carga un PDF con pdf-lib (tolera archivos con cifrado básico) */
async function loadPdf(file) {
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
}

/** Devuelve los índices [a-1 ... b-1] para el rango de páginas a..b */
function pageIndices(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
}

/**
 * Interpreta "1-3, 5, 8-" y devuelve [[1,3],[5,5],[8,total]].
 * Lanza un error con mensaje claro si algo no es válido.
 */
function parseRanges(text, total) {
  const ranges = [];

  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;

    if (m) {
      a = m[1] ? +m[1] : 1;
      b = m[2] ? +m[2] : total;
    } else if (/^\d+$/.test(part)) {
      a = b = +part;
    } else {
      throw new Error(`Rango no válido: "${part}"`);
    }

    if (a < 1 || b > total || a > b) {
      throw new Error(`El rango "${part}" está fuera del documento (1–${total}).`);
    }
    ranges.push([a, b]);
  }

  if (!ranges.length) throw new Error('Indica al menos una página o rango.');
  return ranges;
}


/* --------------------------------------------------------------------------
   Interfaz
   -------------------------------------------------------------------------- */

/** Cambia de herramienta y reinicia la pantalla */
function setTool(key) {
  tool = key;
  files = [];
  $('res').innerHTML = '';
  showError('');

  const T = TOOLS[key];
  $('t').textContent = T.t;
  $('s').textContent = T.s;
  $('dt').textContent = T.dt;
  $('inp').accept = T.acc;
  $('inp').multiple = T.multi;
  $('go').textContent = T.btn;

  $('seg').innerHTML = Object.entries(TOOLS)
    .map(([id, v]) => `<button role="tab" aria-selected="${id === key}" data-k="${id}">${v.n}</button>`)
    .join('');

  render();
}

/** HTML de una fila de la lista de archivos */
function fileRow(f, i) {
  const ext = esc(f.name.split('.').pop().toUpperCase().slice(0, 4));
  const sortable = (tool === 'merge' || tool === 'img') && files.length > 1;

  const sortButtons = sortable ? `
      <button class="ib" data-a="up" data-i="${i}" aria-label="Subir" ${i ? '' : 'disabled'}>↑</button>
      <button class="ib" data-a="dn" data-i="${i}" aria-label="Bajar" ${i < files.length - 1 ? '' : 'disabled'}>↓</button>`
    : '';

  return `
    <li>
      <div class="ico">${ext}</div>
      <div class="nm">
        <div>${esc(f.name)}</div>
        <small>${fmt(f.size)}</small>
      </div>${sortButtons}
      <button class="ib" data-a="rm" data-i="${i}" aria-label="Quitar">✕</button>
    </li>`;
}

/** HTML de las opciones propias de cada herramienta */
function optionsHTML() {
  if (tool === 'split') {
    return `
      <label>Modo
        <select id="mode">
          <option value="one">Extraer páginas en un solo PDF</option>
          <option value="each">Separar cada rango en un archivo (ZIP)</option>
          <option value="all">Una página por archivo (ZIP)</option>
        </select>
      </label>
      <label id="rg">Páginas
        <input type="text" id="range" placeholder="Ej. 1-3, 5, 8-">
        <p class="hint" id="pc"></p>
      </label>`;
  }

  if (tool === 'img') {
    return `
      <label>Tamaño de página
        <select id="psz">
          <option value="a4">A4 con márgenes (orientación automática)</option>
          <option value="fit">Ajustar al tamaño de la imagen</option>
        </select>
      </label>`;
  }

  if (tool === 'compress') {
    return `
      <label>Nivel de compresión
        <select id="lvl">
          <option value="0.85|1.6">Baja — mejor calidad</option>
          <option value="0.65|1.3" selected>Recomendada</option>
          <option value="0.4|1">Alta — menor tamaño</option>
        </select>
      </label>
      <p class="hint">Las páginas se convierten en imágenes optimizadas,
        por lo que el texto deja de ser seleccionable.</p>`;
  }

  if (tool === 'office') {
    return `
      <p class="hint">Convierte Word y Excel directamente en tu navegador.
        PowerPoint (.pptx) aún no está disponible.
        El formato puede variar respecto al original.</p>`;
  }

  return '';
}

/** Redibuja lista, opciones y botones según el estado actual */
async function render() {
  $('list').innerHTML = files.map(fileRow).join('');
  $('opts').innerHTML = files.length ? optionsHTML() : '';

  // En herramientas de un solo archivo se oculta la zona de arrastre al elegirlo
  $('drop').style.display = files.length && !TOOLS[tool].multi ? 'none' : '';
  $('go').style.display = files.length ? '' : 'none';
  $('go').disabled = files.length < TOOLS[tool].min || busy;

  if (tool === 'split' && files.length) {
    const mode = $('mode');
    mode.onchange = () => {
      $('rg').style.display = mode.value === 'all' ? 'none' : '';
    };

    try {
      const doc = await loadPdf(files[0]);
      $('pc').textContent = `El documento tiene ${doc.getPageCount()} páginas.`;
    } catch (e) {
      showError('No se pudo leer el PDF. Puede estar dañado o protegido.');
    }
  }
}

/** Añade archivos validando su extensión */
function addFiles(list) {
  const T = TOOLS[tool];
  const allowed = T.acc.split(',');
  const valid = [...list].filter((f) => allowed.some((ext) => f.name.toLowerCase().endsWith(ext)));

  if (!valid.length) {
    return showError('Formato no compatible. Usa: ' + T.acc.replace(/,/g, ', '));
  }

  showError('');
  files = T.multi ? files.concat(valid) : [valid[0]];
  $('res').innerHTML = '';
  render();
}


/* --------------------------------------------------------------------------
   Herramientas
   -------------------------------------------------------------------------- */

/** UNIR: junta todas las páginas de los PDFs, en el orden de la lista */
async function mergePDFs() {
  const out = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    setProgress(i / files.length);
    const doc = await loadPdf(files[i]);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  showResult(new Blob([await out.save()], { type: 'application/pdf' }), 'unido.pdf');
}

/** DIVIDIR: extrae páginas a un PDF, o genera un ZIP con varios */
async function splitPDF() {
  const src = await loadPdf(files[0]);
  const total = src.getPageCount();
  const mode = $('mode').value;
  const base = files[0].name.replace(/\.pdf$/i, '');

  // Crea un PDF nuevo con las páginas indicadas
  const extract = async (indices) => {
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, indices)).forEach((p) => doc.addPage(p));
    return doc.save();
  };

  if (mode === 'one') {
    const ranges = parseRanges($('range').value, total);
    const bytes = await extract(ranges.flatMap(([a, b]) => pageIndices(a, b)));
    return showResult(new Blob([bytes], { type: 'application/pdf' }), base + '-extracto.pdf');
  }

  const ranges = mode === 'all'
    ? Array.from({ length: total }, (_, i) => [i + 1, i + 1])
    : parseRanges($('range').value, total);

  const zip = new JSZip();
  for (let i = 0; i < ranges.length; i++) {
    setProgress(i / ranges.length);
    const [a, b] = ranges[i];
    zip.file(`${base}-${a === b ? a : a + '-' + b}.pdf`, await extract(pageIndices(a, b)));
  }

  showResult(await zip.generateAsync({ type: 'blob' }), base + '-dividido.zip');
}

/** COMPRIMIR: renderiza cada página y la guarda como JPEG de menor calidad */
async function compressPDF() {
  const [quality, scale] = $('lvl').value.split('|').map(Number);
  const file = files[0];

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = await PDFDocument.create();

  for (let n = 1; n <= pdf.numPages; n++) {
    setProgress((n - 1) / pdf.numPages);

    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const original = page.getViewport({ scale: 1 }); // tamaño real de la página

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpg = await out.embedJpg(await canvasToJpeg(canvas, quality));
    out.addPage([original.width, original.height])
      .drawImage(jpg, { x: 0, y: 0, width: original.width, height: original.height });
  }

  const bytes = await out.save();
  const saved = Math.round((1 - bytes.length / file.size) * 100);

  const note = saved > 0
    ? `${fmt(file.size)} → ${fmt(bytes.length)} (−${saved}%)`
    : 'Este PDF ya estaba optimizado; el resultado no es más pequeño. ' +
      'Prueba otro nivel o conserva el original.';

  showResult(
    new Blob([bytes], { type: 'application/pdf' }),
    file.name.replace(/\.pdf$/i, '') + '-comprimido.pdf',
    note
  );
}

/** IMAGEN A PDF: una imagen por página */
async function imagesToPDF() {
  const out = await PDFDocument.create();
  const a4 = $('psz').value === 'a4';

  for (let i = 0; i < files.length; i++) {
    setProgress(i / files.length);
    const file = files[i];
    let image;

    if (/\.png$/i.test(file.name)) {
      image = await out.embedPng(await file.arrayBuffer());
    } else {
      // JPG, WebP y GIF pasan por un canvas para convertirlos a JPEG
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);

      image = await out.embedJpg(await canvasToJpeg(canvas, 0.92));
    }

    // Píxeles -> puntos PDF (96 dpi -> 72 dpi)
    const w = image.width * 0.75;
    const h = image.height * 0.75;

    if (a4) {
      const landscape = w > h;
      const pw = landscape ? 841.89 : 595.28;
      const ph = landscape ? 595.28 : 841.89;
      const margin = 28;
      const s = Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h, 1);

      out.addPage([pw, ph]).drawImage(image, {
        x: (pw - w * s) / 2,
        y: (ph - h * s) / 2,
        width: w * s,
        height: h * s,
      });
    } else {
      out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    }
  }

  showResult(new Blob([await out.save()], { type: 'application/pdf' }), 'imagenes.pdf');
}

/** Convierte un .docx / .xlsx / .xls / .csv en HTML */
async function officeToHTML(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();

  if (ext === 'docx') {
    return (await mammoth.convertToHtml({ arrayBuffer: buffer })).value;
  }

  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.map((name) => {
    const table = XLSX.utils.sheet_to_html(workbook.Sheets[name], { header: '', footer: '' });
    return `<h3>${esc(name)}</h3>${table}`;
  }).join('');
}

/** OFFICE A PDF: Word/Excel -> HTML -> PDF */
async function officeToPDF() {
  const results = [];

  for (let i = 0; i < files.length; i++) {
    setProgress(i / files.length);
    const file = files[i];

    // Contenedor temporal con el aspecto de una hoja de papel
    const el = document.createElement('div');
    el.style.cssText = 'width:680px;padding:24px;color:#000;background:#fff;' +
      'font:14px/1.5 Arial,sans-serif';
    el.innerHTML =
      '<style>table{border-collapse:collapse}' +
      'td,th{border:1px solid #bbb;padding:4px 8px;font-size:11px}' +
      'img{max-width:100%}</style>' +
      await officeToHTML(file);
    document.body.appendChild(el);

    const blob = await html2pdf()
      .set({
        margin: 12,
        filename: 'x.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(el)
      .outputPdf('blob');

    el.remove();
    results.push({ name: file.name.replace(/\.[^.]+$/, '') + '.pdf', blob });
  }

  if (results.length === 1) {
    return showResult(results[0].blob, results[0].name);
  }

  const zip = new JSZip();
  results.forEach((r) => zip.file(r.name, r.blob));
  showResult(await zip.generateAsync({ type: 'blob' }), 'convertidos.zip');
}

const RUNNERS = {
  merge: mergePDFs,
  split: splitPDF,
  compress: compressPDF,
  img: imagesToPDF,
  office: officeToPDF,
};


/* --------------------------------------------------------------------------
   Eventos
   -------------------------------------------------------------------------- */

// Cambiar de herramienta
$('seg').onclick = (e) => {
  const key = e.target.dataset.k;
  if (key && !busy) setTool(key);
};

// Subir / bajar / quitar archivos de la lista
$('list').onclick = (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const i = +btn.dataset.i;
  const action = btn.dataset.a;

  if (action === 'rm') {
    files.splice(i, 1);
  } else {
    const j = action === 'up' ? i - 1 : i + 1;
    [files[i], files[j]] = [files[j], files[i]];
  }

  $('res').innerHTML = '';
  render();
};

// Selector de archivos y zona de arrastre
$('drop').onclick = () => $('inp').click();

$('drop').onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('inp').click();
  }
};

$('inp').onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = ''; // permite volver a elegir el mismo archivo
};

['dragover', 'dragenter'].forEach((type) =>
  $('drop').addEventListener(type, (e) => {
    e.preventDefault();
    $('drop').classList.add('over');
  })
);

['dragleave', 'drop'].forEach((type) =>
  $('drop').addEventListener(type, (e) => {
    e.preventDefault();
    $('drop').classList.remove('over');
  })
);

$('drop').addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// Botón principal: ejecuta la herramienta activa
$('go').onclick = async () => {
  busy = true;
  showError('');
  $('res').innerHTML = '';
  $('go').disabled = true;
  $('go').textContent = 'Procesando…';

  try {
    await RUNNERS[tool]();
  } catch (e) {
    showError(e.message || 'Algo salió mal. Revisa el archivo e inténtalo de nuevo.');
  }

  busy = false;
  setProgress(null);
  $('go').textContent = TOOLS[tool].btn;
  $('go').disabled = false;
};

// Inicio
setTool('merge');