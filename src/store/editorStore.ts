import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { PDFDocument, Page, PageObject, PageSizeName, Comment } from '../types/document';
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

  // Whether the page sidebar (PageNav) is hidden. Transient view state,
  // same category as isRenamingTitle: it shouldn't be undoable, and it
  // isn't reset by loadDocument/createBlankDocument/copyDocument — a user
  // who collapsed the sidebar almost certainly wants it to stay collapsed
  // after switching documents, not spring back open.
  isPageNavCollapsed: boolean;
  setIsPageNavCollapsed: (value: boolean) => void;

  // Whether the ruler is shown around the canvas. Same category as
  // isPageNavCollapsed: transient view state, not undoable, not reset
  // across document switches.
  showRuler: boolean;
  setShowRuler: (value: boolean) => void;

  // Whether the comments panel is shown. Transient view state, same
  // treatment as showRuler/isPageNavCollapsed.
  showComments: boolean;
  setShowComments: (value: boolean) => void;

  // Live bounds of the currently selected object, kept in sync by
  // PdfCanvas on selection and on every 'object:moving' tick (not just on
  // drop) — used by the ruler's alignment highlight and the position/size
  // readout badge, both of which need to track a drag in real time rather
  // than only updating once the object is released. null when nothing is
  // selected. Transient view state, not undoable.
  liveObjectBounds: { x: number; y: number; width: number; height: number } | null;
  setLiveObjectBounds: (bounds: { x: number; y: number; width: number; height: number } | null) => void;

  // Which top-level menu (File/Edit/View/Add/Help) is currently open, by a
  // short id ('file' | 'edit' | 'view' | 'add' | 'help'), or null if none
  // is open. Lives here rather than as local state in each menu component
  // so that, once a menu is open by a click, hovering over a *different*
  // menu button can switch directly to it — the standard "click once, then
  // hover across the bar" behavior native menu bars and Docs use. Only one
  // menu is ever open at a time by construction. Transient view state, not
  // undoable.
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;

  // Comments
  // These DO go through withHistory (see below) — unlike the view-state
  // flags above, comments are actual document content that gets saved to
  // the backend via the existing whole-document PUT, so add/resolve/delete
  // should be undoable the same way editing an object is.
  addComment: (pageId: string, text: string, objectId?: string) => void;
  resolveComment: (commentId: string, resolved: boolean) => void;
  deleteComment: (commentId: string) => void;

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
  addObjects: (pageId: string, objects: PageObject[]) => void;
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
    isPageNavCollapsed: false,
    setIsPageNavCollapsed: (value) => set({ isPageNavCollapsed: value }),
    showRuler: false,
    setShowRuler: (value) => set({ showRuler: value }),
    showComments: false,
    setShowComments: (value) => set({ showComments: value }),
    liveObjectBounds: null,
    setLiveObjectBounds: (bounds) => set({ liveObjectBounds: bounds }),
    openMenuId: null,
    setOpenMenuId: (id) => set({ openMenuId: id }),
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

    // Adds multiple objects in a single history step — used by tables and
    // any other feature that places several objects atomically, so the
    // entire operation undoes in one Ctrl+Z rather than once per object.
    addObjects: withHistory((pageId: string, objects: PageObject[]) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            pages: state.document.pages.map((p) =>
              p.id === pageId ? { ...p, objects: [...p.objects, ...objects] } : p
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

    addComment: withHistory((pageId: string, text: string, objectId?: string) =>
      set((state) => {
        if (!state.document) return state;
        const trimmed = text.trim();
        if (!trimmed) return state; // never store a blank comment

        const comment: Comment = {
          id: nanoid(),
          pageId,
          objectId,
          text: trimmed,
          createdAt: Date.now(),
          resolved: false,
        };

        return {
          document: {
            ...state.document,
            comments: [...(state.document.comments ?? []), comment],
            updatedAt: Date.now(),
          },
        };
      })
    ),

    resolveComment: withHistory((commentId: string, resolved: boolean) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            comments: (state.document.comments ?? []).map((c) =>
              c.id === commentId ? { ...c, resolved } : c
            ),
            updatedAt: Date.now(),
          },
        };
      })
    ),

    deleteComment: withHistory((commentId: string) =>
      set((state) => {
        if (!state.document) return state;
        return {
          document: {
            ...state.document,
            comments: (state.document.comments ?? []).filter((c) => c.id !== commentId),
            updatedAt: Date.now(),
          },
        };
      })
    ),
  };
});