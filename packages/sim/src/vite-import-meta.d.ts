/**
 * LE TYPE de `import.meta.glob`, réduit à l'usage de la garde des plans (`plans-batis.test.ts`) :
 * vitest passe par Vite, qui fournit l'implémentation. Types seulement — rien ne s'exécute
 * ici, la pureté de `/sim` ne bouge pas.
 */
interface ImportMeta {
  glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, unknown>
}
