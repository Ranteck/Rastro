import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vistas.css";
import { crearApi, fuenteDeEntorno } from "./api.ts";
import { montarApp } from "./app.ts";
import { vistas } from "./views/index.ts";

const raiz = document.getElementById("app");
if (!raiz) throw new Error("Falta el contenedor #app en index.html");

const fuente = fuenteDeEntorno();
montarApp({ raiz, api: crearApi({ fuente }), vistas, modoEjemplos: fuente === "ejemplos" });
