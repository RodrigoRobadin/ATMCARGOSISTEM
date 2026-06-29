import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { api, API_URL } from './src/api/client';
import { pickDeviceContact } from './src/utils/deviceContacts';
import { openPhone, openWhatsapp } from './src/utils/phone';

const Tab = createBottomTabNavigator();

const colors = {
  bg: '#f6f7f9',
  panel: '#ffffff',
  ink: '#111827',
  muted: '#64748b',
  border: '#dbe2ea',
  accent: '#0f766e',
  accentDark: '#115e59',
  danger: '#b91c1c',
  soft: '#e6f3f1',
};

function showError(error, fallback = 'No se pudo completar la accion') {
  Alert.alert('ATMCARGOSISTEM', error?.message || fallback);
}

function Screen({ children }) {
  return <SafeAreaView style={styles.screen}>{children}</SafeAreaView>;
}

function PrimaryButton({ title, icon, onPress, disabled, variant = 'primary' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={variant === 'secondary' ? colors.accent : '#fff'} /> : null}
      <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText]}>{title}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize="none"
        multiline={multiline}
        style={[styles.input, multiline && styles.textArea]}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );
}

function EmptyState({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!email || !password) {
      Alert.alert('ATMCARGOSISTEM', 'Email y password son requeridos');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      showError(e, 'No se pudo iniciar sesion');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.loginWrap}>
        <View style={styles.loginCard}>
          <Text style={styles.brand}>ATMCARGOSISTEM</Text>
          <Text style={styles.subtitle}>Acceso movil operativo</Text>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="usuario@empresa.com" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="Password" />
          <PrimaryButton title={submitting ? 'Ingresando...' : 'Ingresar'} icon="login" onPress={submit} disabled={submitting} />
          <Text style={styles.hint}>API: {API_URL}</Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const boot = await api.bootstrap();
      setData(boot);
    } catch (e) {
      showError(e, 'No se pudo cargar el inicio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const recentQuotes = data?.recent?.quotes || [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>Hola</Text>
            <Text style={styles.title}>{user?.name || 'Usuario'}</Text>
          </View>
          <Pressable onPress={logout} style={styles.logoutButton}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
          </Pressable>
        </View>

        <View style={styles.quickGrid}>
          <QuickAction icon="account-plus" label="Contacto" onPress={() => navigation.navigate('Contactos')} />
          <QuickAction icon="office-building-plus" label="Organizacion" onPress={() => navigation.navigate('Organizaciones')} />
          <QuickAction icon="file-document-edit" label="Cotizar" onPress={() => navigation.navigate('Cotizar')} />
          <QuickAction icon="paperclip-plus" label="Adjuntar" onPress={() => navigation.navigate('Adjuntos')} />
        </View>

        <SectionTitle title="Cotizaciones recientes" />
        {loading ? <ActivityIndicator /> : null}
        {!loading && !recentQuotes.length ? <EmptyState text="Sin cotizaciones recientes" /> : null}
        {recentQuotes.map((quote) => (
          <View key={quote.id} style={styles.card}>
            <Text style={styles.cardTitle}>{quote.client_name || quote.inputs?.client_name || 'Sin cliente'}</Text>
            <Text style={styles.meta}>{quote.ref_code || `Cotizacion #${quote.id}`}</Text>
            <Text style={styles.meta}>
              {(quote.inputs?.modality || 'borrador').toUpperCase()} · {quote.inputs?.origin || '-'} / {quote.inputs?.destination || '-'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.quickAction}>
      <MaterialCommunityIcons name={icon} size={26} color={colors.accent} />
      <Text style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

function SectionTitle({ title }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function ContactCard({ item }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.name || 'Sin nombre'}</Text>
      <Text style={styles.meta}>{item.org_name || item.email || 'Sin organizacion'}</Text>
      <Text style={styles.meta}>{item.phone || 'Sin telefono'}</Text>
      <View style={styles.actions}>
        <PrimaryButton title="Llamar" icon="phone" variant="secondary" disabled={!item.phone} onPress={() => openPhone(item.phone).catch(showError)} />
        <PrimaryButton title="WhatsApp" icon="whatsapp" variant="secondary" disabled={!item.phone} onPress={() => openWhatsapp(item.phone).catch(showError)} />
      </View>
    </View>
  );
}

function ContactsScreen() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '', org_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.searchContacts(q);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showError(e, 'No se pudieron cargar contactos');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, []);

  async function create() {
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        title: form.title.trim() || null,
        org_id: form.org_id ? Number(form.org_id) : null,
      };
      await api.createContact(payload);
      setForm({ name: '', email: '', phone: '', title: '', org_id: '' });
      setFormOpen(false);
      await load();
    } catch (e) {
      showError(e, 'No se pudo crear contacto');
    }
  }

  async function importFromPhone() {
    try {
      const contact = await pickDeviceContact();
      if (!contact) return;
      setForm({
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        title: contact.title || '',
        org_id: form.org_id || '',
      });
      setFormOpen(true);
    } catch (e) {
      showError(e, 'No se pudo importar contacto del telefono');
    }
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ContactCard item={item} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={styles.title}>Contactos</Text>
            <View style={styles.searchRow}>
              <TextInput value={q} onChangeText={setQ} placeholder="Buscar contacto" style={[styles.input, styles.searchInput]} />
              <PrimaryButton title="Buscar" icon="magnify" onPress={load} disabled={loading} />
            </View>
            <View style={styles.actions}>
              <PrimaryButton title={formOpen ? 'Cerrar formulario' : 'Agregar contacto'} icon="account-plus" variant="secondary" onPress={() => setFormOpen((v) => !v)} />
              <PrimaryButton title="Importar telefono" icon="contacts" variant="secondary" onPress={importFromPhone} />
            </View>
            {formOpen ? (
              <View style={styles.formPanel}>
                <Field label="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Nombre completo" />
                <Field label="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} placeholder="correo@empresa.com" keyboardType="email-address" />
                <Field label="Telefono" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="+595..." keyboardType="phone-pad" />
                <Field label="Cargo" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="Compras, gerente, etc." />
                <Field label="ID organizacion" value={form.org_id} onChangeText={(v) => setForm({ ...form, org_id: v })} placeholder="Opcional" keyboardType="number-pad" />
                <PrimaryButton title="Guardar contacto" icon="content-save" onPress={create} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={!loading ? <EmptyState text="Sin contactos para mostrar" /> : null}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

function OrganizationCard({ item }) {
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);

  async function toggleContacts() {
    const next = !open;
    setOpen(next);
    if (next && !contacts.length) {
      try {
        setContacts(await api.organizationContacts(item.id));
      } catch (e) {
        showError(e, 'No se pudieron cargar contactos');
      }
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.name || item.razon_social || 'Sin nombre'}</Text>
      <Text style={styles.meta}>{item.ruc || item.email || 'Sin RUC/email'}</Text>
      <Text style={styles.meta}>{item.phone || 'Sin telefono'}</Text>
      <View style={styles.actions}>
        <PrimaryButton title="Llamar" icon="phone" variant="secondary" disabled={!item.phone} onPress={() => openPhone(item.phone).catch(showError)} />
        <PrimaryButton title="Contactos" icon="account-group" variant="secondary" onPress={toggleContacts} />
      </View>
      {open ? (
        <View style={styles.inlineList}>
          {!contacts.length ? <Text style={styles.meta}>Sin contactos asociados</Text> : null}
          {contacts.map((contact) => (
            <Text key={contact.id} style={styles.inlineItem}>
              {contact.name} {contact.phone ? `· ${contact.phone}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OrganizationsScreen() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', razon_social: '', ruc: '', email: '', phone: '', city: '', notes: '' });
  const [phoneContact, setPhoneContact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.searchOrganizations(q);
      setItems(Array.isArray(rows) ? rows : rows?.items || []);
    } catch (e) {
      showError(e, 'No se pudieron cargar organizaciones');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, []);

  async function create() {
    try {
      const org = await api.createOrganization({
        name: (form.name || form.razon_social).trim(),
        razon_social: (form.razon_social || form.name).trim(),
        ruc: form.ruc.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (phoneContact?.name && org?.id) {
        await api.createContact({
          name: phoneContact.name,
          email: phoneContact.email || null,
          phone: phoneContact.phone || null,
          title: phoneContact.title || null,
          org_id: org.id,
        });
      }
      setForm({ name: '', razon_social: '', ruc: '', email: '', phone: '', city: '', notes: '' });
      setPhoneContact(null);
      setFormOpen(false);
      await load();
    } catch (e) {
      showError(e, 'No se pudo crear organizacion');
    }
  }

  async function importOrganizationContact() {
    try {
      const contact = await pickDeviceContact();
      if (!contact) return;
      setPhoneContact(contact);
      setForm((prev) => ({
        ...prev,
        name: prev.name || contact.company || '',
        razon_social: prev.razon_social || contact.company || '',
        email: prev.email || contact.email || '',
        phone: prev.phone || contact.phone || '',
      }));
      setFormOpen(true);
    } catch (e) {
      showError(e, 'No se pudo importar contacto del telefono');
    }
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <OrganizationCard item={item} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={styles.title}>Organizaciones</Text>
            <View style={styles.searchRow}>
              <TextInput value={q} onChangeText={setQ} placeholder="Buscar organizacion" style={[styles.input, styles.searchInput]} />
              <PrimaryButton title="Buscar" icon="magnify" onPress={load} disabled={loading} />
            </View>
            <View style={styles.actions}>
              <PrimaryButton title={formOpen ? 'Cerrar formulario' : 'Agregar organizacion'} icon="office-building-plus" variant="secondary" onPress={() => setFormOpen((v) => !v)} />
              <PrimaryButton title="Importar contacto" icon="contacts" variant="secondary" onPress={importOrganizationContact} />
            </View>
            {formOpen ? (
              <View style={styles.formPanel}>
                <Field label="Nombre comercial" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Empresa SA" />
                <Field label="Razon social" value={form.razon_social} onChangeText={(v) => setForm({ ...form, razon_social: v })} placeholder="Razon social legal" />
                <Field label="RUC" value={form.ruc} onChangeText={(v) => setForm({ ...form, ruc: v })} placeholder="Opcional" />
                <Field label="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} placeholder="contacto@empresa.com" keyboardType="email-address" />
                <Field label="Telefono" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="+595..." keyboardType="phone-pad" />
                <Field label="Ciudad" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="Asuncion" />
                <Field label="Notas" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} placeholder="Datos utiles" multiline />
                {phoneContact ? (
                  <View style={styles.importPreview}>
                    <Text style={styles.label}>Contacto importado</Text>
                    <Text style={styles.meta}>{phoneContact.name || 'Sin nombre'}</Text>
                    <Text style={styles.meta}>{phoneContact.phone || '-'} {phoneContact.email ? `· ${phoneContact.email}` : ''}</Text>
                  </View>
                ) : null}
                <PrimaryButton title="Guardar organizacion" icon="content-save" onPress={create} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={!loading ? <EmptyState text="Sin organizaciones para mostrar" /> : null}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

function ChoiceButton({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SuggestionBox({ label, value, onChangeText, placeholder, suggestions, onSelect, renderSuggestion, loading }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        style={styles.input}
        placeholderTextColor="#94a3b8"
      />
      {loading ? <Text style={styles.meta}>Buscando...</Text> : null}
      {!!suggestions.length ? (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 6).map((item) => (
            <Pressable key={String(item.id)} onPress={() => onSelect(item)} style={styles.suggestionItem}>
              {renderSuggestion ? renderSuggestion(item) : <Text style={styles.inlineItem}>{item.name}</Text>}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function QuoteScreen({ navigation }) {
  const [form, setForm] = useState({
    business_unit_key: 'atm-cargo',
    client_name: '',
    org_name: '',
    org_ruc: '',
    org_id: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    contact_id: '',
    modality: 'AEREO',
    cargo_class: 'LCL',
    operation_type: 'IMPORT',
    origin: '',
    destination: '',
    commodity: '',
    quantity: '',
    weight: '',
    volume: '',
    industrial_brand: '',
    industrial_project_type: '',
    industrial_location: '',
    industrial_product_name: '',
    currency: 'USD',
    cost_amount: '',
    sale_amount: '',
    notes: '',
  });
  const [orgSuggestions, setOrgSuggestions] = useState([]);
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [searchingOrg, setSearchingOrg] = useState(false);
  const [searchingContact, setSearchingContact] = useState(false);
  const [quotes, setQuotes] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setQuotes(await api.quickQuotes());
    } catch (e) {
      showError(e, 'No se pudieron cargar cotizaciones');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    let live = true;
    const q = form.org_name.trim();
    if (q.length < 2) {
      setOrgSuggestions([]);
      return;
    }
    setSearchingOrg(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.searchOrganizations(q);
        if (live) setOrgSuggestions(Array.isArray(rows) ? rows : rows?.items || []);
      } catch {
        if (live) setOrgSuggestions([]);
      } finally {
        if (live) setSearchingOrg(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [form.org_name]);

  useEffect(() => {
    let live = true;
    const q = form.contact_name.trim();
    async function run() {
      if (form.org_id) {
        try {
          setSearchingContact(true);
          const rows = await api.organizationContacts(form.org_id);
          if (live) {
            const filtered = q
              ? rows.filter((c) =>
                  [c.name, c.email, c.phone].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())
                )
              : rows;
            setContactSuggestions(filtered);
          }
        } catch {
          if (live) setContactSuggestions([]);
        } finally {
          if (live) setSearchingContact(false);
        }
        return;
      }
      if (q.length < 2) {
        setContactSuggestions([]);
        return;
      }
      setSearchingContact(true);
      try {
        const rows = await api.searchContacts(q);
        if (live) setContactSuggestions(Array.isArray(rows) ? rows : []);
      } catch {
        if (live) setContactSuggestions([]);
      } finally {
        if (live) setSearchingContact(false);
      }
    }
    const t = setTimeout(run, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [form.contact_name, form.org_id]);

  const profit = useMemo(() => {
    const sale = Number(String(form.sale_amount).replace(',', '.'));
    const cost = Number(String(form.cost_amount).replace(',', '.'));
    if (!Number.isFinite(sale) || !Number.isFinite(cost)) return null;
    return sale - cost;
  }, [form.cost_amount, form.sale_amount]);

  async function save() {
    setSaving(true);
    try {
      const defaults = await api.operationDefaults(form.business_unit_key);
      const isIndustrial = form.business_unit_key === 'atm-industrial';
      const safeTitle = isIndustrial
        ? [form.industrial_brand, form.org_name || form.client_name, form.industrial_product_name]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' · ') || 'Operacion industrial'
        : [form.org_name || form.client_name, form.modality, form.commodity]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' · ') || 'Operacion cargo';

      const dealPayload = {
        pipeline_id: defaults.pipeline_id,
        stage_id: defaults.stage_id,
        business_unit_id: defaults.business_unit?.id,
        title: safeTitle,
        value: 0,
        organization: form.org_id
          ? { id: Number(form.org_id), name: form.org_name, ruc: form.org_ruc || null }
          : null,
        org_name: form.org_name || form.client_name || null,
        org_ruc: form.org_ruc || null,
        contact: form.contact_id
          ? {
              id: Number(form.contact_id),
              name: form.contact_name,
              email: form.contact_email || null,
              phone: form.contact_phone || null,
            }
          : null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        transport_type_hint: isIndustrial ? 'INDUSTRIAL' : form.modality,
        cargo_class_hint: isIndustrial ? form.industrial_project_type : form.cargo_class,
        origin_hint: isIndustrial ? form.industrial_location : form.origin,
        destination_hint: form.destination,
        commodity_hint: isIndustrial ? form.industrial_product_name : form.commodity,
        quantity_hint: form.quantity,
        weight_hint: form.weight,
        volume_hint: form.volume,
        operation_type_hint: isIndustrial ? 'INDUSTRIAL' : form.operation_type,
      };

      const deal = await api.createDeal(dealPayload);
      const dealId = deal?.id;
      if (!dealId) throw new Error('No se obtuvo ID de operacion');

      if (isIndustrial) {
        const fields = [
          ['industrial_brand', 'Marca industrial principal', 'select', form.industrial_brand],
          ['industrial_project_type', 'Tipo de proyecto', 'text', form.industrial_project_type],
          ['industrial_location', 'Ubicacion', 'text', form.industrial_location],
          ['industrial_notes', 'Notas', 'text', form.notes],
          ['industrial_product_name', 'Producto cotizado', 'text', form.industrial_product_name],
        ];
        await Promise.all(
          fields
            .filter(([, , , value]) => String(value || '').trim())
            .map(([key, label, type, value]) => api.addDealCustomField(dealId, { key, label, type, value }))
        );
        if (form.industrial_product_name.trim()) {
          await api.createIndustrialDoor(dealId, {
            identifier: 'P1',
            product_name: form.industrial_product_name.trim(),
            brand: form.industrial_brand || null,
          }).catch(() => {});
        }
      } else {
        const mode = form.modality.toUpperCase();
        const payloadByMode = {
          AEREO: {
            origin_airport: form.origin || '',
            destination_airport: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            weight_gross_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          MARITIMO: {
            load_type: form.cargo_class || '',
            pol: form.origin || '',
            pod: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            weight_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          TERRESTRE: {
            cargo_class: form.cargo_class || '',
            origin_city: form.origin || '',
            destination_city: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            weight_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          MULTIMODAL: {
            cargo_type: form.cargo_class || '',
            origin_port: form.origin || '',
            destination_port: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            weight_gross_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
        };
        await api.updateCargoOperation(dealId, mode.toLowerCase(), payloadByMode[mode] || payloadByMode.AEREO).catch(() => {});
      }

      const created = await api.createQuickQuote({
        ...form,
        org_id: form.org_id ? Number(form.org_id) : null,
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        deal_id: dealId,
        client_name: form.org_name || form.client_name || form.contact_name,
        modality: isIndustrial ? 'industrial' : form.modality.toLowerCase(),
      });
      Alert.alert('Operacion creada', `${deal.reference || `OP #${dealId}`}\nCotizacion: ${created.ref_code || `#${created.id}`}`);
      setForm({
        ...form,
        client_name: '',
        org_name: '',
        org_ruc: '',
        org_id: '',
        contact_name: '',
        contact_email: '',
        contact_phone: '',
        contact_id: '',
        origin: '',
        destination: '',
        commodity: '',
        quantity: '',
        weight: '',
        volume: '',
        industrial_product_name: '',
        cost_amount: '',
        sale_amount: '',
        notes: '',
      });
      await load();
      navigation.navigate('Adjuntos', { entityType: 'deal', entityId: String(dealId) });
    } catch (e) {
      showError(e, 'No se pudo crear la operacion/cotizacion');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Nueva operacion</Text>
        <View style={styles.formPanel}>
          <Text style={styles.label}>Unidad de negocio</Text>
          <View style={styles.choiceRow}>
            <ChoiceButton
              active={form.business_unit_key === 'atm-cargo'}
              label="ATM CARGO"
              onPress={() => setForm({ ...form, business_unit_key: 'atm-cargo', modality: 'AEREO' })}
            />
            <ChoiceButton
              active={form.business_unit_key === 'atm-industrial'}
              label="ATM INDUSTRIAL"
              onPress={() => setForm({ ...form, business_unit_key: 'atm-industrial', modality: 'INDUSTRIAL' })}
            />
          </View>

          <SuggestionBox
            label="Organizacion"
            value={form.org_name}
            onChangeText={(v) => setForm({ ...form, org_name: v, client_name: v, org_id: '', org_ruc: '' })}
            placeholder="Buscar o escribir cliente"
            suggestions={orgSuggestions}
            loading={searchingOrg}
            onSelect={(org) => {
              setOrgSuggestions([]);
              setForm({
                ...form,
                org_id: String(org.id),
                org_name: org.name || org.razon_social || '',
                client_name: org.name || org.razon_social || '',
                org_ruc: org.ruc || '',
              });
            }}
            renderSuggestion={(org) => (
              <View>
                <Text style={styles.inlineItem}>{org.name || org.razon_social}</Text>
                <Text style={styles.meta}>{org.ruc || org.email || 'Seleccionar organizacion'}</Text>
              </View>
            )}
          />
          <Field label="RUC" value={form.org_ruc} onChangeText={(v) => setForm({ ...form, org_ruc: v })} placeholder="Autocompleta si existe" />
          <SuggestionBox
            label="Contacto"
            value={form.contact_name}
            onChangeText={(v) => setForm({ ...form, contact_name: v, contact_id: '' })}
            placeholder="Buscar o escribir contacto"
            suggestions={contactSuggestions}
            loading={searchingContact}
            onSelect={(contact) => {
              setContactSuggestions([]);
              setForm({
                ...form,
                contact_id: String(contact.id),
                contact_name: contact.name || '',
                contact_email: contact.email || '',
                contact_phone: contact.phone || '',
              });
            }}
            renderSuggestion={(contact) => (
              <View>
                <Text style={styles.inlineItem}>{contact.name}</Text>
                <Text style={styles.meta}>{contact.email || '-'} {contact.phone ? `· ${contact.phone}` : ''}</Text>
              </View>
            )}
          />
          <Field label="Telefono contacto" value={form.contact_phone} onChangeText={(v) => setForm({ ...form, contact_phone: v })} placeholder="+595..." keyboardType="phone-pad" />
          <Field label="Email contacto" value={form.contact_email} onChangeText={(v) => setForm({ ...form, contact_email: v })} placeholder="correo@empresa.com" keyboardType="email-address" />

          {form.business_unit_key === 'atm-cargo' ? (
            <>
              <Text style={styles.label}>Modalidad</Text>
              <View style={styles.choiceRow}>
                {['AEREO', 'MARITIMO', 'TERRESTRE', 'MULTIMODAL'].map((mode) => (
                  <ChoiceButton key={mode} active={form.modality === mode} label={mode} onPress={() => setForm({ ...form, modality: mode })} />
                ))}
              </View>
              <Text style={styles.label}>Tipo de carga</Text>
              <View style={styles.choiceRow}>
                {['LCL', 'FCL', 'FTL', 'LTL'].map((type) => (
                  <ChoiceButton key={type} active={form.cargo_class === type} label={type} onPress={() => setForm({ ...form, cargo_class: type })} />
                ))}
              </View>
              <Text style={styles.label}>Tipo de operacion</Text>
              <View style={styles.choiceRow}>
                {['IMPORT', 'EXPORT', 'EXTERIOR'].map((type) => (
                  <ChoiceButton key={type} active={form.operation_type === type} label={type} onPress={() => setForm({ ...form, operation_type: type })} />
                ))}
              </View>
              <Field label="Origen" value={form.origin} onChangeText={(v) => setForm({ ...form, origin: v })} placeholder="Puerto, aeropuerto o ciudad" />
              <Field label="Destino" value={form.destination} onChangeText={(v) => setForm({ ...form, destination: v })} placeholder="Puerto, aeropuerto o ciudad" />
              <Field label="Mercaderia" value={form.commodity} onChangeText={(v) => setForm({ ...form, commodity: v })} placeholder="Descripcion de carga" />
              <Field label="Bultos" value={form.quantity} onChangeText={(v) => setForm({ ...form, quantity: v })} placeholder="Cantidad" keyboardType="decimal-pad" />
              <Field label="Peso kg" value={form.weight} onChangeText={(v) => setForm({ ...form, weight: v })} placeholder="Peso bruto" keyboardType="decimal-pad" />
              <Field label="Volumen m3" value={form.volume} onChangeText={(v) => setForm({ ...form, volume: v })} placeholder="Volumen" keyboardType="decimal-pad" />
            </>
          ) : (
            <>
              <Field label="Marca" value={form.industrial_brand} onChangeText={(v) => setForm({ ...form, industrial_brand: v })} placeholder="Rayflex, Boplan..." />
              <Field label="Producto / proyecto" value={form.industrial_product_name} onChangeText={(v) => setForm({ ...form, industrial_product_name: v })} placeholder="Puerta, barrera, cortina..." />
              <Field label="Tipo de proyecto" value={form.industrial_project_type} onChangeText={(v) => setForm({ ...form, industrial_project_type: v })} placeholder="Venta, instalacion, mantenimiento..." />
              <Field label="Ubicacion" value={form.industrial_location} onChangeText={(v) => setForm({ ...form, industrial_location: v })} placeholder="Planta, ciudad, sucursal..." />
            </>
          )}

          <Field label="Moneda" value={form.currency} onChangeText={(v) => setForm({ ...form, currency: v.toUpperCase() })} placeholder="USD/PYG" />
          <Field label="Costo" value={form.cost_amount} onChangeText={(v) => setForm({ ...form, cost_amount: v })} placeholder="0" keyboardType="decimal-pad" />
          <Field label="Precio venta" value={form.sale_amount} onChangeText={(v) => setForm({ ...form, sale_amount: v })} placeholder="0" keyboardType="decimal-pad" />
          {profit !== null ? <Text style={styles.profit}>Margen estimado: {form.currency} {profit.toFixed(2)}</Text> : null}
          <Field label="Notas" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} placeholder="Notas internas" multiline />
          <PrimaryButton title={saving ? 'Creando...' : 'Crear operacion y cotizacion'} icon="content-save" onPress={save} disabled={saving} />
        </View>

        <SectionTitle title="Ultimas cotizaciones" />
        {quotes.slice(0, 8).map((quote) => (
          <View key={quote.id} style={styles.card}>
            <Text style={styles.cardTitle}>{quote.client_name || quote.inputs?.client_name || 'Sin cliente'}</Text>
            <Text style={styles.meta}>{quote.ref_code || `Cotizacion #${quote.id}`}</Text>
            <Text style={styles.meta}>{quote.inputs?.modality || 'draft'} · {quote.inputs?.currency || 'USD'}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function AttachmentsScreen({ route }) {
  const [entityType, setEntityType] = useState(route?.params?.entityType || 'quote');
  const [entityId, setEntityId] = useState(route?.params?.entityId || '');
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (route?.params?.entityType) setEntityType(route.params.entityType);
    if (route?.params?.entityId) setEntityId(String(route.params.entityId));
  }, [route?.params]);

  const load = useCallback(async () => {
    if (!entityType || !entityId) return;
    try {
      setItems(await api.listAttachments(entityType, entityId));
    } catch (e) {
      showError(e, 'No se pudieron listar adjuntos');
    }
  }, [entityId, entityType]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function uploadAsset(asset) {
    if (!entityType || !entityId) {
      Alert.alert('ATMCARGOSISTEM', 'Elegir tipo e ID antes de adjuntar');
      return;
    }

    const uri = asset.uri;
    const name = asset.name || asset.fileName || uri?.split('/').pop() || 'archivo';
    const mimeType = asset.mimeType || asset.type || 'application/octet-stream';
    const form = new FormData();
    form.append('entity_type', entityType);
    form.append('entity_id', entityId);
    form.append('type', 'mobile');
    form.append('file', { uri, name, type: mimeType });

    setUploading(true);
    try {
      await api.uploadAttachment(form);
      await load();
    } catch (e) {
      showError(e, 'No se pudo subir archivo');
    } finally {
      setUploading(false);
    }
  }

  async function pickCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ATMCARGOSISTEM', 'Permiso de camara requerido');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
    if (!result.canceled && result.assets?.[0]) uploadAsset(result.assets[0]);
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.75 });
    if (!result.canceled && result.assets?.[0]) uploadAsset(result.assets[0]);
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) uploadAsset(result.assets[0]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Adjuntos</Text>
        <View style={styles.formPanel}>
          <Field label="Tipo" value={entityType} onChangeText={setEntityType} placeholder="contact, organization, deal, quote" />
          <Field label="ID" value={entityId} onChangeText={setEntityId} placeholder="ID del registro" keyboardType="number-pad" />
          <View style={styles.actions}>
            <PrimaryButton title="Camara" icon="camera" variant="secondary" onPress={pickCamera} disabled={uploading} />
            <PrimaryButton title="Galeria" icon="image" variant="secondary" onPress={pickImage} disabled={uploading} />
          </View>
          <PrimaryButton title={uploading ? 'Subiendo...' : 'Documento'} icon="file-upload" onPress={pickDocument} disabled={uploading} />
          <PrimaryButton title="Actualizar lista" icon="refresh" variant="secondary" onPress={load} />
        </View>

        <SectionTitle title="Archivos" />
        {!items.length ? <EmptyState text="Sin archivos para este registro" /> : null}
        {items.map((item) => (
          <View key={`${item.entity_type || 'deal'}-${item.id}`} style={styles.card}>
            <Text style={styles.cardTitle}>{item.original_name || item.filename}</Text>
            <Text style={styles.meta}>{item.mime_type || item.entity_type || 'archivo'}</Text>
            <Text style={styles.meta}>{item.url}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Inicio: 'view-dashboard',
            Contactos: 'account-group',
            Organizaciones: 'office-building',
            Cotizar: 'file-document-edit',
            Adjuntos: 'paperclip',
          };
          return <MaterialCommunityIcons name={icons[route.name]} color={color} size={size} />;
        },
      })}
    >
      <Tab.Screen name="Inicio" component={HomeScreen} />
      <Tab.Screen name="Contactos" component={ContactsScreen} />
      <Tab.Screen name="Organizaciones" component={OrganizationsScreen} />
      <Tab.Screen name="Cotizar" component={QuoteScreen} />
      <Tab.Screen name="Adjuntos" component={AttachmentsScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.meta}>Cargando sesion...</Text>
        </View>
      </Screen>
    );
  }
  return token ? <Tabs /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  listContent: {
    paddingBottom: 24,
  },
  loginWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  loginCard: {
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  brand: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
  },
  kicker: {
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoutButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff5f5',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickAction: {
    width: '48%',
    minHeight: 92,
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    justifyContent: 'space-between',
  },
  quickText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    color: colors.ink,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  textArea: {
    minHeight: 92,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
  },
  button: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: '#b7ded8',
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: colors.accentDark,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  buttonSecondaryText: {
    color: colors.accent,
  },
  formPanel: {
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  choiceText: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 12,
  },
  choiceTextActive: {
    color: '#fff',
  },
  suggestions: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f6',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  inlineList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    gap: 4,
  },
  inlineItem: {
    fontSize: 13,
    color: colors.ink,
  },
  importPreview: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7ded8',
    backgroundColor: colors.soft,
    padding: 12,
    gap: 4,
  },
  empty: {
    margin: 16,
    padding: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
  },
  profit: {
    color: colors.accent,
    fontWeight: '800',
  },
});
