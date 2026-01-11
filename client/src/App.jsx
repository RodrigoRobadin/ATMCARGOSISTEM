// client/src/App.jsx
import React from 'react';
import { NavLink, Routes, Route } from 'react-router-dom';

import Pipeline from './pages/Pipeline';
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

// Admin
import UsersAdmin from './pages/UsersAdmin.jsx';
import AdminParams from './pages/AdminParams.jsx';
import AdminActivity from './pages/AdminActivity.jsx';
import AccountStatement from './pages/AccountStatement.jsx';
import Payments from './pages/Payments.jsx';
import AdminExpenses from './pages/AdminExpenses.jsx';

// ?? NUEVO: Workspace de Administración (Ops)
import AdminWorkspace from './pages/admin/AdminWorkspace.jsx';

// Auth
import { RequireAuth, RequireRole, useAuth } from './auth.jsx';

// (opcional) generator dedicado:
import QuoteGenerator from './pages/QuoteGenerator.jsx';
import IndustrialQuoteGenerator from './pages/IndustrialQuoteGenerator.jsx';

// Seguimiento
import Invoices from './pages/Invoices.jsx';
import FollowUp from './pages/FollowUp.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail.jsx';

// ?? NUEVO: Editor de Pipeline (pantalla completa)
import PipelineEditorPage from './pages/PipelineEditorPage.jsx';

// Catálogo
import ProductsServices from './pages/catalog/ProductsServices.jsx';

// ?? NUEVO: Solicitud de flete desde operación
import RequestFreight from './pages/RequestFreight.jsx';

// ---------------- UI helpers ----------------
const sidebarIcons = {
  header: String.fromCodePoint(0x1F9ED),
  general: String.fromCodePoint(0x1F4CB),
  kanban: String.fromCodePoint(0x1F9E9),
  cargo: String.fromCodePoint(0x1F69A),
  industrial: String.fromCodePoint(0x1F3ED),
  admin: String.fromCodePoint(0x1F4C4),
  user: String.fromCodePoint(0x1F464),
  params: String.fromCodePoint(0x2699),
  adminOps: String.fromCodePoint(0x1F4C1),
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
   ${isActive ? 'bg-black text-white' : 'hover:bg-slate-100'}`;

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
  const role = user?.role || '';

  return (
    <div className="min-h-screen flex">
      {/* Lateral colapsable por hover */}
      <aside
        className="
          group bg-white border-r
          w-[64px] hover:w-[220px]
          transition-[width] duration-300 ease-in-out
          overflow-hidden
        "
      >
        {/* Header: compacto (icono) / expandido (título) */}
        <div className="border-b">
          <div className="h-14 flex items-center justify-center text-xl group-hover:hidden select-none">{sidebarIcons.header}</div>
          <div className="hidden group-hover:block p-4">
            <div className="text-lg font-semibold">CRM MVP</div>
            <div className="text-xs text-slate-500">GRUPO ATM</div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="p-3 space-y-1">
          <SideLink to="/general" icon={sidebarIcons.general} label="Vista general" />
          <SideLink to="/" icon={sidebarIcons.kanban} label="Kanban" />

          <hr className="my-2" />
          <div className="hidden group-hover:block text-xs text-slate-500 px-1 pb-1">
            Workspaces
          </div>
          <SideLink to="/workspace/atm-cargo" icon={sidebarIcons.cargo} label="ATM CARGO" />
          {/* Workspace industrial unico */}
          <SideLink to="/workspace/atm-industrial" icon={sidebarIcons.industrial} label="ATM INDUSTRIAL" />

          {/* Bloque administrativo visible SOLO si NO es "venta" */}
          {role !== 'venta' && (
            <>
              <hr className="my-2" />
              <SideLink to="/admin" icon={sidebarIcons.admin} label="Administraci\u00f3n" />
              <SideLink to="/admin/users" icon={sidebarIcons.user} label="Usuarios" />
              <SideLink to="/admin/params" icon={sidebarIcons.params} label="Par\u00e1metros" />
              <div className="relative group/admin-ops">
                <SideLink to="/admin-ops" icon={sidebarIcons.adminOps} label="Administraci\u00f3n (Ops)" />
                <div className="hidden group-hover/admin-ops:block ml-8 mt-1 space-y-1">
                  <SideLink
                    to="/account-statement"
                    icon={sidebarIcons.account}
                    label="Estado de cuenta de clientes"
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
              <hr className="my-2" />
              <SideLink to="/catalog" icon={sidebarIcons.catalog} label="Productos y servicios" />
            </>
          )}

          <hr className="my-2" />
          <SideLink to="/contacts" icon={sidebarIcons.contacts} label="Contactos" />
          <SideLink to="/organizations" icon={sidebarIcons.orgs} label="Organizaciones" />

          <hr className="my-2" />
          <SideLink to="/invoices" icon={sidebarIcons.invoices} label="Facturas" />
          <SideLink to="/purchase-orders" icon={sidebarIcons.orders} label="\u00d3rdenes de compra" />
          <SideLink to="/followup" icon={sidebarIcons.followup} label="Seguimiento" />
          <SideLink to="/quotes" icon={sidebarIcons.quotes} label="Cotizaciones" />

          <hr className="my-3" />
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
      <main className="bg-gray-50 flex-1 min-w-0">
        <div className="p-4 border-b bg-white sticky top-0 z-40">
          <GlobalSearchBar />
        </div>
        <div className="p-4">{children}</div>
      </main>
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

      {/* Resto de la app con Layout */}
      <Route
        path="*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Pipeline />} />
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

                {/* ---- Secciones restringidas a admin/manager ---- */}
                <Route
                  path="/admin"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <AdminActivity />
                    </RequireRole>
                  }
                />
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
                  path="/admin-ops"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <AdminWorkspace />
                    </RequireRole>
                  }
                />
                <Route
                  path="/payments"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <Payments />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin-expenses"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
                      <AdminExpenses />
                    </RequireRole>
                  }
                />
                <Route
                  path="/account-statement"
                  element={
                    <RequireRole allow={['admin', 'manager']}>
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

                {/* Cotizaciones */}
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/quotes/new" element={<QuoteEditor />} />
                <Route path="/quotes/:id" element={<QuoteEditor />} />

                <Route path="/invoices" element={<Invoices />} />
                <Route path="/invoices/:id" element={<InvoiceDetail />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />

                {/* Seguimiento */}
                <Route path="/followup" element={<FollowUp />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
