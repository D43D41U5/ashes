/**
 * `virtual:braises-build-id` — module virtuel servi par vite.config (`buildIdPlugin`) : l'horodatage
 * du build + le hash git court, réévalué à chaque changement de source en dev. Voir
 * `scenes/ui/build-stamp.ts` pour l'affichage.
 */
declare module 'virtual:braises-build-id' {
  export const BUILD_ID: string
}
