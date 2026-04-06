import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import OperationDetail from "./OperationDetail";
import OperationDetailIndustrial from "./OperationDetailIndustrial";
import OperationDetailContainer from "./OperationDetailContainer";

export default function OperationDetailSwitcher() {
  const { id } = useParams();
  const [detailKind, setDetailKind] = useState(null);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const { data: dealData } = await api.get(`/deals/${id}`);
        const buKey = String(dealData?.deal?.business_unit_key || "").toLowerCase();

        if (buKey === "atm-container") {
          if (live) setDetailKind("container");
          return;
        }

        if (buKey === "atm-industrial") {
          if (live) setDetailKind("industrial");
          return;
        }

        const { data: customFields } = await api
          .get(`/deals/${id}/custom-fields`)
          .catch(() => ({ data: [] }));

        const list = Array.isArray(customFields) ? customFields : [];
        const hasIndustrialBrand = list.some(
          (cf) => cf.key === "industrial_brand" && String(cf.value || "").trim() !== ""
        );

        if (live) setDetailKind(hasIndustrialBrand ? "industrial" : "default");
      } catch (err) {
        console.warn("No se pudo resolver el tipo de detalle", err);
        if (live) setDetailKind("default");
      }
    })();

    return () => {
      live = false;
    };
  }, [id]);

  if (detailKind === null) {
    return <p className="text-sm text-slate-600">Cargando...</p>;
  }

  if (detailKind === "container") {
    return <OperationDetailContainer />;
  }

  if (detailKind === "industrial") {
    return <OperationDetailIndustrial />;
  }

  return <OperationDetail />;
}
