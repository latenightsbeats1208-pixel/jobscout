// jsdom (v28) est fourni par isomorphic-dompurify mais sans types dédiés.
// On déclare l'API minimale utilisée par lib/scrapers/dom.ts et lib/offres/escaped-markup.ts.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
    /** Position du nœud dans la source (option includeNodeLocations), null pour un nœud créé après coup. */
    nodeLocation(node: Node): unknown;
  }
}
