// client/src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import bgImage from "../assets/IMAGEN FONDO ATM.jpg";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from?.pathname || "/";

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [activeFeature, setActiveFeature] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  // Efecto de scroll parallax
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-rotate features
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % 4);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await login({ email, password: pass });
      nav(from, { replace: true });
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Usuario o contraseña inválidos";
      setErr(msg);
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const features = [
    {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      ),
      title: "Gestión Centralizada",
      description:
        "Toda la información de tu operación en un solo lugar. Sin saltos entre sistemas.",
      color: "from-blue-500 to-cyan-500",
    },
    {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      ),
      title: "Flujo Simplificado",
      description:
        "Desde la cotización hasta el cierre, todo se gestiona dentro de la misma operación.",
      color: "from-cyan-500 to-blue-500",
    },
    {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      ),
      title: "Ahorro de Tiempo",
      description:
        "Elimina trámites innecesarios. Actualiza, consulta y gestiona sin complicaciones.",
      color: "from-blue-500 to-cyan-500",
    },
    {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      ),
      title: "Historial Completo",
      description:
        "Seguimiento, visitas, presupuestos y documentos. Todo vinculado a cada operación.",
      color: "from-cyan-500 to-blue-500",
    },
  ];

  const benefits = [
    { number: "01", text: "Cotizaciones", subtext: "Rápidas y precisas" },
    { number: "02", text: "Seguimiento", subtext: "En tiempo real" },
    { number: "03", text: "Presupuestos", subtext: "Con versionado" },
    { number: "04", text: "Documentos", subtext: "Centralizados" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-hidden">
      {/* Hero Section con parallax */}
      <div
        className="relative min-h-screen flex items-center justify-center overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.85)), url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse"
            style={{ transform: `translateY(${scrollY * 0.5}px)` }}
          ></div>
          <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse"
            style={{
              transform: `translateY(${scrollY * -0.3}px)`,
              animationDelay: "1s",
            }}
          ></div>
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        </div>

        {/* Floating particles */}
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-blue-400/30 rounded-full animate-float"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${5 + Math.random() * 10}s`,
              }}
            ></div>
          ))}
        </div>

        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 py-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left side - Interactive presentation */}
            <div className="space-y-8 text-white">
              {/* Animated title */}
              <div className="space-y-4">
                <div className="inline-block">
                  <h1 className="text-6xl md:text-7xl font-bold bg-gradient-to-r from-white via-blue-200 to-cyan-300 bg-clip-text text-transparent animate-gradient">
                    ATM Cargo
                  </h1>
                  <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full mt-2 animate-expand"></div>
                </div>
                <p className="text-2xl md:text-3xl text-blue-200 font-light animate-fade-in">
                  Todo en una sola operación
                </p>
              </div>

              {/* Interactive feature cards */}
              <div className="space-y-4">
                {features.map((feature, index) => (
                  <div
                    key={index}
                    onClick={() => setActiveFeature(index)}
                    className={`cursor-pointer transition-all duration-500 transform ${activeFeature === index
                        ? "scale-105 opacity-100"
                        : "scale-100 opacity-60 hover:opacity-80"
                      }`}
                  >
                    <div
                      className={`p-6 rounded-2xl backdrop-blur-sm border transition-all duration-500 ${activeFeature === index
                          ? "bg-white/10 border-white/30 shadow-2xl"
                          : "bg-white/5 border-white/10 hover:bg-white/8"
                        }`}
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={`flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center shadow-lg transition-transform duration-500 ${activeFeature === index
                              ? "scale-110 rotate-6"
                              : "scale-100 rotate-0"
                            }`}
                        >
                          <svg
                            className="w-7 h-7 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            {feature.icon}
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold mb-2">
                            {feature.title}
                          </h3>
                          <p
                            className={`text-blue-200 text-sm transition-all duration-500 ${activeFeature === index
                                ? "max-h-20 opacity-100"
                                : "max-h-0 opacity-0 overflow-hidden"
                              }`}
                          >
                            {feature.description}
                          </p>
                        </div>
                        <div
                          className={`flex-shrink-0 transition-transform duration-500 ${activeFeature === index ? "rotate-90" : "rotate-0"
                            }`}
                        >
                          <svg
                            className="w-6 h-6 text-blue-300"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Benefits grid */}
              <div className="grid grid-cols-2 gap-4 pt-6">
                {benefits.map((benefit, index) => (
                  <div
                    key={index}
                    className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-white/5 to-white/10 p-4 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all duration-300 hover:scale-105"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-cyan-500/0 group-hover:from-blue-500/10 group-hover:to-cyan-500/10 transition-all duration-300"></div>
                    <div className="relative">
                      <div className="text-4xl font-bold text-blue-400/50 mb-1">
                        {benefit.number}
                      </div>
                      <div className="text-lg font-semibold text-white">
                        {benefit.text}
                      </div>
                      <div className="text-sm text-blue-200">
                        {benefit.subtext}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Scroll indicator */}
              <div className="flex items-center gap-2 text-blue-300 animate-bounce">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                <span className="text-sm">Explora más abajo</span>
              </div>
            </div>

            {/* Right side - Login form */}
            <div className="lg:sticky lg:top-8">
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 md:p-10 border border-white/20 transform hover:scale-[1.02] transition-transform duration-300">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-slate-900 mb-2">
                    Bienvenido
                  </h2>
                  <p className="text-slate-600">
                    Ingresa tus credenciales para acceder
                  </p>
                </div>

                <form onSubmit={onSubmit} className="space-y-6">
                  {err && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2 animate-shake">
                      <svg
                        className="w-5 h-5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{err}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">
                        Email
                      </span>
                      <div className="relative mt-1.5">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <svg
                            className="w-5 h-5 text-slate-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"
                            />
                          </svg>
                        </div>
                        <input
                          className="w-full border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="tu@email.com"
                          autoFocus
                          required
                        />
                      </div>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">
                        Contraseña
                      </span>
                      <div className="relative mt-1.5">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <svg
                            className="w-5 h-5 text-slate-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            />
                          </svg>
                        </div>
                        <input
                          className="w-full border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          type="password"
                          value={pass}
                          onChange={(e) => setPass(e.target.value)}
                          placeholder="••••••••"
                          required
                        />
                      </div>
                    </label>
                  </div>

                  <button
                    disabled={submitting}
                    className="w-full px-4 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                    type="submit"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Ingresando...
                      </span>
                    ) : (
                      "Ingresar al Sistema"
                    )}
                  </button>
                </form>

                <div className="mt-8 pt-6 border-t border-slate-200">
                  <p className="text-xs text-center text-slate-500">
                    © 2024 ATM Cargo System. Todos los derechos reservados.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Additional info section with scroll reveal */}
      <div className="relative bg-gradient-to-b from-slate-950 to-slate-900 py-20">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              ¿Por qué ATM Cargo System?
            </h2>
            <p className="text-xl text-blue-200">
              La solución integral para tu logística
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Sin Fragmentación",
                desc: "Olvídate de múltiples sistemas. Todo en un solo lugar.",
                icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z",
              },
              {
                title: "Trazabilidad Total",
                desc: "Seguimiento completo desde el inicio hasta el final de cada operación.",
                icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
              },
              {
                title: "Eficiencia Máxima",
                desc: "Reduce tiempos y aumenta la productividad de tu equipo.",
                icon: "M13 10V3L4 14h7v7l9-11h-7z",
              },
            ].map((item, index) => (
              <div
                key={index}
                className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/5 to-white/10 p-8 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all duration-500 hover:scale-105"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-cyan-500/0 group-hover:from-blue-500/20 group-hover:to-cyan-500/20 transition-all duration-500"></div>
                <div className="relative">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <svg
                      className="w-8 h-8 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d={item.icon} clipRule="evenodd" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">
                    {item.title}
                  </h3>
                  <p className="text-blue-200">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }
        @keyframes gradient {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        @keyframes expand {
          from {
            width: 0%;
          }
          to {
            width: 100%;
          }
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-5px);
          }
          75% {
            transform: translateX(5px);
          }
        }
        .animate-float {
          animation: float ease-in-out infinite;
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }
        .animate-expand {
          animation: expand 1s ease-out;
        }
        .animate-fade-in {
          animation: fade-in 1s ease-out;
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}
