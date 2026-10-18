'use strict';

const { PDFDocument } = PDFLib;

try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
} catch (e) { /* no cargó */ }

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

let tool = 'merge';
let files = [];
let busy = false;

const $ = (id) => document.getElementById(id);

function fmt(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
}

function esc(s) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return s.replace(/[&<>"]/g, (c) => map[c]);
}

function showError(msg) {
    $('err').textContent = msg;
}

function setProgress(p) {
    $('prog').hiddden = p == null;
    if (p != null) $('prog').firstChild.style.width = p * 100 + '%';
}

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

async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob.arrayBuffer();
}
