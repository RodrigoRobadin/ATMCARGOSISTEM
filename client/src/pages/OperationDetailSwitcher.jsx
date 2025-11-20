import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import OperationDetail from "./OperationDetail";
import OperationDetailIndustrial from "./OperationDetailIndustrial";

export default function OperationDetailSwitcher() {
  const { id } = useParams();
  const [isIndustrial, setIsIndustrial] = useState(null); // null = cargando

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        // Leemos los custom fields de la operación
        const { data } = await api
          .get(`/deals/${id}/custom-fields`)
          .catch(() => ({ data: [] }));

        const list = Array.isArray(data) ? data : [];

        // Regla: es INDUSTRIAL si tiene el campo industrial_brand con algún valor
        const hasIndustrialBrand = list.some(
          (cf) =>
            cf.key === "industrial_brand" &&
            String(cf.value || "").trim() !== ""
        );

        if (live) {
          setIsIndustrial(hasIndustrialBrand);
        }
      } catch (err) {
        console.warn("No se pudieron leer los custom-fields", err);
        if (live) setIsIndustrial(false); // fallback: detalle normal
      }
    })();

    return () => {
      live = false;
    };
  }, [id]);

  if (isIndustrial === null) {
    return <p className="text-sm text-slate-600">Cargando…</p>;
  }

  // Si es industrial -> abrimos OperationDetailIndustrial
  if (isIndustrial) {
    return <OperationDetailIndustrial />;
  }

  // Si no, seguimos usando el OperationDetail clásico
  return <OperationDetail />;
}