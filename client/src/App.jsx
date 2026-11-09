// client/src/App.jsx
import React, { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ChartNoAxesCombined, ListTodo, MessageSquare, KanbanSquare, Truck, Boxes, Factory, Wrench, CalendarDays, ClipboardList, Users, Settings, Folder, Wallet, FileText, ReceiptText, Package, Building2, FileCheck2, Phone, LogOut, Sun, Moon, ShieldCheck, UserRound, CreditCard, ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';

import Pipeline from './pages/Pipeline';
import CommercialDashboard from './pages/CommercialDashboard.jsx';
import CommissionSheet from './pages/CommissionSheet.jsx';
import LostDeals from './pages/LostDeals.jsx';
import Contacts from './pages/Contacts';
import General from './pages/General.jsx';
import Organizations from './pages/Organizations';
import Workspace from './pages/Workspace';
import WorkspaceTable from './pages/WorkspaceTable';
import OrganizationDetail from './pages/OrganizationDetail.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
// ?? antes importabas OperationDetail directamente
// import OperationDetail from './pages/OperationDetail.jsx';
import OperationDetailSwitcher from './pages/OperationDetailSwitcher.jsx';
import OperationDetailIndustrial from './pages/OperationDetailIndustrial.jsx';

import Login from './pages/Login.jsx';
import Quotes from './pages/Quotes.jsx';
import QuoteEditor from './pages/QuoteEditor.jsx';
import GlobalSearchBar from './components/GlobalSearchBar.jsx';
import AssistantBubble from './components/AssistantBubble.jsx';
import AssistantDashboard from './pages/AssistantDashboard.jsx';

// Admin
import UsersAdmin from './pages/UsersAdmin.jsx';
import AdminParams from './pages/AdminParams.jsx';
import AccountStatement from './pages/AccountStatement.jsx';
import Payments from './pages/Payments.jsx';
import AdminExpenses from './pages/AdminExpenses.jsx';
import AdminFinance from './pages/AdminFinance.jsx';
import ConfirmedSalesReport from './pages/ConfirmedSalesReport.jsx';
import OperationalPurchases from './pages/admin/OperationalPurchases.jsx';
import PaymentOrders from './pages/admin/PaymentOrders.jsx';
import BankReconciliation from './pages/admin/BankReconciliation.jsx';
import AccountsPayable from './pages/admin/AccountsPayable.jsx';

// ?? NUEVO: Workspace de Administración (Ops)
import AdminWorkspace from './pages/admin/AdminWorkspace.jsx';

// Auth
import { RequireAuth, RequireRole, useAuth } from './auth.jsx';

// (opcional) generator dedicado:
import QuoteGenerator from './pages/QuoteGenerator.jsx';
import IndustrialQuoteGenerator from './pages/IndustrialQuoteGenerator.jsx';
import ServiceModule from './pages/service/ServiceModule.jsx';
import ServiceDoorDetail from './pages/service/ServiceDoorDetail.jsx';
import ServiceCaseDetail from './pages/service/ServiceCaseDetail.jsx';
import ServiceAdditionalQuoteEditor from './pages/service/ServiceAdditionalQuoteEditor.jsx';
import ContainerMaster from './pages/container/ContainerMaster.jsx';
import ContainerContracts from './pages/container/ContainerContracts.jsx';
import ContainerAlerts from './pages/container/ContainerAlerts.jsx';
import ContainerBilling from './pages/container/ContainerBilling.jsx';

// Seguimiento
import Invoices from './pages/Invoices.jsx';
import CreditNotes from './pages/CreditNotes.jsx';
import FollowUpManagement from './pages/FollowUpManagement.jsx';
import AuditPage from './pages/AuditPage.jsx';
import SystemCalendar from './pages/SystemCalendar.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail.jsx';
import PurchaseInvoiceDetail from './pages/PurchaseInvoiceDetail.jsx';

// ?? NUEVO: Editor de Pipeline (pantalla completa)
import PipelineEditorPage from './pages/PipelineEditorPage.jsx';

// Catálogo
import ProductsServices from './pages/catalog/ProductsServices.jsx';

// ?? NUEVO: Solicitud de flete desde operación
import RequestFreight from './pages/RequestFreight.jsx';

// ---------------- UI helpers ----------------
const sidebarIcons = {
  header: <Factory size={18} />,
  themeOn: <Sun size={18} />,
  themeOff: <Moon size={18} />,
  general: <LayoutDashboard size={18} />,
  commercial: <ChartNoAxesCombined size={18} />,
  commissions: <Wallet size={18} />,
  assistantFollowup: <ListTodo size={18} />,
  assistant: <Sparkles size={18} />,
  prospecting: <MessageSquare size={18} />,
  kanban: <KanbanSquare size={18} />,
  cargo: <Truck size={18} />,
  container: <Boxes size={18} />,
  industrial: <Factory size={18} />,
  service: <Wrench size={18} />,
  calendar: <CalendarDays size={18} />,
  admin: <ClipboardList size={18} />,
  audit: <ShieldCheck size={18} />,
  user: <UserRound size={18} />,
  params: <Settings size={18} />,
  adminOps: <Folder size={18} />,
  finance: <ChartNoAxesCombined size={18} />,
  account: <FileText size={18} />,
  payments: <CreditCard size={18} />,
  expenses: <ReceiptText size={18} />,
  catalog: <Package size={18} />,
  contacts: <Users size={18} />,
  orgs: <Building2 size={18} />,
  invoices: <ReceiptText size={18} />,
  orders: <FileCheck2 size={18} />,
  followup: <Phone size={18} />,
  quotes: <FileText size={18} />,
  logout: <LogOut size={18} />,
};

const linkCls = ({ isActive }) =>
  `atm-nav-link flex items-center rounded-lg text-sm px-3 py-2 transition-all
   justify-center group-hover:justify-start
   gap-0 group-hover:gap-2
   ${isActive ? 'bg-black text-white dark:bg-white dark:text-black' : 'hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200'}`;

function SideLink({ to, icon, label }) {
  return (
    <NavLink to={to} className={linkCls} title={label}>
      <span className="text-base w-6 text-center">{icon}</span>
      <span className="hidden group-hover:inline">{label}</span>
    </NavLink>
  );
}

function Layout({ children }) {
  const { logout, user } = useAuth();
  const { pathname } = useLocation();
  const role = String(user?.role || '').toLowerCase();
  const isServiceRole = role === 'service';
  const canSeeAdminCore = role === 'admin' || role === 'manager';
  const canSeeFinanceBlock = role === 'admin' || role === 'finanzas';
  const canSeeAdminBlock = canSeeAdminCore || canSeeFinanceBlock;
  const canSeeContactsModules = true;
  const canSeeCommercialModules = !isServiceRole;
  const canSeeFollowupManagement = ['admin', 'venta', 'ventas', 'vendedor', 'seller', 'sales', 'commercial', 'comercial'].includes(role);
  const [darkMode, setDarkMode] = useState(false);
  const [containerMenuOpen, setContainerMenuOpen] = useState(false);
  const [commercialMenuOpen, setCommercialMenuOpen] = useState(false);
  const [adminOpsMenuOpen, setAdminOpsMenuOpen] = useState(() => pathname.startsWith('/invoices'));
  const [invoicesMenuOpen, setInvoicesMenuOpen] = useState(() => pathname.startsWith('/invoices'));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('atm-sidebar-collapsed');
    return saved === null ? window.innerWidth < 900 : saved === '1';
  });

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const isDark = stored === 'dark';
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  useEffect(() => {
    if (pathname.startsWith('/invoices')) {
      setAdminOpsMenuOpen(true);
      setInvoicesMenuOpen(true);
    }
  }, [pathname]);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      localStorage.setItem('atm-sidebar-collapsed', value ? '0' : '1');
      return !value;
    });
  }

  return (
    <div className="atm-app min-h-screen flex dark:bg-slate-900 dark:text-slate-100">
      {/* Lateral colapsable por hover */}
      <aside
        className={`atm-sidebar group sticky top-0 h-screen shrink-0 overflow-y-auto overflow-x-hidden border-r transition-[width] duration-200 dark:bg-slate-950 dark:border-slate-800 ${sidebarCollapsed ? 'atm-sidebar-collapsed w-[64px]' : 'w-[232px]'}`}
      >
        {/* Header: compacto (icono) / expandido (título) */}
        <div className="atm-sidebar-brand border-b dark:border-slate-800 h-16 flex items-center justify-between px-3">
          {!sidebarCollapsed && <div className="atm-brand-lockup"><span className="atm-brand-mark" aria-hidden="true" /><span>ATM CargoSoft</span></div>}
          <button type="button" onClick={toggleSidebar} className="atm-sidebar-toggle h-8 w-8 shrink-0 rounded-md flex items-center justify-center" aria-label={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'} title={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
        </div>

        {/* Navegación */}
        <nav className="p-3 space-y-1">
          <SideLink to="/general" icon={sidebarIcons.general} label="Inicio" />
          <SideLink to="/calendar" icon={sidebarIcons.calendar} label="Agenda" />
          <SideLink to="/assistant" icon={sidebarIcons.assistant} label="Asistente IA" />
          <SideLink to="/workspace/atm-cargo" icon={sidebarIcons.cargo} label="ATM Cargo" />
          <div>
            <button
              type="button"
              onClick={() => setContainerMenuOpen((open) => !open)}
              className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all
                         justify-center group-hover:justify-start
                         gap-0 group-hover:gap-2
                         hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200"
              title="ATM Container"
            >
              <span className="text-base w-6 text-center">{sidebarIcons.container}</span>
              <span className="hidden group-hover:inline flex-1 text-left">ATM Container</span>
              <span className="hidden group-hover:inline text-[10px] text-slate-500">
                {containerMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>
            <div className={`${containerMenuOpen ? 'block' : 'hidden'} ml-8 mt-1 space-y-1`}>
              <SideLink
                to="/workspace/atm-container"
                icon={sidebarIcons.container}
                label="Workspace container"
              />
              <SideLink
                to="/container/master"
                icon={sidebarIcons.container}
                label="Maestro de contenedores"
              />
              <SideLink
                to="/container/contracts"
                icon={sidebarIcons.quotes}
                label="Contratos container"
              />
              <SideLink
                to="/container/alerts"
                icon={sidebarIcons.followup}
                label="Alertas container"
              />
              <SideLink
                to="/container/billing"
                icon={sidebarIcons.admin}
                label="Facturación mensual"
              />
            </div>
          </div>
          <SideLink to="/workspace/atm-industrial" icon={sidebarIcons.industrial} label="ATM Industrial" />
          {(role === 'admin' || role === 'service') && (
            <SideLink to="/service" icon={sidebarIcons.service} label="Servicio" />
          )}
          {canSeeCommercialModules && <SideLink to="/quotes" icon={sidebarIcons.quotes} label="Cotizaciones" />}
          {canSeeContactsModules && <SideLink to="/contacts" icon={sidebarIcons.contacts} label="Contactos" />}

          <hr className="my-3 dark:border-slate-800" />
          <div className="hidden group-hover:block text-[11px] uppercase text-slate-500 dark:text-slate-400 px-3 pb-1">Herramientas</div>
          <SideLink to="/" icon={sidebarIcons.kanban} label="Kanban general" />
          {canSeeCommercialModules && (
            <>
              <div>
                <button type="button" onClick={() => setCommercialMenuOpen((open) => !open)} className="atm-nav-group w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all justify-center group-hover:justify-start gap-0 group-hover:gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200" title="Dashboard comercial">
                  <span className="text-base w-6 text-center">{sidebarIcons.commercial}</span>
                  <span className="hidden group-hover:inline flex-1 text-left">Dashboard comercial</span>
                  <span className="hidden group-hover:inline text-slate-500">{commercialMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                </button>
                <div className={`${commercialMenuOpen ? 'block' : 'hidden'} ml-8 mt-1 space-y-1`}>
                  <SideLink to="/commercial-dashboard" icon={sidebarIcons.commercial} label="Dashboard" />
                  <SideLink to="/commercial-dashboard/commissions" icon={sidebarIcons.commissions} label="Planilla de comisiones" />
                </div>
              </div>
              <SideLink to="/lost-deals" icon={sidebarIcons.followup} label="No cerradas" />
            </>
          )}

          {canSeeAdminBlock && (
            <>
              <hr className="my-2 dark:border-slate-800" />
              {canSeeAdminCore && (
                <>
                  <SideLink to="/admin/users" icon={sidebarIcons.user} label="Usuarios" />
                  {role === 'admin' && <SideLink to="/audit" icon={sidebarIcons.audit} label="Auditoría" />}
                  <SideLink to="/admin/params" icon={sidebarIcons.params} label="Parámetros" />
                </>
              )}
              {canSeeFinanceBlock && (
                <>
                  <SideLink to="/admin/finance" icon={sidebarIcons.finance} label="Gerencia" />
                  <SideLink to="/sales-report" icon={sidebarIcons.commercial} label="Informe de ventas" />
                  <div>
                    <button
                      type="button"
                      onClick={() => setAdminOpsMenuOpen((open) => !open)}
                      className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all
                                 justify-center group-hover:justify-start
                                 gap-0 group-hover:gap-2
                                 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200"
                      title="Administración (Ops)"
                    >
                      <span className="text-base w-6 text-center">{sidebarIcons.adminOps}</span>
                      <span className="hidden group-hover:inline flex-1 text-left">Administración (Ops)</span>
                      <span className="hidden group-hover:inline text-[10px] text-slate-500">
                        {adminOpsMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </button>
                    <div className={`${adminOpsMenuOpen ? 'block' : 'hidden'} ml-8 mt-1 space-y-1`}>
                      <SideLink
                        to="/admin-ops"
                        icon={sidebarIcons.adminOps}
                        label="Tablero Ops"
                      />
                      <SideLink
                        to="/account-statement"
                        icon={sidebarIcons.account}
                        label="Estado de cuenta de clientes"
                      />
                      <div>
                        <button
                          type="button"
                          onClick={() => setInvoicesMenuOpen((open) => !open)}
                          className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all justify-center group-hover:justify-start gap-0 group-hover:gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200"
                          title="Facturas"
                        >
                          <span className="text-base w-6 text-center">{sidebarIcons.invoices}</span>
                          <span className="hidden group-hover:inline flex-1 text-left">Facturas</span>
                          <span className="hidden group-hover:inline text-slate-500">{invoicesMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                        </button>
                        <div className={`${invoicesMenuOpen ? 'block' : 'hidden'} ml-8 mt-1 space-y-1`}>
                          <SideLink to="/invoices" icon={sidebarIcons.invoices} label="Facturación" />
                          <SideLink to="/invoices/credit-notes" icon={sidebarIcons.account} label="Notas de credito" />
                        </div>
                      </div>
                      <SideLink
                        to="/admin-ops/purchases"
                        icon={sidebarIcons.expenses}
                        label="Compras operativas"
                      />
                      <SideLink
                        to="/admin-ops/payment-orders"
                        icon={sidebarIcons.payments}
                        label="Ordenes de pago"
                      />
                      <SideLink
                        to="/admin-ops/bank-reconciliation"
                        icon={sidebarIcons.account}
                        label="Conciliación bancaria"
                      />
                      <SideLink
                        to="/admin-ops/accounts-payable"
                        icon={sidebarIcons.account}
                        label="Ctas a pagar proveedores"
                      />
                      <SideLink
                        to="/payments"
                        icon={sidebarIcons.payments}
                        label="Pagos / Recibos"
                      />
                      <SideLink
                        to="/admin-expenses"
                        icon={sidebarIcons.expenses}
                        label="Gastos administrativos"
                      />
                    </div>
                  </div>
                </>
              )}
              {canSeeAdminCore && (
                <>
                  <hr className="my-2 dark:border-slate-800" />
                  <SideLink to="/catalog" icon={sidebarIcons.catalog} label="Productos y servicios" />
                </>
              )}
            </>
          )}

          {canSeeContactsModules && (
            <>
              <hr className="my-2 dark:border-slate-800" />
              <SideLink to="/organizations" icon={sidebarIcons.orgs} label="Organizaciones" />
            </>
          )}

          {canSeeCommercialModules && (
            <>
              <hr className="my-2 dark:border-slate-800" />
              <SideLink to="/purchase-orders" icon={sidebarIcons.orders} label="Órdenes de compra" />
              {canSeeFollowupManagement && <SideLink to="/followup-management" icon={sidebarIcons.followup} label="Gestion de seguimiento" />}
            </>
          )}

          <hr className="my-3 dark:border-slate-800" />
          <div className="px-3">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all
                         justify-center group-hover:justify-start
                         gap-0 group-hover:gap-2
                         hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Modo oscuro"
              type="button"
            >
              <span className="text-base w-6 text-center">
                {darkMode ? sidebarIcons.themeOn : sidebarIcons.themeOff}
              </span>
              <span className="hidden group-hover:inline">{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
            </button>
          </div>
          <hr className="my-3 dark:border-slate-800" />
          {/* Sesi\u00f3n */}
          <div className="px-3">
            <button
              onClick={logout}
              className="hidden group-hover:inline text-xs text-red-600 hover:underline"
            >
              Salir
            </button>
            <div className="group-hover:hidden flex justify-center">
              <span title="Salir">{sidebarIcons.logout}</span>
            </div>
          </div>
        </nav>
      </aside>

      {/* Contenido principal */}
      <main className="atm-main dark:bg-slate-900 flex-1 min-w-0">
        <div className="atm-topbar px-4 py-3 border-b dark:bg-slate-950 dark:border-slate-800 sticky top-0 z-40">
          <GlobalSearchBar />
        </div>
        <div className="p-4 lg:p-5">{children}</div>
      </main>
      {pathname !== '/assistant' && <AssistantBubble />}
    </div>
  );
}

// ---------------- App (única exportación por defecto) ----------------
export default function App() {
  return (
    <Routes>
      {/* Login (fuera de layout) */}
      <Route path="/login" element={<Login />} />

      {/* ?? Pantallas fullscreen fuera del layout */}
      <Route
        path="/pipelines/edit"
        element={
          <RequireAuth>
            <PipelineEditorPage />
          </RequireAuth>
        }
      />
      <Route
        path="/pipelines/:pipelineId/edit"
        element={
          <RequireAuth>
            <PipelineEditorPage />
          </RequireAuth>
        }
      />
      <Route
        path="/operations/:id/quote-embed"
        element={
          <RequireAuth>
            <QuoteGenerator />
          </RequireAuth>
        }
      />
      <Route
        path="/operations/:id/industrial-quote-embed"
        element={
          <RequireAuth>
            <IndustrialQuoteGenerator />
          </RequireAuth>
        }
      />
      <Route
        path="/service/cases/:serviceCaseId/industrial-quote-embed"
        element={
          <RequireAuth>
            <IndustrialQuoteGenerator />
          </RequireAuth>
        }
      />

      {/* Resto de la app con Layout */}
      <Route
        path="*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Pipeline />} />
                <Route path="/commercial-dashboard" element={<CommercialDashboard />} />
                <Route path="/commercial-dashboard/commissions" element={<CommissionSheet />} />
                <Route path="/lost-deals" element={<LostDeals />} />
                <Route path="/general" element={<General />} />
                <Route path="/assistant" element={<AssistantDashboard />} />

                {/* Contactos */}
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/contacts/:id" element={<ContactDetail />} />

                {/* Organizaciones */}
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/organizations/:id" element={<OrganizationDetail />} />

                {/* Workspaces */}
                <Route path="/workspace/:key" element={<Workspace />} />
                <Route path="/workspace/:key/table" element={<WorkspaceTable />} />
                <Route path="/container/master" element={<ContainerMaster />} />
                <Route path="/container/contracts" element={<ContainerContracts />} />
                <Route path="/container/alerts" element={<ContainerAlerts />} />
                <Route path="/container/billing" element={<ContainerBilling />} />

                {/* ---- Secciones restringidas a admin/manager ---- */}
                <Route path="/admin" element={<Navigate to="/audit" replace />} />
                <Route path="/audit" element={<RequireRole allow={['admin']}><AuditPage /></RequireRole>} />
                <Route
                  path="/admin/users"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <UsersAdmin />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin/params"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <AdminParams />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin/finance"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <AdminFinance />
                    </RequireRole>
                  }
                />
                <Route path="/sales-report" element={<RequireRole allow={['admin', 'finanzas']}><ConfirmedSalesReport /></RequireRole>} />
                <Route
                  path="/admin-ops"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <AdminWorkspace />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-ops/purchases"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <OperationalPurchases />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-ops/payment-orders"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <PaymentOrders />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-ops/bank-reconciliation"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <BankReconciliation />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-ops/accounts-payable"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <AccountsPayable />
                    </RequireRole>
                  }
                />
                <Route
                  path="/payments"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <Payments />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-expenses"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <AdminExpenses />
                    </RequireRole>
                  }
                />
                <Route
                  path="/account-statement"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <AccountStatement />
                    </RequireRole>
                  }
                />
                <Route
                  path="/catalog"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <ProductsServices />
                    </RequireRole>
                  }
                />
                {/* ----------------------------------------------- */}

                {/* Operaciones */}
                <Route path="/operations/:id" element={<OperationDetailSwitcher />} />
                <Route
                  path="/operations/:id/industrial"
                  element={<OperationDetailIndustrial />}
                />

                <Route path="/operations/:id/quote" element={<QuoteGenerator />} />
                <Route path="/operations/:id/industrial-quote" element={<IndustrialQuoteGenerator />} />
                <Route
                  path="/operations/:id/request-freight"
                  element={<RequestFreight />}
                />

                {/* Service */}
                <Route
                  path="/service"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <ServiceModule />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/doors/:id"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <ServiceDoorDetail />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/cases/:id"
                  element={
                    <RequireRole allow={['admin', 'service', 'finanzas']}>
                      <ServiceCaseDetail />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/cases/:caseId/quote"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <QuoteEditor />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/quotes/:id"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <QuoteEditor />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/additional-quotes/:id"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <ServiceAdditionalQuoteEditor />
                    </RequireRole>
                  }
                />
                <Route
                  path="/service/cases/:serviceCaseId/industrial-quote"
                  element={
                    <RequireRole allow={['admin', 'service']}>
                      <IndustrialQuoteGenerator />
                    </RequireRole>
                  }
                />

                {/* Cotizaciones */}
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/new" element={<QuoteEditor />} />
                <Route path="/quotes/:id" element={<QuoteEditor />} />

                <Route
                  path="/invoices"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <Invoices />
                    </RequireRole>
                  }
                />
                <Route
                  path="/invoices/credit-notes"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <CreditNotes />
                    </RequireRole>
                  }
                />
                <Route
                  path="/invoices/:id"
                  element={
                    <RequireRole allow={['admin', 'finanzas']}>
                      <InvoiceDetail />
                    </RequireRole>
                  }
                />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
                <Route path="/purchase-invoices/:id" element={<PurchaseInvoiceDetail />} />

                {/* Seguimiento */}
                <Route
                  path="/followup-management"
                  element={
                    <RequireRole allow={['admin', 'venta', 'ventas', 'vendedor', 'seller', 'sales', 'commercial', 'comercial']}>
                      <FollowUpManagement />
                    </RequireRole>
                  }
                />
                <Route path="/followup" element={<Navigate to="/followup-management" replace />} />
                <Route path="/calendar" element={<SystemCalendar />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
