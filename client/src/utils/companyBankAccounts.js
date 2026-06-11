export function parseCompanyBankAccountRow(row) {
  let data = {};
  try {
    data = JSON.parse(row?.value || "{}") || {};
  } catch {
    data = { alias: row?.value || "" };
  }

  const alias = String(data.alias || data.bank_name || row?.value || "").trim();
  const currency = String(data.currency_code || data.currency || "PYG").toUpperCase();
  return {
    id: row?.id || null,
    paramId: row?.id || null,
    alias,
    bank_name: data.bank_name || "",
    account_holder: data.account_holder || "",
    holder_ruc: data.holder_ruc || "",
    account_number: data.account_number || "",
    currency_code: currency,
    account_type: data.account_type || "",
    cci_iban: data.cci_iban || "",
    swift: data.swift || "",
    notes: data.notes || "",
    active: data.active === false || row?.active === 0 ? 0 : 1,
    rawValue: row?.value || "",
  };
}

export function parseCompanyBankAccounts(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(parseCompanyBankAccountRow)
    .filter((account) => account.alias || account.bank_name || account.account_number);
}

export function companyBankAccountValue(account) {
  return account?.alias || account?.account_number || account?.bank_name || account?.rawValue || "";
}

export function companyBankAccountLabel(account) {
  const parts = [
    account?.alias,
    account?.bank_name,
    account?.account_number,
    account?.currency_code,
  ].filter(Boolean);
  return parts.join(" - ");
}

export function filterCompanyBankAccounts(accounts = [], currencyCode = "") {
  const wanted = String(currencyCode || "").toUpperCase();
  return (accounts || []).filter((account) => {
    if (!account?.active) return false;
    if (!wanted) return true;
    return String(account.currency_code || "").toUpperCase() === wanted;
  });
}
