## livePDF

PDF creation and editing tool that runs completely on your browser.
Works in the same way as Google Spreadsheets does, where PDFs can be opened, edited, 
merged, then saved as a renamable PDF file on your computer. 
It containes features such as auto-saves and an offline = view only mode. 

## Tech stack

- Frontend: React + TypeScript + Vite, Fabric.js (canvas editing),
  pdf.js (render uploaded PDFs), pdf-lib (export to real PDF), Zustand
  (state), idb (offline document cache), a service worker (offline app
  shell).
- Backend: Express + PostgreSQL, Google Oauth login style feature.
