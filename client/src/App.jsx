// client/src/App.jsx
import React, { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';

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

// Admin
import UsersAdmin from './pages/UsersAdmin.jsx';
import AdminParams from './pages/AdminParams.jsx';
import AccountStatement from './pages/AccountStatement.jsx';
import Payments from './pages/Payments.jsx';
import AdminExpenses from './pages/AdminExpenses.jsx';
import AdminFinance from './pages/AdminFinance.jsx';
import OperationalPurchases from './pages/admin/OperationalPurchases.jsx';
import PaymentOrders from './pages/admin/PaymentOrders.jsx';
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
import FollowUpManagement from './pages/FollowUpManagement.jsx';
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
  header: String.fromCodePoint(0x1F9ED),
  themeOn: String.fromCodePoint(0x2600),
  themeOff: String.fromCodePoint(0x1F319),
  general: String.fromCodePoint(0x1F4CB),
  commercial: String.fromCodePoint(0x1F4C8),
  commissions: String.fromCodePoint(0x1F4B0),
  kanban: String.fromCodePoint(0x1F9E9),
  cargo: String.fromCodePoint(0x1F69A),
  container: String.fromCodePoint(0x1F4E6),
  industrial: String.fromCodePoint(0x1F3ED),
  service: String.fromCodePoint(0x1F527),
  admin: String.fromCodePoint(0x1F4C4),
  user: String.fromCodePoint(0x1F464),
  params: String.fromCodePoint(0x2699),
  adminOps: String.fromCodePoint(0x1F4C1),
  finance: String.fromCodePoint(0x1F4CA),
  account: String.fromCodePoint(0x1F4C4),
  payments: String.fromCodePoint(0x1F9FE),
  expenses: String.fromCodePoint(0x1F4B3),
  catalog: String.fromCodePoint(0x1F4C4),
  contacts: String.fromCodePoint(0x1F464),
  orgs: String.fromCodePoint(0x1F3E2),
  invoices: String.fromCodePoint(0x1F4B5),
  orders: String.fromCodePoint(0x1F4E6),
  followup: String.fromCodePoint(0x1F4DE),
  quotes: String.fromCodePoint(0x1F4DD),
  logout: String.fromCodePoint(0x1F6AA),
};

const linkCls = ({ isActive }) =>
  `flex items-center rounded-lg text-sm px-3 py-2 transition-all
   justify-center group-hover:justify-start
   gap-0 group-hover:gap-2
   ${isActive ? 'bg-black text-white dark:bg-white dark:text-black' : 'hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200'}`;

function SideLink({ to, icon, label }) {
  return (
    <NavLink to={to} className={linkCls}>
      <span className="text-base w-6 text-center">{icon}</span>
      <span className="hidden group-hover:inline">{label}</span>
    </NavLink>
  );
}

function Layout({ children }) {
  const { logout, user } = useAuth();
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
  const [adminOpsMenuOpen, setAdminOpsMenuOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const isDark = stored === 'dark';
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  return (
    <div className="min-h-screen flex bg-gray-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {/* Lateral colapsable por hover */}
      <aside
        className="
          group bg-white border-r dark:bg-slate-950 dark:border-slate-800
          w-[64px] hover:w-[220px]
          transition-[width] duration-300 ease-in-out
          overflow-hidden
        "
      >
        {/* Header: compacto (icono) / expandido (título) */}
        <div className="border-b dark:border-slate-800">
          <div className="h-14 flex items-center justify-center text-xl group-hover:hidden select-none">{sidebarIcons.header}</div>
          <div className="hidden group-hover:block p-4">
            <div className="text-lg font-semibold">CRM MVP</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">GRUPO ATM</div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="p-3 space-y-1">
          {canSeeCommercialModules && (
            <>
              <div>
                <button type="button" onClick={() => setCommercialMenuOpen((open) => !open)} className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all justify-center group-hover:justify-start gap-0 group-hover:gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200" title="Dashboard comercial">
                  <span className="text-base w-6 text-center">{sidebarIcons.commercial}</span>
                  <span className="hidden group-hover:inline flex-1 text-left">Dashboard comercial</span>
                  <span className="hidden group-hover:inline text-[10px] text-slate-500">{commercialMenuOpen ? '▲' : '▼'}</span>
                </button>
                <div className={`${commercialMenuOpen ? 'block' : 'hidden'} ml-8 mt-1 space-y-1`}>
                  <SideLink to="/commercial-dashboard" icon={sidebarIcons.commercial} label="Dashboard" />
                  <SideLink to="/commercial-dashboard/commissions" icon={sidebarIcons.commissions} label="Planilla de comisiones" />
                </div>
              </div>
              <SideLink to="/lost-deals" icon={sidebarIcons.followup} label="No cerradas" />
            </>
          )}
          <SideLink to="/general" icon={sidebarIcons.general} label="Vista general" />
          <SideLink to="/" icon={sidebarIcons.kanban} label="Kanban" />

          <hr className="my-2 dark:border-slate-800" />
          <div className="hidden group-hover:block text-xs text-slate-500 dark:text-slate-400 px-1 pb-1">
            Workspaces
          </div>
          <SideLink to="/workspace/atm-cargo" icon={sidebarIcons.cargo} label="ATM CARGO" />
          <div>
            <button
              type="button"
              onClick={() => setContainerMenuOpen((open) => !open)}
              className="w-full flex items-center rounded-lg text-sm px-3 py-2 transition-all
                         justify-center group-hover:justify-start
                         gap-0 group-hover:gap-2
                         hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-200"
              title="ATM CONTAINER"
            >
              <span className="text-base w-6 text-center">{sidebarIcons.container}</span>
              <span className="hidden group-hover:inline flex-1 text-left">ATM CONTAINER</span>
              <span className="hidden group-hover:inline text-[10px] text-slate-500">
                {containerMenuOpen ? '▲' : '▼'}
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
          <SideLink to="/workspace/atm-industrial" icon={sidebarIcons.industrial} label="ATM INDUSTRIAL" />
          {(role === 'admin' || role === 'service') && (
            <SideLink to="/service" icon={sidebarIcons.service} label="Reparación y mantenimiento" />
          )}

          {canSeeAdminBlock && (
            <>
              <hr className="my-2 dark:border-slate-800" />
              {canSeeAdminCore && (
                <>
                  <SideLink to="/admin/users" icon={sidebarIcons.user} label="Usuarios" />
                  <SideLink to="/admin/params" icon={sidebarIcons.params} label="Par\u00e1metros" />
                </>
              )}
              {canSeeFinanceBlock && (
                <>
                  <SideLink to="/admin/finance" icon={sidebarIcons.finance} label="Gerencia" />
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
                      <span className="hidden group-hover:inline flex-1 text-left">Administraci\u00f3n (Ops)</span>
                      <span className="hidden group-hover:inline text-[10px] text-slate-500">
                        {adminOpsMenuOpen ? '▲' : '▼'}
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
                      <SideLink
                        to="/invoices"
                        icon={sidebarIcons.invoices}
                        label="Facturas"
                      />
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
              <SideLink to="/contacts" icon={sidebarIcons.contacts} label="Contactos" />
              <SideLink to="/organizations" icon={sidebarIcons.orgs} label="Organizaciones" />
            </>
          )}

          {canSeeCommercialModules && (
            <>
              <hr className="my-2 dark:border-slate-800" />
              <SideLink to="/purchase-orders" icon={sidebarIcons.orders} label="\u00d3rdenes de compra" />
              {canSeeFollowupManagement && <SideLink to="/followup-management" icon={sidebarIcons.followup} label="Gestion de seguimiento" />}
              <SideLink to="/quotes" icon={sidebarIcons.quotes} label="Cotizaciones" />
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
      <main className="bg-gray-50 dark:bg-slate-900 flex-1 min-w-0">
        <div className="p-4 border-b bg-white dark:bg-slate-950 dark:border-slate-800 sticky top-0 z-40">
          <GlobalSearchBar />
        </div>
        <div className="p-4">{children}</div>
      </main>
      <AssistantBubble />
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
                <Route path="/admin" element={<Navigate to="/followup-management?tab=audit" replace />} />
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
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
