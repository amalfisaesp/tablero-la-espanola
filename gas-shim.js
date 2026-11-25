// Imita google.script.run llamando por fetch() al punto de entrada ?api=call del servidor (Apps Script).
// Sin cookies: funciona igual para cualquier visitante, tenga una o varias cuentas de Google abiertas.
//
// CARGA INMEDIATA: las consultas de lectura se pintan al instante con la última copia conocida
// (la guardada en este navegador o la publicada en datos.json) y se actualizan en segundo plano.
(function () {
  'use strict';
  const API = window.AMALFI_API_URL;
  const PREFIJO = 'amalfi1:';

  // Solo estas consultas se guardan. Las de generar/exportar van siempre directo al servidor.
  const LECTURA = ['apiMenu', 'apiAniosDisponibles', 'apiDatosHojaClasificada', 'apiRegistroFotografico',
    'apiTurnos', 'apiCronograma', 'apiModulosExportables', 'apiOpcionesFiltro'];
  // Consultas que no cambian la vista: la respuesta nueva queda guardada para la próxima apertura.
  const SIN_REDIBUJO = ['apiMenu', 'apiAniosDisponibles'];
  const SIN_VISTA = ['apiMenu', 'apiAniosDisponibles'];

  const copia = fetch('datos.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  async function pedir(fn, args, limiteMs) {
    const url = API + '?api=call&fn=' + encodeURIComponent(fn) + '&args=' + encodeURIComponent(JSON.stringify(args));
    const ctl = new AbortController();
    const reloj = limiteMs ? setTimeout(() => ctl.abort(), limiteMs) : null;
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow', signal: ctl.signal });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('El servidor devolvio una respuesta no valida (' + res.status + ').'); }
      if (!json.ok) throw new Error(json.error || 'Error del servidor.');
      return json.data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('El servidor tardo demasiado en responder. Intente de nuevo.');
      throw e;
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  }

  // Si el primer intento no responde en 20 s se lanza un segundo en paralelo; gana el que llegue antes.
  function pedirLectura(fn, args) {
    return new Promise((ok, mal) => {
      let listo = false, fallos = 0, segundo = false, reloj = null;
      function lanzar() {
        pedir(fn, args, 75000).then(
          (d) => { if (!listo) { listo = true; clearTimeout(reloj); ok(d); } },
          (e) => {
            if (listo) return;
            fallos++;
            if (!segundo) { clearTimeout(reloj); relevo(); }
            else if (fallos === 2) { listo = true; mal(e); }
          });
      }
      function relevo() { if (listo || segundo) return; segundo = true; lanzar(); }
      lanzar();
      reloj = setTimeout(relevo, 20000);
    });
  }

  async function leerGuardado(clave) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(PREFIJO + clave)); } catch (e) { /* sin copia local */ }
    const pub = await copia;
    const publicado = pub && pub.entradas && pub.entradas[clave] !== undefined
      ? { fecha: pub.fecha, data: pub.entradas[clave] } : null;
    if (local && publicado) return local.fecha >= publicado.fecha ? local : publicado;
    return local || publicado;
  }

  function guardar(clave, data) {
    try { localStorage.setItem(PREFIJO + clave, JSON.stringify({ fecha: Date.now(), data: data })); }
    catch (e) { /* almacenamiento lleno o bloqueado: se sigue con la copia publicada */ }
  }

  // ---- Aviso del estado de los datos ---------------------------------------
  let aviso = null, ocultar = null;
  function estadoDatos(texto, accion, duracionMs) {
    clearTimeout(ocultar);
    if (!aviso) {
      aviso = document.createElement('button');
      aviso.type = 'button';
      aviso.setAttribute('aria-live', 'polite');
      aviso.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:999;border:1px solid #2F8F8F;' +
        'background:#fff;color:#1f5f5f;border-radius:20px;padding:7px 16px;font:600 12px Nunito,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18);';
      document.body.appendChild(aviso);
    }
    aviso.textContent = texto;
    aviso.style.cursor = accion ? 'pointer' : 'default';
    aviso.onclick = accion || null;
    aviso.hidden = false;
    if (duracionMs) ocultar = setTimeout(() => { aviso.hidden = true; }, duracionMs);
  }
  function fechaCorta(ms) {
    return new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ---- Control de la vista activa ------------------------------------------
  // Una respuesta atrasada nunca debe pintarse sobre otra vista que el usuario abrió después.
  const turno = {};
  let toques = 0;
  ['click', 'input', 'change'].forEach((t) => document.addEventListener(t, (ev) => {
    if (ev.isTrusted && ev.target.closest && ev.target.closest('#viewRoot')) toques++;
  }, true));
  function vistaActual() { return document.querySelector('.nav-item.active'); }

  async function lectura(fn, args, onOk, onFail) {
    const clave = fn + JSON.stringify(args);
    const mio = (turno[fn] = (turno[fn] || 0) + 1);
    const guardado = await leerGuardado(clave);
    const vista = vistaActual();
    const vigente = () => SIN_VISTA.includes(fn) || (turno[fn] === mio && vistaActual() === vista);
    if (turno[fn] !== mio && !SIN_VISTA.includes(fn)) return;

    let toquesAlPintar = 0;
    if (guardado) {
      if (onOk) onOk(guardado.data);
      toquesAlPintar = toques;
      if (!SIN_VISTA.includes(fn)) estadoDatos('Datos del ' + fechaCorta(guardado.fecha) + ' · actualizando…');
    }

    let nuevo;
    try {
      nuevo = await pedirLectura(fn, args);
    } catch (err) {
      if (!vigente()) return;
      if (guardado) { if (!SIN_VISTA.includes(fn)) estadoDatos('Datos del ' + fechaCorta(guardado.fecha)); return; }
      if (onFail) onFail(err); else console.error(err);
      return;
    }
    guardar(clave, nuevo);
    if (!guardado) { if (vigente() && onOk) onOk(nuevo); return; }
    if (!vigente() || SIN_REDIBUJO.includes(fn)) return;
    if (JSON.stringify(nuevo) === JSON.stringify(guardado.data)) { estadoDatos('Datos al día', null, 3000); return; }
    const pintar = () => { if (vigente()) { if (onOk) onOk(nuevo); estadoDatos('Datos actualizados', null, 3000); } };
    // Si el usuario ya está trabajando en la vista, no se le redibuja sin avisar.
    if (toques === toquesAlPintar) pintar();
    else estadoDatos('Hay datos nuevos · tocar para mostrarlos', pintar);
  }

  // Al cambiar de vista se oculta el aviso de la anterior.
  document.addEventListener('click', (ev) => {
    if (aviso && ev.target.closest && ev.target.closest('.nav-item')) aviso.hidden = true;
  }, true);

  function ejecutar(fn, args, onOk, onFail) {
    // Las consultas con filtros se piden siempre en vivo.
    const conFiltros = fn === 'apiDatosHojaClasificada' && args[2] && Object.keys(args[2]).length > 0;
    if (LECTURA.includes(fn) && !conFiltros) { lectura(fn, args, onOk, onFail); return; }
    // Exportar y generar: un solo intento, para no crear archivos duplicados en Drive.
    const promesa = conFiltros ? pedirLectura(fn, args) : pedir(fn, args, 0);
    const mio = (turno[fn] = (turno[fn] || 0) + 1);
    const vista = vistaActual();
    const vigente = () => !conFiltros || (turno[fn] === mio && vistaActual() === vista);
    promesa.then(
      (data) => { if (vigente() && onOk) onOk(data); },
      (err) => { if (!vigente()) return; if (onFail) onFail(err); else console.error(err); }
    );
  }

  function runner(onOk, onFail) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return (f) => runner(f, onFail);
        if (name === 'withFailureHandler') return (f) => runner(onOk, f);
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (...args) => ejecutar(name, args, onOk, onFail);
      }
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };
})();
