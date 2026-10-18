set -e
cd "$(dirname "$0")"
mkdir -p vendor/fonts

C=https://cdnjs.cloudflare.com/ajax/libs
curl -fL $C/pdf-lib/1.17.1/pdf-lib.min.js -o vendor/pdf-lib.min.js
curl -fL $C/pdf.js/3.11.174/pdf.min.js -o vendor/pdf.min.js
curl -fL $C/pdf.js/3.11.174/pdf.worker.min.js -o vendor/pdf.worker.min.js
curl -fL $C/jszip/3.10.1/jszip.min.js -o vendor/jszip.min.js
curl -fL $C/mammoth/1.6.0/mammoth.browser.min.js -o vendor/mammoth.browser.min.js
curl -fL $C/xlsx/0.18.5/xlsx.full.min.js -o vendor/xlsx.full.min.js
curl -fL $C/html2pdf.js/0.10.1/html2pdf.bundle.min.js -o vendor/html2pdf.bundle.min.js

for w in 400 500 600 700; do
    curl -fL https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.8/files/inter-latin-$w-normal.woff2 -o vendor/fonts/inter-latin-$w-normal.woff2
done

echo "librerías descargadas"