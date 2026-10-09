import "./styles/tokens.css";
import "./styles/base.css";
import { montarShell } from "./shell.ts";

const raiz = document.getElementById("app");
if (!raiz) throw new Error("Falta el contenedor #app en index.html");

montarShell(raiz);
