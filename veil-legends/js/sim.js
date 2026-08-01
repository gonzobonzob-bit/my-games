/* SCAFFOLD — systems-engineer owns this file. See CONTRACT.md for the full
   public API and frozen state field names. Zero DOM/canvas/audio access. */
(function(g){
  g.Sim = { state:{phase:'menu'}, events:[], drainEvents(){const e=this.events;this.events=[];return e;} };
})(typeof window!=='undefined'?window:globalThis);
