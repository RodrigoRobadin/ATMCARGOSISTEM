export function detectFollowupActionIntent(message) {
  const text = String(message || '').trim();
  const createVerb = /(?:^|[^\p{L}])(?:crea|crear|cr[eé]ame|agrega|agregar|anota|anotar|recorda|recordame|recordar|genera|generar|carga|cargar)(?=$|[^\p{L}])/iu;
  if (!createVerb.test(text)) return null;

  if (/\b(tarea|seguimiento pendiente)\b/iu.test(text)) return 'task';
  if (/\b(recordatorio|recordame|recordar)\b/iu.test(text)) return 'reminder';
  if (/\b(nota|comentario)\b/iu.test(text) || /\banota\b/iu.test(text)) return 'note';
  if (/\b(actividad|seguimiento)\b/iu.test(text)) return 'activity';
  return null;
}

export function isGeneralCrmQuery(message) {
  const text = String(message || '').trim().toLowerCase();
  if (/\b(esta|este|esa|ese)\s+(operaci[oó]n|tarea|cotizaci[oó]n)\b/iu.test(text)) return false;
  return /\ben general\b|\btodas? las operaciones\b|\boperaciones abiertas\b|\b(?:qu[eé]|que) operaciones\b|\blos seguimientos pendientes\b/iu.test(text);
}

export function detectDailyRoutineIntent(message) {
  const text = String(message || '').trim().toLowerCase();
  if (/(resum|qué hice|que hice|lo hecho).*ayer|ayer.*(hice|actividad|resum)/iu.test(text)) return 'yesterday';
  if (/(resum|qué hice|que hice|lo hecho).*(hoy|mañana|manana)|hoy.*pendiente.*ma[ñn]ana/iu.test(text)) return 'handoff';
  if (/(requiere[n]? atenci[oó]n hoy|pendiente[s]? (para )?hoy|prioridades? de hoy|qu[eé] (tengo|hay) que hacer hoy)/iu.test(text)) return 'morning';
  return null;
}
