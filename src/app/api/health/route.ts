import { prisma } from "@/server/db";
import { isMailConfigured, siteUrl } from "@/server/mail";
import { getServices } from "@/server/catalog";

export const dynamic = "force-dynamic";

/** Masque l'essentiel d'un nom d'hôte tout en permettant de reconnaître la base utilisée. */
function maskHost(host: string) {
  return host.length <= 10 ? host : `${host.slice(0, 8)}…${host.slice(-6)}`;
}

/**
 * Diagnostic de déploiement : base joignable, tables créées, migrations, administrateur.
 * N'expose aucune donnée personnelle ni secret.
 */
export async function GET() {
  const out: Record<string, unknown> = { siteUrl: siteUrl(), mail: isMailConfigured() ? "configuré" : "non configuré" };
  const problems: string[] = [];

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    problems.push("DATABASE_URL n'est pas définie dans les variables d'environnement.");
  } else {
    try {
      const u = new URL(raw);
      out.database = { host: maskHost(u.hostname), name: u.pathname.replace(/^\//, "") };
    } catch {
      problems.push("DATABASE_URL n'est pas une adresse valide (attendu : postgresql://utilisateur:motdepasse@hote:5432/base).");
    }
  }

  if (raw) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      out.connection = "ok";
      const tables = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('ProjectRequest','Service','User','Setting')`;
      if (Number(tables[0]?.n ?? 0) < 4) {
        problems.push("Les tables n'existent pas encore : les migrations n'ont pas été appliquées (commande de démarrage : npm start).");
      } else {
        const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
        out.migrations = migrations.map((m) => `${m.migration_name}${m.finished_at ? "" : m.rolled_back_at ? " (annulée)" : " (ÉCHOUÉE)"}`);
        if (migrations.some((m) => !m.finished_at && !m.rolled_back_at)) problems.push("Une migration a échoué : voir la section « Base non synchronisée » du README.");
        const [admins, services, requests] = await Promise.all([
          prisma.user.count({ where: { role: "ADMIN" } }),
          getServices().then((s) => s.length), // crée aussi la configuration initiale si besoin
          prisma.projectRequest.count(),
        ]);
        out.counts = { administrateurs: admins, services, demandes: requests };
        if (!admins) problems.push("Aucun administrateur : définissez ADMIN_EMAIL et ADMIN_PASSWORD (12 caractères min.) puis redémarrez, ou lancez npm run admin:create.");
      }
    } catch (e) {
      out.connection = "échec";
      problems.push(`Connexion à la base impossible : ${(e as Error).message.split("\n").filter(Boolean).slice(-1)[0]}`);
    }
  }

  return Response.json({ ok: problems.length === 0, problems, ...out }, { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
