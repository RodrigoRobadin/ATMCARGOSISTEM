import * as Contacts from 'expo-contacts';

function firstValue(list, key = 'number') {
  const item = Array.isArray(list) ? list.find((entry) => entry?.[key]) : null;
  return item?.[key] || '';
}

export async function pickDeviceContact() {
  const permission = await Contacts.requestPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Permiso de contactos requerido');
  }

  if (typeof Contacts.presentContactPickerAsync === 'function') {
    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return null;
    return normalizeDeviceContact(contact);
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.Company,
      Contacts.Fields.JobTitle,
      Contacts.Fields.Emails,
      Contacts.Fields.PhoneNumbers,
    ],
    pageSize: 2000,
  });
  return normalizeDeviceContact(Array.isArray(data) ? data[0] : null);
}

export function normalizeDeviceContact(contact) {
  if (!contact) return null;
  const name =
    contact.name ||
    [contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(' ') ||
    '';
  const email = firstValue(contact.emails, 'email');
  const phone = firstValue(contact.phoneNumbers, 'number');
  return {
    name,
    email,
    phone,
    title: contact.jobTitle || '',
    company: contact.company || '',
  };
}
