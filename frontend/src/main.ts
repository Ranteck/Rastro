import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vistas.css";
import { crearApi } from "./api.ts";
import { montarApp } from "./app.ts";
import { vistas } from "./views/index.ts";

const raiz = document.getElementById("app");
if (!raiz) throw new Error("Falta el contenedor #app en index.html");

montarApp({ raiz, api: crearApi(), vistas });
