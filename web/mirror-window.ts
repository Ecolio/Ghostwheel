const name = 'cornelius-mirror';

/**
 * Ouvre le miroir dans sa propre fenêtre, à la taille de l’écran, et laisse l’administration
 * ouverte. Une fenêtre déjà ouverte est ramenée au premier plan sans être rechargée : le miroir
 * garde sa conversation et sa voix. À appeler dans le geste (clic), sinon le navigateur bloque.
 */
export function openMirrorWindow(): void {
  const { availWidth, availHeight } = window.screen;
  const features = `popup,left=0,top=0,width=${availWidth},height=${availHeight}`;
  // Une adresse vide retrouve la fenêtre déjà nommée sans la recharger.
  const mirror = window.open('', name, features);
  if (!mirror) {
    // Fenêtres surgissantes bloquées : un nouvel onglet, plutôt que de quitter l’administration.
    window.open('/', '_blank');
    return;
  }
  let fresh = true;
  try {
    fresh = mirror.location.href === 'about:blank';
  } catch {
    // Fenêtre d’une autre origine portant le même nom : elle est remplacée.
  }
  if (fresh) mirror.location.replace('/');
  mirror.focus();
}
