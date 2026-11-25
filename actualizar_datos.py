"""Descarga del servidor la copia de datos (datos.json) que el tablero muestra al abrir.

Uso:  python actualizar_datos.py
Solo reescribe el archivo cuando la información cambió. Si una consulta falla,
conserva la copia anterior de esa vista.
"""
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

CARPETA = pathlib.Path(__file__).resolve().parent
API = re.search(r"'(https://script\.google\.com/[^']+/exec)'",
                (CARPETA / "config.js").read_text(encoding="utf-8")).group(1)


def clave(fn, args):
    # Debe coincidir con fn + JSON.stringify(args) de gas-shim.js
    return fn + json.dumps(args, ensure_ascii=False, separators=(",", ":"))


def pedir(fn, args, intentos=4):
    url = API + "?" + urllib.parse.urlencode(
        {"api": "call", "fn": fn, "args": json.dumps(args, ensure_ascii=False, separators=(",", ":"))})
    for n in range(1, intentos + 1):
        inicio = time.time()
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                resp = json.load(r)
            if not resp.get("ok"):
                raise RuntimeError(resp.get("error"))
            print(f"  ok    {fn} {args[:1]} {time.time() - inicio:.1f}s", flush=True)
            return resp["data"]
        except Exception as e:  # el servidor se bloquea de forma intermitente
            print(f"  falla {fn} {args[:1]} intento {n}: {e}", flush=True)
    return None


def main():
    entradas = {}
    destino = CARPETA / "datos.json"
    previas = json.loads(destino.read_text(encoding="utf-8"))["entradas"] if destino.exists() else {}

    def tomar(fn, args):
        data = pedir(fn, args)
        k = clave(fn, args)
        if data is not None:
            entradas[k] = data
        elif k in previas:
            entradas[k] = previas[k]
        return data

    fecha = int(time.time() * 1000)
    menu = tomar("apiMenu", [])
    if menu is None:
        raise SystemExit("No se obtuvo el menú; datos.json no se modificó.")
    tomar("apiAniosDisponibles", [])
    tomar("apiModulosExportables", [])
    tomar("apiRegistroFotografico", [{}])
    for cat in menu:
        for hoja in cat["hojas"]:
            if hoja["modo"] == "turnos":
                tomar("apiTurnos", [None, None])
            elif hoja["modo"] == "cronograma":
                tomar("apiCronograma", [None, None])
            else:
                tomar("apiDatosHojaClasificada", [hoja["nombre"], {"tipo": "todo"}, {}])

    if entradas == previas:
        print("Sin cambios.")
        return
    destino.write_text(json.dumps({"fecha": fecha, "entradas": entradas}, ensure_ascii=False,
                                  separators=(",", ":")), encoding="utf-8")
    print(f"{len(entradas)} consultas guardadas, {destino.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
