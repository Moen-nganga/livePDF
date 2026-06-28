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

export const useEditorStore = create<EditorState>((set) => ({
  document: null,
  activePageIndex: 0,
  selectedObjectId: null,
  shareSession: null,
  setShareSession: (session) => set({ shareSession: session }),
  isRenamingTitle: false,
  setIsRenamingTitle: (value) => set({ isRenamingTitle: value }),

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
    })),

  loadDocument: (doc) =>
    set(() => ({
      document: doc,
      activePageIndex: 0,
      selectedObjectId: null,
    })),

  renameDocument: (title) =>
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
    }),

  addBlankPage: (sizeName) =>
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
    }),

  removePage: (pageId) =>
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
    }),

  duplicatePage: (pageId) =>
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
    }),

  renamePage: (pageId, name) =>
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
    }),

  setActivePageIndex: (index) => set({ activePageIndex: index }),

  addObject: (pageId, object) =>
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
    }),

  updateObject: (pageId, objectId, patch) =>
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
    }),

  removeObject: (pageId, objectId) =>
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
    }),

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
      return { document: copy, activePageIndex: 0, selectedObjectId: null };
    });

    return createdCopy;
  },

  setSelectedObjectId: (id) => set({ selectedObjectId: id }),
}));