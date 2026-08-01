/* SCAFFOLD — content-writer owns this file. See CONTRACT.md for the required
   shape: CONTENT = { HEROES, PACTS, ENEMY_TYPES, RIFTS, COVENANT, ASCENSIONS,
   VEIL_TIERS, STRINGS, validatePacts() }. Pure data, no DOM, no state. */
(function(g){
  g.CONTENT = { HEROES:[], PACTS:[], ENEMY_TYPES:[], RIFTS:[], COVENANT:[],
    ASCENSIONS:[], VEIL_TIERS:[{min:0,mult:1},{min:25,mult:2},{min:50,mult:4},{min:75,mult:8},{min:90,mult:16}],
    STRINGS:{}, validatePacts(){ return []; } };
})(typeof window!=='undefined'?window:globalThis);
