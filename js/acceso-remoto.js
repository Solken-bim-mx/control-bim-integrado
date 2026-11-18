/**
 * Acceso remoto (Pieza 4, 2026-11-18).
 *
 * Los enlaces "Iniciar sesión" del sitio público apuntaban siempre a
 * http://localhost:3002/agent/ -- correcto solo si la persona está frente
 * a la misma PC/servidor donde tiene Solken instalado (ver sesión
 * 2026-11-18, Opción B). Este script intercepta esos enlaces.
 *
 * Flujo (reordenado 2026-11-18 a pedido de Carlos -- la version anterior
 * pedia login SIEMPRE antes de preguntar destino, lo que forzaba un login
 * extra incluso para el caso mas comun, entrar en la misma PC):
 *   1. Pregunta primero "¿Esta PC o Acceso remoto?" -- sin pedir login
 *      todavia, porque para entrar en esta PC no hace falta identificar a
 *      nadie.
 *   2. "Esta PC" -> va directo a localhost:3002/login, un solo clic.
 *   3. "Acceso remoto" -> AHI SI pide login (Google o correo+contraseña)
 *      contra solken-suscripciones, porque hace falta saber quien es para
 *      buscar su url_remota (Tenant.url_remota, panel Configuración del
 *      agente). Si no tiene una configurada, se le avisa y se le ofrece
 *      "Esta PC" en su lugar.
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

  function irAEstaPC() {
    window.location.href = destino("http://localhost:3002");
  }

  // ─── Modal ────────────────────────────────────────────────────────────
  var modalEl = null;

  function cerrarModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function render(html) {
    if (!modalEl) return;
    var modal = modalEl.querySelector(".sk-login-modal");
    modal.innerHTML = html;
    var cerrarBtn = modal.querySelector(".sk-login-cerrar");
    if (cerrarBtn) cerrarBtn.addEventListener("click", cerrarModal);
    return modal;
  }

  function mostrarEleccionDestino() {
    var modal = render(
      '<button type="button" class="sk-login-cerrar" aria-label="Cerrar">&times;</button>' +
      "<h2>Inicia sesión</h2>" +
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
      "</div>"
    );
    modal.querySelector("#sk-destino-pc").addEventListener("click", irAEstaPC);
    modal.querySelector("#sk-destino-remoto").addEventListener("click", mostrarLogin);
  }

  function mostrarLogin() {
    var modal = render(
      '<button type="button" class="sk-login-cerrar" aria-label="Cerrar">&times;</button>' +
      "<h2>Inicia sesión</h2>" +
      '<p class="sk-login-sub">Para mandarte a tu acceso remoto necesitamos identificarte.</p>' +
      '<div id="sk-google-btn" class="sk-google-btn"></div>' +
      '<div class="sk-login-divider"><span>o con correo</span></div>' +
      '<form id="sk-login-form" class="sk-login-form">' +
      '  <input type="email" id="sk-login-email" placeholder="correo@ejemplo.com" required autocomplete="email">' +
      '  <input type="password" id="sk-login-password" placeholder="Contraseña" required autocomplete="current-password">' +
      "  <button type=\"submit\">Continuar</button>" +
      "</form>" +
      '<p class="sk-login-err" id="sk-login-err"></p>' +
      '<p class="sk-login-fallback">&iquest;Prefieres entrar directo? <a href="#" id="sk-volver-pc">Ir a esta PC</a></p>'
    );

    modal.querySelector("#sk-volver-pc").addEventListener("click", function (e) {
      e.preventDefault();
      irAEstaPC();
    });

    modal.querySelector("#sk-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("sk-login-email").value.trim();
      var password = document.getElementById("sk-login-password").value;
      enviarLogin("/auth/login-password", { email: email, password: password });
    });

    // Botón de Google: si el script de Identity Services ya cargó, lo
    // renderizamos; si no (red lenta, bloqueador), el formulario de correo
    // sigue funcionando igual.
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

  function continuarConRespuesta(data) {
    var urlRemota = (data.url_remota || "").trim();
    if (!urlRemota) {
      render(
        '<button type="button" class="sk-login-cerrar" aria-label="Cerrar">&times;</button>' +
        "<h2>A&uacute;n no tienes acceso remoto</h2>" +
        '<p class="sk-login-sub">No encontramos un acceso remoto configurado para tu cuenta. Config&uacute;ralo en Configuraci&oacute;n &rarr; Acceso remoto dentro de Solken, desde esta PC.</p>' +
        '<div class="sk-destino-opciones">' +
        '  <button type="button" class="sk-destino-btn" id="sk-destino-pc">' +
        "    <strong>Entrar en esta PC</strong>" +
        "  </button>" +
        "</div>"
      ).querySelector("#sk-destino-pc").addEventListener("click", irAEstaPC);
      return;
    }
    window.location.href = destino(urlRemota);
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

  function abrirModal() {
    cerrarModal();
    modalEl = document.createElement("div");
    modalEl.className = "sk-login-overlay";
    modalEl.innerHTML = '<div class="sk-login-modal" role="dialog" aria-label="Iniciar sesión en Solken"></div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl) cerrarModal();
    });
    mostrarEleccionDestino();
  }

  function engancharEnlaces() {
    var enlaces = document.querySelectorAll('a[href="http://localhost:3002/agent/"]');
    enlaces.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        abrirModal();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", engancharEnlaces);
  } else {
    engancharEnlaces();
  }
})();
