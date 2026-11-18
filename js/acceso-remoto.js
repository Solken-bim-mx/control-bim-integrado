/**
 * Acceso remoto (Pieza 4, 2026-11-18).
 *
 * Los enlaces "Iniciar sesión" del sitio público apuntaban siempre a
 * http://localhost:3002/agent/ -- correcto solo si la persona está frente
 * a la misma PC/servidor donde tiene Solken instalado (ver sesión
 * 2026-11-18, Opción B). Este script intercepta esos enlaces y antes de
 * navegar:
 *   1. Abre un mini-login (Google o correo+contraseña) contra
 *      solken-suscripciones directamente desde el navegador (CORS
 *      habilitado solo para este origen -- ver main.py).
 *   2. Si el login identifica al tenant y este configuró su propio acceso
 *      remoto (Tenant.url_remota, panel Configuración del agente), navega
 *      ahí en vez de a esta misma PC.
 *   3. Si no hay url_remota, o el JS falla por cualquier razón, se cae al
 *      href original (localhost:3002/agent/) -- este script nunca rompe el
 *      comportamiento anterior, solo lo mejora cuando puede.
 *
 * El destino SIEMPRE es la página /login de ese agente (local o remoto),
 * no /agent/ directamente: el solken_token de este login es solo para
 * *identificar* a dónde mandar a la persona, el agente destino hace su
 * propio login real (misma página que ya existe hoy) y pone su propia
 * cookie de sesión en su propio origen -- no intentamos mover el JWT entre
 * orígenes, que sería frágil e inseguro.
 */
(function () {
  "use strict";

  var BACKEND = "https://solken-suscripciones.onrender.com";
  var GOOGLE_CLIENT_ID = "766562700713-441tffpibcm3vaa0srlv8sgmfammnu4e.apps.googleusercontent.com";

  function destino(base) {
    return base.replace(/\/+$/, "") + "/login?next=/agent";
  }

  // ─── Modal ────────────────────────────────────────────────────────────
  var modalEl = null;

  function cerrarModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function construirModal(hrefFallback) {
    var overlay = document.createElement("div");
    overlay.className = "sk-login-overlay";
    overlay.innerHTML =
      '<div class="sk-login-modal" role="dialog" aria-label="Iniciar sesión en Solken">' +
      '  <button type="button" class="sk-login-cerrar" aria-label="Cerrar">&times;</button>' +
      '  <h2>Inicia sesión</h2>' +
      '  <p class="sk-login-sub">Te llevamos a tu Solken -- en esta PC o donde lo tengas instalado.</p>' +
      '  <div id="sk-google-btn" class="sk-google-btn"></div>' +
      '  <div class="sk-login-divider"><span>o con correo</span></div>' +
      '  <form id="sk-login-form" class="sk-login-form">' +
      '    <input type="email" id="sk-login-email" placeholder="correo@ejemplo.com" required autocomplete="email">' +
      '    <input type="password" id="sk-login-password" placeholder="Contraseña" required autocomplete="current-password">' +
      '    <button type="submit">Continuar</button>' +
      '  </form>' +
      '  <p class="sk-login-err" id="sk-login-err"></p>' +
      '  <p class="sk-login-fallback">¿Prefieres entrar directo? <a href="' + hrefFallback + '">Ir a esta PC</a></p>' +
      "</div>";
    return overlay;
  }

  function mostrarError(msg) {
    var err = document.getElementById("sk-login-err");
    if (!err) return;
    // FastAPI manda detail como string en errores propios (HTTPException),
    // pero como lista de objetos {loc, msg, type} en errores de validacion
    // de Pydantic (ej. 2026-11-18: id_token sin proveedor_auth) -- sin esto
    // el navegador convierte el objeto/arreglo a "[object Object]".
    if (Array.isArray(msg)) {
      msg = msg.map(function (m) { return m && m.msg ? m.msg : JSON.stringify(m); }).join(" / ");
    } else if (msg && typeof msg === "object") {
      msg = msg.msg || JSON.stringify(msg);
    }
    err.textContent = msg || "No se pudo iniciar sesion.";
    err.style.display = "block";
  }

  // Si el tenant configuro su propio acceso remoto, no asumimos a donde
  // quiere ir: puede estar sentado frente a esta misma PC (y no le sirve
  // de nada pasar por Cloudflare Access) o fuera de la oficina. Solo
  // mandamos directo cuando hay una sola opcion posible (sin url_remota).
  function continuarConRespuesta(data) {
    var urlRemota = (data.url_remota || "").trim();
    if (!urlRemota) {
      window.location.href = destino("http://localhost:3002");
      return;
    }
    mostrarEleccionDestino(urlRemota);
  }

  function mostrarEleccionDestino(urlRemota) {
    if (!modalEl) return;
    var modal = modalEl.querySelector(".sk-login-modal");
    modal.innerHTML =
      '<button type="button" class="sk-login-cerrar" aria-label="Cerrar">&times;</button>' +
      '<h2>&iexcl;Ya casi!</h2>' +
      '<p class="sk-login-sub">&iquest;Desde d&oacute;nde quieres entrar?</p>' +
      '<div class="sk-destino-opciones">' +
      '  <button type="button" class="sk-destino-btn" id="sk-destino-pc">' +
      '    <strong>Esta PC</strong>' +
      '    <span>Est&aacute;s frente al equipo donde tienes Solken instalado</span>' +
      "  </button>" +
      '  <button type="button" class="sk-destino-btn" id="sk-destino-remoto">' +
      '    <strong>Acceso remoto</strong>' +
      '    <span>Entrar desde fuera, vía tu acceso remoto configurado</span>' +
      "  </button>" +
      "</div>";
    modal.querySelector(".sk-login-cerrar").addEventListener("click", cerrarModal);
    modal.querySelector("#sk-destino-pc").addEventListener("click", function () {
      window.location.href = destino("http://localhost:3002");
    });
    modal.querySelector("#sk-destino-remoto").addEventListener("click", function () {
      window.location.href = destino(urlRemota);
    });
  }

  async function enviarLogin(url, body) {
    try {
      var r = await fetch(BACKEND + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      var data = await r.json();
      if (!r.ok) {
        mostrarError(data.detail || data.error || "No se pudo iniciar sesión.");
        return;
      }
      continuarConRespuesta(data);
    } catch (e) {
      mostrarError("No se pudo contactar a Solken. Intenta de nuevo o usa el enlace directo.");
    }
  }

  function onCredentialGoogle(response) {
    enviarLogin("/auth/login", { id_token: response.credential, proveedor_auth: "google" });
  }

  function abrirModal(hrefFallback) {
    cerrarModal();
    modalEl = construirModal(hrefFallback);
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl) cerrarModal();
    });
    modalEl.querySelector(".sk-login-cerrar").addEventListener("click", cerrarModal);

    modalEl.querySelector("#sk-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("sk-login-email").value.trim();
      var password = document.getElementById("sk-login-password").value;
      enviarLogin("/auth/login-password", { email: email, password: password });
    });

    // Botón de Google: si el script de Identity Services ya cargó, lo
    // renderizamos; si no (red lenta, bloqueador), el formulario de correo
    // y el enlace de respaldo siguen funcionando igual.
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: onCredentialGoogle,
          // auto_select (2026-11-18, a pedido de Carlos): si el navegador
          // ya tiene una sesion de Google activa, entra directo con esa
          // cuenta sin mostrar el selector de cuentas de Google. Si la
          // persona quiere usar otra cuenta, debe cerrar sesion de Google
          // en el navegador primero.
          auto_select: true,
        });
        window.google.accounts.id.renderButton(
          document.getElementById("sk-google-btn"),
          { type: "standard", theme: "outline", size: "large", shape: "pill", width: 280 }
        );
      } catch (e) {
        /* sin Google -- el formulario de correo basta */
      }
    }
  }

  function engancharEnlaces() {
    var enlaces = document.querySelectorAll('a[href="http://localhost:3002/agent/"]');
    enlaces.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        abrirModal(a.getAttribute("href"));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", engancharEnlaces);
  } else {
    engancharEnlaces();
  }
})();
