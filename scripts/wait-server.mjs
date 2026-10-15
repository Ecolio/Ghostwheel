// Attend qu’une adresse locale réponde, quel que soit son statut HTTP. Avec un PID, renonce dès
// que ce processus s’arrête : un serveur arrêté au démarrage ne répondra jamais.
// Usage : node scripts/wait-server.mjs [adresse] [secondes] [pid]
const url = process.argv[2] ?? 'http://127.0.0.1:3000/api/health';
const seconds = Number(process.argv[3] ?? 60);
const pid = Number(process.argv[4] || 0);
const deadline = Date.now() + (Number.isFinite(seconds) ? seconds : 60) * 1000;

const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

while (Date.now() < deadline) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    process.exit(0);
  } catch {
    if (pid > 0 && !alive()) process.exit(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
console.error('Pas de réponse de ' + url + '.');
process.exit(1);
