import { useEffect, useState } from 'react';
import { useImageAdd } from '../hooks/useImageAdd.tsx';

export function AddMenu() {
  const [open, setOpen] = useState(false);
  const { triggerImagePick, fileInputElement } = useImageAdd();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleImage() {
    setOpen(false);
    triggerImagePick();
  }

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          Add
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
              label="Image"
              description="Add an image to the page"
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