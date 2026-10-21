import React, { useEffect, useMemo, useRef, useState } from "react";
import { htmlToPlainText, sanitizeRichTextHtml } from "../utils/richText";

function exec(command, value = null) {
  try {
    document.execCommand(command, false, value);
  } catch (_) {}
}

function ToolbarButton({ label, onClick, title, disabled = false }) {
  return (
    <button
      type="button"
      className="px-2 py-1 text-xs border rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title || label}
      disabled={disabled}
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
  const [inTable, setInTable] = useState(false);
  const [inQuote, setInQuote] = useState(false);
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

  const currentTable = () => {
    const anchor = window.getSelection()?.anchorNode;
    const table = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.("table");
    return table && editorRef.current?.contains(table) ? table : null;
  };

  const currentQuote = () => {
    const anchor = window.getSelection()?.anchorNode;
    const quote = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.("blockquote");
    return quote && editorRef.current?.contains(quote) ? quote : null;
  };

  const updateToolbarSelection = () => {
    setInTable(Boolean(currentTable()));
    setInQuote(Boolean(currentQuote()));
  };

  const applyCommand = (command, value = null) => {
    editorRef.current?.focus();
    exec(command, value);
    emitChange();
    updateToolbarSelection();
  };

  const toggleQuote = () => {
    const quote = currentQuote();
    if (!quote) {
      applyCommand("formatBlock", "blockquote");
      return;
    }

    const fragment = document.createDocumentFragment();
    let paragraph = null;
    Array.from(quote.childNodes).forEach((node) => {
      if (node.nodeType === 1 && ["P", "DIV", "UL", "OL", "TABLE"].includes(node.tagName)) {
        paragraph = null;
        fragment.appendChild(node);
      } else {
        if (!paragraph) {
          paragraph = document.createElement("p");
          fragment.appendChild(paragraph);
        }
        paragraph.appendChild(node);
      }
    });
    if (!fragment.childNodes.length) {
      paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      fragment.appendChild(paragraph);
    }
    const firstBlock = fragment.firstChild;
    quote.replaceWith(fragment);
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && !editorRef.current?.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(firstBlock);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setInQuote(false);
    emitChange();
  };

  const insertTable = () => {
    editorRef.current?.focus();
    exec("insertHTML", "<table><tbody><tr><th>Concepto</th><th>Detalle</th></tr><tr><td> </td><td> </td></tr></tbody></table><p><br></p>");
    emitChange();
  };

  const addTableRow = () => {
    const table = currentTable();
    if (!table) return;
    const lastRow = table.rows[table.rows.length - 1];
    const row = table.insertRow();
    for (let index = 0; index < (lastRow?.cells.length || 2); index += 1) row.insertCell().textContent = " ";
    emitChange();
  };

  const addTableColumn = () => {
    const table = currentTable();
    if (!table) return;
    Array.from(table.rows).forEach((row, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = " ";
      row.appendChild(cell);
    });
    emitChange();
  };

  const removeTable = () => {
    const table = currentTable();
    if (!table || !window.confirm("¿Eliminar esta tabla y todo su contenido?")) return;
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    table.after(paragraph);
    table.remove();
    editorRef.current?.focus();
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setInTable(false);
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
        <ToolbarButton label="1. Lista" title="Lista numerada" onClick={() => applyCommand("insertOrderedList")} />
        <ToolbarButton label={inQuote ? "Quitar cita" : "Cita"} title={inQuote ? "Quitar formato de cita" : "Formato de cita"} onClick={toggleQuote} />
        <ToolbarButton label="Tabla" title="Insertar tabla" onClick={insertTable} />
        <ToolbarButton label="Fila +" title="Agregar fila a la tabla actual" onClick={addTableRow} disabled={!inTable} />
        <ToolbarButton label="Col. +" title="Agregar columna a la tabla actual" onClick={addTableColumn} disabled={!inTable} />
        <ToolbarButton label="Eliminar tabla" title="Eliminar la tabla actual y su contenido" onClick={removeTable} disabled={!inTable} />
        <ToolbarButton label="Izq" title="Alinear izquierda" onClick={() => applyCommand("justifyLeft")} />
        <ToolbarButton label="Centro" title="Centrar" onClick={() => applyCommand("justifyCenter")} />
        <ToolbarButton label="Der" title="Alinear derecha" onClick={() => applyCommand("justifyRight")} />
        <ToolbarButton label="Just." title="Justificar" onClick={() => applyCommand("justifyFull")} />
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className={`rich-text-content w-full px-3 py-2 text-sm focus:outline-none ${minHeightClass}`}
        aria-label={placeholder || "Editor de texto enriquecido"}
        onFocus={() => { setFocused(true); updateToolbarSelection(); }}
        onBlur={() => {
          setFocused(false);
          setInTable(false);
          setInQuote(false);
          emitChange();
        }}
        onInput={() => { emitChange(); updateToolbarSelection(); }}
        onMouseUp={updateToolbarSelection}
        onKeyUp={updateToolbarSelection}
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
