// Imita google.script.run llamando por fetch() al punto de entrada ?api=call del servidor (Apps Script).
// Sin cookies: funciona igual para cualquier visitante, tenga una o varias cuentas de Google abiertas.
(function () {
  'use strict';
  const API = window.AMALFI_API_URL;
  async function request(fn, args) {
    const url = API + '?api=call&fn=' + encodeURIComponent(fn) + '&args=' + encodeURIComponent(JSON.stringify(args));
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow' });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { throw new Error('El servidor devolvio una respuesta no valida (' + res.status + ').'); }
        if (!json.ok) throw new Error(json.error || 'Error del servidor.');
        return json.data;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr;
  }
  function runner(onOk, onFail) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return (f) => runner(f, onFail);
        if (name === 'withFailureHandler') return (f) => runner(onOk, f);
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (...args) => {
          request(name, args).then(
            (data) => { if (onOk) onOk(data); },
            (err) => { if (onFail) onFail(err); else console.error(err); }
          );
        };
      }
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };
})();
