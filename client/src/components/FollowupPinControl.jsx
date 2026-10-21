import React from 'react';

export default function FollowupPinControl({ pinned, busy, onToggle }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {pinned && <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">Anclada</span>}
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={Boolean(pinned)}
        title={pinned ? 'Quitar anclaje del seguimiento' : 'Anclar arriba en el seguimiento'}
        className="rounded border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
      >
        <span aria-hidden="true">{String.fromCodePoint(0x1F4CC)}</span> {busy ? 'Guardando...' : pinned ? 'Desanclar' : 'Anclar'}
      </button>
    </div>
  );
}
