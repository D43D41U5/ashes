import { describe, expect, it } from 'vitest'
import { ASTRES, astreSvg, astreUrl } from './astres'

/**
 * LES DEUX ASTRES SONT PARTAGÉS PAR DEUX ÉCRANS (barre haute, cadran de l'encyclopédie), et
 * l'un des deux les pose dans une `url()` de CSS — un contexte où le SVG brut ne marche PAS.
 */
describe('les astres au trait', () => {
  it('le data: n’expose aucun # brut — sinon la teinte ouvre un fragment', () => {
    // ⚠ CE QUI REND CE TEST ROUGE : rendre `astreUrl` sans encoder. Une teinte est un
    // `#rrggbb` ; dans une `url()`, ce `#` ouvre un FRAGMENT — le navigateur tronque la
    // source à cet endroit et n'affiche rien, sans un mot dans la console. La contre-épreuve
    // est dans le test : le SVG nu, lui, en porte bien un.
    expect(astreSvg('soleil', '#ffffff')).toContain('#')
    for (const nom of ['soleil', 'lune'] as const) {
      const url = astreUrl(nom, '#f2ead0')
      expect(url.startsWith('data:image/svg+xml,'), nom).toBe(true)
      expect(url.slice('data:image/svg+xml,'.length), nom).not.toContain('#')
      // Et il se relit : c'est bien le tracé partagé, avec sa teinte, qui part dans le CSS.
      const relu = decodeURIComponent(url.slice('data:image/svg+xml,'.length))
      expect(relu, nom).toContain(ASTRES[nom])
      expect(relu, nom).toContain('stroke="#f2ead0"')
    }
  })

  it('le SVG est autonome — il porte son xmlns, il ne vit pas que dans le document', () => {
    // Une icône de la barre haute est un NŒUD du document : elle hérite du namespace SVG de
    // son parent. Dans une `url()`, il n'y a pas de parent — sans `xmlns`, rien ne s'affiche.
    expect(astreSvg('lune', '#ffffff')).toContain('xmlns="http://www.w3.org/2000/svg"')
  })
})
