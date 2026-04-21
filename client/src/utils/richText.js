const ALLOWED_TAGS = new Set([
  "P",
  "DIV",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "UL",
  "OL",
  "LI",
  "SPAN",
]);

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAlign(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  if (["left", "right", "center", "justify"].includes(value)) return value;
  return "";
}

function normalizeFontWeight(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "bold") return "bold";
  const num = Number(value);
  if (Number.isFinite(num) && num >= 600) return "bold";
  return "";
}

function normalizeFontStyle(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  return value === "italic" ? "italic" : "";
}

function normalizeTextDecoration(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  if (value.includes("underline")) return "underline";
  return "";
}

function extractAllowedStyle(node) {
  if (!node?.getAttribute) return "";
  const style = node.getAttribute("style") || "";
  const parts = [];

  const alignMatch = style.match(/text-align\s*:\s*([^;]+)/i);
  const align = normalizeAlign(alignMatch?.[1] || node.getAttribute("align") || "");
  if (align) parts.push(`text-align:${align}`);

  const weightMatch = style.match(/font-weight\s*:\s*([^;]+)/i);
  const weight = normalizeFontWeight(weightMatch?.[1] || "");
  if (weight) parts.push(`font-weight:${weight}`);

  const fontStyleMatch = style.match(/font-style\s*:\s*([^;]+)/i);
  const fontStyle = normalizeFontStyle(fontStyleMatch?.[1] || "");
  if (fontStyle) parts.push(`font-style:${fontStyle}`);

  const textDecorationMatch =
    style.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/i);
  const textDecoration = normalizeTextDecoration(textDecorationMatch?.[1] || "");
  if (textDecoration) parts.push(`text-decoration:${textDecoration}`);

  return parts.length ? ` style="${parts.join(";")}"` : "";
}

function sanitizeNode(node) {
  if (!node) return "";
  if (node.nodeType === 3) return escapeHtml(node.textContent || "");
  if (node.nodeType !== 1) return "";

  const tag = String(node.tagName || "").toUpperCase();
  const children = Array.from(node.childNodes || []).map(sanitizeNode).join("");

  if (!ALLOWED_TAGS.has(tag)) return children;

  if (tag === "BR") return "<br>";

  const normalizedTag =
    tag === "B" ? "strong" :
    tag === "I" ? "em" :
    tag === "STRIKE" ? "s" :
    tag.toLowerCase();

  const styleAttr = extractAllowedStyle(node);
  return `<${normalizedTag}${styleAttr}>${children}</${normalizedTag}>`;
}

export function sanitizeRichTextHtml(input = "") {
  const source = String(input || "").trim();
  if (!source) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return escapeHtml(source).replace(/\n/g, "<br>");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${source}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  return Array.from(root.childNodes).map(sanitizeNode).join("").trim();
}

export function htmlToPlainText(input = "") {
  const source = String(input || "");
  if (!source) return "";
  if (typeof window === "undefined" || typeof document === "undefined") {
    return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = source;
  return String(div.textContent || div.innerText || "").replace(/\u00a0/g, " ").trim();
}

export function normalizeRichTextPayload(input = "") {
  const html = sanitizeRichTextHtml(input);
  return {
    html,
    text: htmlToPlainText(html),
  };
}
