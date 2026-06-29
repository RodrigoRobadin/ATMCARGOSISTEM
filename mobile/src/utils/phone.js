import * as Linking from 'expo-linking';

export function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

export async function openPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) throw new Error('Telefono no disponible');
  await Linking.openURL(`tel:${phone}`);
}

export async function openWhatsapp(value, text = '') {
  const phone = normalizePhone(value).replace(/^\+/, '');
  if (!phone) throw new Error('WhatsApp no disponible');
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  await Linking.openURL(`https://wa.me/${phone}${suffix}`);
}
