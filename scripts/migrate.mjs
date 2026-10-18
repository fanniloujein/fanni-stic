// Applique les migrations de la base de données (création / mise à jour des tables).
// Lancé au build (mode --soft : n'interrompt pas le build si la base est inaccessible à ce moment-là)
// et au démarrage (mode strict : le serveur ne démarre pas sur une base non synchronisée).
import { spawnSync } from "node:child_process";

// En local, les variables viennent du fichier .env (chez l'hébergeur, elles sont déjà définies).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    /* pas de fichier .env */
  }
}

const soft = process.argv.includes("--soft");
const tag = soft ? "[migrations · build]" : "[migrations]";

if (!process.env.DATABASE_URL) {
  console.error(`${tag} DATABASE_URL n'est pas définie : ajoutez-la dans les variables d'environnement de l'hébergeur.`);
  process.exit(soft ? 0 : 1);
}

const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { encoding: "utf8", shell: process.platform === "win32" });
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
process.stdout.write(out);

if (r.status === 0) {
  console.log(`${tag} ✔ base de données à jour.`);
  process.exit(0);
}

const hints = [
  [/P1001|Can't reach database server|ECONNREFUSED|ENOTFOUND/i, "Serveur de base injoignable : vérifiez l'adresse dans DATABASE_URL (sur Render, l'« Internal URL » ne fonctionne que pour un service de la même région ; sinon utilisez l'« External URL »)."],
  [/P1000|Authentication failed|password authentication/i, "Identifiants refusés : copiez à nouveau DATABASE_URL depuis l'hébergeur de la base."],
  [/P1003|does not exist/i, "La base indiquée dans DATABASE_URL n'existe pas."],
  [/P1011|TLS|SSL/i, "Connexion chiffrée requise : ajoutez ?sslmode=require à la fin de DATABASE_URL."],
  [/P3009|P3018|failed migration/i, "Une migration précédente a échoué : voir la section « Base non synchronisée » du README."],
];
const hint = hints.find(([re]) => re.test(out))?.[1] ?? "Voir le message ci-dessus et la section « Base non synchronisée » du README.";
console.error(`${tag} ✖ migrations non appliquées. ${hint}`);
process.exit(soft ? 0 : 1);
