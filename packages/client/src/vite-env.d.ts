/// <reference types="vite/client" />

/**
 * Variables d'environnement Vite propres à Braises. `import.meta.env.VITE_*` est
 * remplacé à la compilation ; ce fichier n'en fait que TYPER l'accès (fusion
 * d'interface avec `ImportMetaEnv` de vite/client).
 */
interface ImportMetaEnv {
  /**
   * URL du serveur Colyseus (ex. `ws://localhost:2567`). DÉFINIE → le client se
   * branche au serveur (multi, `createColyseusHost`) ; ABSENTE → Worker solo
   * (Veillée). C'est le seul aiguillage solo/multi tant qu'il n'y a pas de menu.
   */
  readonly VITE_SERVER_URL?: string
  /**
   * DEV : latence réseau artificielle en millisecondes (RTT simulé) sur l'hôte
   * Colyseus — `createColyseusHost` retarde envoi et réception de la moitié chacun.
   * Absente ou 0 → aucune latence. Sert à éprouver réconciliation + interpolation.
   */
  readonly VITE_FAKE_LAG_MS?: string
}
