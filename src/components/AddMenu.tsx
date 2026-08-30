import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useI18nStore } from '../store/i18nStore';
import { useImageAdd } from '../hooks/useImageAdd.tsx';

const MENU_ID = 'add';

export function AddMenu() {
  const openMenuId = useEditorStore((s) => s.openMenuId);
  const setOpenMenuId = useEditorStore((s) => s.setOpenMenuId);
  const open = openMenuId === MENU_ID;
  const t = useI18nStore((s) => s.t);

  const { triggerImagePick, fileInputElement } = useImageAdd();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpenMenuId(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenuId(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpenMenuId]);

  function handleImage() {
    setOpenMenuId(null);
    triggerImagePick();
  }

  // Hovering only switches menus once one is already open by a click —
  // hovering the bar with nothing open does nothing, matching native menu
  // bars and Docs.
  function handleMouseEnter() {
    if (openMenuId !== null && openMenuId !== MENU_ID) setOpenMenuId(MENU_ID);
  }

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-block' }} onMouseEnter={handleMouseEnter}>
        <button
          className={open ? 'tool-active' : undefined}
          onClick={(e) => { e.stopPropagation(); setOpenMenuId(open ? null : MENU_ID); }}
        >
          {t('addMenu.add')}
        </button>

        {open && (
          <div
            className="popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              zIndex: 1000,
              minWidth: 190,
              fontSize: 13,
              overflow: 'hidden',
            }}
          >
            <MenuItem
              label={t('addMenu.image')}
              description={t('addMenu.imageDescription')}
              icon="🖼"
              onClick={handleImage}
            />
          </div>
        )}
      </div>

      {fileInputElement}
    </>
  );
}

function MenuItem({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        border: 'none',
        background: 'none',
        borderRadius: 0,
        cursor: 'pointer',
        color: 'var(--color-text)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{description}</div>
      </div>
    </button>
  );
}