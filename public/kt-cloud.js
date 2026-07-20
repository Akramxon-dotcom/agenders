/* ══════════════════════════════════════════════════════════
   KT CLOUD SYNC MODULE
   - Anonymous auth (har foydalanuvchiga alohida hisob)
   - Multi-device space (bir hisob ostidagi barcha qurilmalar)
   - Realtime data sync
   - QR handshake: yangi qurilma → asosiy qurilma orqali tasdiq
   - Dynamic PIN (HHMM) + Active devices management
   ══════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if (!window.supabase || !window.__KT_SUPABASE) {
    console.warn('[cloud] supabase-js yoki config yoʻq — offline rejimda ishlaymiz');
    return;
  }
  const sb = window.supabase.createClient(
    window.__KT_SUPABASE.url,
    window.__KT_SUPABASE.anon,
    { auth: { persistSession:true, autoRefreshToken:true, storageKey:'kt-sb-auth' } }
  );

  const LS = {
    spaceId: 'kt_space_id',
    isMaster: 'kt_is_master',
    deviceName: 'kt_device_name'
  };

  const KTC = window.ktCloud = {
    sb, ready:false, userId:null, spaceId:null, isMaster:false,
    listeners: [], pushTimer:null, remoteVersion:0
  };

  // ─── DEVICE NAMING ─────────────────────────────────────
  function guessDeviceName(){
    const ua = navigator.userAgent;
    let os = 'Qurilma';
    if (/Windows/i.test(ua)) os='Windows';
    else if (/Android/i.test(ua)) os='Android';
    else if (/iPhone|iPad|iOS/i.test(ua)) os='iPhone/iPad';
    else if (/Mac OS/i.test(ua)) os='Mac';
    else if (/Linux/i.test(ua)) os='Linux';
    let br='Brauzer';
    if (/Edg\//i.test(ua)) br='Edge';
    else if (/OPR\//i.test(ua)) br='Opera';
    else if (/Chrome\//i.test(ua)) br='Chrome';
    else if (/Firefox\//i.test(ua)) br='Firefox';
    else if (/Safari\//i.test(ua)) br='Safari';
    return `${os} — ${br}`;
  }
  function deviceName(){
    let n = localStorage.getItem(LS.deviceName);
    if (!n){ n = guessDeviceName(); localStorage.setItem(LS.deviceName, n); }
    return n;
  }

  // ─── AUTH ──────────────────────────────────────────────
  async function ensureAuth(){
    let { data:{ session } } = await sb.auth.getSession();
    if (!session){
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    KTC.userId = session.user.id;
    return session;
  }

  // ─── SPACE ─────────────────────────────────────────────
  async function ensureSpace(){
    let sid = localStorage.getItem(LS.spaceId);
    if (sid){
      // Verify membership
      const { data:mem } = await sb.from('space_members')
        .select('is_master,revoked').eq('space_id', sid).eq('user_id', KTC.userId).maybeSingle();
      if (mem && !mem.revoked){
        KTC.spaceId = sid;
        KTC.isMaster = !!mem.is_master;
        localStorage.setItem(LS.isMaster, KTC.isMaster?'1':'0');
        return sid;
      }
      // Not a member anymore → clear
      localStorage.removeItem(LS.spaceId);
      sid = null;
    }
    // Create own space (become master)
    const { data:sp, error } = await sb.from('spaces')
      .insert({ owner_id: KTC.userId, data:{} })
      .select().single();
    if (error) throw error;
    await sb.from('space_members').insert({
      space_id: sp.id, user_id: KTC.userId,
      device_name: deviceName(), user_agent: navigator.userAgent,
      is_master: true
    });
    KTC.spaceId = sp.id; KTC.isMaster = true;
    localStorage.setItem(LS.spaceId, sp.id);
    localStorage.setItem(LS.isMaster, '1');
    return sp.id;
  }

  // ─── DATA SYNC ─────────────────────────────────────────
  async function pullData(){
    const { data, error } = await sb.from('spaces').select('data,updated_at').eq('id', KTC.spaceId).maybeSingle();
    if (error || !data) return null;
    KTC.remoteVersion = new Date(data.updated_at).getTime();
    return data.data || {};
  }

  function mergeIntoS(cloud){
    if (!cloud || typeof cloud !== 'object') return;
    if (!window.S) return;
    // Merge but keep local functions/DEFP intact. Overwrite persistent fields.
    Object.keys(cloud).forEach(k => { window.S[k] = cloud[k]; });
  }

  async function pushData(){
    if (!KTC.ready || !KTC.spaceId || !window.S) return;
    try{
      // Strip volatile UI state
      const payload = JSON.parse(JSON.stringify(window.S));
      const { data, error } = await sb.from('spaces')
        .update({ data: payload }).eq('id', KTC.spaceId).select('updated_at').maybeSingle();
      if (!error && data) KTC.remoteVersion = new Date(data.updated_at).getTime();
    }catch(e){ console.warn('[cloud] push', e); }
  }

  function schedulePush(){
    if (!KTC.ready) return;
    clearTimeout(KTC.pushTimer);
    KTC.pushTimer = setTimeout(pushData, 600);
  }

  // Wrap persist to also push
  function hookPersist(){
    if (typeof window.persist !== 'function') return;
    if (window.persist.__ktWrapped) return;
    const orig = window.persist;
    window.persist = function(){
      const r = orig.apply(this, arguments);
      schedulePush();
      return r;
    };
    window.persist.__ktWrapped = true;
  }

  // ─── REALTIME ──────────────────────────────────────────
  let channel = null;
  function subscribe(){
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('space:'+KTC.spaceId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'spaces', filter:'id=eq.'+KTC.spaceId },
        payload => {
          const row = payload.new;
          const t = new Date(row.updated_at).getTime();
          if (t <= KTC.remoteVersion + 100) return; // our own echo
          KTC.remoteVersion = t;
          mergeIntoS(row.data || {});
          rerenderAll();
          window.toast && window.toast('☁️ Sinxronlandi');
        })
      .on('postgres_changes', { event:'*', schema:'public', table:'space_members', filter:'space_id=eq.'+KTC.spaceId },
        payload => {
          // If our own membership was revoked → force logout
          const row = payload.new || payload.old;
          if (row && row.user_id === KTC.userId && row.revoked){
            forceLogout('Sizni chiqarib yuborishdi');
          }
        })
      .subscribe();
  }

  function rerenderAll(){
    try{
      window.applyTheme && window.applyTheme();
      window.applyAccent && window.applyAccent();
      window.applyVisibility && window.applyVisibility();
      window.renderSchedule && window.renderSchedule();
      window.renderPrayers && window.renderPrayers();
      window.updateProgress && window.updateProgress();
      window.renderStreak && window.renderStreak();
      window.updateTopbar && window.updateTopbar();
    }catch(e){ console.warn(e); }
  }

  // ─── HEARTBEAT / LAST SEEN ─────────────────────────────
  async function heartbeat(){
    if (!KTC.spaceId) return;
    try{ await sb.from('space_members').update({ last_seen: new Date().toISOString() })
      .eq('space_id', KTC.spaceId).eq('user_id', KTC.userId); }catch(e){}
  }

  // ─── FORCE LOGOUT ──────────────────────────────────────
  function forceLogout(msg){
    try{ localStorage.removeItem(LS.spaceId); }catch(e){}
    alert('🚪 ' + (msg||'Chiqib ketildi'));
    location.reload();
  }

  // ─── QR: SECONDARY DEVICE (create session, wait) ───────
  KTC.showJoinQR = async function(){
    // Create qr session as requester
    const { data:sess, error } = await sb.from('qr_sessions').insert({
      requester_user_id: KTC.userId,
      user_agent: navigator.userAgent
    }).select().single();
    if (error){ alert('QR yaratilmadi: '+error.message); return; }

    // UI overlay
    let ov = document.getElementById('qrJoinOv');
    if (!ov){
      ov = document.createElement('div');
      ov.id='qrJoinOv';
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:Inter,sans-serif';
      ov.innerHTML = `
        <div style="font-size:22px;font-weight:800;margin-bottom:8px">📱 Yangi qurilmani ulash</div>
        <div style="font-size:13px;color:#aaa;margin-bottom:16px;text-align:center;max-width:320px">
          Asosiy qurilmangizda <b>Sozlamalar → QR skaner</b> orqali quyidagi kodni skaner qiling
        </div>
        <div id="qrJoinImg" style="background:#fff;padding:16px;border-radius:16px;margin-bottom:16px"></div>
        <div id="qrJoinStatus" style="font-size:13px;color:#facc15;margin-bottom:16px">⏳ Tasdiqlash kutilmoqda...</div>
        <button onclick="ktCloud.cancelJoin()" style="padding:12px 24px;background:#374151;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer">Bekor qilish</button>
      `;
      document.body.appendChild(ov);
    }
    ov.style.display='flex';
    const payload = JSON.stringify({ t:'ktjoin', sid:sess.id });
    const canvas = document.createElement('canvas');
    await window.QRCode.toCanvas(canvas, payload, { width:260, margin:1 });
    const box = document.getElementById('qrJoinImg');
    box.innerHTML=''; box.appendChild(canvas);

    KTC._joinSessionId = sess.id;
    // Poll for approval (also realtime works, but polling is a safety net)
    const poll = setInterval(async ()=>{
      if (KTC._joinSessionId !== sess.id){ clearInterval(poll); return; }
      const { data } = await sb.from('qr_sessions').select('status,space_id').eq('id', sess.id).maybeSingle();
      if (!data){ clearInterval(poll); return; }
      if (data.status==='approved' && data.space_id){
        clearInterval(poll);
        await KTC.bindToSpace(data.space_id);
      } else if (new Date().getTime() - new Date().getTime() > 120000){
        clearInterval(poll);
      }
    }, 1500);
  };

  KTC.cancelJoin = function(){
    KTC._joinSessionId=null;
    const ov=document.getElementById('qrJoinOv'); if (ov) ov.style.display='none';
  };

  KTC.bindToSpace = async function(spaceId){
    // Delete our own solo space + rebind membership to master's space
    const oldSpaceId = KTC.spaceId;
    // Add self as member of new space (secondary)
    const { error } = await sb.from('space_members').insert({
      space_id: spaceId, user_id: KTC.userId,
      device_name: deviceName(), user_agent: navigator.userAgent,
      is_master: false
    });
    if (error && !/duplicate/i.test(error.message)){
      alert('Ulash xatosi: '+error.message); return;
    }
    // Remove old solo space (best-effort — may fail if we're not owner)
    if (oldSpaceId && oldSpaceId !== spaceId){
      try{ await sb.from('spaces').delete().eq('id', oldSpaceId).eq('owner_id', KTC.userId); }catch(e){}
    }
    KTC.spaceId = spaceId; KTC.isMaster = false;
    localStorage.setItem(LS.spaceId, spaceId);
    localStorage.setItem(LS.isMaster, '0');
    // Pull data
    const cloud = await pullData();
    if (cloud) mergeIntoS(cloud);
    try{ localStorage.setItem('kt5', JSON.stringify(window.S)); }catch(e){}
    KTC.cancelJoin();
    subscribe();
    rerenderAll();
    window.toast && window.toast('✅ Ulanish tasdiqlandi');
  };

  // ─── QR: MASTER (scan) ─────────────────────────────────
  KTC.openScanner = async function(){
    if (!KTC.isMaster){ alert('Faqat asosiy qurilma skaner qila oladi'); return; }
    let ov = document.getElementById('qrScanOv');
    if (!ov){
      ov = document.createElement('div');
      ov.id='qrScanOv';
      ov.style.cssText='position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:Inter';
      ov.innerHTML = `
        <div style="font-size:18px;font-weight:800;margin-bottom:12px">📷 QR ni skaner qiling</div>
        <div id="qrReader" style="width:min(340px,90vw)"></div>
        <button onclick="ktCloud.closeScanner()" style="margin-top:16px;padding:12px 24px;background:#374151;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer">Yopish</button>
      `;
      document.body.appendChild(ov);
    }
    ov.style.display='flex';
    const scanner = new Html5Qrcode('qrReader');
    KTC._scanner = scanner;
    try{
      await scanner.start({ facingMode:'environment' }, { fps:10, qrbox:220 },
        async (text)=>{
          try{
            const j = JSON.parse(text);
            if (j.t!=='ktjoin' || !j.sid) return;
            await scanner.stop();
            await KTC.approveJoin(j.sid);
            KTC.closeScanner();
          }catch(e){ /* ignore non-json */ }
        }, ()=>{});
    }catch(e){ alert('Kamera ochilmadi: '+e.message); KTC.closeScanner(); }
  };
  KTC.closeScanner = async function(){
    try{ KTC._scanner && await KTC._scanner.stop(); }catch(e){}
    KTC._scanner=null;
    const ov=document.getElementById('qrScanOv'); if (ov) ov.style.display='none';
  };
  KTC.approveJoin = async function(sessionId){
    const { error } = await sb.from('qr_sessions')
      .update({ status:'approved', space_id: KTC.spaceId })
      .eq('id', sessionId).eq('status','pending');
    if (error) alert('Tasdiqlash xatosi: '+error.message);
    else window.toast && window.toast('✅ Qurilma qoʻshildi');
  };

  // ─── ACTIVE DEVICES ────────────────────────────────────
  KTC.listDevices = async function(){
    if (!KTC.spaceId) return [];
    const { data } = await sb.from('space_members')
      .select('*').eq('space_id', KTC.spaceId).eq('revoked', false)
      .order('created_at', { ascending:true });
    return data||[];
  };
  KTC.revokeDevice = async function(memberId){
    const { error } = await sb.from('space_members')
      .update({ revoked:true }).eq('id', memberId);
    if (error) alert('Xato: '+error.message);
    else window.toast && window.toast('🚪 Qurilma chiqarildi');
  };

  // ─── DYNAMIC PIN ───────────────────────────────────────
  KTC.dynamicPin = function(){
    const d = new Date();
    return String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0');
  };

  // ─── SIGN OUT / LOGOUT ─────────────────────────────────
  KTC.signOut = async function(){
    try{ await sb.auth.signOut(); }catch(e){}
    try{ localStorage.removeItem(LS.spaceId); localStorage.removeItem(LS.isMaster); localStorage.removeItem('kt-sb-auth'); }catch(e){}
    location.reload();
  };

  // ─── BOOT ──────────────────────────────────────────────
  KTC.init = async function(){
    try{
      await ensureAuth();
      await ensureSpace();
      // Pull cloud data and merge if newer than local
      const cloud = await pullData();
      if (cloud && Object.keys(cloud).length > 0){
        const localTs = Number(localStorage.getItem('kt5_ts')||0);
        // Simpler: always merge cloud on start (multi-device sync semantics)
        mergeIntoS(cloud);
        try{ localStorage.setItem('kt5', JSON.stringify(window.S)); }catch(e){}
        rerenderAll();
      }
      hookPersist();
      subscribe();
      heartbeat();
      setInterval(heartbeat, 60000);
      KTC.ready = true;
      // Push once so cloud has our current state if it was empty
      if (!cloud || Object.keys(cloud).length===0) schedulePush();
      // Notify listeners
      document.dispatchEvent(new Event('kt-cloud-ready'));
    }catch(e){
      console.error('[cloud] init', e);
      window.toast && window.toast('⚠️ Bulut ulanmadi — offline rejim');
    }
  };

  // Auto-start after DOMContentLoaded so window.S exists
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=> setTimeout(KTC.init, 500));
  else setTimeout(KTC.init, 500);
})();
