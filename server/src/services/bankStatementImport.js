import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

export async function readStatement(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.xlsx')) await workbook.xlsx.load(buffer);
  else if (lower.endsWith('.csv')) {
    const firstLine = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    await workbook.csv.read(Readable.from([buffer]), { parserOptions: { delimiter, quote: '"' } });
  } else fail('Use un archivo CSV o XLSX');
  const sheet = workbook.worksheets[0];
  if (!sheet) fail('El archivo no contiene una hoja de movimientos');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = Array.from({ length: Math.min(row.cellCount, 24) }, (_, i) => {
      const value = row.getCell(i + 1).value;
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value?.text ?? value?.result ?? value ?? '').trim();
    });
    if (cells.some(Boolean)) rows.push(cells);
  });
  if (rows.length < 2 || rows.length > 5001) fail('El extracto debe tener encabezado y entre 1 y 5000 movimientos');
  return rows;
}

export function parseBankAmount(value) {
  let raw = String(value ?? '').trim().replace(/[\s\u00a0₲$]/g, '');
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  raw = raw.replace(/[()]/g, '');
  if (!/^-?[\d.,]+$/.test(raw)) fail('Importe bancario inválido');
  const dot = raw.lastIndexOf('.');
  const comma = raw.lastIndexOf(',');
  const decimal = dot > comma ? '.' : ',';
  const last = Math.max(dot, comma);
  const fraction = last >= 0 ? raw.slice(last + 1) : '';
  const hasDecimal = last >= 0 && fraction.length > 0 && fraction.length <= 2;
  const normalized = hasDecimal
    ? raw.slice(0, last).replace(/[.,]/g, '') + '.' + fraction
    : raw.replace(/[.,]/g, '');
  const number = Number(normalized) * (negative ? -1 : 1);
  if (!Number.isFinite(number) || Math.abs(number) > 9999999999999) fail('Importe bancario fuera de rango');
  return Math.round(number * 100);
}

export function parseBankDate(value) {
  if (typeof value === 'number' || /^\d{5}$/.test(String(value))) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
  if (!match) fail(`Fecha bancaria inválida: ${raw}`);
  const iso = match[1].length === 4
    ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    : `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) fail(`Fecha bancaria inválida: ${raw}`);
  return iso;
}

export function normalizeStatement(rows, mapping) {
  const required = ['date', 'description'];
  for (const key of required) if (!Number.isInteger(mapping?.[key]) || mapping[key] < 0) fail(`Seleccione columna de ${key}`);
  const split = Number.isInteger(mapping.debit) && Number.isInteger(mapping.credit);
  if (!split && !Number.isInteger(mapping.amount)) fail('Seleccione importe o las columnas débito y crédito');
  const seen = new Map();
  return rows.slice(1).map((row, index) => {
    const date = parseBankDate(row[mapping.date]);
    const description = String(row[mapping.description] || '').trim().slice(0, 500);
    if (!description) fail(`Falta descripción en la fila ${index + 2}`);
    const reference = Number.isInteger(mapping.reference) ? String(row[mapping.reference] || '').trim().slice(0, 160) : '';
    const debit = split ? Math.abs(parseBankAmount(row[mapping.debit])) : Math.max(0, -parseBankAmount(row[mapping.amount]));
    const credit = split ? Math.abs(parseBankAmount(row[mapping.credit])) : Math.max(0, parseBankAmount(row[mapping.amount]));
    if (!debit && !credit || debit && credit) fail(`Importe ambiguo en la fila ${index + 2}`);
    const base = [date, description.toLowerCase(), reference.toLowerCase(), debit, credit].join('|');
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    return { date, description, reference, debit, credit,
      fingerprint: crypto.createHash('sha256').update(`${base}|${occurrence}`).digest('hex'), rowNumber: index + 2 };
  });
}

export function assertBankPaymentMatch(movement, payment, account) {
  const accountValues = [account.alias, account.account_number].filter(Boolean);
  if (payment.currency_code !== account.currency_code || !accountValues.includes(payment.company_account)) {
    fail('La cuenta o moneda del pago no coincide');
  }
  if (!Number(movement.debit_amount) || Math.round(Number(movement.debit_amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
    fail('Los importes deben coincidir exactamente');
  }
}
