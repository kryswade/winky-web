/* ============================================================================
 * Winky Community - Plugin: Now Playing (Last.fm)
 * ---------------------------------------------------------------------------
 * Shows the song a user is currently listening to, right next to their online
 * status ("● online da PC  ·  🎵 Song — Artist").
 *
 * WHY LAST.FM: it has a free, official, no-auth read API (user.getRecentTracks)
 * that flags the current track with nowplaying="true". Last.fm aggregates
 * scrobbles from ANY source — so a single username covers YouTube Music,
 * Spotify, Apple Music, etc. No OAuth, no backend, no secret to hide.
 *
 * HOW IT WORKS:
 *   YOUR web client → polls Last.fm (30s) → upserts your `now_playing` row on
 *   Supabase. Everyone who opens a DM with you reads that row and sees the song.
 *
 * SETUP (per user, one-time): open Profile → "🎵 Collega Last.fm" → paste a free
 * Last.fm API key (once, saved locally) → type your Last.fm username. Leave the
 * username empty to disconnect.
 *
 * NOTES:
 *   • Presence METADATA only — does NOT touch E2E-encrypted messages.
 *   • Watch: read-only friendly; the watch never writes here.
 *   • Loaded on demand by the core plugin loader (classic script, shared scope:
 *     can use LS / rest / App / T / el / toast / promptDialog / I18N directly).
 * ==========================================================================*/
(function(){
  'use strict';

  // App-owner Last.fm API key (Winky Community app, registered to 'kryswade').
  // Read-only endpoints like user.getRecentTracks need ONLY the API key — the
  // shared secret is for signed/write calls and is deliberately NOT included
  // here (it must never ship in client code). With this set, users only enter
  // their Last.fm username; they are never asked for a key.
  var LASTFM_API_KEY = '4dc9204ccbaa4e35aee054a24ab1070f';

  function lfmKey(){ return (LASTFM_API_KEY && LASTFM_API_KEY.trim()) || LS.get('wc_lastfm_key','') || ''; }
  function lfmUser(){ return (LS.get('wc_lastfm_user','') || '').trim(); }

  // ---- i18n (merge into the core dictionary so it localises properly) -------
  var STRINGS = {
    en:{ lfmConnect:'\uD83C\uDFB5 Connect Last.fm', lfmChange:'\uD83C\uDFB5 Last.fm: ',
         lfmKeyPrompt:'Paste your free Last.fm API key (saved on this device):',
         lfmUserPrompt:'Your Last.fm username (leave empty to disconnect):',
         lfmConnected:'Last.fm connected', lfmDisconnected:'Last.fm disconnected',
         lfmNothing:'Nothing playing right now', lfmHint:'Scrobble from Spotify / YouTube Music / Apple Music to Last.fm and it shows up here.' },
    it:{ lfmConnect:'\uD83C\uDFB5 Collega Last.fm', lfmChange:'\uD83C\uDFB5 Last.fm: ',
         lfmKeyPrompt:'Incolla la tua chiave API Last.fm gratuita (salvata su questo dispositivo):',
         lfmUserPrompt:'Il tuo username Last.fm (lascia vuoto per scollegare):',
         lfmConnected:'Last.fm collegato', lfmDisconnected:'Last.fm scollegato',
         lfmNothing:'Nessun brano in riproduzione', lfmHint:'Fai scrobbling da Spotify / YouTube Music / Apple Music verso Last.fm e comparirà qui.' },
    es:{ lfmConnect:'\uD83C\uDFB5 Conectar Last.fm', lfmChange:'\uD83C\uDFB5 Last.fm: ',
         lfmKeyPrompt:'Pega tu clave API de Last.fm gratuita (guardada en este dispositivo):',
         lfmUserPrompt:'Tu usuario de Last.fm (vac\u00EDo para desconectar):',
         lfmConnected:'Last.fm conectado', lfmDisconnected:'Last.fm desconectado',
         lfmNothing:'No se est\u00E1 reproduciendo nada', lfmHint:'Haz scrobbling desde Spotify / YouTube Music / Apple Music a Last.fm y aparecer\u00E1 aqu\u00ED.' }
  };
  // Merge our strings into the core dictionary. NB: the core declares
  // `const I18N` which is NOT attached to window, so we reference the global
  // binding directly (classic scripts share global scope), not window.I18N.
  try{ if(typeof I18N!=='undefined' && I18N){ ['en','it','es'].forEach(function(l){ if(I18N[l]) for(var k in STRINGS[l]){ if(I18N[l][k]===undefined) I18N[l][k]=STRINGS[l][k]; } }); } }catch(e){}
  // Robust translator: use the core T(), but if it returns the raw key (merge
  // didn't run for any reason) fall back to our own STRINGS in the active lang.
  function TR(k){
    try{ var v=T(k); if(v && v!==k) return v; }catch(e){}
    var L='en'; try{ L=curLang(); }catch(e){}
    return (STRINGS[L] && STRINGS[L][k]) || STRINGS.en[k] || k;
  }

  // ---- Write MY current track to Supabase -----------------------------------
  var __lastSig = '', __lastWrite = 0;
  function writeNowPlaying(row){
    if(!App.me) return Promise.resolve();
    var sig = (row.is_playing?'1':'0')+'|'+(row.track||'')+'|'+(row.artist||'');
    // De-dupe: skip identical state unless > 20s elapsed (keeps updated_at fresh).
    if(sig===__lastSig && (Date.now()-__lastWrite)<20000) return Promise.resolve();
    __lastSig = sig; __lastWrite = Date.now();
    var body = { user_id:App.me.id, track:(row.track||null), artist:(row.artist||null),
                 art:(row.art||null), is_playing:!!row.is_playing, source:'lastfm',
                 updated_at:new Date().toISOString() };
    return rest('/now_playing',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:body}).catch(function(){});
  }

  // ---- Account-bound persistence (survives logout/login & new devices) ------
  // The Last.fm username is saved on the server (users.lastfm_user) keyed by the
  // account, and mirrored to localStorage for speed. This way the connection is
  // NOT tied to a single device/browser and is restored on every login.
  function saveUser(uu){
    LS.set('wc_lastfm_user', uu);
    if(App.me){ try{ rest('/users?id=eq.'+App.me.id,{method:'PATCH',body:{lastfm_user:uu}}).catch(function(){}); }catch(e){} }
  }
  function clearUser(){
    LS.del('wc_lastfm_user');
    if(App.me){ try{ rest('/users?id=eq.'+App.me.id,{method:'PATCH',body:{lastfm_user:null}}).catch(function(){}); }catch(e){} }
  }
  // Sync the saved username with the server. ADDITIVE ONLY — this never deletes
  // the local username (a null server value just means "not migrated yet", NOT
  // "disconnect"). Only an explicit clearUser() removes a connection.
  //   • server has a value  -> adopt it locally (server wins when set)
  //   • server empty, local set -> self-heal: push local up so it persists
  //     across logout / other devices (covers users who connected on the old,
  //     local-only version).
  // Tolerant of the migration not being run yet (missing column -> 400 -> catch).
  function restoreFromServer(){
    if(!App.me) return Promise.resolve(lfmUser());
    return rest('/users?id=eq.'+App.me.id+'&select=lastfm_user').then(function(rows){
      var srv = (Array.isArray(rows) && rows.length) ? ((rows[0].lastfm_user||'').trim()) : '';
      var loc = lfmUser();
      if(srv){
        if(srv!==loc) LS.set('wc_lastfm_user', srv);
      } else if(loc){
        try{ rest('/users?id=eq.'+App.me.id,{method:'PATCH',body:{lastfm_user:loc}}).catch(function(){}); }catch(e){}
      }
      return lfmUser();               // NEVER delete the local username here
    }).catch(function(){ return lfmUser(); });
  }

  // ---- Poll Last.fm for MY current track ------------------------------------
  function pollSelf(){
    var user=lfmUser(), key=lfmKey();
    if(!App.me || !user || !key) return Promise.resolve();
    var url='https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user='+
            encodeURIComponent(user)+'&api_key='+encodeURIComponent(key)+'&format=json&limit=1';
    return fetch(url).then(function(r){ return r.ok? r.json() : null; }).then(function(d){
      var t = d && d.recenttracks && d.recenttracks.track;
      if(Array.isArray(t)) t = t[0]; // API returns array (or single object)
      var playing = !!(t && t['@attr'] && t['@attr'].nowplaying==='true');
      if(playing){
        var artist=(t.artist && (t.artist['#text']||t.artist.name)) || '';
        var title = t.name || '';
        var art=''; if(Array.isArray(t.image)){ for(var i=t.image.length-1;i>=0;i--){ if(t.image[i] && t.image[i]['#text']){ art=t.image[i]['#text']; break; } } }
        return writeNowPlaying({ track:title, artist:artist, art:art, is_playing:true });
      }
      return writeNowPlaying({ is_playing:false });
    }).catch(function(){});
  }

  var __selfInt=null;
  function startSelfPoll(){
    if(__selfInt) clearInterval(__selfInt);
    pollSelf();
    __selfInt=setInterval(function(){ if(App.me && lfmUser()) pollSelf(); }, 30000);
  }
  try{
    document.addEventListener('visibilitychange',function(){ if(!document.hidden && App.me && lfmUser()) pollSelf(); });
    window.addEventListener('focus',function(){ if(App.me && lfmUser()) pollSelf(); });
  }catch(e){}

  // ---- Read someone's current track (cached ~12s to spare the 3s status poll)
  var __npCache={};
  function nowPlayingOf(userId){
    var c=__npCache[userId];
    if(c && (Date.now()-c.t)<12000) return Promise.resolve(c.v);
    return rest('/now_playing?user_id=eq.'+userId+'&select=track,artist,is_playing,updated_at').then(function(rows){
      var v=null;
      if(Array.isArray(rows) && rows.length){
        var r=rows[0];
        if(r.is_playing && (Date.now()-new Date(r.updated_at).getTime())<120000){ v={track:r.track, artist:r.artist}; }
      }
      __npCache[userId]={t:Date.now(), v:v};
      return v;
    }).catch(function(){ return null; });
  }
  function npText(np){
    if(!np) return '';
    var tr=(np.track||'').trim(), ar=(np.artist||'').trim();
    if(!tr && !ar) return '';
    return '\uD83C\uDFB5 ' + (tr||'?') + (ar ? (' \u2014 '+ar) : '');
  }

  // ---- Profile settings UI --------------------------------------------------
  function profileButtons(card){
    var wrap=el('div','col'); wrap.style.width='100%';
    var btn=el('button','btn grey');
    function setLabel(){ var u=lfmUser(); btn.textContent = u ? (TR('lfmChange')+u) : TR('lfmConnect'); }
    setLabel();
    var prev=el('div','center muted'); prev.style.fontSize='13px'; prev.style.minHeight='16px';
    function refreshPreview(){
      if(!lfmUser()){ prev.textContent=''; return; }
      // Prefer a live poll, then reflect our own stored row.
      pollSelf().then(function(){ __npCache[App.me.id]=null; return nowPlayingOf(App.me.id); })
                .then(function(np){ prev.textContent = np ? npText(np) : TR('lfmNothing'); });
    }
    btn.onclick=async function(){
      if(!lfmKey()){
        var k=await promptDialog(TR('lfmKeyPrompt'));
        if(k===null) return;
        if(k.trim()) LS.set('wc_lastfm_key', k.trim());
      }
      var u=await promptDialog(TR('lfmUserPrompt'), { value:lfmUser() });
      if(u===null) return;
      var uu=(u||'').trim();
      if(!uu){ clearUser(); __lastSig=''; writeNowPlaying({ is_playing:false }); toast(TR('lfmDisconnected')); }
      else { saveUser(uu); toast(TR('lfmConnected')); startSelfPoll(); }
      setLabel(); refreshPreview();
    };
    wrap.appendChild(btn); wrap.appendChild(prev);
    card.appendChild(wrap);
    // Reflect the account's saved username from the server (in case this device
    // never stored it locally), then update the label + preview.
    restoreFromServer().then(function(){ setLabel(); refreshPreview(); });
    refreshPreview();
    var pv=setInterval(function(){ if(document.body.contains(prev)) refreshPreview(); else clearInterval(pv); }, 20000);
  }

  // ---- Register with the core generic plugin registry -----------------------
  if(window.WinkyPlugins){
    WinkyPlugins.register({
      id:'nowplaying',
      onInit:function(){ restoreFromServer().then(function(){ startSelfPoll(); }); },
      // Appended to the DM online-status line for the other user.
      presenceExtra:function(userId){ return nowPlayingOf(userId).then(npText); },
      // Adds the "Connect Last.fm" control + live preview to the profile card.
      profileButtons:profileButtons
    });
  }
})();
