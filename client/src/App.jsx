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
import OperationDetail from './pages/OperationDetail.jsx';
import Login from './pages/Login.jsx';
import GlobalSearchBar from './components/GlobalSearchBar.jsx';

// Admin
import UsersAdmin from './pages/UsersAdmin.jsx';
import AdminParams from './pages/AdminParams.jsx';
import AdminActivity from './pages/AdminActivity.jsx';

// ⭐️ NUEVO: Workspace de Administración (Ops)
import AdminWorkspace from './pages/admin/AdminWorkspace.jsx';

// Auth
import { RequireAuth, RequireRole, useAuth } from './auth.jsx';

// (opcional) generator dedicado:
import QuoteGenerator from './pages/QuoteGenerator.jsx';

// Seguimiento
import FollowUp from './pages/FollowUp.jsx';

// ⭐️ NUEVO: Editor de Pipeline (pantalla completa)
import PipelineEditorPage from './pages/PipelineEditorPage.jsx';
// + NUEVO import
import ProductsServices from "./pages/catalog/ProductsServices.jsx";


// ---------------- UI helpers ----------------
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
  const { logout } = useAuth();

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
          <div className="h-14 flex items-center justify-center text-xl group-hover:hidden select-none">
            📦
          </div>
          <div className="hidden group-hover:block p-4">
            <div className="text-lg font-semibold">CRM MVP</div>
            <div className="text-xs text-slate-500">GRUPO ATM</div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="p-3 space-y-1">
          <SideLink to="/general" icon="📋" label="Vista general" />
          <SideLink to="/" icon="🧩" label="Kanban" />

          <hr className="my-2" />
          <div className="hidden group-hover:block text-xs text-slate-500 px-1 pb-1">
            Workspaces
          </div>
          <SideLink to="/workspace/atm-cargo" icon="🚚" label="ATM CARGO" />
          <SideLink to="/workspace/industrial-rayflex" icon="⚙️" label="Rayflex" />
          <SideLink to="/workspace/industrial-boplan" icon="🛡️" label="Boplan" />

          <hr className="my-2" />
          {/* Admin existentes */}
          <SideLink to="/admin" icon="🧾" label="Administración" />
          <SideLink to="/admin/users" icon="👤" label="Usuarios" />
          <SideLink to="/admin/params" icon="⚙️" label="Parámetros" />
          {/* ⭐️ NUEVO: Administración (Ops) */}
          <SideLink to="/admin-ops" icon="📂" label="Administración (Ops)" />

           <hr className="my-2" />
          {/* Productos y servicios (nuevo) */}
          <SideLink to="/catalog" icon="🧾" label="Productos y servicios" />

          <hr className="my-2" />
          <SideLink to="/contacts" icon="👤" label="Contactos" />
          <SideLink to="/organizations" icon="🏢" label="Organizaciones" />

          <hr className="my-2" />
          <SideLink to="/followup" icon="📞" label="Seguimiento" />

          <hr className="my-3" />
          {/* Sesión */}
          <div className="px-3">
            <button
              onClick={logout}
              className="hidden group-hover:inline text-xs text-red-600 hover:underline"
            >
              Salir
            </button>
            {/* Icono solo en colapsado (opcional) */}
            <div className="group-hover:hidden flex justify-center">
              <span title="Salir">🚪</span>
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

      {/* ⭐️ Pantallas fullscreen fuera del layout */}
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

                {/* Catálogo */}
                <Route path="/catalog" element={<ProductsServices />} />

                {/* Contactos */}
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/contacts/:id" element={<ContactDetail />} />

                {/* Organizaciones */}
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/organizations/:id" element={<OrganizationDetail />} />

                {/* Workspaces */}
                <Route path="/workspace/:key" element={<Workspace />} />
                <Route path="/workspace/:key/table" element={<WorkspaceTable />} />

                {/* Admin existentes */}
                <Route path="/admin" element={<AdminActivity />} />
                <Route path="/admin/users" element={<UsersAdmin />} />
                <Route path="/admin/params" element={<AdminParams />} />

                {/* ⭐️ NUEVO: Administración (Ops) */}
                <Route path="/admin-ops" element={<AdminWorkspace />} />

                {/* Operaciones */}
                <Route path="/operations/:id" element={<OperationDetail />} />
                <Route path="/operations/:id/quote" element={<QuoteGenerator />} />

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
