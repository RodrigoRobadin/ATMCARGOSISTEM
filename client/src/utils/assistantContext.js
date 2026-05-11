export const ASSISTANT_ATTACH_EVENT = "assistant:attach-context";

export function dispatchAssistantContext(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_ATTACH_EVENT, {
      detail,
    })
  );
}

export function attachOperationToAssistant(operation) {
  if (!operation) return;
  dispatchAssistantContext({
    type: "operation",
    id: operation.id,
    label: operation.reference || `Operacion ${operation.id}`,
    meta: {
      title: operation.title || "",
      href: operation.id ? `/operations/${operation.id}` : "",
    },
  });
}

export function attachOrganizationToAssistant(organization) {
  if (!organization) return;
  dispatchAssistantContext({
    type: "organization",
    id: organization.id,
    label: organization.name || organization.razon_social || `Organizacion ${organization.id}`,
    meta: {
      href: organization.id ? `/organizations/${organization.id}` : "",
    },
  });
}

export function attachContactToAssistant(contact) {
  if (!contact) return;
  dispatchAssistantContext({
    type: "contact",
    id: contact.id,
    label: contact.name || `Contacto ${contact.id}`,
    meta: {
      href: contact.id ? `/contacts/${contact.id}` : "",
      org_name: contact.org_name || "",
    },
  });
}

export function attachServiceCaseToAssistant(serviceCase) {
  if (!serviceCase) return;
  dispatchAssistantContext({
    type: "service_case",
    id: serviceCase.id,
    label: serviceCase.reference || `Servicio ${serviceCase.id}`,
    meta: {
      href: serviceCase.id ? `/service/cases/${serviceCase.id}` : "",
    },
  });
}
