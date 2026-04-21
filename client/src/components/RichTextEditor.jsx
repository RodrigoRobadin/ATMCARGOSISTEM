import React, { useEffect, useMemo, useRef, useState } from "react";
import { htmlToPlainText, sanitizeRichTextHtml } from "../utils/richText";

function exec(command, value = null) {
  try {
    document.execCommand(command, false, value);
  } catch (_) {}
}

function ToolbarButton({ label, onClick, title }) {
  return (
    <button
      type="button"
      className="px-2 py-1 text-xs border rounded bg-white hover:bg-slate-50"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title || label}
    >
      {label}
    </button>
  );
}

export function RichTextEditor({
  value = "",
  onChange,
  placeholder = "",
  minHeightClass = "min-h-[84px]",
}) {
  const editorRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const safeValue = useMemo(() => sanitizeRichTextHtml(value), [value]);

  useEffect(() => {
    if (!editorRef.current || focused) return;
    if (editorRef.current.innerHTML !== safeValue) {
      editorRef.current.innerHTML = safeValue;
    }
  }, [safeValue, focused]);

  const emitChange = () => {
    if (!editorRef.current || !onChange) return;
    const html = sanitizeRichTextHtml(editorRef.current.innerHTML || "");
    const text = htmlToPlainText(html);
    onChange({ html, text });
  };

  const applyCommand = (command) => {
    editorRef.current?.focus();
    exec(command);
    emitChange();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain");
    if (html) {
      exec("insertHTML", sanitizeRichTextHtml(html));
    } else if (text) {
      exec("insertText", text);
    }
    emitChange();
  };

  return (
    <div className="border rounded-lg bg-white">
      <div className="flex flex-wrap gap-1 p-2 border-b bg-slate-50">
        <ToolbarButton label="B" title="Negrita" onClick={() => applyCommand("bold")} />
        <ToolbarButton label="I" title="Cursiva" onClick={() => applyCommand("italic")} />
        <ToolbarButton label="U" title="Subrayado" onClick={() => applyCommand("underline")} />
        <ToolbarButton label="• Lista" title="Lista" onClick={() => applyCommand("insertUnorderedList")} />
        <ToolbarButton label="Izq" title="Alinear izquierda" onClick={() => applyCommand("justifyLeft")} />
        <ToolbarButton label="Centro" title="Centrar" onClick={() => applyCommand("justifyCenter")} />
        <ToolbarButton label="Der" title="Alinear derecha" onClick={() => applyCommand("justifyRight")} />
        <ToolbarButton label="Just." title="Justificar" onClick={() => applyCommand("justifyFull")} />
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className={`w-full px-3 py-2 text-sm focus:outline-none ${minHeightClass}`}
        aria-label={placeholder || "Editor de texto enriquecido"}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          emitChange();
        }}
        onInput={emitChange}
        onPaste={handlePaste}
      />
    </div>
  );
}

export function RichTextContent({ html = "", className = "" }) {
  const safeHtml = useMemo(() => sanitizeRichTextHtml(html), [html]);
  if (!safeHtml) return <span className={className}>-</span>;
  return (
    <div
      className={`rich-text-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

export function RichTextDialogField({
  value = "",
  onChange,
  placeholder = "",
  dialogTitle = "Editar texto con formato",
  minHeightClass = "min-h-[160px]",
  widthClass = "w-[220px] max-w-[220px]",
}) {
  const [open, setOpen] = useState(false);
  const [draftHtml, setDraftHtml] = useState(sanitizeRichTextHtml(value));
  const [draftText, setDraftText] = useState(htmlToPlainText(value));

  useEffect(() => {
    if (open) return;
    const safeHtml = sanitizeRichTextHtml(value);
    setDraftHtml(safeHtml);
    setDraftText(htmlToPlainText(safeHtml));
  }, [value, open]);

  const previewText = useMemo(() => {
    const text = htmlToPlainText(value);
    return text || "";
  }, [value]);

  const openDialog = () => {
    const safeHtml = sanitizeRichTextHtml(value);
    setDraftHtml(safeHtml);
    setDraftText(htmlToPlainText(safeHtml));
    setOpen(true);
  };

  const closeDialog = () => setOpen(false);

  const saveDialog = () => {
    onChange?.({ html: draftHtml, text: draftText });
    setOpen(false);
  };

  return (
    <>
      <div className={`flex items-center gap-2 ${widthClass}`.trim()}>
        <button
          type="button"
          className={`flex-1 min-w-0 h-8 rounded border px-2.5 text-left text-xs hover:bg-slate-50 ${previewText ? "text-slate-700" : "text-slate-400"}`}
          onClick={openDialog}
          title={previewText || placeholder || "Sin observación"}
        >
          <div className="truncate">
            {previewText || placeholder || "Sin observación"}
          </div>
        </button>
        <button
          type="button"
          className="h-8 shrink-0 px-2.5 rounded border bg-white text-[11px] hover:bg-slate-50"
          onClick={openDialog}
        >
          Formato
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">{dialogTitle}</div>
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-slate-800"
                onClick={closeDialog}
              >
                Cerrar
              </button>
            </div>
            <div className="p-4">
              <RichTextEditor
                value={draftHtml}
                placeholder={placeholder}
                minHeightClass={minHeightClass}
                onChange={({ html, text }) => {
                  setDraftHtml(html);
                  setDraftText(text);
                }}
              />
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                className="px-4 py-2 rounded border bg-white text-sm hover:bg-slate-50"
                onClick={closeDialog}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-slate-900 text-sm text-white hover:bg-slate-800"
                onClick={saveDialog}
              >
                Guardar formato
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
