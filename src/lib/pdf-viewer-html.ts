/**
 * A self-contained page that draws a PDF with Mozilla PDF.js (bundled, so it works offline) for the
 * in-app viewer. PDF.js is loaded from blob URLs because the page has no server to fetch it from; any
 * failure is posted back to the app as { error }.
 */
export async function buildPdfViewerHtml(pdfBase64: string): Promise<string> {
  const { PDFJS_LIB, PDFJS_WORKER } = await import('@/generated/pdfjs-source');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes" />
    <style>
      html, body { margin: 0; background: #e9edf5; }
      #pages { padding: 10px 0 24px; }
      canvas { display: block; width: calc(100% - 20px); height: auto; margin: 0 auto 10px; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); }
      #status { padding: 40px 20px; font: 15px -apple-system, Roboto, sans-serif; color: #5a6b8c; text-align: center; }
    </style>
  </head>
  <body>
    <div id="status">Opening PDF…</div>
    <div id="pages"></div>
    <script type="text/plain" id="pdfjs-lib">${PDFJS_LIB}</script>
    <script type="text/plain" id="pdfjs-worker">${PDFJS_WORKER}</script>
    <script type="text/plain" id="pdf-data">${pdfBase64}</script>
    <script type="module">
      const post = (message) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
      const blobUrl = (id) => URL.createObjectURL(new Blob([document.getElementById(id).textContent], { type: 'text/javascript' }));
      try {
        const pdfjs = await import(blobUrl('pdfjs-lib'));
        pdfjs.GlobalWorkerOptions.workerSrc = blobUrl('pdfjs-worker');
        const base64 = document.getElementById('pdf-data').textContent.trim();
        const binary = atob(base64);
        const data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
        const pdf = await pdfjs.getDocument({ data }).promise;
        const pages = document.getElementById('pages');
        // Drawn at twice the screen's pixel density so zoomed-in text stays sharp.
        const density = Math.min(3, (window.devicePixelRatio || 1) * 2);
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (window.innerWidth / base.width) * density });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute('aria-label', 'Page ' + number + ' of ' + pdf.numPages);
          pages.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (number === 1) document.getElementById('status').remove();
        }
        post({ pages: pdf.numPages });
      } catch (error) {
        document.getElementById('status').textContent = 'Couldn’t open this PDF.';
        post({ error: String((error && error.message) || error) });
      }
    </script>
  </body>
</html>`;
}
