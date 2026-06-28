import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { PDFDocument, Page, PageObject, PageSizeName } from '../types/document';
import { PAGE_SIZES } from '../types/document';

interface EditorState {
  document: PDFDocument | null;
  activePageIndex: number;
  selectedObjectId: string | null;

  // Document lifecycle
  createBlankDocument: (sizeName: PageSizeName) => void;
  loadDocument: (doc: PDFDocument) => void;

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

  setSelectedObjectId: (id) => set({ selectedObjectId: id }),
}));