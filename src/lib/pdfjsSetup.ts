import { GlobalWorkerOptions } from 'pdfjs-dist';

// pdf.js needs its worker script available at a real URL. Vite's `?url`
// import gives us the built/served path to the worker file so it loads
// correctly in both dev and production, without manual copying.
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
