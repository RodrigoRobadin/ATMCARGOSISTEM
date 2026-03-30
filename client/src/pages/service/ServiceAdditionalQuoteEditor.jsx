import React from "react";
import QuoteEditor from "../QuoteEditor";

export default function ServiceAdditionalQuoteEditor() {
  return (
    <QuoteEditor
      quoteBaseOverride="/service/additional-quotes"
      ignoreInvoiceLock
      enableRevisions={false}
    />
  );
}
