import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';

export function EditableTitle() {
  const title = useEditorStore((s) => s.document?.title ?? '');
  const renameDocument = useEditorStore((s) => s.renameDocument);
  const isRenamingTitle = useEditorStore((s) => s.isRenamingTitle);
  const setIsRenamingTitle = useEditorStore((s) => s.setIsRenamingTitle);

  const [value, setValue] = useState(title);

  // Whenever editing is triggered (by clicking the title here, OR by the
  // File menu's "Rename" item flipping the shared store flag), reset the
  // draft value to the current title so we always start from a fresh,
  // accurate copy rather than a stale one from a previous edit attempt.
  useEffect(() => {
    if (isRenamingTitle) setValue(title);
  }, [isRenamingTitle, title]);

  function commit() {
    renameDocument(value);
    setIsRenamingTitle(false);
  }

  if (isRenamingTitle) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()} // select-all on entry, like Docs/Sheets, for fast full replacement
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setIsRenamingTitle(false);
        }}
        style={{
          fontWeight: 'bold',
          fontSize: 16,
          border: '1px solid #3380cc',
          borderRadius: 3,
          padding: '2px 6px',
          minWidth: 200,
        }}
      />
    );
  }

  return (
    <strong
      onClick={() => setIsRenamingTitle(true)}
      title="Click to rename"
      style={{ cursor: 'pointer', padding: '2px 6px', borderRadius: 3 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {title}
    </strong>
  );
}