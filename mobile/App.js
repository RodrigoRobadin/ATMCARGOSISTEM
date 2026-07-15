import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as Font from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, NavigationContainer, createNavigationContainerRef, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { api, API_URL, getAuthToken } from './src/api/client';
import { pickDeviceContact } from './src/utils/deviceContacts';
import { openPhone, openWhatsapp } from './src/utils/phone';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const navigationRef = createNavigationContainerRef();
const Tab = createBottomTabNavigator();
const brandLogo = require('./assets/grupo-atm-logo.jpeg');
const materialCommunityFont = require('./node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf');
const materialCommunityGlyphs = require('./node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

const iconAliases = {
  'office-building-plus': 'office-building',
  'phone-clock': 'phone',
};

const lightColors = {
  bg: '#f5f7f8',
  panel: '#ffffff',
  elevated: '#ffffff',
  input: '#ffffff',
  ink: '#102038',
  muted: '#64748b',
  border: '#dce4e8',
  accent: '#087f73',
  accentDark: '#06675f',
  danger: '#c2414a',
  dangerSoft: '#fff1f2',
  soft: '#eaf6f3',
  softStrong: '#dff1ed',
  placeholder: '#94a3b8',
  warning: '#a16207',
  warningSoft: '#fffbeb',
  shadow: '#0f172a',
  nav: '#ffffff',
};

const darkColors = {
  bg: '#0f171b',
  panel: '#172126',
  elevated: '#1b282e',
  input: '#111b20',
  ink: '#f3f7f8',
  muted: '#9fb0ba',
  border: '#2d3d45',
  accent: '#39b8a8',
  accentDark: '#278f84',
  danger: '#fb7185',
  dangerSoft: '#321b22',
  soft: '#17332f',
  softStrong: '#1d403a',
  placeholder: '#71838e',
  warning: '#fbbf24',
  warningSoft: '#352a14',
  shadow: '#000000',
  nav: '#141e23',
};

const THEME_STORAGE_KEY = 'atm-mobile-theme';
const ThemeContext = React.createContext({ isDark: false, toggleTheme: () => {} });
let colors = lightColors;
let styles;

function useAppTheme() {
  return React.useContext(ThemeContext);
}

function showError(error, fallback = 'No se pudo completar la accion') {
  Alert.alert('ATMCARGOSISTEM', error?.message || fallback);
}

function Screen({ children }) {
  return <SafeAreaView style={styles.screen}>{children}</SafeAreaView>;
}

function PrimaryButton({ title, icon, onPress, disabled, variant = 'primary', compact = false, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={variant === 'secondary' ? colors.accent : '#fff'} /> : null}
      {title ? <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText]}>{title}</Text> : null}
    </Pressable>
  );
}

function MaterialCommunityIcons({ name, size = 20, color = colors.ink, style }) {
  const glyphName = iconAliases[name] || name;
  const code = materialCommunityGlyphs[glyphName];
  if (!code) return null;
  return (
    <Text
      style={[
        styles.iconFont,
        {
          color,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
        },
        style,
      ]}
    >
      {String.fromCodePoint(code)}
    </Text>
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
        placeholderTextColor={colors.placeholder}
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

async function ensureMediaLibraryPermission() {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  const permission = current.granted ? current : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('ATMCARGOSISTEM', 'Permiso de galeria requerido para seleccionar imagenes');
    return false;
  }
  return true;
}

function imageUploadPart(asset, fallbackName = 'imagen.jpg') {
  const uri = asset?.uri || '';
  const rawName = asset?.name || asset?.fileName || uri.split('/').pop() || fallbackName;
  const rawMimeType = asset?.mimeType || asset?.type || '';
  let name = String(rawName || fallbackName).split('?')[0] || fallbackName;
  const lowerName = name.toLowerCase();
  const mimeType = rawMimeType.includes('/')
    ? rawMimeType
    : lowerName.endsWith('.png')
      ? 'image/png'
      : lowerName.endsWith('.webp')
        ? 'image/webp'
        : lowerName.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';

  if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) {
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'jpg';
    name = `${name.replace(/\.[^/.]+$/, '') || 'imagen'}.${ext}`;
  }

  return { uri, name, type: mimeType };
}

const IMAGE_UPLOAD_MAX_WIDTH = 1600;
const IMAGE_UPLOAD_QUALITY = 0.68;

function isImageAsset(asset) {
  const mimeType = String(asset?.mimeType || asset?.type || '').toLowerCase();
  const name = String(asset?.name || asset?.fileName || asset?.uri || '').toLowerCase();
  return mimeType.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
}

function jpgName(asset, fallbackName = 'imagen.jpg') {
  const rawName = String(asset?.name || asset?.fileName || fallbackName).split('?')[0] || fallbackName;
  const base = rawName.replace(/\.[^/.]+$/, '') || 'imagen';
  return `${base}.jpg`;
}

async function prepareImageForUpload(asset, fallbackName = 'imagen.jpg') {
  if (!asset?.uri || !isImageAsset(asset)) return asset;
  try {
    const width = Number(asset.width || 0);
    const actions = width > IMAGE_UPLOAD_MAX_WIDTH ? [{ resize: { width: IMAGE_UPLOAD_MAX_WIDTH } }] : [];
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: IMAGE_UPLOAD_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      ...asset,
      ...result,
      name: jpgName(asset, fallbackName),
      fileName: jpgName(asset, fallbackName),
      mimeType: 'image/jpeg',
      type: 'image/jpeg',
      base64: undefined,
    };
  } catch (_error) {
    return asset;
  }
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
          <Image source={brandLogo} style={styles.loginLogo} resizeMode="contain" />
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
  const { isDark, toggleTheme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const [boot, operations] = await Promise.all([
        api.bootstrap(),
        api.mobileOperations(''),
      ]);
      setData({ ...boot, recentOperations: operations || [] });
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

  const recentQuotes = [];
  const recentOperations = (data?.recentOperations || []).slice(0, 8);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={styles.headerRow}>
          <View style={styles.homeBrandRow}>
            <Image source={brandLogo} style={styles.homeLogo} resizeMode="contain" />
            <View>
              <Text style={styles.kicker}>Hola</Text>
              <Text style={styles.title}>{user?.name || 'Usuario'}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={toggleTheme} style={styles.iconButton} accessibilityLabel={isDark ? "Usar modo claro" : "Usar modo oscuro"}>
              <MaterialCommunityIcons name={isDark ? "white-balance-sunny" : "moon-waning-crescent"} size={20} color={colors.accent} />
            </Pressable>
            <Pressable onPress={logout} style={[styles.iconButton, styles.logoutButton]} accessibilityLabel="Cerrar sesion">
              <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
            </Pressable>
          </View>
        </View>

        <View style={styles.quickGrid}>
          <QuickAction icon="account-group" label="Contactos" subtitle="Comunica y da seguimiento" onPress={() => navigation.navigate('Contactos')} />
          <QuickAction icon="office-building" label="Organizaciones" subtitle="Clientes y proveedores" onPress={() => navigation.navigate('Organizaciones')} />
          <QuickAction icon="file-document-edit" label="Nueva operacion" subtitle="Crea un registro comercial" onPress={() => navigation.navigate('Operar')} />
          <QuickAction icon="clipboard-list" label="Operaciones" subtitle="Consulta y actualiza" onPress={() => navigation.navigate('Operaciones')} />
        </View>

        <SectionTitle title="Operaciones recientes" />
        {loading ? <ActivityIndicator /> : null}
        {!loading && !recentOperations.length ? <EmptyState text="Sin operaciones recientes" /> : null}
        {recentOperations.map((op) => (
          <Pressable key={op.id} style={[styles.card, styles.operationCard]} onPress={() => navigation.navigate('Operaciones', { operationId: op.id })}>
            <View style={styles.entityIcon}><MaterialCommunityIcons name="clipboard-list" size={22} color={colors.accent} /></View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{op.reference || `OP #${op.id}`}</Text>
              <Text style={styles.meta} numberOfLines={1}>{op.org_name || op.title || 'Sin cliente'}</Text>
              <Text style={styles.meta} numberOfLines={1}>{op.business_unit_name || '-'} · {op.file_count || 0} adjuntos · {op.custom_field_count || 0} datos</Text>
            </View>
            <View style={styles.cardAside}>
              <View style={styles.stagePill}><Text style={styles.stagePillText}>{op.stage_name || 'Sin etapa'}</Text></View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accent} />
            </View>
          </Pressable>
        ))}

        {null}
        {null}
        {null}
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

function QuickAction({ icon, label, subtitle, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.cardPressed]}>
      <View style={styles.entityIcon}><MaterialCommunityIcons name={icon} size={24} color={colors.accent} /></View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickText}>{label}</Text>
        <Text style={styles.quickSubtitle}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accent} />
    </Pressable>
  );
}

function SectionTitle({ title }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const CALL_OUTCOMES = [
  { value: 'no_contesta', label: 'No contesta', icon: 'phone-missed' },
  { value: 'interesado', label: 'Interesado', icon: 'star-outline' },
  { value: 'no_interesado', label: 'No interesado', icon: 'thumb-down-outline' },
  { value: 'volver_a_llamar', label: 'Volver a llamar', icon: 'phone-forward' },
  { value: 'en_negociacion', label: 'En negociacion', icon: 'handshake-outline' },
];

const CALL_OUTCOMES_REQUIRING_TASK = new Set(['interesado', 'volver_a_llamar', 'en_negociacion']);

function validateCallDraft(draft) {
  if (draft?.outcome !== 'no_contesta' && !String(draft?.notes || '').trim()) {
    throw new Error('El contexto de la llamada es obligatorio');
  }
  if (CALL_OUTCOMES_REQUIRING_TASK.has(draft?.outcome) &&
      (!String(draft?.task_title || '').trim() || !String(draft?.task_due || '').trim())) {
    throw new Error('Este resultado requiere una proxima accion con fecha y hora');
  }
}

function callCompletionPayload(draft) {
  const hasTask = Boolean(String(draft?.task_title || '').trim() && String(draft?.task_due || '').trim());
  return {
    subject: draft.subject,
    notes: String(draft.notes || '').trim(),
    happened_at: draft.happened_at,
    duration_min: Number(draft.duration_min || 0),
    outcome: draft.outcome,
    task: hasTask ? {
      title: String(draft.task_title).trim(),
      due_at: draft.task_due,
      priority: 'medium',
      reminder_minutes: 30,
    } : undefined,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateTime(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function shortDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function money(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${currency} ${n.toLocaleString('es-PY', { maximumFractionDigits: 2 })}`;
}

function apiUrl(path) {
  if (!path) return '';
  return path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function authenticatedFileUrl(path) {
  const url = apiUrl(path);
  const token = getAuthToken();
  if (!url || !token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}

async function startAssistedCallFromList({ navigation, phone, orgId = null, contactId = null, name = 'cliente' }) {
  const draft = {
    org_id: orgId || null,
    contact_id: contactId || null,
    deal_id: null,
    phone_number: phone || '',
    subject: `Llamada - ${name || 'cliente'}`,
    happened_at: localDateTime(0),
    duration_min: '',
    outcome: 'volver_a_llamar',
    notes: '',
    task_title: 'Volver a llamar',
    task_due: localDateTime(1),
  };
  const started = await api.startFollowupCall({ ...draft, started_at: draft.happened_at, source: 'mobile' });
  navigation.navigate('Seguimiento', { pendingCall: { ...draft, call_id: started.id } });
  await openPhone(phone);
}
function entityPayload(entityType, entity) {
  if (entityType === 'contact') {
    return { contact_id: entity?.id, org_id: entity?.org_id || null };
  }
  return { org_id: entity?.id, contact_id: null };
}

function FollowupEntityDetail({ entityType, entity, followup, contacts = [], onClose, onReload, openContact }) {
  const [sections, setSections] = useState({ resumen: true, acciones: true, seguimiento: true, nota: false, tarea: false });
  const [callDraft, setCallDraft] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState(localDateTime(1));
  const [saving, setSaving] = useState(false);
  const base = entityPayload(entityType, entity);
  const phone = entity?.phone || entity?.org_phone || '';
  const title = entity?.name || entity?.razon_social || entity?.org_name || 'Sin nombre';

  function toggle(key) {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function callNow(target = entity) {
    const targetPhone = target?.phone || phone;
    const draft = {
      ...entityPayload(target?.org_id ? 'contact' : entityType, target),
      org_id: target?.org_id || base.org_id || null,
      contact_id: target?.org_id ? target.id : base.contact_id || null,
      subject: `Llamada - ${target?.name || title}`,
      phone_number: targetPhone,
      happened_at: localDateTime(0),
      duration_min: '',
      outcome: 'volver_a_llamar',
      notes: '',
      task_title: 'Volver a llamar',
      task_due: localDateTime(1),
    };
    try {
      const started = await api.startFollowupCall({ ...draft, started_at: draft.happened_at, source: 'mobile' });
      setCallDraft({ ...draft, call_id: started.id });
      await openPhone(targetPhone);
    } catch (e) {
      showError(e, 'No se pudo iniciar la llamada');
    }
  }

  async function saveCall() {
    if (!callDraft) return;
    setSaving(true);
    try {
      validateCallDraft(callDraft);
      const started = callDraft.call_id ? null : await api.startFollowupCall({
        ...callDraft,
        started_at: callDraft.happened_at,
        source: 'mobile',
      });
      await api.completeFollowupCall(callDraft.call_id || started.id, callCompletionPayload(callDraft));
      setCallDraft(null);
      await onReload?.();
    } catch (e) {
      showError(e, 'No se pudo registrar llamada');
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await api.createFollowupNote({ ...base, content: noteText.trim() });
      setNoteText('');
      await onReload?.();
    } catch (e) {
      showError(e, 'No se pudo guardar nota');
    } finally {
      setSaving(false);
    }
  }

  async function saveTask() {
    if (!taskTitle.trim() || !taskDue.trim()) return;
    setSaving(true);
    try {
      await api.createFollowupTask({ ...base, title: taskTitle.trim(), due_at: taskDue.trim(), priority: 'medium' });
      setTaskTitle('');
      setTaskDue(localDateTime(1));
      await onReload?.();
    } catch (e) {
      showError(e, 'No se pudo crear tarea');
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(taskId) {
    setSaving(true);
    try {
      await api.updateFollowupTask(taskId, { status: 'done' });
      await onReload?.();
    } catch (e) {
      showError(e, 'No se pudo completar tarea');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.detailHeader}>
        <PrimaryButton title="Volver" icon="arrow-left" variant="secondary" onPress={onClose} disabled={saving} />
      </View>
      <DetailSection open={sections.resumen} title="Resumen" onToggle={() => toggle('resumen')}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.meta}>{entity?.ruc || entity?.email || entity?.org_name || '-'}</Text>
        <Text style={styles.meta}>{phone || 'Sin telefono'}</Text>
        {entity?.notes ? <Text style={styles.inlineItem}>{entity.notes}</Text> : null}
      </DetailSection>

      <DetailSection open={sections.acciones} title="Acciones rapidas" onToggle={() => toggle('acciones')}>
        <View style={styles.actions}>
          <PrimaryButton title="Llamar" icon="phone" variant="secondary" disabled={!phone} onPress={() => callNow(entity)} />
          <PrimaryButton title="WhatsApp" icon="whatsapp" variant="secondary" disabled={!phone} onPress={() => openWhatsapp(phone).catch(showError)} />
          <PrimaryButton title="Nota" icon="note-plus" variant="secondary" onPress={() => setSections((p) => ({ ...p, nota: true }))} />
          <PrimaryButton title="Tarea" icon="calendar-plus" variant="secondary" onPress={() => setSections((p) => ({ ...p, tarea: true }))} />
        </View>
        {contacts.length ? (
          <View style={styles.inlineList}>
            <Text style={styles.label}>Contactos asociados</Text>
            {contacts.map((contact) => (
              <View key={contact.id} style={styles.inlinePanel}>
                <Text style={styles.cardTitle}>{contact.name}</Text>
                <Text style={styles.meta}>{contact.phone || contact.email || '-'}</Text>
                <View style={styles.actions}>
                  <PrimaryButton title="Abrir" icon="account" variant="secondary" onPress={() => openContact?.(contact.id)} />
                  <PrimaryButton title="Llamar" icon="phone" variant="secondary" disabled={!contact.phone} onPress={() => callNow(contact)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </DetailSection>

      {callDraft ? (
        <View style={styles.formPanel}>
          <Text style={styles.sectionTitle}>Registrar llamada</Text>
          <Text style={styles.label}>Resultado</Text>
          <OptionChips options={CALL_OUTCOMES} value={callDraft.outcome} onChange={(value) => setCallDraft({ ...callDraft, outcome: value })} />
          <Field label="Que se hablo" value={callDraft.notes} onChangeText={(v) => setCallDraft({ ...callDraft, notes: v })} placeholder="Resumen de la llamada" multiline />
          <Field label="Fecha llamada" value={callDraft.happened_at} onChangeText={(v) => setCallDraft({ ...callDraft, happened_at: v })} placeholder="YYYY-MM-DD HH:mm" />
          <Field label="Duracion (minutos, opcional)" value={String(callDraft.duration_min || '')} onChangeText={(v) => setCallDraft({ ...callDraft, duration_min: v })} placeholder="0" keyboardType="number-pad" />
          <Field label="Proxima accion" value={callDraft.task_title} onChangeText={(v) => setCallDraft({ ...callDraft, task_title: v })} placeholder="Volver a llamar..." />
          <Text style={styles.label}>Fecha rapida</Text>
          <OptionChips
            options={[{ value: localDateTime(0), label: 'Hoy' }, { value: localDateTime(1), label: 'Manana' }, { value: localDateTime(2), label: '2 dias' }, { value: localDateTime(7), label: 'Prox. semana' }]}
            value={callDraft.task_due}
            onChange={(value) => setCallDraft({ ...callDraft, task_due: value, create_task: true })}
          />
          <Field label="Fecha tarea" value={callDraft.task_due} onChangeText={(v) => setCallDraft({ ...callDraft, task_due: v })} placeholder="YYYY-MM-DD HH:mm" />
          <View style={styles.actions}>
            <PrimaryButton title="Guardar llamada" icon="content-save" onPress={saveCall} disabled={saving} />
            <PrimaryButton title="Dejar pendiente" icon="close" variant="secondary" onPress={() => setCallDraft(null)} disabled={saving} />
          </View>
        </View>
      ) : null}

      <DetailSection open={sections.seguimiento} title="Seguimiento" onToggle={() => toggle('seguimiento')}>
        <SectionTitle title="Tareas" />
        {!(followup?.tasks || []).length ? <Text style={styles.meta}>Sin tareas</Text> : null}
        {(followup?.tasks || []).map((task) => (
          <View key={task.id} style={styles.inlinePanel}>
            <Text style={styles.cardTitle}>{task.title}</Text>
            <Text style={styles.meta}>{shortDateTime(task.due_at)} - {task.status}</Text>
            {task.status === 'pending' ? <PrimaryButton title="Hecha" icon="check" variant="secondary" onPress={() => completeTask(task.id)} disabled={saving} /> : null}
          </View>
        ))}
        <SectionTitle title="Llamadas" />
        {(followup?.calls || []).slice(0, 8).map((call) => (
          <Text key={call.id} style={styles.inlineItem}>{shortDateTime(call.happened_at)} - {call.outcome || call.subject || 'Llamada'} {call.notes ? `- ${call.notes}` : ''}</Text>
        ))}
        <SectionTitle title="Notas" />
        {(followup?.notes || []).slice(0, 8).map((note) => (
          <Text key={note.id} style={styles.inlineItem}>{shortDateTime(note.created_at)} - {note.content}</Text>
        ))}
      </DetailSection>

      <DetailSection open={sections.nota} title="Nota rapida" onToggle={() => toggle('nota')}>
        <Field label="Nota" value={noteText} onChangeText={setNoteText} placeholder="Escribir seguimiento..." multiline />
        <PrimaryButton title="Guardar nota" icon="content-save" onPress={saveNote} disabled={saving || !noteText.trim()} />
      </DetailSection>

      <DetailSection open={sections.tarea} title="Tarea / recordatorio" onToggle={() => toggle('tarea')}>
        <Field label="Tarea" value={taskTitle} onChangeText={setTaskTitle} placeholder="Llamar, enviar propuesta..." />
        <Text style={styles.label}>Fecha rapida</Text>
        <OptionChips
          options={[{ value: localDateTime(0), label: 'Hoy' }, { value: localDateTime(1), label: 'Manana' }, { value: localDateTime(2), label: '2 dias' }, { value: localDateTime(7), label: 'Prox. semana' }]}
          value={taskDue}
          onChange={setTaskDue}
        />
        <Field label="Fecha" value={taskDue} onChangeText={setTaskDue} placeholder="YYYY-MM-DD HH:mm" />
        <PrimaryButton title="Guardar tarea" icon="content-save" onPress={saveTask} disabled={saving || !taskTitle.trim()} />
      </DetailSection>
    </ScrollView>
  );
}

function ContactCard({ item, onOpen, onCall }) {
  const { width } = useWindowDimensions();
  const compactActions = width < 430;
  const initials = String(item.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <Pressable style={({ pressed }) => [styles.card, styles.entityCard, pressed && styles.cardPressed]} onPress={() => onOpen?.(item.id)}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{initials || '?'}</Text></View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.name || 'Sin nombre'}</Text>
        <Text style={styles.meta} numberOfLines={1}>{item.org_name || item.email || 'Sin organizacion'}</Text>
        <Text style={styles.meta}>{item.phone || 'Sin telefono'}</Text>
      </View>
      <View style={styles.entityActions}>
        <PrimaryButton title={compactActions ? "" : "Llamar"} accessibilityLabel="Llamar" compact={compactActions} icon="phone" variant="secondary" disabled={!item.phone} onPress={() => onCall?.(item)} />
        <PrimaryButton title={compactActions ? "" : "WhatsApp"} accessibilityLabel="WhatsApp" compact={compactActions} icon="whatsapp" variant="secondary" disabled={!item.phone} onPress={() => openWhatsapp(item.phone).catch(showError)} />
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accent} />
    </Pressable>
  );
}

function ContactsScreen({ navigation }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '', org_id: '' });
  const [orgQuery, setOrgQuery] = useState('');
  const [orgSuggestions, setOrgSuggestions] = useState([]);
  const [searchingOrg, setSearchingOrg] = useState(false);

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
    const timer = setTimeout(load, q.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  useEffect(() => {
    let active = true;
    const query = orgQuery.trim();
    if (query.length < 1) {
      setOrgSuggestions([]);
      setSearchingOrg(false);
      return undefined;
    }
    setSearchingOrg(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await api.searchOrganizations(query);
        if (active) setOrgSuggestions(Array.isArray(rows) ? rows : rows?.items || []);
      } catch {
        if (active) setOrgSuggestions([]);
      } finally {
        if (active) setSearchingOrg(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [orgQuery]);

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
      setOrgQuery('');
      setOrgSuggestions([]);
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

  async function callContactFromList(item) {
    try {
      await startAssistedCallFromList({
        navigation, phone: item.phone, orgId: item.org_id, contactId: item.id, name: item.name,
      });
    } catch (error) {
      showError(error, 'No se pudo iniciar la llamada');
    }
  }
  const openContactDetail = useCallback(async (id) => {
    setLoading(true);
    try {
      setSelectedId(id);
      setDetail(await api.mobileContact(id));
    } catch (e) {
      showError(e, 'No se pudo abrir contacto');
    } finally {
      setLoading(false);
    }
  }, []);

  if (detail?.contact) {
    return (
      <Screen>
        <FollowupEntityDetail
          entityType="contact"
          entity={detail.contact}
          followup={detail.followup}
          onClose={() => { setDetail(null); setSelectedId(null); }}
          onReload={() => openContactDetail(selectedId)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ContactCard item={item} onOpen={openContactDetail} onCall={callContactFromList} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={styles.title}>Contactos</Text>
            <SuggestionBox
              label="Buscar contacto"
              value={q}
              onChangeText={setQ}
              placeholder="Nombre, organizacion, telefono o correo"
              suggestions={q.trim() ? items : []}
              loading={loading}
              onSelect={(item) => {
                setQ(item.name || '');
                openContactDetail(item.id);
              }}
              renderSuggestion={(item) => (
                <View>
                  <Text style={styles.inlineItem}>{item.name || 'Sin nombre'}</Text>
                  <Text style={styles.meta}>{item.org_name || item.phone || item.email || 'Contacto'}</Text>
                </View>
              )}
            />
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
                <SuggestionBox
                  label="Organizacion"
                  value={orgQuery}
                  onChangeText={(value) => {
                    setOrgQuery(value);
                    setForm((prev) => ({ ...prev, org_id: '' }));
                  }}
                  placeholder="Buscar organizacion existente"
                  suggestions={orgSuggestions}
                  loading={searchingOrg}
                  onSelect={(org) => {
                    setOrgQuery(org.name || org.razon_social || '');
                    setOrgSuggestions([]);
                    setForm((prev) => ({ ...prev, org_id: String(org.id) }));
                  }}
                  renderSuggestion={(org) => (
                    <View>
                      <Text style={styles.inlineItem}>{org.name || org.razon_social || 'Sin nombre'}</Text>
                      <Text style={styles.meta}>{org.ruc || org.email || 'Seleccionar organizacion'}</Text>
                    </View>
                  )}
                />
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

function OrganizationCard({ item, onOpen, onCall }) {
  const { width } = useWindowDimensions();
  const compactActions = width < 430;
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
    <Pressable style={({ pressed }) => [styles.card, styles.entityCard, pressed && styles.cardPressed]} onPress={() => onOpen?.(item.id)}>
      <View style={styles.entityIcon}><MaterialCommunityIcons name="office-building" size={23} color={colors.accent} /></View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.name || item.razon_social || 'Sin nombre'}</Text>
        <Text style={styles.meta} numberOfLines={1}>{item.ruc || item.email || 'Sin RUC/email'}</Text>
        <Text style={styles.meta}>{item.phone || 'Sin telefono'}</Text>
        {open ? (
          <View style={styles.inlineList}>
            {!contacts.length ? <Text style={styles.meta}>Sin contactos asociados</Text> : null}
            {contacts.map((contact) => (
              <Text key={contact.id} style={styles.inlineItem}>{contact.name} {contact.phone ? `· ${contact.phone}` : ''}</Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.entityActions}>
        <PrimaryButton title={compactActions ? "" : "Llamar"} accessibilityLabel="Llamar" compact={compactActions} icon="phone" variant="secondary" disabled={!item.phone} onPress={() => onCall?.(item)} />
        <PrimaryButton title={compactActions ? "" : "Contactos"} accessibilityLabel="Ver contactos" compact={compactActions} icon="account-group" variant="secondary" onPress={toggleContacts} />
      </View>
      <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-right"} size={22} color={colors.accent} />
    </Pressable>
  );
}

function OrganizationsScreen({ navigation }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
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
    const timer = setTimeout(load, q.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

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

  async function callOrganizationFromList(item) {
    try {
      await startAssistedCallFromList({
        navigation, phone: item.phone, orgId: item.id, name: item.name || item.razon_social,
      });
    } catch (error) {
      showError(error, 'No se pudo iniciar la llamada');
    }
  }
  const openOrganizationDetail = useCallback(async (id) => {
    setLoading(true);
    try {
      setSelectedId(id);
      setDetail(await api.mobileOrganization(id));
    } catch (e) {
      showError(e, 'No se pudo abrir organizacion');
    } finally {
      setLoading(false);
    }
  }, []);

  async function openAssociatedContact(contactId) {
    setDetail(null);
    setSelectedId(null);
    // Mantiene la navegacion simple: abre el contacto dentro de la misma vista con datos completos.
    setLoading(true);
    try {
      const contactDetail = await api.mobileContact(contactId);
      setDetail({ organization: null, contactDetail });
    } catch (e) {
      showError(e, 'No se pudo abrir contacto');
    } finally {
      setLoading(false);
    }
  }

  if (detail?.contactDetail?.contact) {
    return (
      <Screen>
        <FollowupEntityDetail
          entityType="contact"
          entity={detail.contactDetail.contact}
          followup={detail.contactDetail.followup}
          onClose={() => setDetail(null)}
          onReload={() => openAssociatedContact(detail.contactDetail.contact.id)}
        />
      </Screen>
    );
  }

  if (detail?.organization) {
    return (
      <Screen>
        <FollowupEntityDetail
          entityType="organization"
          entity={detail.organization}
          contacts={detail.contacts || []}
          followup={detail.followup}
          onClose={() => { setDetail(null); setSelectedId(null); }}
          onReload={() => openOrganizationDetail(selectedId)}
          openContact={openAssociatedContact}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <OrganizationCard item={item} onOpen={openOrganizationDetail} onCall={callOrganizationFromList} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={styles.title}>Organizaciones</Text>
            <SuggestionBox
              label="Buscar organizacion"
              value={q}
              onChangeText={setQ}
              placeholder="Nombre, razon social o RUC"
              suggestions={q.trim() ? items : []}
              loading={loading}
              onSelect={(item) => {
                setQ(item.name || item.razon_social || '');
                openOrganizationDetail(item.id);
              }}
              renderSuggestion={(item) => (
                <View>
                  <Text style={styles.inlineItem}>{item.name || item.razon_social || 'Sin nombre'}</Text>
                  <Text style={styles.meta}>{item.ruc || item.email || item.phone || 'Organizacion'}</Text>
                </View>
              )}
            />
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

function ChoiceButton({ active, label, icon, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.choice, active && styles.choiceActive, pressed && styles.choicePressed]}>
      {icon ? <MaterialCommunityIcons name={icon} size={17} color={active ? '#fff' : colors.muted} /> : null}
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
      {active ? <MaterialCommunityIcons name="check-circle" size={15} color="#fff" /> : null}
    </Pressable>
  );
}

function DetailSection({ open, title, onToggle, children }) {
  const normalized = String(title || '').toLowerCase();
  const icon = normalized.includes('adjunt') ? 'paperclip'
    : normalized.includes('producto') ? 'cube-outline'
      : normalized.includes('servicio') ? 'tools'
        : normalized.includes('presupuesto') || normalized.includes('resultado') ? 'chart-pie'
          : normalized.includes('seguimiento') ? 'phone-clock'
            : normalized.includes('tarea') ? 'calendar-check'
              : normalized.includes('nota') ? 'note-text-outline'
                : 'clipboard-text-outline';
  return (
    <View style={styles.detailSection}>
      <Pressable style={styles.sectionToggle} onPress={onToggle}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIcon}><MaterialCommunityIcons name={icon} size={18} color={colors.accent} /></View>
          <Text style={styles.sectionToggleText}>{title}</Text>
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.ink} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function OptionChips({ options, value, onChange }) {
  if (!options?.length) return null;
  return (
    <View style={styles.choiceRow}>
      {options.map((option, idx) => {
        const key = String(option?.value ?? option?.id ?? option?.label ?? option ?? idx);
        const label = String(option?.label ?? option?.name ?? option?.value ?? option);
        const optionValue = String(option?.value ?? option?.id ?? option);
        return (
          <ChoiceButton
            key={`${key}-${idx}`}
            active={String(value || '') === optionValue}
            label={label.slice(0, 42)}
            icon={option?.icon}
            onPress={() => onChange(optionValue, option)}
          />
        );
      })}
    </View>
  );
}

const INDUSTRIAL_SELECT_OPTIONS = {
  canvas_type: ['X-Force', 'Vinil'],
  frame_material: ['Mamposteria', 'Isopanel'],
  finish: ['Pintado', 'Galvanizado', 'Inox'],
  side_install: ['Interior', 'Exterior'],
  motor_side: ['Derecha', 'Izquierda', 'Superior', 'Sin definir'],
  actuator_type: ['Botonera', 'Lazo inductivo', 'Tirador', 'Sensor', 'Botonera No touch'],
};

function OperationListScreen({ route, navigation }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(route?.params?.operationId || null);
  const [detail, setDetail] = useState(null);
  const [detailForm, setDetailForm] = useState({});
  const [detailBaseline, setDetailBaseline] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [industrialDoors, setIndustrialDoors] = useState([]);
  const [doorForm, setDoorForm] = useState({});
  const [editingDoorId, setEditingDoorId] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sectionOpen, setSectionOpen] = useState({
    resumen: true,
    datos: true,
    presupuesto: true,
    productos: true,
    servicios: false,
    adjuntos: true,
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.mobileOperations(q));
    } catch (e) {
      showError(e, 'No se pudieron cargar operaciones');
    } finally {
      setLoading(false);
    }
  }, [q]);

  const loadIndustrialData = useCallback(async (dealId) => {
    if (!dealId) return;
    try {
      const [catalog, doors] = await Promise.all([
        api.catalogItems().catch(() => []),
        api.industrialDoors(dealId).catch(() => []),
      ]);
      setCatalogItems(Array.isArray(catalog) ? catalog : Array.isArray(catalog?.items) ? catalog.items : []);
      setIndustrialDoors(Array.isArray(doors) ? doors : []);
    } catch {
      setCatalogItems([]);
      setIndustrialDoors([]);
    }
  }, []);

  function parseJsonField(value, fallback = []) {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.mobileOperation(id);
      const fieldValue = (key) => {
        const row = (data?.custom_fields || []).find((field) => field.key === key);
        return row?.value || '';
      };
      const cargoDetail = data?.cargo_detail || {};
      setDetail(data);
      setCatalogItems([
        ...(Array.isArray(data?.catalog_products) ? data.catalog_products : []),
        ...(Array.isArray(data?.catalog_services) ? data.catalog_services : []),
      ]);
      setIndustrialDoors(Array.isArray(data?.industrial_doors) ? data.industrial_doors : []);
      const nextForm = {
        title: data?.deal?.title || '',
        stage_id: data?.deal?.stage_id ? String(data.deal.stage_id) : '',
        modalidad_carga: cargoDetail.modalidad_carga || fieldValue('modalidad_carga'),
        tipo_carga: cargoDetail.tipo_carga || fieldValue('tipo_carga'),
        tipo_operacion: cargoDetail.tipo_operacion || fieldValue('tipo_operacion'),
        origen_pto: cargoDetail.origen_pto || fieldValue('origen_pto'),
        destino_pto: cargoDetail.destino_pto || fieldValue('destino_pto'),
        mercaderia: cargoDetail.mercaderia || fieldValue('mercaderia'),
        cant_bultos: cargoDetail.cant_bultos || fieldValue('cant_bultos'),
        unidad_bultos: cargoDetail.unidad_bultos || fieldValue('unidad_bultos'),
        peso_bruto: cargoDetail.peso_bruto || fieldValue('peso_bruto'),
        vol_m3: cargoDetail.vol_m3 || fieldValue('vol_m3'),
        industrial_brand: fieldValue('industrial_brand'),
        mobile_notes: cargoDetail.mobile_notes || fieldValue('mobile_notes') || fieldValue('industrial_notes'),
        industrial_mobile_services: parseJsonField(fieldValue('industrial_mobile_services')),
      };
      setDetailForm(nextForm);
      setDetailBaseline(JSON.stringify(nextForm));
      if (data?.detail_kind === 'industrial' && (!data?.industrial_doors || !data?.catalog_products)) {
        await loadIndustrialData(id);
      }
      if (data?.detail_kind !== 'industrial') {
        setIndustrialDoors([]);
      }
    } catch (e) {
      showError(e, 'No se pudo cargar la operacion');
    } finally {
      setLoading(false);
    }
  }, [loadIndustrialData]);

  useFocusEffect(
    useCallback(() => {
      loadList();
      const routeId = route?.params?.operationId;
      if (routeId) {
        setSelectedId(routeId);
        loadDetail(routeId);
        navigation.setParams({ operationId: undefined });
      }
    }, [loadList, loadDetail, navigation, route?.params?.operationId])
  );

  async function openOperation(id) {
    setSelectedId(id);
    await loadDetail(id);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailForm({});
    setDetailBaseline('');
    setEditingDoorId(null);
    setDoorForm({});
  }

  function updateDetailField(key, value) {
    setDetailForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDoorField(key, value) {
    setDoorForm((prev) => ({ ...prev, [key]: value }));
  }

  function parseActuatorValue(value = '') {
    const text = String(value || '').trim();
    if (!text) return [];
    return text
      .split(/\s*[;\n,]\s*/)
      .map((part) => {
        const clean = part.trim();
        if (!clean) return null;
        const match = clean.match(/^(.*?)\s*(?:x|\(|-)?\s*(\d+(?:[.,]\d+)?)\)?\s*$/i);
        const rawType = match ? match[1].trim() : clean;
        const found = INDUSTRIAL_SELECT_OPTIONS.actuator_type.find((option) => rawType.toLowerCase().includes(option.toLowerCase()));
        return {
          type: found || rawType,
          quantity: match?.[2] || '',
        };
      })
      .filter((item) => item?.type);
  }

  function formatActuatorValue(actuators = []) {
    const list = Array.isArray(actuators) ? actuators : [];
    return list
      .map((item) => {
        const type = String(item?.type || '').trim();
        const quantity = String(item?.quantity || '').trim();
        if (!type) return '';
        return quantity ? `${type} x ${quantity}` : type;
      })
      .filter(Boolean)
      .join('; ');
  }

  function toggleActuator(type) {
    setDoorForm((prev) => {
      const current = Array.isArray(prev.actuators_list) ? prev.actuators_list : [];
      const exists = current.some((item) => item.type === type);
      const next = exists
        ? current.filter((item) => item.type !== type)
        : [...current, { type, quantity: '1' }];
      return { ...prev, actuators_list: next, actuators: formatActuatorValue(next) };
    });
  }

  function updateActuatorQuantity(type, quantity) {
    setDoorForm((prev) => {
      const current = Array.isArray(prev.actuators_list) ? prev.actuators_list : [];
      const next = current.map((item) => item.type === type ? { ...item, quantity } : item);
      return { ...prev, actuators_list: next, actuators: formatActuatorValue(next) };
    });
  }

  async function saveDetail() {
    if (!selectedId || !detail) return;
    setSaving(true);
    try {
      const isIndustrialDetail = detail.detail_kind === 'industrial';
      const isContainerDetail = detail.detail_kind === 'container';
      const fields = isIndustrialDetail
        ? [
            ['industrial_brand', 'Marca industrial principal', 'select', detailForm.industrial_brand],
            ['industrial_notes', 'Notas', 'text', detailForm.mobile_notes],
            ['industrial_mobile_services', 'Servicios seleccionados desde mobile', 'text', JSON.stringify(detailForm.industrial_mobile_services || [])],
          ]
        : isContainerDetail
          ? [
              ['mobile_notes', 'Notas moviles', 'text', detailForm.mobile_notes],
            ]
          : [
            ['modalidad_carga', 'Tipo de embarque', 'select', detailForm.modalidad_carga],
            ['tipo_carga', 'Tipo de carga', 'select', detailForm.tipo_carga],
            ['tipo_operacion', 'Tipo de operacion', 'select', detailForm.tipo_operacion],
            ['origen_pto', 'Origen', 'text', detailForm.origen_pto],
            ['destino_pto', 'Destino', 'text', detailForm.destino_pto],
            ['mercaderia', 'Mercaderia', 'text', detailForm.mercaderia],
            ['cant_bultos', 'Cantidad', 'number', detailForm.cant_bultos],
            ['unidad_bultos', 'Unidad', 'text', detailForm.unidad_bultos],
            ['peso_bruto', 'Peso', 'text', detailForm.peso_bruto],
            ['vol_m3', 'Vol m3', 'text', detailForm.vol_m3],
            ['mobile_notes', 'Notas moviles', 'text', detailForm.mobile_notes],
          ];
      await api.updateMobileOperation(selectedId, {
        title: detailForm.title,
        stage_id: detailForm.stage_id ? Number(detailForm.stage_id) : null,
        custom_fields: fields
          .filter(([, , , value]) => String(value ?? '').trim())
          .map(([key, label, type, value]) => ({ key, label, type, value })),
      });
      if (!isIndustrialDetail && !isContainerDetail && detailForm.modalidad_carga) {
        const mode = String(detailForm.modalidad_carga || '').trim().toLowerCase();
        await api.updateCargoOperation(selectedId, mode, {
          load_type: detailForm.tipo_carga || null,
          operation_type: detailForm.tipo_operacion || null,
          origin: detailForm.origen_pto || null,
          destination: detailForm.destino_pto || null,
          commodity: detailForm.mercaderia || null,
          packages: detailForm.cant_bultos || null,
          package_unit: detailForm.unidad_bultos || null,
          gross_weight: detailForm.peso_bruto || null,
          volume: detailForm.vol_m3 || null,
          notes: detailForm.mobile_notes || null,
        }).catch(() => null);
      }
      await loadDetail(selectedId);
      await loadList();
      Alert.alert('ATMCARGOSISTEM', 'Operacion actualizada');
    } catch (e) {
      showError(e, 'No se pudo guardar la operacion');
    } finally {
      setSaving(false);
    }
  }

  const productCatalogItems = catalogItems.filter((item) => String(item.type || '').toUpperCase() === 'PRODUCTO');
  const serviceCatalogItems = catalogItems.filter((item) => String(item.type || '').toUpperCase() === 'SERVICIO');
  const brandOptions = [...new Set([
    ...productCatalogItems.map((item) => item.brand),
    ...serviceCatalogItems.map((item) => item.brand),
  ].filter(Boolean))].map((brand) => ({ value: brand, label: brand }));
  const filteredProductCatalog = productCatalogItems
    .filter((item) => {
      const qText = productSearch.trim().toLowerCase();
      if (!qText) return true;
      return [item.name, item.sku, item.brand, item.category].filter(Boolean).join(' ').toLowerCase().includes(qText);
    })
    .slice(0, 20);
  const filteredServiceCatalog = serviceCatalogItems
    .filter((item) => {
      const qText = serviceSearch.trim().toLowerCase();
      if (!qText) return true;
      return [item.name, item.sku, item.brand, item.category].filter(Boolean).join(' ').toLowerCase().includes(qText);
    })
    .slice(0, 20);

  function startDoorEdit(door = null) {
    const actuatorsList = parseActuatorValue(door?.actuators || '');
    setEditingDoorId(door?.id || 'new');
    setDoorForm({
      product_id: door?.product_id ? String(door.product_id) : '',
      product_name: door?.product_name || '',
      brand: door?.brand || detailForm.industrial_brand || '',
        identifier: door?.identifier || `P${industrialDoors.length + 1}`,
        quantity: door?.quantity ? String(door.quantity) : '1',
        place: door?.place || door?.identifier || '',
        width_available: door?.width_available ? String(door.width_available) : '',
      height_available: door?.height_available ? String(door.height_available) : '',
      overheight_available: door?.overheight_available ? String(door.overheight_available) : '',
      side_install: door?.side_install || '',
      frame_type: door?.frame_type || '',
      canvas_type: door?.canvas_type || '',
      frame_material: door?.frame_material || '',
      finish: door?.finish || '',
      clearance_right: door?.clearance_right ? String(door.clearance_right) : '',
      clearance_left: door?.clearance_left ? String(door.clearance_left) : '',
      motor_side: door?.motor_side || '',
      actuators: door?.actuators || '',
      actuators_list: actuatorsList,
      visor_lines: door?.visor_lines || '',
      right_leg: door?.right_leg || '',
      notes: door?.notes || '',
    });
  }

  function selectDoorProduct(productId) {
    const product = productCatalogItems.find((item) => String(item.id) === String(productId));
    setDoorForm((prev) => ({
      ...prev,
      product_id: product?.id ? String(product.id) : '',
      product_name: product?.name || '',
      brand: product?.brand || prev.brand || '',
    }));
  }

  async function saveDoor() {
    if (!selectedId || !editingDoorId) return;
    setSaving(true);
    try {
      const payload = {
        product_id: doorForm.product_id ? Number(doorForm.product_id) : null,
        product_name: doorForm.product_name || null,
        brand: doorForm.brand || null,
        identifier: doorForm.identifier || null,
      quantity: doorForm.quantity || null,
        place: doorForm.place || doorForm.identifier || null,
      width_available: doorForm.width_available || null,
        height_available: doorForm.height_available || null,
        overheight_available: doorForm.overheight_available || null,
        side_install: doorForm.side_install || null,
        frame_type: doorForm.frame_type || null,
        canvas_type: doorForm.canvas_type || null,
        frame_material: doorForm.frame_material || null,
        finish: doorForm.finish || null,
        clearance_right: doorForm.clearance_right || null,
        clearance_left: doorForm.clearance_left || null,
        motor_side: doorForm.motor_side || null,
        actuators: formatActuatorValue(doorForm.actuators_list) || doorForm.actuators || null,
        visor_lines: doorForm.visor_lines || null,
        right_leg: doorForm.right_leg || null,
        notes: doorForm.notes || null,
      };
      const wasNewDoor = editingDoorId === 'new';
      if (editingDoorId === 'new') {
        await api.createIndustrialDoor(selectedId, payload);
      } else {
        await api.updateIndustrialDoor(editingDoorId, payload);
      }
      setEditingDoorId(null);
      setDoorForm({});
      await Promise.all([
        loadIndustrialData(selectedId),
        loadDetail(selectedId),
      ]);
      Alert.alert('ATMCARGOSISTEM', wasNewDoor ? 'Producto guardado' : 'Producto actualizado');
    } catch (e) {
      showError(e, 'No se pudo guardar el producto industrial');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoor(doorId) {
    setSaving(true);
    try {
      await api.deleteIndustrialDoor(doorId);
      await loadIndustrialData(selectedId);
    } catch (e) {
      showError(e, 'No se pudo eliminar el producto industrial');
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoorImage(doorId, asset) {
    if (!doorId || !asset) return;
    const form = new FormData();
    const preparedAsset = await prepareImageForUpload(asset, `producto-${doorId}.jpg`);
    const imagePart = imageUploadPart(preparedAsset, `producto-${doorId}.jpg`);
    form.append('image', imagePart);
    setSaving(true);
    try {
      await api.uploadIndustrialDoorImage(doorId, form);
      await loadIndustrialData(selectedId);
    } catch (e) {
      showError(e, 'No se pudo subir la imagen al producto');
    } finally {
      setSaving(false);
    }
  }

  async function pickDoorCamera(doorId) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ATMCARGOSISTEM', 'Permiso de camara requerido');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
    if (!result.canceled && result.assets?.[0]) uploadDoorImage(doorId, result.assets[0]);
  }

  async function pickDoorImage(doorId) {
    const allowed = await ensureMediaLibraryPermission();
    if (!allowed) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) uploadDoorImage(doorId, result.assets[0]);
  }

  function toggleIndustrialService(item) {
    setDetailForm((prev) => {
      const current = Array.isArray(prev.industrial_mobile_services) ? prev.industrial_mobile_services : [];
      const exists = current.some((service) => String(service.id) === String(item.id));
      const next = exists
        ? current.filter((service) => String(service.id) !== String(item.id))
        : [...current, { id: item.id, name: item.name, sku: item.sku || '', brand: item.brand || '', notes: '' }];
      return { ...prev, industrial_mobile_services: next };
    });
  }

  async function uploadDetailAsset(asset) {
    if (!selectedId) return;
    const preparedAsset = await prepareImageForUpload(asset, 'archivo.jpg');
    const uri = preparedAsset.uri;
    const name = preparedAsset.name || preparedAsset.fileName || uri?.split('/').pop() || 'archivo';
    const mimeType = preparedAsset.mimeType || preparedAsset.type || 'application/octet-stream';
    const form = new FormData();
    form.append('entity_type', 'deal');
    form.append('entity_id', String(selectedId));
    form.append('type', 'mobile');
    form.append('file', { uri, name, type: mimeType });
    setSaving(true);
    try {
      await api.uploadAttachment(form);
      await loadDetail(selectedId);
    } catch (e) {
      showError(e, 'No se pudo adjuntar archivo');
    } finally {
      setSaving(false);
    }
  }

  async function pickDetailCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ATMCARGOSISTEM', 'Permiso de camara requerido');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
    if (!result.canceled && result.assets?.[0]) uploadDetailAsset(result.assets[0]);
  }

  async function pickDetailImage() {
    const allowed = await ensureMediaLibraryPermission();
    if (!allowed) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) uploadDetailAsset(result.assets[0]);
  }

  async function pickDetailDocument() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) uploadDetailAsset(result.assets[0]);
  }

  const isIndustrial = String(detail?.deal?.business_unit_key || '').toLowerCase() === 'atm-industrial';
  const detailKind = detail?.detail_kind || (isIndustrial ? 'industrial' : 'cargo');
  const isIndustrialDetail = detailKind === 'industrial';
  const isContainerDetail = detailKind === 'container';
  const hasUnsavedChanges = !!detail && JSON.stringify(detailForm) !== detailBaseline;

  function toggleSection(key) {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {!detail ? (
          <>
        <Text style={styles.title}>Operaciones</Text>
        <SuggestionBox
          label="Buscar operacion"
          value={q}
          onChangeText={setQ}
          placeholder="Referencia, cliente, contacto o titulo"
          suggestions={q.trim() ? items : []}
          loading={loading}
          onSelect={(item) => {
            setQ(item.reference || item.title || '');
            openOperation(item.id);
          }}
          renderSuggestion={(item) => (
            <View>
              <Text style={styles.inlineItem}>{item.reference || `OP #${item.id}`}</Text>
              <Text style={styles.meta}>{item.org_name || item.contact_name || item.title || 'Operacion'}</Text>
            </View>
          )}
        />
        {!items.length && !loading ? <EmptyState text="Sin operaciones para mostrar" /> : null}
        {items.map((item) => (
          <Pressable key={item.id} style={({ pressed }) => [styles.card, styles.operationCard, String(selectedId) === String(item.id) && styles.selectedCard, pressed && styles.cardPressed]} onPress={() => openOperation(item.id)}>
            <View style={styles.entityIcon}><MaterialCommunityIcons name="clipboard-list" size={22} color={colors.accent} /></View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{item.reference || `OP #${item.id}`}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.org_name || item.contact_name || item.title || 'Sin cliente'}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.business_unit_name || '-'}</Text>
            </View>
            <View style={styles.cardAside}>
              <View style={styles.stagePill}><Text style={styles.stagePillText}>{item.stage_name || 'Sin etapa'}</Text></View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accent} />
            </View>
          </Pressable>
        ))}

          </>
        ) : null}

        {detail ? (
          <View style={styles.formPanel}>
            <View style={styles.detailHeader}>
              <PrimaryButton title="Volver" icon="arrow-left" variant="secondary" onPress={closeDetail} disabled={saving} />
              <View style={[styles.statusPill, hasUnsavedChanges && styles.statusPillDirty]}>
                <Text style={[styles.statusPillText, hasUnsavedChanges && styles.statusPillDirtyText]}>
                  {hasUnsavedChanges ? 'Cambios sin guardar' : 'Guardado'}
                </Text>
              </View>
            </View>
            <DetailSection open={sectionOpen.resumen !== false} title="Resumen" onToggle={() => toggleSection('resumen')}>
              <Text style={styles.sectionTitle}>{detail.deal?.reference || `OP #${selectedId}`}</Text>
              <Text style={styles.meta}>{detail.deal?.org_name || 'Sin organizacion'} {detail.deal?.contact_name ? `· ${detail.deal.contact_name}` : ''}</Text>
              <Text style={styles.meta}>{detail.deal?.business_unit_name || '-'} · {detail.deal?.pipeline_name || '-'}</Text>
              <Field label="Titulo" value={detailForm.title} onChangeText={(v) => setDetailForm({ ...detailForm, title: v })} placeholder="Titulo operativo" />
              <Text style={styles.label}>Etapa</Text>
              <View style={styles.choiceRow}>
                {(detail.stages || []).map((stage) => (
                  <ChoiceButton
                    key={stage.id}
                    active={String(detailForm.stage_id) === String(stage.id)}
                    label={stage.name}
                    onPress={() => setDetailForm({ ...detailForm, stage_id: String(stage.id) })}
                  />
                ))}
              </View>
            </DetailSection>

            <DetailSection open={sectionOpen.datos !== false} title="Datos de operacion" onToggle={() => toggleSection('datos')}>
              {isContainerDetail ? (
                <Text style={styles.meta}>ATM CONTAINER queda como resumen y adjuntos en esta version mobile. El detalle avanzado se completa en la web.</Text>
              ) : null}
              {isIndustrialDetail ? (
                <>
                <Text style={styles.label}>Marca</Text>
                <OptionChips options={brandOptions} value={detailForm.industrial_brand} onChange={(value) => updateDetailField('industrial_brand', value)} />
                <Field label="Notas para cotizar despues" value={detailForm.mobile_notes} onChangeText={(v) => setDetailForm({ ...detailForm, mobile_notes: v })} placeholder="Datos pendientes, medidas, instrucciones..." multiline />
              </>
              ) : null}
              {!isIndustrialDetail && !isContainerDetail ? (
                <>
                  <Field label="Modalidad" value={detailForm.modalidad_carga} onChangeText={(v) => setDetailForm({ ...detailForm, modalidad_carga: v })} placeholder="AEREO/MARITIMO/TERRESTRE" />
                  <Field label="Tipo de carga" value={detailForm.tipo_carga} onChangeText={(v) => setDetailForm({ ...detailForm, tipo_carga: v })} placeholder="LCL/FCL/FTL/LTL" />
                  <Field label="Tipo de operacion" value={detailForm.tipo_operacion} onChangeText={(v) => setDetailForm({ ...detailForm, tipo_operacion: v })} placeholder="IMPORT/EXPORT/EXTERIOR" />
                  <Field label="Origen" value={detailForm.origen_pto} onChangeText={(v) => setDetailForm({ ...detailForm, origen_pto: v })} placeholder="PY - ASU" />
                  <Field label="Destino" value={detailForm.destino_pto} onChangeText={(v) => setDetailForm({ ...detailForm, destino_pto: v })} placeholder="BR - SSZ" />
                  <Field label="Mercaderia" value={detailForm.mercaderia} onChangeText={(v) => setDetailForm({ ...detailForm, mercaderia: v })} placeholder="Descripcion" />
                  <Field label="Cantidad" value={detailForm.cant_bultos} onChangeText={(v) => setDetailForm({ ...detailForm, cant_bultos: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                  <Field label="Unidad" value={detailForm.unidad_bultos} onChangeText={(v) => setDetailForm({ ...detailForm, unidad_bultos: v })} placeholder="Bultos/Cajas/Pallets" />
                  <Field label="Peso kg" value={detailForm.peso_bruto} onChangeText={(v) => setDetailForm({ ...detailForm, peso_bruto: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                  <Field label="Volumen m3" value={detailForm.vol_m3} onChangeText={(v) => setDetailForm({ ...detailForm, vol_m3: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                  <Field label="Notas para cotizar despues" value={detailForm.mobile_notes} onChangeText={(v) => setDetailForm({ ...detailForm, mobile_notes: v })} placeholder="Datos pendientes, medidas, instrucciones..." multiline />
                </>
              ) : null}
              {isContainerDetail ? (
                <Field label="Notas para cotizar despues" value={detailForm.mobile_notes} onChangeText={(v) => setDetailForm({ ...detailForm, mobile_notes: v })} placeholder="Datos pendientes, instrucciones..." multiline />
              ) : null}
              <PrimaryButton title={saving ? 'Guardando...' : 'Guardar datos'} icon="content-save" onPress={saveDetail} disabled={saving} />
            </DetailSection>

            <DetailSection open={sectionOpen.presupuesto !== false} title="Presupuesto / Resultado" onToggle={() => toggleSection('presupuesto')}>
              {detail.quote ? (
                <>
                  <Text style={styles.cardTitle}>{detail.quote.ref_code || `Presupuesto #${detail.quote.id}`}</Text>
                  <Text style={styles.meta}>{detail.quote.client_name || detail.deal?.org_name || 'Sin cliente'} - {detail.quote.status || 'draft'}</Text>
                  <Text style={styles.meta}>Actualizado: {shortDateTime(detail.quote.updated_at)}</Text>
                  <View style={styles.inlinePanel}>
                    <Text style={styles.label}>Resultado operativo</Text>
                    {detail.quote.summary?.supplier_discount_display ? (
                      <Text style={styles.inlineItem}>
                        Compra productos antes descuento: {money(detail.quote.summary.gross_purchase_display, detail.quote.summary.currency)}
                      </Text>
                    ) : null}
                    {detail.quote.summary?.supplier_discount_display ? (
                      <Text style={styles.inlineItem}>Descuento proveedor: -{money(detail.quote.summary.supplier_discount_display, detail.quote.summary.currency)}</Text>
                    ) : null}
                    {detail.quote.summary?.discount_display ? (
                      <Text style={styles.inlineItem}>Venta antes descuento: {money(detail.quote.summary.gross_sales_display, detail.quote.summary.currency)}</Text>
                    ) : null}
                    {detail.quote.summary?.discount_display ? (
                      <Text style={styles.inlineItem}>Descuento cliente: -{money(detail.quote.summary.discount_display, detail.quote.summary.currency)}</Text>
                    ) : null}
                    <Text style={styles.inlineItem}>Total compra: {money(detail.quote.summary?.total_cost_display, detail.quote.summary?.currency)}</Text>
                    <Text style={styles.inlineItem}>Total venta: {money(detail.quote.summary?.total_sales_display, detail.quote.summary?.currency)}</Text>
                    <Text style={styles.inlineItem}>Profit total: {money(detail.quote.summary?.profit_total_display, detail.quote.summary?.currency)}</Text>
                    {detail.quote.summary?.vendor_profit_display != null || detail.quote.summary?.final_profit_display != null ? (
                      <Text style={styles.inlineItem}>
                        Vendedor: {money(detail.quote.summary?.vendor_profit_display, detail.quote.summary?.currency)} / Final: {money(detail.quote.summary?.final_profit_display, detail.quote.summary?.currency)}
                      </Text>
                    ) : null}
                    <Text style={styles.inlineItem}>Margen: {detail.quote.summary?.margin_percent == null ? '-' : `${Number(detail.quote.summary.margin_percent).toFixed(1)}%`}</Text>
                    <Text style={styles.meta}>TC: {detail.quote.summary?.exchange_rate || '-'}</Text>
                  </View>
                  {detail.quote.summary?.rubros?.length ? (
                    <View style={styles.inlinePanel}>
                      <Text style={styles.label}>Rubros</Text>
                      {detail.quote.summary.rubros.map((row) => (
                        <Text key={row.key} style={styles.inlineItem}>
                          {row.key}: C {money(row.compra_display, detail.quote.summary.currency)} / V {money(row.venta_display, detail.quote.summary.currency)} / P {money(row.profit_display, detail.quote.summary.currency)}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {detail.quote.revisions?.length ? (
                    <View style={styles.inlineList}>
                      <Text style={styles.label}>Revisiones</Text>
                      {detail.quote.revisions.map((rev) => (
                        <Text key={rev.id} style={styles.inlineItem}>{rev.name || `Revision ${rev.id}`} - {shortDateTime(rev.created_at)}</Text>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.actions}>
                    <PrimaryButton
                      title="Abrir PDF"
                      icon="file-pdf-box"
                      variant="secondary"
                      onPress={() => Linking.openURL(authenticatedFileUrl(detail.quote.links?.pdf_url)).catch(showError)}
                    />
                    <PrimaryButton
                      title="Abrir Excel"
                      icon="file-excel"
                      variant="secondary"
                      onPress={() => Linking.openURL(apiUrl(detail.quote.links?.xlsx_url)).catch(showError)}
                    />
                  </View>
                </>
              ) : (
                <Text style={styles.meta}>Esta operacion todavia no tiene presupuesto cargado.</Text>
              )}
            </DetailSection>

            {isIndustrialDetail ? (
              <DetailSection open={sectionOpen.productos !== false} title="Productos industriales" onToggle={() => toggleSection('productos')}>
                <SectionTitle title="Productos industriales" />
                <PrimaryButton title="Agregar producto" icon="plus" variant="secondary" onPress={() => startDoorEdit()} disabled={saving} />
                {industrialDoors.map((door) => (
                  <View key={door.id} style={styles.inlinePanel}>
                    <Text style={styles.cardTitle}>{door.identifier || door.product_name || `Producto #${door.id}`}</Text>
                    <Text style={styles.meta}>{[door.product_name, door.brand].filter(Boolean).join(' · ') || 'Sin producto de catalogo'}</Text>
                    <Text style={styles.meta}>
                      Cant: {door.quantity || '-'} · {door.width_available || '-'} x {door.height_available || '-'} mm
                    </Text>
                    <View style={styles.actions}>
                      <PrimaryButton title="Editar" icon="pencil" variant="secondary" onPress={() => startDoorEdit(door)} disabled={saving} />
                      <PrimaryButton title="Foto producto" icon="camera" variant="secondary" onPress={() => pickDoorCamera(door.id)} disabled={saving} />
                      <PrimaryButton title="Galeria producto" icon="image" variant="secondary" onPress={() => pickDoorImage(door.id)} disabled={saving} />
                      <PrimaryButton title="Eliminar" icon="trash-can" variant="danger" onPress={() => deleteDoor(door.id)} disabled={saving} />
                    </View>
                    {door.images?.length ? (
                      <View style={styles.inlineList}>
                        {door.images.map((image) => (
                          <Text key={image.id} style={styles.inlineItem}>{image.filename}</Text>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.meta}>Sin imagenes de producto</Text>
                    )}
                  </View>
                ))}
                {editingDoorId ? (
                  <View style={styles.inlinePanel}>
                    <Text style={styles.sectionTitle}>{editingDoorId === 'new' ? 'Nuevo producto' : 'Editar producto'}</Text>
                    <Field label="Buscar producto disponible" value={productSearch} onChangeText={setProductSearch} placeholder="Nombre, SKU o marca" />
                    <View style={styles.choiceRow}>
                      {filteredProductCatalog.map((product) => (
                        <ChoiceButton
                          key={product.id}
                          active={String(doorForm.product_id) === String(product.id)}
                          label={[product.sku, product.name].filter(Boolean).join(' - ').slice(0, 36)}
                          onPress={() => selectDoorProduct(product.id)}
                        />
                      ))}
                    </View>
                    <Text style={styles.meta}>Producto seleccionado: {doorForm.product_name || 'Selecciona un producto del catalogo'}</Text>
                    <Text style={styles.label}>Marca</Text>
                    <OptionChips options={brandOptions} value={doorForm.brand} onChange={(value) => updateDoorField('brand', value)} />
                    <Field label="Identificacion / lugar" value={doorForm.identifier} onChangeText={(v) => setDoorForm({ ...doorForm, identifier: v, place: v })} placeholder="P1, Acceso principal..." />
                    <Field label="Cantidad" value={doorForm.quantity} onChangeText={(v) => setDoorForm({ ...doorForm, quantity: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Field label="Ancho mm" value={doorForm.width_available} onChangeText={(v) => setDoorForm({ ...doorForm, width_available: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Field label="Alto mm" value={doorForm.height_available} onChangeText={(v) => setDoorForm({ ...doorForm, height_available: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Field label="Sobrealtura mm" value={doorForm.overheight_available} onChangeText={(v) => setDoorForm({ ...doorForm, overheight_available: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Field label="Tipo de puerta" value={doorForm.frame_type} onChangeText={(v) => setDoorForm({ ...doorForm, frame_type: v })} placeholder="SECCIONAL, VECTOR FLEX..." />
                    <Text style={styles.label}>Tipo de lona</Text>
                    <OptionChips options={INDUSTRIAL_SELECT_OPTIONS.canvas_type} value={doorForm.canvas_type} onChange={(value) => updateDoorField('canvas_type', value)} />
                    <Text style={styles.label}>Tipo de marco</Text>
                    <OptionChips options={INDUSTRIAL_SELECT_OPTIONS.frame_material} value={doorForm.frame_material} onChange={(value) => updateDoorField('frame_material', value)} />
                    <Text style={styles.label}>Acabado</Text>
                    <OptionChips options={INDUSTRIAL_SELECT_OPTIONS.finish} value={doorForm.finish} onChange={(value) => updateDoorField('finish', value)} />
                    <Text style={styles.label}>Lado instalacion</Text>
                    <OptionChips options={INDUSTRIAL_SELECT_OPTIONS.side_install} value={doorForm.side_install} onChange={(value) => updateDoorField('side_install', value)} />
                    <Text style={styles.label}>Lado motor</Text>
                    <OptionChips options={INDUSTRIAL_SELECT_OPTIONS.motor_side} value={doorForm.motor_side} onChange={(value) => updateDoorField('motor_side', value)} />
                    <Field label="Espacio derecho mm" value={doorForm.clearance_right} onChangeText={(v) => setDoorForm({ ...doorForm, clearance_right: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Field label="Espacio izquierdo mm" value={doorForm.clearance_left} onChangeText={(v) => setDoorForm({ ...doorForm, clearance_left: v.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" />
                    <Text style={styles.label}>Actuadores</Text>
                    <View style={styles.choiceRow}>
                      {INDUSTRIAL_SELECT_OPTIONS.actuator_type.map((type) => {
                        const active = (doorForm.actuators_list || []).some((item) => item.type === type);
                        return (
                          <ChoiceButton
                            key={type}
                            active={active}
                            label={type}
                            onPress={() => toggleActuator(type)}
                          />
                        );
                      })}
                    </View>
                    {(doorForm.actuators_list || []).map((item) => (
                      <Field
                        key={item.type}
                        label={`Cantidad - ${item.type}`}
                        value={item.quantity}
                        onChangeText={(v) => updateActuatorQuantity(item.type, v.replace(/[^\d.,]/g, ''))}
                        keyboardType="decimal-pad"
                      />
                    ))}
                    <Field label="Visores" value={doorForm.visor_lines} onChangeText={(v) => setDoorForm({ ...doorForm, visor_lines: v })} placeholder="Cantidad/lineas" />
                    <Field label="Pie derecho" value={doorForm.right_leg} onChangeText={(v) => setDoorForm({ ...doorForm, right_leg: v })} placeholder="Detalle" />
                    <Field label="Notas del producto" value={doorForm.notes} onChangeText={(v) => setDoorForm({ ...doorForm, notes: v })} placeholder="Datos utiles para cotizar" multiline />
                    <View style={styles.actions}>
                      <PrimaryButton title={saving ? 'Guardando...' : 'Guardar producto'} icon="content-save" onPress={saveDoor} disabled={saving} />
                      <PrimaryButton title="Cancelar" icon="close" variant="secondary" onPress={() => { setEditingDoorId(null); setDoorForm({}); }} disabled={saving} />
                    </View>
                  </View>
                ) : null}
              </DetailSection>
            ) : null}

            {isIndustrialDetail ? (
              <DetailSection open={sectionOpen.servicios !== false} title="Servicios" onToggle={() => toggleSection('servicios')}>
                <SectionTitle title="Servicios del catalogo" />
                <Field label="Buscar servicio" value={serviceSearch} onChangeText={setServiceSearch} placeholder="Servicio disponible" />
                <View style={styles.choiceRow}>
                  {filteredServiceCatalog.map((service) => {
                    const active = (detailForm.industrial_mobile_services || []).some((item) => String(item.id) === String(service.id));
                    return (
                      <ChoiceButton
                        key={service.id}
                        active={active}
                        label={(service.name || service.sku || `Servicio ${service.id}`).slice(0, 36)}
                        onPress={() => toggleIndustrialService(service)}
                      />
                    );
                  })}
                </View>
                {(detailForm.industrial_mobile_services || []).map((service) => (
                  <Text key={service.id} style={styles.inlineItem}>{service.name}</Text>
                ))}
              </DetailSection>
            ) : null}

            <DetailSection open={sectionOpen.adjuntos !== false} title="Adjuntos" onToggle={() => toggleSection('adjuntos')}>
              <Text style={styles.meta}>Adjunto general: queda asociado a la operacion en deal_files.</Text>
              <View style={styles.actions}>
                <PrimaryButton title="Camara" icon="camera" variant="secondary" onPress={pickDetailCamera} disabled={saving} />
                <PrimaryButton title="Galeria" icon="image" variant="secondary" onPress={pickDetailImage} disabled={saving} />
                <PrimaryButton title="Documento" icon="file-upload" variant="secondary" onPress={pickDetailDocument} disabled={saving} />
              </View>
              <SectionTitle title="Adjuntos" />
              {!(detail.files || []).length ? <Text style={styles.meta}>Sin adjuntos</Text> : null}
              {(detail.files || []).map((file) => (
                <Text key={file.id} style={styles.inlineItem}>{file.filename}</Text>
              ))}
            </DetailSection>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
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
        placeholderTextColor={colors.placeholder}
      />
      {loading ? <Text style={styles.meta}>Buscando...</Text> : null}
      {!!suggestions.length ? (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 6).map((item, idx) => (
            <Pressable
              key={String(item.id || `${item.value || item.code || item.name || 'suggestion'}-${item.type || ''}-${item.country_iso2 || ''}-${idx}`)}
              onPress={() => onSelect(item)}
              style={styles.suggestionItem}
            >
              {renderSuggestion ? renderSuggestion(item) : <Text style={styles.inlineItem}>{item.name}</Text>}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OperationsScreen({ navigation }) {
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
    stage_id: '',
    origin: '',
    origin_country_iso2: '',
    origin_code: '',
    destination: '',
    destination_country_iso2: '',
    destination_code: '',
    commodity: '',
    quantity: '',
    unit: 'Bultos',
    weight: '',
    volume: '',
    industrial_brand: '',
    notes: '',
  });
  const [orgSuggestions, setOrgSuggestions] = useState([]);
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [searchingOrg, setSearchingOrg] = useState(false);
  const [searchingContact, setSearchingContact] = useState(false);
  const [defaults, setDefaults] = useState(null);
  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [brandSuggestions, setBrandSuggestions] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadDefaults = useCallback(async () => {
    try {
      const data = await api.operationDefaults(form.business_unit_key);
      setDefaults(data);
      setForm((prev) => {
        const stages = data?.stages || [];
        const next = { ...prev };
        if (!stages.some((stage) => String(stage.id) === String(prev.stage_id))) {
          next.stage_id = data?.stage_id ? String(data.stage_id) : '';
        }
        if (prev.business_unit_key === 'atm-industrial' && !prev.industrial_brand) {
          next.industrial_brand = data?.options?.industrial?.brands?.[0] || '';
        }
        const loadTypes = data?.options?.cargo?.load_types?.[prev.modality] || [];
        if (prev.business_unit_key === 'atm-cargo' && loadTypes.length && !loadTypes.includes(prev.cargo_class)) {
          next.cargo_class = loadTypes[0];
        }
        return next;
      });
    } catch (e) {
      showError(e, 'No se pudo cargar configuracion de operaciones');
    }
  }, [form.business_unit_key]);

  useFocusEffect(
    useCallback(() => {
      loadDefaults();
    }, [loadDefaults])
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

  const cargoOptions = defaults?.options?.cargo || {};
  const industrialOptions = defaults?.options?.industrial || {};
  const stages = defaults?.stages || [];
  const loadTypes = cargoOptions.load_types?.[form.modality] || [];
  const operationTypes = cargoOptions.operation_types || [
    { value: 'IMPORT', label: 'IMPORT' },
    { value: 'EXPORT', label: 'EXPORT' },
    { value: 'EXTERIOR', label: 'EXTERIOR' },
  ];
  const unitOptions = cargoOptions.unit_options || ['Bultos', 'Cajas', 'Pallets', 'Contenedores'];
  const locationOptions = cargoOptions.locations || [];

  function resetBusinessUnit(businessUnitKey) {
    const isIndustrial = businessUnitKey === 'atm-industrial';
    setDefaults(null);
    setForm((prev) => ({
      ...prev,
      business_unit_key: businessUnitKey,
      stage_id: '',
      modality: isIndustrial ? 'INDUSTRIAL' : 'AEREO',
      cargo_class: isIndustrial ? '' : 'LCL',
      industrial_brand: isIndustrial ? prev.industrial_brand : prev.industrial_brand,
    }));
  }

  function setCargoMode(mode) {
    const nextLoadTypes = cargoOptions.load_types?.[mode] || [];
    setForm((prev) => ({
      ...prev,
      modality: mode,
      cargo_class: nextLoadTypes.includes(prev.cargo_class) ? prev.cargo_class : nextLoadTypes[0] || '',
      unit: nextLoadTypes[0] === 'FCL' ? 'Contenedores' : prev.unit || 'Bultos',
    }));
  }

  function normalizeNumeric(value) {
    return String(value || '').replace(/[^\d.,]/g, '');
  }

  function findLocationSuggestions(text) {
    const q = String(text || '').trim().toLowerCase();
    if (q.length < 1) return [];
    return locationOptions
      .filter((option) =>
        [option.value, option.label, option.name, option.code, option.country_iso2]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 8);
  }

  function selectLocation(field, option) {
    setForm((prev) => ({
      ...prev,
      [field]: option.value || '',
      [`${field}_country_iso2`]: option.country_iso2 || '',
      [`${field}_code`]: option.code || '',
    }));
    if (field === 'origin') setOriginSuggestions([]);
    if (field === 'destination') setDestinationSuggestions([]);
  }

  async function uploadPendingFiles(dealId) {
    for (const asset of pendingFiles) {
      const preparedAsset = await prepareImageForUpload(asset, 'archivo.jpg');
      const uri = preparedAsset.uri;
      const name = preparedAsset.name || preparedAsset.fileName || uri?.split('/').pop() || 'archivo';
      const mimeType = preparedAsset.mimeType || preparedAsset.type || 'application/octet-stream';
      const body = new FormData();
      body.append('entity_type', 'deal');
      body.append('entity_id', String(dealId));
      body.append('type', 'mobile');
      body.append('file', { uri, name, type: mimeType });
      await api.uploadAttachment(body);
    }
  }

  async function pickPendingCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ATMCARGOSISTEM', 'Permiso de camara requerido');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
    if (!result.canceled && result.assets?.[0]) setPendingFiles((prev) => [...prev, result.assets[0]]);
  }

  async function pickPendingImage() {
    const allowed = await ensureMediaLibraryPermission();
    if (!allowed) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) setPendingFiles((prev) => [...prev, result.assets[0]]);
  }

  async function pickPendingDocument() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) setPendingFiles((prev) => [...prev, result.assets[0]]);
  }

  async function save() {
    if (!form.org_name && !form.contact_name && !form.client_name) {
      Alert.alert('ATMCARGOSISTEM', 'Cliente u organizacion es requerido');
      return;
    }
    if (!form.stage_id) {
      Alert.alert('ATMCARGOSISTEM', 'Elegir etapa del pipeline');
      return;
    }
    setSaving(true);
    try {
      const resolvedDefaults = defaults || (await api.operationDefaults(form.business_unit_key));
      const isIndustrial = form.business_unit_key === 'atm-industrial';
      const safeTitle = isIndustrial
        ? [form.industrial_brand, form.org_name || form.client_name || form.contact_name]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' · ') || 'Operacion industrial'
        : [form.org_name || form.client_name, form.modality, form.commodity]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' · ') || 'Operacion cargo';

      const dealPayload = {
        pipeline_id: resolvedDefaults.pipeline_id,
        stage_id: Number(form.stage_id),
        business_unit_id: resolvedDefaults.business_unit?.id,
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
        cargo_class_hint: isIndustrial ? '' : form.cargo_class,
        origin_hint: isIndustrial ? '' : form.origin,
        destination_hint: isIndustrial ? '' : form.destination,
        commodity_hint: isIndustrial ? '' : form.commodity,
        quantity_hint: form.quantity,
        unit_hint: form.unit,
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
          ['industrial_notes', 'Notas', 'text', form.notes],
        ];
        await Promise.all(
          fields
            .filter(([, , , value]) => String(value || '').trim())
            .map(([key, label, type, value]) => api.addDealCustomField(dealId, { key, label, type, value }))
        );
      } else {
        const mode = form.modality.toUpperCase();
        const cargoFields = [
          ['origen_pais_iso2', 'Pais origen', 'text', form.origin_country_iso2],
          ['origen_codigo', 'Codigo origen', 'text', form.origin_code],
          ['destino_pais_iso2', 'Pais destino', 'text', form.destination_country_iso2],
          ['destino_codigo', 'Codigo destino', 'text', form.destination_code],
          ['mobile_notes', 'Notas moviles', 'text', form.notes],
        ];
        await Promise.all(
          cargoFields
            .filter(([, , , value]) => String(value || '').trim())
            .map(([key, label, type, value]) => api.addDealCustomField(dealId, { key, label, type, value }))
        );
        const payloadByMode = {
          AEREO: {
            origin_airport: form.origin || '',
            destination_airport: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            unit: form.unit || '',
            weight_gross_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          MARITIMO: {
            load_type: form.cargo_class || '',
            pol: form.origin || '',
            pod: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            unit: form.unit || '',
            weight_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          TERRESTRE: {
            cargo_class: form.cargo_class || '',
            origin_city: form.origin || '',
            destination_city: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            unit: form.unit || '',
            weight_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
          MULTIMODAL: {
            cargo_type: form.cargo_class || '',
            origin_port: form.origin || '',
            destination_port: form.destination || '',
            commodity: form.commodity || '',
            packages: form.quantity || '',
            unit: form.unit || '',
            weight_gross_kg: form.weight || '',
            volume_m3: form.volume || '',
          },
        };
        await api.updateCargoOperation(dealId, mode.toLowerCase(), payloadByMode[mode] || payloadByMode.AEREO).catch(() => {});
      }

      if (pendingFiles.length) await uploadPendingFiles(dealId);
      Alert.alert('Operacion creada', deal.reference || `OP #${dealId}`);
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
        origin_country_iso2: '',
        origin_code: '',
        destination: '',
        destination_country_iso2: '',
        destination_code: '',
        commodity: '',
        quantity: '',
        weight: '',
        volume: '',
        notes: '',
      });
      setPendingFiles([]);
      await loadDefaults();
      navigation.navigate('Operaciones', { operationId: dealId });
    } catch (e) {
      showError(e, 'No se pudo crear la operacion');
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
              onPress={() => resetBusinessUnit('atm-cargo')}
            />
            <ChoiceButton
              active={form.business_unit_key === 'atm-industrial'}
              label="ATM INDUSTRIAL"
              onPress={() => resetBusinessUnit('atm-industrial')}
            />
          </View>
          <Text style={styles.label}>Etapa</Text>
          <View style={styles.choiceRow}>
            {stages.map((stage) => (
              <ChoiceButton
                key={stage.id}
                active={String(form.stage_id) === String(stage.id)}
                label={stage.name}
                onPress={() => setForm({ ...form, stage_id: String(stage.id) })}
              />
            ))}
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
                {(cargoOptions.modalities || ['AEREO', 'MARITIMO', 'TERRESTRE', 'MULTIMODAL']).map((mode) => (
                  <ChoiceButton key={mode} active={form.modality === mode} label={mode} onPress={() => setCargoMode(mode)} />
                ))}
              </View>
              <Text style={styles.label}>Tipo de carga</Text>
              <View style={styles.choiceRow}>
                {loadTypes.map((type) => (
                  <ChoiceButton key={type} active={form.cargo_class === type} label={type} onPress={() => setForm({ ...form, cargo_class: type })} />
                ))}
              </View>
              <Text style={styles.label}>Tipo de operacion</Text>
              <View style={styles.choiceRow}>
                {operationTypes.map((type) => (
                  <ChoiceButton key={type.value} active={form.operation_type === type.value} label={type.label || type.value} onPress={() => setForm({ ...form, operation_type: type.value })} />
                ))}
              </View>
              <SuggestionBox
                label="Origen"
                value={form.origin}
                onChangeText={(v) => {
                  setForm({ ...form, origin: v, origin_country_iso2: '', origin_code: '' });
                  setOriginSuggestions(findLocationSuggestions(v));
                }}
                placeholder="PY - ASU"
                suggestions={originSuggestions}
                onSelect={(option) => selectLocation('origin', option)}
                renderSuggestion={(option) => (
                  <View>
                    <Text style={styles.inlineItem}>{option.value}</Text>
                    <Text style={styles.meta}>{option.label}</Text>
                  </View>
                )}
              />
              <SuggestionBox
                label="Destino"
                value={form.destination}
                onChangeText={(v) => {
                  setForm({ ...form, destination: v, destination_country_iso2: '', destination_code: '' });
                  setDestinationSuggestions(findLocationSuggestions(v));
                }}
                placeholder="PY - ASU"
                suggestions={destinationSuggestions}
                onSelect={(option) => selectLocation('destination', option)}
                renderSuggestion={(option) => (
                  <View>
                    <Text style={styles.inlineItem}>{option.value}</Text>
                    <Text style={styles.meta}>{option.label}</Text>
                  </View>
                )}
              />
              <Field label="Mercaderia" value={form.commodity} onChangeText={(v) => setForm({ ...form, commodity: v })} placeholder="Descripcion de carga" />
              <Field label="Cantidad" value={form.quantity} onChangeText={(v) => setForm({ ...form, quantity: normalizeNumeric(v) })} placeholder="Cantidad" keyboardType="decimal-pad" />
              <Text style={styles.label}>Unidad</Text>
              <View style={styles.choiceRow}>
                {unitOptions.map((unit) => (
                  <ChoiceButton key={unit} active={form.unit === unit} label={unit} onPress={() => setForm({ ...form, unit })} />
                ))}
              </View>
              <Field label="Peso kg" value={form.weight} onChangeText={(v) => setForm({ ...form, weight: normalizeNumeric(v) })} placeholder="Peso bruto" keyboardType="decimal-pad" />
              <Field label="Volumen m3" value={form.volume} onChangeText={(v) => setForm({ ...form, volume: normalizeNumeric(v) })} placeholder="Volumen" keyboardType="decimal-pad" />
            </>
          ) : (
            <>
              <Text style={styles.label}>Marca</Text>
              {(industrialOptions.brands || []).length ? (
                <OptionChips
                  options={(industrialOptions.brands || []).map((brand) => ({ value: brand, label: brand }))}
                  value={form.industrial_brand}
                  onChange={(value) => setForm({ ...form, industrial_brand: value })}
                />
              ) : (
                <Text style={styles.meta}>No hay marcas cargadas en productos o servicios activos.</Text>
              )}
            </>
          )}

          <Field label="Notas" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} placeholder="Notas internas" multiline />
          <View style={styles.importPreview}>
            <Text style={styles.label}>Adjuntos para esta operacion</Text>
            <Text style={styles.meta}>{pendingFiles.length ? `${pendingFiles.length} archivo(s) listos para subir` : 'Opcional: se suben al crear la operacion'}</Text>
            <View style={styles.actions}>
              <PrimaryButton title="Camara" icon="camera" variant="secondary" onPress={pickPendingCamera} disabled={saving} />
              <PrimaryButton title="Galeria" icon="image" variant="secondary" onPress={pickPendingImage} disabled={saving} />
              <PrimaryButton title="Documento" icon="file-upload" variant="secondary" onPress={pickPendingDocument} disabled={saving} />
            </View>
            {pendingFiles.map((file, idx) => (
              <Text key={`${file.uri}-${idx}`} style={styles.meta}>{file.name || file.fileName || file.uri?.split('/').pop() || 'archivo'}</Text>
            ))}
          </View>
          <PrimaryButton title={saving ? 'Creando...' : 'Crear operacion'} icon="content-save" onPress={save} disabled={saving} />
        </View>

        {null}
        {null && [].slice(0, 8).map((quote) => (
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

function FollowupCard({ item, onCall, onRegister, onDone }) {
  const name = item.contact_name || item.org_name || 'Sin nombre';
  const phone = item.contact_phone || item.org_phone || '';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{name}</Text>
      <Text style={styles.meta}>{item.title || item.subject || item.last_call_at || 'Seguimiento'}</Text>
      <Text style={styles.meta}>{item.due_at ? `Vence: ${shortDateTime(item.due_at)}` : phone || 'Sin telefono'}</Text>
      <View style={styles.actions}>
        <PrimaryButton title="Llamar" icon="phone" variant="secondary" disabled={!phone} onPress={() => onCall(item)} />
        <PrimaryButton title="Registrar" icon="phone-log" variant="secondary" onPress={() => onRegister(item)} />
        {item.id && item.status === 'pending' ? <PrimaryButton title="Hecha" icon="check" variant="secondary" onPress={() => onDone(item.id)} /> : null}
      </View>
    </View>
  );
}

function FollowupScreen({ route, navigation }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [callDraft, setCallDraft] = useState(null);
  const [pendingCalls, setPendingCalls] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const pendingCall = route?.params?.pendingCall;
    if (!pendingCall?.call_id) return;
    setCallDraft(pendingCall);
    navigation.setParams({ pendingCall: null });
  }, [route?.params?.pendingCall, navigation]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [followup, pending] = await Promise.all([
        api.mobileFollowup(),
        api.followupCalls({ status: 'pending_result', limit: 20 }),
      ]);
      setData(followup);
      setPendingCalls(pending?.rows || []);
    } catch (e) {
      showError(e, 'No se pudo cargar seguimiento');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function draftFromPending(row) {
    return {
      call_id: row.id,
      org_id: row.org_id || null,
      contact_id: row.contact_id || null,
      deal_id: row.deal_id || null,
      phone_number: row.phone_number || '',
      subject: row.subject || 'Llamada',
      happened_at: row.happened_at || localDateTime(0),
      duration_min: row.duration_min || '',
      outcome: row.outcome || 'volver_a_llamar',
      notes: row.notes || '',
      task_title: row.task_title || 'Volver a llamar',
      task_due: row.task_due_at || localDateTime(1),
    };
  }
  function draftFromItem(item) {
    return {
      org_id: item.org_id || null,
      contact_id: item.contact_id || null,
      deal_id: item.deal_id || null,
      phone_number: item.contact_phone || item.org_phone || '',
      subject: `Llamada - ${item.contact_name || item.org_name || 'cliente'}`,
      happened_at: localDateTime(0),
      duration_min: '',
      outcome: 'volver_a_llamar',
      notes: '',
      task_title: item.title || 'Volver a llamar',
      task_due: localDateTime(1),
    };
  }

  async function callItem(item) {
    const phone = item.contact_phone || item.org_phone;
    const draft = draftFromItem(item);
    try {
      const started = await api.startFollowupCall({ ...draft, started_at: draft.happened_at, source: 'mobile' });
      setCallDraft({ ...draft, call_id: started.id });
      await openPhone(phone);
    } catch (e) {
      showError(e, 'No se pudo iniciar la llamada');
    }
  }

  async function saveCall() {
    if (!callDraft) return;
    setSaving(true);
    try {
      validateCallDraft(callDraft);
      const started = callDraft.call_id ? null : await api.startFollowupCall({
        ...callDraft,
        started_at: callDraft.happened_at,
        source: 'mobile',
      });
      await api.completeFollowupCall(callDraft.call_id || started.id, callCompletionPayload(callDraft));
      setCallDraft(null);
      await load();
    } catch (e) {
      showError(e, 'No se pudo registrar llamada');
    } finally {
      setSaving(false);
    }
  }

  async function doneTask(id) {
    setSaving(true);
    try {
      await api.updateFollowupTask(id, { status: 'done' });
      await load();
    } catch (e) {
      showError(e, 'No se pudo completar tarea');
    } finally {
      setSaving(false);
    }
  }

  const pendingToShow = pendingCalls.filter((row) => Number(row.id) !== Number(callDraft?.call_id));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Text style={styles.title}>Seguimiento</Text>
        {route?.params?.taskId ? (() => {
          const openedTask = [...(data?.overdue || []), ...(data?.today || []), ...(data?.upcoming || [])]
            .find((item) => Number(item.id) === Number(route.params.taskId));
          return openedTask ? <View style={styles.formPanel}><Text style={styles.sectionTitle}>Recordatorio abierto</Text><FollowupCard item={openedTask} onCall={callItem} onRegister={(row) => setCallDraft(draftFromItem(row))} onDone={doneTask} /></View> : null;
        })() : null}
        {pendingToShow.length ? (
          <View>
            <SectionTitle title={`Pendientes de completar (${pendingToShow.length})`} />
            {pendingToShow.map((row) => (
              <View key={`pending-${row.id}`} style={styles.card}>
                <Text style={styles.cardTitle}>{row.contact_name || row.org_name || row.subject || 'Llamada pendiente'}</Text>
                <Text style={styles.meta}>{row.phone_number || 'Sin telefono'} · {shortDateTime(row.happened_at)}</Text>
                <PrimaryButton title="Completar registro" icon="phone-log" variant="secondary" onPress={() => setCallDraft(draftFromPending(row))} />
              </View>
            ))}
          </View>
        ) : null}
        {callDraft ? (
          <View style={styles.formPanel}>
            <Text style={styles.sectionTitle}>Registrar llamada</Text>
            <Text style={styles.label}>Resultado</Text>
            <OptionChips options={CALL_OUTCOMES} value={callDraft.outcome} onChange={(value) => setCallDraft({ ...callDraft, outcome: value })} />
            <Field label="Que se hablo" value={callDraft.notes} onChangeText={(v) => setCallDraft({ ...callDraft, notes: v })} placeholder="Resumen" multiline />
            <Field label="Fecha llamada" value={String(callDraft.happened_at || '')} onChangeText={(v) => setCallDraft({ ...callDraft, happened_at: v })} placeholder="YYYY-MM-DD HH:mm" />
            <Field label="Duracion (minutos, opcional)" value={String(callDraft.duration_min || '')} onChangeText={(v) => setCallDraft({ ...callDraft, duration_min: v })} placeholder="0" keyboardType="number-pad" />
            <Field label="Proxima accion" value={callDraft.task_title} onChangeText={(v) => setCallDraft({ ...callDraft, task_title: v })} placeholder="Volver a llamar..." />
            <OptionChips
              options={[{ value: localDateTime(0), label: 'Hoy' }, { value: localDateTime(1), label: 'Manana' }, { value: localDateTime(2), label: '2 dias' }, { value: localDateTime(7), label: 'Prox. semana' }]}
              value={callDraft.task_due}
              onChange={(value) => setCallDraft({ ...callDraft, task_due: value })}
            />
            <Field label="Fecha tarea" value={callDraft.task_due} onChangeText={(v) => setCallDraft({ ...callDraft, task_due: v })} placeholder="YYYY-MM-DD HH:mm" />
            <View style={styles.actions}>
              <PrimaryButton title="Guardar" icon="content-save" onPress={saveCall} disabled={saving} />
              <PrimaryButton title="Dejar pendiente" icon="close" variant="secondary" onPress={() => setCallDraft(null)} disabled={saving} />
            </View>
          </View>
        ) : null}

        <SectionTitle title="Vencidos" />
        {!(data?.overdue || []).length ? <Text style={styles.meta}>Sin vencidos</Text> : null}
        {(data?.overdue || []).map((item) => <FollowupCard key={`od-${item.id}`} item={item} onCall={callItem} onRegister={(row) => setCallDraft(draftFromItem(row))} onDone={doneTask} />)}

        <SectionTitle title="Hoy" />
        {!(data?.today || []).length ? <Text style={styles.meta}>Sin tareas para hoy</Text> : null}
        {(data?.today || []).map((item) => <FollowupCard key={`td-${item.id}`} item={item} onCall={callItem} onRegister={(row) => setCallDraft(draftFromItem(row))} onDone={doneTask} />)}

        <SectionTitle title="Proximos" />
        {(data?.upcoming || []).slice(0, 20).map((item) => <FollowupCard key={`up-${item.id}`} item={item} onCall={callItem} onRegister={(row) => setCallDraft(draftFromItem(row))} onDone={doneTask} />)}

        <SectionTitle title="Sin seguimiento reciente" />
        {(data?.no_recent_followup || []).map((item) => <FollowupCard key={`nr-${item.org_id}`} item={item} onCall={callItem} onRegister={(row) => setCallDraft(draftFromItem(row))} onDone={doneTask} />)}
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

    const preparedAsset = await prepareImageForUpload(asset, 'archivo.jpg');
    const uri = preparedAsset.uri;
    const name = preparedAsset.name || preparedAsset.fileName || uri?.split('/').pop() || 'archivo';
    const mimeType = preparedAsset.mimeType || preparedAsset.type || 'application/octet-stream';
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
    const allowed = await ensureMediaLibraryPermission();
    if (!allowed) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    });
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
  const { width } = useWindowDimensions();
  const compact = width < 460;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: !compact,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.soft,
        tabBarStyle: {
          minHeight: compact ? 62 : 70,
          paddingTop: 7,
          paddingBottom: Platform.OS === 'ios' ? 10 : 7,
          paddingHorizontal: 6,
          borderTopColor: colors.border,
          backgroundColor: colors.nav,
          elevation: 12,
          shadowColor: colors.shadow,
          shadowOpacity: 0.1,
          shadowRadius: 12,
        },
        tabBarItemStyle: {
          borderRadius: 8,
          marginHorizontal: 2,
          minWidth: 44,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginBottom: 2,
        },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Inicio: 'home',
            Contactos: 'account-group',
            Organizaciones: 'office-building',
            Operar: 'file-document-edit',
            Operaciones: 'clipboard-list',
            Seguimiento: 'phone-clock',
            Adjuntos: 'paperclip',
          };
          return <MaterialCommunityIcons name={icons[route.name]} color={color} size={compact ? 23 : size} />;
        },
      })}
    >
      <Tab.Screen name="Inicio" component={HomeScreen} />
      <Tab.Screen name="Contactos" component={ContactsScreen} />
      <Tab.Screen name="Organizaciones" component={OrganizationsScreen} />
      <Tab.Screen name="Operar" component={OperationsScreen} />
      <Tab.Screen name="Operaciones" component={OperationListScreen} />
      <Tab.Screen name="Seguimiento" component={FollowupScreen} />
      <Tab.Screen name="Adjuntos" component={AttachmentsScreen} />
    </Tab.Navigator>
  );
}
function Root() {
  const { token, loading } = useAuth();

  useEffect(() => {
    const openFollowup = (response) => {
      const data = response?.notification?.request?.content?.data || {};
      if (navigationRef.isReady()) {
        navigationRef.navigate('Seguimiento', { taskId: data.task_id || null, callId: data.call_id || null, orgId: data.org_id || null });
      }
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(openFollowup);
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openFollowup(response);
    }).catch(() => null);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    async function registerPushDevice() {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('followup', {
            name: 'Seguimiento',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }
        const current = await Notifications.getPermissionsAsync();
        const permission = current.status === 'granted'
          ? current
          : await Notifications.requestPermissionsAsync();
        if (permission.status !== 'granted' || !active) return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
        if (!projectId) return;
        const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (active && pushToken) {
          await api.registerFollowupDevice({
            token: pushToken,
            platform: Platform.OS,
            device_name: `${Platform.OS} mobile`,
          });
        }
      } catch (error) {
        console.warn('[followup-push] No se pudo registrar el dispositivo', error?.message || error);
      }
    }
    registerPushDevice();
    return () => {
      active = false;
    };
  }, [token]);

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
  const systemScheme = useColorScheme();
  const [iconFontsReady, setIconFontsReady] = useState(false);
  const [themeMode, setThemeMode] = useState(systemScheme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (mounted && (saved === 'light' || saved === 'dark')) setThemeMode(saved);
      })
      .catch(() => null);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    Font.loadAsync({ MaterialCommunityIcons: materialCommunityFont })
      .catch(() => null)
      .finally(() => {
        if (mounted) setIconFontsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const isDark = themeMode === 'dark';
  colors = isDark ? darkColors : lightColors;
  styles = createStyles(colors);

  const toggleTheme = useCallback(() => {
    setThemeMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => null);
      return next;
    });
  }, []);

  const navigationBase = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...navigationBase,
    colors: {
      ...navigationBase.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.nav,
      text: colors.ink,
      border: colors.border,
      notification: colors.danger,
    },
  };

  const themeContext = { isDark, toggleTheme };

  if (!iconFontsReady) {
    return (
      <ThemeContext.Provider value={themeContext}>
        <SafeAreaProvider>
          <Screen>
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.meta}>Cargando aplicacion...</Text>
            </View>
          </Screen>
        </SafeAreaProvider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={themeContext}>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer ref={navigationRef} theme={navigationTheme}>
            <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.bg} />
            <Root />
          </NavigationContainer>
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}
function createStyles(theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    iconFont: {
      fontFamily: 'MaterialCommunityIcons',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'center',
      includeFontPadding: false,
    },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 28,
      gap: 14,
    },
    listContent: {
      paddingBottom: 88,
    },
    loginWrap: {
      flex: 1,
      justifyContent: 'center',
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      padding: 18,
    },
    loginCard: {
      backgroundColor: theme.panel,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 20,
      gap: 13,
      shadowColor: theme.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3,
    },
    loginLogo: {
      width: '100%',
      height: 104,
      marginBottom: 4,
      borderRadius: 8,
      backgroundColor: '#ffffff',
    },
    brand: {
      fontSize: 24,
      fontWeight: '800',
      color: theme.ink,
    },
    subtitle: {
      fontSize: 14,
      color: theme.muted,
      marginBottom: 8,
    },
    title: {
      flexShrink: 1,
      fontSize: 25,
      lineHeight: 31,
      fontWeight: '800',
      color: theme.ink,
    },
    kicker: {
      fontSize: 12,
      color: theme.muted,
      letterSpacing: 0,
    },
    headerRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    homeBrandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: 12,
    },
    homeLogo: {
      width: 86,
      height: 48,
      borderRadius: 8,
      backgroundColor: '#ffffff',
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.elevated,
    },
    logoutButton: {
      borderColor: theme.danger,
      backgroundColor: theme.dangerSoft,
    },
    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    quickAction: {
      width: '48%',
      minHeight: 102,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: theme.panel,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 13,
      shadowColor: theme.shadow,
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    quickCopy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    quickText: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      color: theme.ink,
    },
    quickSubtitle: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.muted,
    },
    sectionTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '800',
      color: theme.ink,
      marginTop: 4,
    },
    card: {
      backgroundColor: theme.panel,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 14,
      marginHorizontal: 12,
      marginBottom: 10,
      gap: 6,
      shadowColor: theme.shadow,
      shadowOpacity: 0.05,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    cardPressed: {
      opacity: 0.84,
      transform: [{ scale: 0.995 }],
    },
    operationCard: {
      marginHorizontal: 0,
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    entityCard: {
      minHeight: 92,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    entityIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.soft,
      borderWidth: 1,
      borderColor: theme.softStrong,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.soft,
      borderWidth: 1,
      borderColor: theme.softStrong,
    },
    avatarText: {
      color: theme.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    cardContent: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    cardAside: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 8,
      maxWidth: 126,
    },
    entityActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: 6,
    },
    stagePill: {
      maxWidth: 112,
      minHeight: 30,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: theme.soft,
      borderWidth: 1,
      borderColor: theme.softStrong,
    },
    stagePillText: {
      color: theme.accent,
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'center',
    },
    selectedCard: {
      borderColor: theme.accent,
      backgroundColor: theme.soft,
    },
    cardTitle: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      color: theme.ink,
    },
    meta: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.muted,
    },
    hint: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.muted,
      marginTop: 4,
    },
    field: {
      gap: 6,
    },
    label: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      color: theme.ink,
    },
    input: {
      width: '100%',
      minHeight: 48,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.input,
      color: theme.ink,
      paddingHorizontal: 13,
      fontSize: 15,
    },
    textArea: {
      minHeight: 104,
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
      backgroundColor: theme.accent,
    },
    buttonCompact: {
      width: 42,
      minWidth: 42,
      height: 42,
      minHeight: 42,
      paddingHorizontal: 0,
    },
    buttonSecondary: {
      backgroundColor: theme.soft,
      borderWidth: 1,
      borderColor: theme.softStrong,
    },
    buttonDanger: {
      backgroundColor: theme.danger,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    buttonPressed: {
      transform: [{ scale: 0.985 }],
      backgroundColor: theme.accentDark,
    },
    buttonText: {
      color: '#ffffff',
      fontWeight: '800',
      fontSize: 14,
    },
    buttonSecondaryText: {
      color: theme.accent,
    },
    formPanel: {
      backgroundColor: theme.panel,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 14,
      gap: 13,
      shadowColor: theme.shadow,
      shadowOpacity: 0.04,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 3 },
      elevation: 1,
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
    },
    statusPill: {
      minHeight: 34,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.elevated,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusPillDirty: {
      borderColor: theme.warning,
      backgroundColor: theme.warningSoft,
    },
    statusPillText: {
      fontSize: 12,
      fontWeight: '800',
      color: theme.muted,
    },
    statusPillDirtyText: {
      color: theme.warning,
    },
    detailSection: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: 'hidden',
      shadowColor: theme.shadow,
      shadowOpacity: 0.035,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    sectionToggle: {
      minHeight: 52,
      paddingHorizontal: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.elevated,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    sectionTitleRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    sectionIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.soft,
      borderWidth: 1,
      borderColor: theme.softStrong,
    },
    sectionToggleText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
      color: theme.ink,
    },
    sectionBody: {
      padding: 13,
      gap: 11,
      backgroundColor: theme.panel,
    },
    choiceRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    choice: {
      minHeight: 40,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.input,
      paddingHorizontal: 12,
      flexDirection: 'row',
      gap: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    choiceActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    choicePressed: {
      opacity: 0.78,
    },
    choiceText: {
      color: theme.ink,
      fontWeight: '800',
      fontSize: 12,
    },
    choiceTextActive: {
      color: '#ffffff',
    },
    suggestions: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.elevated,
      overflow: 'hidden',
      shadowColor: theme.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 5,
    },
    suggestionItem: {
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    inlineList: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 9,
      gap: 5,
    },
    inlinePanel: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.elevated,
      padding: 12,
      gap: 10,
    },
    inlineItem: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.ink,
    },
    importPreview: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.softStrong,
      backgroundColor: theme.soft,
      padding: 12,
      gap: 4,
    },
    empty: {
      margin: 14,
      padding: 20,
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.border,
      backgroundColor: theme.panel,
      alignItems: 'center',
    },
    emptyText: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 19,
      textAlign: 'center',
    },
    profit: {
      color: theme.accent,
      fontWeight: '800',
    },
  });
}

styles = createStyles(colors);