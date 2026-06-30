import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { PDFDocument, Page, PageObject, PageSizeName } from '../types/document';
import { PAGE_SIZES } from '../types/document';

interface EditorState {
  document: PDFDocument | null;
  activePageIndex: number;
  selectedObjectId: string | null;

  // Set when the document was opened via a share link (?share=token)
  // instead of as the owner. null means normal owner session.
  shareSession: { token: string; access: 'view' | 'edit' } | null;
  setShareSession: (session: { token: string; access: 'view' | 'edit' } | null) => void;

  // Lets FileMenu's "Rename" item trigger EditableTitle's inline edit mode
  // even though the two components aren't in a parent/child relationship —
  // the store is the shared channel between them.
  isRenamingTitle: boolean;
  setIsRenamingTitle: (value: boolean) => void;

  // Undo/Redo history. Snapshots the whole document before each mutating
  // action (see withHistory below) rather than tracking per-field diffs —
  // simpler and far less error-prone, at the cost of a bit more memory per
  // step. Loading a different document (loadDocument/createBlankDocument)
  // resets history, since "undo" across an unrelated document switch
  // wouldn't make sense to a user.
  history: { past: PDFDocument[]; future: PDFDocument[] };
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Document lifecycle
  createBlankDocument: (sizeName: PageSizeName) => void;
  loadDocument: (doc: PDFDocument) => void;
  renameDocument: (title: string) => void;
  copyDocument: () => PDFDocument | null;

  // Pages
  addBlankPage: (sizeName: PageSizeName) => void;
  removePage: (pageId: string) => void;
  duplicatePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  setActivePageIndex: (index: number) => void;

  // Objects
  addObject: (pageId: string, object: PageObject) => void;
  updateObject: (pageId: string, objectId: string, patch: Partial<PageObject>) => void;
  removeObject: (pageId: string, objectId: string) => void;
  setSelectedObjectId: (id: string | null) => void;
}

function emptyPage(sizeName: PageSizeName): Page {
  const size = PAGE_SIZES[sizeName];
  return {
    id: nanoid(),
    width: size.width,
    height: size.height,
    backgroundImage: null,
    objects: [],
  };
}

const MAX_HISTORY = 100; // caps memory use; older steps just age out, matching how most editors behave

export const useEditorStore = create<EditorState>((set, get) => {
  // Wraps a mutating action so it automatically snapshots the document
  // into the undo stack first, and clears the redo stack (since making a
  // new change invalidates whatever was previously "ahead" of it). Used
  // for every action that changes document content — NOT for purely
  // transient UI state like selectedObjectId or isRenamingTitle, which
  // shouldn't be undoable themselves.
  function withHistory<Args extends unknown[]>(
    fn: (...args: Args) => void
  ): (...args: Args) => void {
    return (...args: Args) => {
      const current = get().document;
      if (current) {
        set((state) => {
          const past = [...state.history.past, current];
          if (past.length > MAX_HISTORY) past.shift();
          return { history: { past, future: [] } };
        });
      }
      fn(...args);
    };
  }

  return {
    document: null,
    activePageIndex: 0,
    selectedObjectId: null,
    shareSession: null,
    setShareSession: (session) => set({ shareSession: session }),
    isRenamingTitle: false,
    setIsRenamingTitle: (value) => set({ isRenamingTitle: value }),
    history: { past: [], future: [] },

    undo: () => {
      const { history, document } = get();
      if (history.past.length === 0 || !document) return;
      const previous = history.past[history.past.length - 1];
      const newPast = history.past.slice(0, -1);
      set({
        document: previous,
        history: { past: newPast, future: [document, ...history.future] },
      });
    },

    redo: () => {
      const { history, document } = get();
      if (history.future.length === 0 || !document) return;
      const next = history.future[0];
      const newFuture = history.future.slice(1);
      set({
        document: next,
        history: { past: [...history.past, document], future: newFuture },
      });
    },

    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0,

    createBlankDocument: (sizeName) =>
      set(() => ({
        document: {
          id: nanoid(),
          title: 'Untitled document',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pages: [emptyPage(sizeName)],
        },
        activePageIndex: 0,
        selectedObjectId: null,
        history: { past: [], future: [] }, // switching documents resets history
      })),

    loadDocument: (doc) =>
      set(() => ({
        document: doc,
        activePageIndex: 0,
        selectedObjectId: null,
        history: { past: [], future: [] },
      })),

    renameDocument: withHistory((title: string) =>
      set((state) => {
        if (!state.document) return state;
        const trimmed = title.trim();
        return {
          document: {
            ...state.document,
            title: trimmed || state.document.title, // never allow an empty title
            updatedAt: Date.now(),
          },
        };
      })
    ),

    addBlankPage: withHistory((sizeName: PageSizeName) =>
      set((state) => {
        if (!state.document) return state;
        const newPage = emptyPage(sizeName);
        return {
          document: {
            ...state.document,
            pages: [...state.document.pages, newPage],
            updatedAt: Date.now(),
          },
          activePageIndex: state.document.pages.length, // jump to new page
        };
      })
    ),

    removePage: withHistory((pageId: string) =>
      set((state) => {
        if (!state.document) return state;
        if (state.document.pages.length <= 1) return state; // never delete the last page

        const removedIndex = state.document.pages.findIndex((p) => p.id === pageId);
        if (removedIndex === -1) return state;

        const newPages = state.document.pages.filter((p) => p.id !== pageId);

        // Keep the active page pointing at a sensible page after removal:
        // stay on the same index if a page still exists there, otherwise
        // clamp to the new last page.
        const newActiveIndex = Math.min(
          state.activePageIndex >= removedIndex
            ? Math.max(0, state.activePageIndex - 1)
            : state.activePageIndex,
          newPages.length - 1
        );

        return {
          document: { ...state.document, pages: newPages, updatedAt: Date.now() },
          activePageIndex: newActiveIndex,
        };
      })
    ),

    duplicatePage: withHistory((pageId: string) =>
      set((state) => {
        if (!state.document) return state;
        const index = state.document.pages.findIndex((p) => p.id === pageId);
        if (index === -1) return state;

        const original = state.document.pages[index];
        const copy: Page = {
          ...original,
          id: nanoid(),
          name: original.name ? `${original.name} copy` : undefined,
          // Objects need fresh ids too, otherwise the duplicate's objects
          // would collide with the original's in any future per-id lookups.
          objects: original.objects.map((o) => ({ ...o, id: nanoid() })),
        };

        const newPages = [...state.document.pages];
        newPages.splice(index + 1, 0, copy);

        return {
          document: { ...state.document, pages: newPages, updatedAt: Date.now() },
          activePageIndex: index + 1, // jump to the new copy, matches user expectation
        };
      })
    ),

    renamePage: withHistory((pageId: string, name: string) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            pages: state.document.pages.map((p) =>
              p.id === pageId ? { ...p, name } : p
            ),
            updatedAt: Date.now(),
          },
        };
      })
    ),

    setActivePageIndex: (index) => set({ activePageIndex: index }),

    addObject: withHistory((pageId: string, object: PageObject) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            pages: state.document.pages.map((p) =>
              p.id === pageId ? { ...p, objects: [...p.objects, object] } : p
            ),
            updatedAt: Date.now(),
          },
        };
      })
    ),

    updateObject: withHistory((pageId: string, objectId: string, patch: Partial<PageObject>) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            pages: state.document.pages.map((p) => {
              if (p.id !== pageId) return p;
              return {
                ...p,
                objects: p.objects.map((o) =>
                  o.id === objectId ? ({ ...o, ...patch } as PageObject) : o
                ),
              };
            }),
            updatedAt: Date.now(),
          },
        };
      })
    ),

    removeObject: withHistory((pageId: string, objectId: string) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            pages: state.document.pages.map((p) =>
              p.id === pageId
                ? { ...p, objects: p.objects.filter((o) => o.id !== objectId) }
                : p
            ),
            updatedAt: Date.now(),
          },
          selectedObjectId:
            state.selectedObjectId === objectId ? null : state.selectedObjectId,
        };
      })
    ),

    copyDocument: () => {
      let createdCopy: PDFDocument | null = null;

      set((state) => {
        if (!state.document) return state;

        const copy: PDFDocument = {
          ...state.document,
          id: nanoid(),
          title: `Copy of ${state.document.title}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // Fresh ids throughout — a copy must not share any id with the
          // original, or future per-id store operations (rename a page,
          // delete an object) could accidentally affect both documents if
          // they were ever loaded into the same client logic at once.
          pages: state.document.pages.map((p) => ({
            ...p,
            id: nanoid(),
            objects: p.objects.map((o) => ({ ...o, id: nanoid() })),
          })),
        };

        createdCopy = copy;
        // copyDocument switches to editing a different document entirely,
        // same reasoning as loadDocument — history resets.
        return { document: copy, activePageIndex: 0, selectedObjectId: null, history: { past: [], future: [] } };
      });

      return createdCopy;
    },

    setSelectedObjectId: (id) => set({ selectedObjectId: id }),
  };
});