/* SCAFFOLD — interface-engineer owns this file. See CONTRACT.md: UI owns the
   single fixed-step master loop, all DOM screens, input (bound once), settings,
   autosave cadence. */
(function(g){
  g.UI = { startLoop(){}, stopLoop(){}, bindInput(){}, syncHud(){}, paused:false };
})(typeof window!=='undefined'?window:globalThis);
