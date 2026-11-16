(() => {
  'use strict';

  const API = 'https://api.aredl.net/v2/api/aredl';
  const GD_LEVEL_API = 'https://gdbrowser.com/api/level';
  const THUMBNAILS = 'https://raw.githubusercontent.com/All-Rated-Extreme-Demon-List/Thumbnails/main/levels/full';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const input = $('#levelInput');
  const suggestions = $('#suggestions');
  const feedback = $('#feedback');
  const keys = {
    points: 'gdbt-v3-points', correct: 'gdbt-v3-correct', streak: 'gdbt-v3-streak',
    best: 'gdbt-v3-best', history: 'gdbt-v3-history', consent: 'gdbt-privacy-consent-v3',
    profile: 'gdbt-v3-profile', clan: 'gdbt-v3-clan', lastDuel: 'gdbt-v3-last-duel',
    duelHistory: 'gdbt-v3-duel-history', rounds: 'gdbt-v3-rounds',
  };
  const read = (key, fallback = 0) => {
    try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)); }
    catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* file:// storage may be unavailable */ }
  };
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  let levels = [];
  let current = null;
  let round = 0;
  let guessed = false;
  let busy = false;
  let points = Number(read(keys.points));
  let correct = Number(read(keys.correct));
  let streak = Number(read(keys.streak));
  let best = Number(read(keys.best));
  let history = read(keys.history, []);
  if (!Array.isArray(history)) history = [];
  let roundsPlayed = Number(read(keys.rounds, history.length));
  let sessionEntries = [];
  let sessionScore = 0;
  let sessionCorrect = 0;
  let sessionStreak = 0;
  let sessionBestStreak = 0;
  let playerProfile = read(keys.profile, { name: 'Misafir', gdName: '' });
  let localClan = read(keys.clan, null);
  let lastDuelResult = read(keys.lastDuel, null);
  let duelHistory = read(keys.duelHistory, []);
  if (!Array.isArray(duelHistory)) duelHistory = [];
  let challengeSeed = '';
  let clipTimer = 0;
  let clipSerial = 0;
  let cloud = null;
  let cloudUser = null;
  let cloudProfile = null;
  let onlineClan = null;
  let clanControlsReady = false;
  let activeClanDetails = null;
  let clanDirectory = [];
  let clanDirectoryLimit = 50;
  let clanSearchTerm = '';

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2600);
  }

  function updateStats() {
    $('#points').textContent = points.toLocaleString('tr-TR');
    $('#correct').textContent = correct;
    $('#bestScore').textContent = best.toLocaleString('tr-TR');
    $('#streak').textContent = `🔥 ${streak}`;
    renderProfileStats();
  }

  function randomToken() {
    return Array.from({ length: 9 }, () => Math.floor(Math.random() * 36).toString(36)).join('').toUpperCase();
  }

  function encodePayload(value) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  }

  function decodePayload(value) {
    return JSON.parse(decodeURIComponent(escape(atob(value))));
  }

  function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value).catch(() => window.prompt('Kodu kopyala:', value));
    window.prompt('Kodu kopyala:', value);
    return Promise.resolve();
  }

  function renderProfile() {
    const name = playerProfile.name || 'Misafir';
    $$('.profileName').forEach((node) => { node.textContent = name; });
    $$('.avatar').forEach((node) => { node.textContent = name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'G'; });
    $('#profileNameInput').value = name === 'Misafir' ? '' : name;
    $('#profileGdNameInput').value = playerProfile.gdName || '';
    renderProfileStats();
  }

  function renderProfileStats() {
    const online = cloudUser && cloudProfile;
    const score = Number(online ? cloudProfile.total_points : points);
    const right = Number(online ? cloudProfile.total_correct : correct);
    const rounds = Number(online ? cloudProfile.completed_sessions * 5 : roundsPlayed);
    const accuracy = rounds ? Math.round(right / rounds * 100) : 0;
    $('#profilePoints').textContent = score.toLocaleString('tr-TR');
    $('#profileCorrect').textContent = right.toLocaleString('tr-TR');
    $('#profileBest').textContent = Number(online ? cloudProfile.best_streak : best).toLocaleString('tr-TR');
    $('#profileRounds').textContent = rounds.toLocaleString('tr-TR');
    $('#profileAccuracy').textContent = `${accuracy}%`;
  }

  function renderClan() {
    const activeClan = cloud ? onlineClan : localClan;
    const hasClan = Boolean(activeClan?.id);
    $('#clanCreateCard').hidden = hasClan;
    $('#clanManageCard').hidden = !hasClan;
    $('#copyClanInvite').hidden = Boolean(cloud);
    const canInvite = cloud && (onlineClan?.role === 'leader' || (clanControlsReady && onlineClan?.role === 'co_owner'));
    const canManage = cloud && clanControlsReady && ['leader', 'co_owner'].includes(onlineClan?.role);
    $('#createOnlineInvite').hidden = !canInvite;
    $('#clanSettingsForm').hidden = !canManage;
    $('#clanDetailInvite').hidden = Boolean(cloud && (!canInvite || activeClanDetails?.id !== onlineClan?.id));
    if (hasClan) {
      $('#clanDisplayName').textContent = activeClan.name;
      $('#clanDisplayTag').textContent = `[${activeClan.tag}]`;
      if (!cloud) {
        const token = `GDCLAN1.${encodePayload({ id: activeClan.id, name: activeClan.name, tag: activeClan.tag })}`;
        $('#clanInviteOutput').value = `${location.href.split('#')[0]}#join=${token}`;
      }
      $('#clanBackendNote').textContent = cloud ? `${onlineClan.role === 'leader' ? 'Lider' : onlineClan.role === 'co_owner' ? 'Co-owner' : 'Üye'} · çevrimiçi clan · davet kodları 30 gün geçerli.` : 'Yerel mod: bu clan dünya listesine eklenmez.';
      $('#clanAdmissionSummary').textContent = cloud ? (clanControlsReady ? `${onlineClan.join_policy === 'open' ? 'Herkese açık katılım' : 'Sadece davetle katılım'} · ${onlineClan.member_count || 1} / ${onlineClan.member_limit || 50} üye` : 'Yeni clan ayarları için Supabase’te 202611160002 migration dosyasını çalıştır.') : 'Yerel clan ayarları çevrimiçi değildir.';
      if (canManage) {
        $('#clanJoinPolicy').value = onlineClan.join_policy || 'invite';
        $('#clanMemberLimit').value = onlineClan.member_limit || 50;
      }
    }
    $('#clanDetailName').textContent = activeClanDetails?.name || (hasClan ? activeClan.name : 'Clan seçilmedi');
    $('#clanDetailTag').textContent = activeClanDetails ? `[${activeClanDetails.tag}] · ${activeClanDetails.member_count} üye · ${activeClanDetails.join_policy === 'open' ? 'herkese açık' : 'davetle'} · kapasite ${activeClanDetails.member_limit || 50}` : hasClan ? `[${activeClan.tag}]` : 'Bir clana katıl veya yeni clan oluştur.';
    $('#clanMemberCount').textContent = activeClanDetails ? Number(activeClanDetails.member_count).toLocaleString('tr-TR') : hasClan ? (cloud ? '…' : '1') : '0';
    $('#clanKnownScore').textContent = activeClanDetails ? Number(activeClanDetails.total_points).toLocaleString('tr-TR') : cloud ? '…' : points.toLocaleString('tr-TR');
    $('#clanWorldRank').textContent = activeClanDetails ? `#${Number(activeClanDetails.world_rank).toLocaleString('tr-TR')}` : '—';
    $('#clanRankMessage').textContent = activeClanDetails ? `${Number(activeClanDetails.total_points).toLocaleString('tr-TR')} toplam puan · ${Number(activeClanDetails.member_count).toLocaleString('tr-TR')} üye` : cloud ? 'Clan sıralaması yükleniyor…' : 'Dünya sırası için Supabase bağlantısı gerekli.';
    if (!activeClanDetails) $('#clanRoster').innerHTML = hasClan && !cloud ? `<div class="clan-roster-row"><span>${esc(playerProfile.name || 'Misafir')} <small class="muted">· bu cihaz</small></span><b>${points.toLocaleString('tr-TR')}</b><span>${correct}</span><span></span></div>` : '<p class="local-note">Clan ayrıntılarını görmek için çevrimiçi clanı seç.</p>';
    renderClanDirectory();
  }

  function renderClanDirectory() {
    const status = $('#clanDirectoryStatus');
    const list = $('#clanDirectoryRows');
    if (!cloud) {
      status.textContent = 'Dünya sıralaması için profilindeki Supabase bağlantısını tamamla.';
      list.innerHTML = '<div class="clan-directory-empty">Henüz çevrimiçi clan listesi yok.</div>';
      $('#loadMoreClans').hidden = true;
      return;
    }
    if (!clanDirectory.length) {
      status.textContent = cloudUser ? 'Henüz clan oluşturulmamış. İlk clanı sen kurabilirsin.' : 'Clanları görmek için Supabase hesabı gerekmez; üye olmak için giriş yap.';
      list.innerHTML = '<div class="clan-directory-empty">Dünya listesinde clan yok.</div>';
      $('#loadMoreClans').hidden = true;
      return;
    }
    status.textContent = `${clanDirectory.length}${clanSearchTerm ? ' eşleşen' : '+'} çevrimiçi clan · toplam puana göre sıralı${clanControlsReady ? '' : ' · co-owner ve katılım ayarları için yeni SQL migration gerekli'}`;
    $('#loadMoreClans').hidden = Boolean(clanSearchTerm) || clanDirectory.length < clanDirectoryLimit;
    list.innerHTML = clanDirectory.map((clan) => `
      <button class="clan-directory-row" type="button" data-clan-id="${esc(clan.id)}">
      <span class="directory-rank">#${Number(clan.world_rank).toLocaleString('tr-TR')}</span>
      <span class="directory-name">${esc(clan.name)} <small>[${esc(clan.tag)}] · ${Number(clan.member_count).toLocaleString('tr-TR')}/${clan.member_limit || 50} üye · ${clan.join_policy === 'open' ? 'AÇIK' : 'DAVETLE'}</small></span>
      <span class="directory-stat">${Number(clan.total_points).toLocaleString('tr-TR')} puan</span>
      <span class="directory-stat">${Number(clan.total_correct).toLocaleString('tr-TR')} doğru</span></button>${clan.join_policy === 'open' && Number(clan.member_count) < Number(clan.member_limit) ? `<button class="open-join-button" type="button" data-join-clan="${esc(clan.id)}">KATIL</button>` : ''}`).join('');
  }

  async function loadClanDirectory(loadMore = false) {
    if (!cloud) { renderClanDirectory(); return; }
    if (loadMore) clanDirectoryLimit += 50; else clanDirectoryLimit = 50;
    let query = cloud.from('clan_leaderboard').select('*').order('world_rank', { ascending: true }).limit(clanDirectoryLimit);
    if (clanSearchTerm) query = query.or(`name.ilike.%${clanSearchTerm}%,tag.ilike.%${clanSearchTerm}%`);
    const { data, error } = await query;
    if (error) { $('#clanDirectoryStatus').textContent = 'Clan listesi alınamadı. Supabase migration ve Data API ayarlarını kontrol et.'; return; }
    clanDirectory = data || [];
    renderClanDirectory();
  }

  async function loadClanDetails(clanId) {
    if (!cloud) { toast('Dünya clan ayrıntıları için Supabase gerekir.'); return; }
    const { data: clan, error } = await cloud.from('clan_leaderboard').select('*').eq('id', clanId).maybeSingle();
    if (error || !clan) { toast('Clan bilgisi yüklenemedi.'); return; }
    activeClanDetails = clan;
    const { data: members, error: memberError } = await cloud.from('clan_members')
      .select('user_id,role,joined_at,profiles(username,gd_name,total_points,total_correct,best_streak)')
      .eq('clan_id', clanId).order('joined_at', { ascending: true });
    if (memberError) { toast('Clan üyeleri yüklenemedi.'); return; }
    const viewerRole = onlineClan?.id === clanId ? onlineClan.role : null;
    $('#clanRoster').innerHTML = (members || []).map((member) => {
      const self = member.user_id === cloudUser?.id;
      const owner = viewerRole === 'leader';
      const coOwner = viewerRole === 'co_owner';
      let controls = '';
      if (clanControlsReady && !self && owner && member.role !== 'leader') controls = `<button class="roster-action" data-role-target="${esc(member.user_id)}" data-next-role="${member.role === 'co_owner' ? 'member' : 'co_owner'}">${member.role === 'co_owner' ? 'ÜYELİĞE AL' : 'CO-OWNER YAP'}</button><button class="roster-action danger" data-kick-member="${esc(member.user_id)}">ÇIKAR</button>`;
      else if (!self && coOwner && member.role === 'member') controls = `<button class="roster-action danger" data-kick-member="${esc(member.user_id)}">ÇIKAR</button>`;
      return `<div class="clan-roster-row"><span>${esc(member.profiles?.username || 'Oyuncu')} ${member.role === 'leader' ? '<small class="muted">· LİDER</small>' : member.role === 'co_owner' ? '<small class="muted">· CO-OWNER</small>' : ''}${self ? '<small class="muted"> · SEN</small>' : ''}<small class="muted">${member.profiles?.gd_name ? ` · GD: ${esc(member.profiles.gd_name)}` : ''}</small></span>
      <b>${Number(member.profiles?.total_points || 0).toLocaleString('tr-TR')}</b><span>${Number(member.profiles?.total_correct || 0).toLocaleString('tr-TR')}</span><span class="roster-controls">${controls}</span></div>`;
    }).join('') || '<p class="local-note">Bu clanda henüz üye yok.</p>';
    setPage('clanDetail');
    renderClan();
  }

  async function loadPlayerRank() {
    if (!cloudUser) return;
    const { data } = await cloud.from('player_leaderboard').select('world_rank,total_points,total_correct')
      .eq('user_id', cloudUser.id).maybeSingle();
    if (!data) return;
    $('#playerWorldRank').textContent = `#${Number(data.world_rank).toLocaleString('tr-TR')}`;
    $('#onlinePoints').textContent = Number(data.total_points).toLocaleString('tr-TR');
    $('#onlineCorrect').textContent = Number(data.total_correct).toLocaleString('tr-TR');
  }

  async function refreshCloudState() {
    if (!cloud) return;
    const { data: { session } } = await cloud.auth.getSession();
    cloudUser = session?.user || null;
    $('#signOut').hidden = !cloudUser;
    $('#deleteAccount').hidden = !cloudUser;
    $('#signIn').hidden = Boolean(cloudUser);
    $('#signUp').hidden = Boolean(cloudUser);
    if (!cloudUser) {
      cloudProfile = null; onlineClan = null;
      $('#authStatus').textContent = 'Hesabına giriş yap';
      $('#authMessage').textContent = 'Giriş yapınca dünya clan listesi, ortak üyelik ve çevrimiçi puan kaydı açılır.';
      renderProfile(); renderClan(); await loadClanDirectory(); return;
    }
    const { data: profile, error } = await cloud.from('profiles')
      .select('username,gd_name,total_points,total_correct,completed_sessions,best_streak')
      .eq('user_id', cloudUser.id).maybeSingle();
    if (error || !profile) {
      $('#authStatus').textContent = cloudUser.email || 'Bağlı hesap';
      $('#authMessage').textContent = 'Profil tablosu okunamadı. SQL migration uygulanmış mı kontrol et.';
    } else {
      cloudProfile = profile;
      playerProfile = { name: profile.username, gdName: profile.gd_name || '' };
      $('#authStatus').textContent = profile.username;
      $('#authMessage').textContent = `${cloudUser.email} · çevrimiçi profil bağlı`;
      $('#onlinePoints').textContent = Number(profile.total_points).toLocaleString('tr-TR');
      $('#onlineCorrect').textContent = Number(profile.total_correct).toLocaleString('tr-TR');
      save(keys.profile, playerProfile);
    }
    const { data: membership } = await cloud.from('clan_members').select('clan_id,role,joined_at').eq('user_id', cloudUser.id).maybeSingle();
    if (membership) {
      const { data: clan } = await cloud.from('clans').select('id,name,tag,owner_id,created_at').eq('id', membership.clan_id).maybeSingle();
      const { data: clanStats } = await cloud.from('clan_leaderboard').select('member_count,total_points,world_rank').eq('id', membership.clan_id).maybeSingle();
      onlineClan = clan ? { ...clan, ...clanStats, join_policy: clanControlsReady ? undefined : 'invite', member_limit: 50, role: membership.role } : null;
    } else onlineClan = null;
    renderProfile(); renderClan();
    await Promise.all([loadClanDirectory(), loadPlayerRank()]);
    if (activeClanDetails?.id) await loadClanDetails(activeClanDetails.id);
  }

  async function initCloud() {
    const config = window.GDBT_SUPABASE;
    if (!config?.url || !config?.anonKey) {
      $('#authStatus').textContent = 'Supabase ayarı gerekiyor';
      $('#authMessage').textContent = 'Online clan sıralaması için backend-config.js içine Project URL ve public anon key girilmeli.';
      renderClanDirectory();
      return;
    }
    try {
      if (!window.supabase?.createClient) {
        await new Promise((resolve, reject) => {
          const sdk = document.createElement('script');
          sdk.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          sdk.async = true;
          sdk.onload = resolve;
          sdk.onerror = () => reject(Error('Supabase JavaScript SDK yüklenemedi.'));
          document.head.appendChild(sdk);
        });
      }
      if (!window.supabase?.createClient) throw Error('Supabase SDK içinde createClient bulunamadı.');
      cloud = window.supabase.createClient(config.url, config.anonKey);
      const { error: clanControlsError } = await cloud.from('clans').select('join_policy,member_limit').limit(0);
      clanControlsReady = !clanControlsError;
      await refreshCloudState();
      cloud.auth.onAuthStateChange(() => setTimeout(refreshCloudState, 0));
    } catch (error) {
      cloud = null;
      $('#authStatus').textContent = 'Supabase ayarı geçersiz';
      $('#authMessage').textContent = error.message;
      renderClanDirectory();
    }
  }

  function setPage(pageId) {
    if (pageId === 'clan') activeClanDetails = null;
    $$('.nav button').forEach((node) => node.classList.toggle('active', node.dataset.page === pageId || (pageId === 'clanDetail' && node.dataset.page === 'clan')));
    $$('.page').forEach((node) => node.classList.toggle('active', node.id === pageId));
    if (pageId === 'profile') renderProfile();
    if (pageId === 'clan' || pageId === 'clanDetail') renderClan();
    if (pageId === 'duel') renderDuelHistory();
  }

  function applyClanInvite(raw) {
    try {
      const token = raw.trim().startsWith('http') ? new URL(raw.trim()).hash.slice(6) : raw.trim();
      const payload = token.startsWith('GDCLAN1.') ? decodePayload(token.slice(8)) : null;
      if (!payload?.id || !payload.name || !payload.tag) throw Error('bad invite');
      localClan = { id: payload.id, name: payload.name, tag: payload.tag, joinedAt: new Date().toISOString() };
      save(keys.clan, localClan);
      renderClan();
      setPage('clan');
      toast(`${payload.name} clanı bu cihaza eklendi.`);
      return true;
    } catch { toast('Clan davet kodu geçerli değil.'); return false; }
  }

  function startDuelFromCode(raw) {
    const code = raw.trim().toUpperCase();
    const match = code.match(/^GDBT1-([A-Z0-9]{6,20})$/);
    if (!match) { toast('Duel kodu GDBT1- ile başlamalı.'); return false; }
    if (!levels.length) { toast('Level kataloğu yüklenince tekrar dene.'); return false; }
    challengeSeed = match[1];
    lastDuelResult = null;
    save(keys.lastDuel, null);
    $('#gameModeLabel').textContent = 'DUEL TURU';
    $('#duelMatchBanner').hidden = false;
    $('#duelMatchCode').textContent = challengeSeed;
    sessionEntries = []; sessionScore = 0; sessionCorrect = 0; sessionStreak = 0; sessionBestStreak = 0;
    $('#summaryOverlay').hidden = true;
    $('#scorePanel').hidden = true;
    setPage('play');
    loadRound();
    return true;
  }

  async function compareDuelResult(raw) {
    const resultNode = $('#duelCompareResult');
    try {
      const token = raw.trim();
      if (!lastDuelResult) throw Error('Oyuncunun yerel sonuç kodu henüz yok.');
      let other = null;
      if (cloud && cloudUser) {
        const { data } = await cloud.from('duel_results').select('points,correct,user_id,profiles(username)')
          .eq('seed', lastDuelResult.seed).neq('user_id', cloudUser.id).order('points', { ascending: false }).limit(1);
        if (data?.length) other = { seed: lastDuelResult.seed, score: data[0].points, correct: data[0].correct, name: data[0].profiles?.username || 'Rakip' };
      }
      if (!other && token.startsWith('GDR1.')) other = decodePayload(token.slice(5));
      if (!other || other.seed !== lastDuelResult.seed) throw Error('Rakip sonucu henüz yok veya sonuç kodu başka duelden.');
      const diff = Number(lastDuelResult.score) - Number(other.score);
      const verdict = diff === 0 ? 'Berabere!' : diff > 0 ? `${lastDuelResult.name} kazandı!` : `${other.name} kazandı!`;
      resultNode.textContent = `${verdict} · ${lastDuelResult.score} – ${other.score} puan · ${lastDuelResult.correct}/5 – ${other.correct}/5 doğru`;
      const entry = duelHistory.find((item) => item.seed === lastDuelResult.seed);
      if (entry) { entry.opponent = other.name; entry.opponentScore = Number(other.score); entry.verdict = diff === 0 ? 'Berabere' : diff > 0 ? 'Kazandı' : 'Kaybetti'; }
      save(keys.duelHistory, duelHistory);
      renderDuelHistory();
    } catch (error) { resultNode.textContent = error.message || 'Sonuç kodu okunamadı.'; }
  }

  function renderDuelHistory() {
    if (!$('#duelHistoryRows')) return;
    $('#duelHistoryRows').innerHTML = duelHistory.length ? duelHistory.slice(0, 8).map((item) => `
      <div class="duel-history-row"><span>${esc(item.name || 'Oyuncu')} ${item.opponent ? `· ${esc(item.opponent)}` : '· rakip bekleniyor'}</span>
      <strong>${Number(item.score || 0)} puan</strong><span>${esc(item.verdict || `${item.correct || 0}/5 doğru`)}</span></div>`).join('') :
      '<p class="local-note">Henüz maç kaydı yok. Bir seed koduyla ilk dueline başla.</p>';
  }

  function renderHistory() {
    const rows = history.slice(0, 20);
    $('#leaderRows').innerHTML = rows.length ? rows.map((entry, index) => `
      <div class="table-row"><span class="muted">${String(index + 1).padStart(2, '0')}</span>
      <span>${esc(entry.name)}</span><span style="color:${entry.ok ? 'var(--lime)' : 'var(--pink)'}">${entry.ok ? 'DOĞRU' : 'YANLIŞ'}</span>
      <span style="color:var(--lime);font-family:var(--mono)">${entry.points}</span></div>`).join('') :
      '<div class="table-row"><span class="muted">—</span><span>Henüz tur yok</span><span>—</span><span>0</span></div>';
    $('#recentResults').innerHTML = rows.slice(0, 3).map((entry) => `
      <div class="leaderrow"><span class="miniava">${entry.ok ? '✓' : '×'}</span>
      <span class="lname">${esc(entry.name)}</span><span class="lscore">${entry.points} puan</span></div>`).join('') ||
      '<p class="muted">Henüz tur tamamlanmadı.</p>';
    const today = new Date().toLocaleDateString('en-CA');
    const count = history.filter((entry) => entry.day === today).length;
    $('#dailyProgress').textContent = `${String(Math.min(5, count)).padStart(2, '0')} / 05`;
  }

  function rankHint(position) {
    const rank = Number(position);
    if (!rank) return 'AREDL sırası mevcut değil';
    if (rank <= 100) return 'ilk 100 içinde';
    return `${Math.max(100, Math.round(rank / 100) * 100)}'e yakın`;
  }

  function seededRank(value) {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  }

  function loadThumbnail(item) {
    const url = `${THUMBNAILS}/${encodeURIComponent(item.level_id)}.webp`;
    return new Promise((resolve) => {
      const probe = new Image();
      const timer = setTimeout(() => finish(false), 8000);
      function finish(ok) {
        clearTimeout(timer);
        probe.onload = null;
        probe.onerror = null;
        resolve(ok ? { ...item, imageUrl: url } : null);
      }
      probe.onload = () => finish(true);
      probe.onerror = () => finish(false);
      probe.src = url;
    });
  }

  async function findRound(previousId) {
    const used = new Set(sessionEntries.map((entry) => String(entry.levelId)));
    const candidates = levels
      .filter((item) => item.level_id && item.level_id !== previousId && !used.has(String(item.level_id)))
      .map((item) => ({ item, rank: challengeSeed ? seededRank(`${challengeSeed}|${sessionEntries.length}|${item.level_id}`) : Math.random() }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item);
    for (const item of candidates.slice(0, 40)) {
      const roundData = await loadThumbnail(item);
      if (roundData) return roundData;
    }
    return null;
  }

  async function findSongUrl(item) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(`${GD_LEVEL_API}/${encodeURIComponent(item.level_id)}`, { signal: controller.signal });
      if (!response.ok) return null;
      const details = await response.json();
      const url = typeof details.songLink === 'string' ? details.songLink : '';
      if (!url || !/^https:\/\//i.test(url)) return null;
      return url;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function stopClip() {
    clearTimeout(clipTimer);
    const audio = $('#songAudio');
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    $('#playSong').hidden = true;
  }

  async function loadRound() {
    if (busy) return;
    busy = true;
    stopClip();
    const thisClip = ++clipSerial;
    const previousId = current?.level_id;
    current = null;
    $('#levelImage').hidden = true;
      $('#imageStatus').textContent = 'YENİ İPUCU HAZIRLANIYOR…';
    $('#skip').disabled = true;
    try {
      const found = await findRound(previousId);
      if (!found) {
        $('#imageStatus').textContent = 'GÖRSEL BULUNAMADI · BAĞLANTIYI KONTROL ET VE TEKRAR DENE';
        return;
      }
      current = found;
      const wantsSong = challengeSeed
        ? seededRank(`${challengeSeed}|mode|${sessionEntries.length}`) % 2 === 1
        : Math.random() < 0.5;
      const songUrl = wantsSong ? await findSongUrl(found) : null;
      if (thisClip !== clipSerial) return;
      guessed = false;
      input.value = '';
      feedback.className = 'feedback';
      feedback.textContent = '';
      $('#levelImage').src = found.imageUrl;
      $('#levelImage').hidden = Boolean(songUrl);
      $('#songAudio').src = songUrl || '';
      $('#playSong').hidden = !songUrl;
      $('.hint').textContent = songUrl ? '15 SN SES İPUCU' : 'GÖRSEL İPUCU';
      $('#imageStatus').textContent = songUrl ? 'ŞARKI İPUCU · PARÇA ADI GİZLİ' : 'AREDL LEVEL GÖRSELİ · İSİM GİZLİ';
      $('.trackname').textContent = songUrl ? 'ŞARKI İPUCU' : 'STATİK LEVEL GÖRSELİ';
      $('.trackmeta').textContent = songUrl ? 'PARÇA ADI GİZLİ · 15 SANİYE' : 'LEVEL ADI GİZLİ';
      $('.duration').textContent = songUrl ? '15 SANİYE' : 'TEK KARE';
      $('.audio-foot').innerHTML = songUrl ? '<span>Tek ipucu</span><span>15 saniye</span><span>Parça adı gizli</span>' : '<span>Her turda tek görsel</span><span>Level adı gizli</span><span>Tek statik kare</span>';
      $('#catalogCount').textContent = `AREDL kataloğu · ${levels.length.toLocaleString('tr-TR')} seviye`;
      $('#submitGuess').disabled = false;
      $('#submitGuess').textContent = 'TAHMİNİ GÖNDER ↗';
      $('#roundNo').textContent = `${String(sessionEntries.length + 1).padStart(2, '0')} / 05`;
    } catch (error) {
      console.error(error);
      $('#imageStatus').textContent = 'GÖRSEL YÜKLENEMEDİ · SAYFAYI YENİLE';
    } finally {
      busy = false;
      $('#skip').disabled = false;
    }
  }

  function matches() {
    const query = input.value.trim().toLocaleLowerCase('tr-TR');
    if (!query) { suggestions.classList.remove('open'); return; }
    const items = levels.filter((item) => item.name.toLocaleLowerCase('tr-TR').includes(query)).slice(0, 8);
    suggestions.innerHTML = items.length ? items.map((item) => `
      <button type="button" data-id="${esc(item.level_id)}"><span>${esc(item.name)}</span><small>AREDL LEVELİ</small></button>`).join('') :
      '<button type="button" disabled><span>Eşleşme bulunamadı</span></button>';
    suggestions.classList.add('open');
  }

  function submit() {
    if (guessed) { toast('Cevap açıklandı. Sonraki tura geç.'); return; }
    if (!current) return;
    const guess = input.value.trim();
    if (!guess) { input.focus(); toast('Önce bir level adı yaz.'); return; }
    guessed = true;
    stopClip();
    const ok = guess.toLocaleLowerCase('tr-TR') === current.name.toLocaleLowerCase('tr-TR');
    const gain = ok ? 500 : 0;
    sessionScore += gain;
    sessionCorrect += ok ? 1 : 0;
    sessionStreak = ok ? sessionStreak + 1 : 0;
    sessionBestStreak = Math.max(sessionBestStreak, sessionStreak);
    const entry = { name: current.name, levelId: current.level_id, ok, points: gain, day: new Date().toLocaleDateString('en-CA') };
    sessionEntries.push(entry);
    const hint = rankHint(current.position);
    feedback.className = `feedback show ${ok ? 'good' : 'nope'}`;
    feedback.innerHTML = ok ?
      `✓ <b>Doğru!</b> ${esc(current.name)} · AREDL sırası ${hint}.` :
      `✕ <b>Bu tur ${esc(current.name)} çıktı.</b> AREDL sırası ${hint}.`;
    $('#submitGuess').textContent = 'CEVAPLANDI';
    $('#submitGuess').disabled = true;
    $('#skip').textContent = sessionEntries.length === 5 ? 'SONUCU GÖSTER' : 'SONRAKİ TUR →';
    if (sessionEntries.length === 5) finishGame();
  }

  $('#playSong').addEventListener('click', async () => {
    const audio = $('#songAudio');
    const button = $('#playSong');
    const serial = clipSerial;
    button.disabled = true;
    button.textContent = 'YÜKLENİYOR…';
    try {
      if (audio.readyState < 1) {
        let metadataTimer;
        try {
          await Promise.race([
            new Promise((resolve, reject) => {
              audio.addEventListener('loadedmetadata', resolve, { once: true });
              audio.addEventListener('error', reject, { once: true });
              audio.load();
            }),
            new Promise((_, reject) => { metadataTimer = setTimeout(() => reject(Error('Audio metadata timeout')), 7000); }),
          ]);
        } finally { clearTimeout(metadataTimer); }
      }
      if (serial !== clipSerial) return;
      audio.currentTime = Number.isFinite(audio.duration) && audio.duration > 75 ? 60 : 0;
      await audio.play();
      button.textContent = '♪ ÇALIYOR · 15 SN';
      clipTimer = setTimeout(() => {
        audio.pause();
        button.textContent = 'TEKRAR DİNLE · 15 SN';
        button.disabled = false;
      }, 15000);
    } catch {
      $('#imageStatus').textContent = 'ŞARKI YÜKLENEMEDİ · TURU GÖRSEL İPUCUYLA OYNAYABİLİRSİN';
      audio.removeAttribute('src'); audio.load();
      $('#levelImage').hidden = false;
      $('.hint').textContent = 'GÖRSEL İPUCU';
      $('.trackname').textContent = 'STATİK LEVEL GÖRSELİ';
      $('.trackmeta').textContent = 'LEVEL ADI GİZLİ';
      $('.duration').textContent = 'TEK KARE';
      $('.audio-foot').innerHTML = '<span>Her turda tek görsel</span><span>Level adı gizli</span><span>Tek statik kare</span>';
      button.hidden = true;
    } finally {
      if (serial === clipSerial) button.disabled = false;
    }
  });

  function finishGame() {
    points += sessionScore;
    correct += sessionCorrect;
    streak = sessionStreak;
    best = Math.max(best, streak);
    history = [...sessionEntries, ...history].slice(0, 100);
    roundsPlayed += sessionEntries.length;
    save(keys.points, points); save(keys.correct, correct); save(keys.streak, streak);
    save(keys.best, best); save(keys.history, history); save(keys.rounds, roundsPlayed);
    if (cloud && cloudUser) {
      const requests = [cloud.rpc('submit_game_session', { p_points: sessionScore, p_correct: sessionCorrect, p_best_streak: sessionBestStreak })];
      if (challengeSeed) requests.push(cloud.rpc('submit_duel_result', { p_seed: challengeSeed, p_points: sessionScore, p_correct: sessionCorrect }));
      Promise.all(requests).then((results) => {
        const failed = results.find((result) => result.error);
        if (failed) toast(`Çevrimiçi skor kaydedilemedi: ${failed.error.message}`);
        else refreshCloudState();
      });
    }
    updateStats(); renderHistory();
    $('#scorePanel').hidden = false;
    $('#summaryScore').textContent = sessionScore.toLocaleString('tr-TR');
    $('#summaryCorrect').textContent = `${sessionCorrect} / 5`;
    if (challengeSeed) {
      lastDuelResult = { seed: challengeSeed, score: sessionScore, correct: sessionCorrect, name: playerProfile.name || 'Misafir' };
      save(keys.lastDuel, lastDuelResult);
      duelHistory = [{ ...lastDuelResult, date: new Date().toLocaleDateString('tr-TR') }, ...duelHistory.filter((item) => item.seed !== challengeSeed)].slice(0, 12);
      save(keys.duelHistory, duelHistory);
      renderDuelHistory();
      $('#challengeResultPanel').hidden = false;
      $('#challengeResultCode').value = `GDR1.${encodePayload(lastDuelResult)}`;
      $('#lastDuelNote').textContent = `Son duel: ${lastDuelResult.name} · ${lastDuelResult.score} puan`;
    } else $('#challengeResultPanel').hidden = true;
    $('#summaryOverlay').hidden = false;
  }

  function startNewGame() {
    sessionEntries = []; sessionScore = 0; sessionCorrect = 0; sessionStreak = 0; sessionBestStreak = 0;
    challengeSeed = '';
    $('#gameModeLabel').textContent = 'OTURUM';
    $('#duelMatchBanner').hidden = true;
    $('#summaryOverlay').hidden = true;
    $('#scorePanel').hidden = true;
    $('#skip').textContent = 'TURU GEÇ →';
    round = 0;
    loadRound();
  }

  async function skipRound() {
    if (busy) return;
    if (!guessed && current) {
      guessed = true;
      stopClip();
      sessionEntries.push({ name: current.name, levelId: current.level_id, ok: false, points: 0, day: new Date().toLocaleDateString('en-CA') });
      sessionStreak = 0;
      const hint = rankHint(current.position);
      feedback.className = 'feedback show nope';
      feedback.innerHTML = `↷ <b>Bu tur ${esc(current.name)} çıktı.</b> AREDL sırası ${hint}.`;
      $('#submitGuess').disabled = true;
      $('#submitGuess').textContent = 'CEVAPLANDI';
      if (sessionEntries.length === 5) { finishGame(); return; }
    }
    if (sessionEntries.length) {
      await loadRound();
      $('#skip').textContent = 'TURU GEÇ →';
    }
  }

  input.addEventListener('input', matches);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (suggestions.classList.contains('open')) {
      const button = suggestions.querySelector('button[data-id]');
      if (button) {
        input.value = levels.find((item) => String(item.level_id) === button.dataset.id)?.name || '';
        suggestions.classList.remove('open');
        return;
      }
    }
    submit();
  });
  suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    input.value = levels.find((item) => String(item.level_id) === button.dataset.id)?.name || '';
    suggestions.classList.remove('open');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.searchwrap')) suggestions.classList.remove('open');
  });
  $('#submitGuess').onclick = submit;
  $('#skip').onclick = skipRound;
  $('#startNewGame').onclick = startNewGame;
  $$('[data-page]').forEach((button) => button.onclick = () => setPage(button.dataset.page));

  $('#profileForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#profileNameInput').value.trim();
    if (!name) { toast('Oyuncu adını yaz.'); return; }
    playerProfile = { name, gdName: $('#profileGdNameInput').value.trim() };
    save(keys.profile, playerProfile);
    renderProfile();
    renderClan();
    if (cloud && cloudUser) {
      cloud.from('profiles').update({ username: name, gd_name: playerProfile.gdName }).eq('user_id', cloudUser.id)
        .then(({ error }) => { if (error) toast(`Profil kaydedilemedi: ${error.message}`); else { toast('Profilin güncellendi.'); refreshCloudState(); } });
    } else toast('Profil bu cihaza kaydedildi.');
  });

  async function authAction(action) {
    if (!cloud) { toast('Önce backend-config.js içindeki Supabase ayarlarını gir.'); return; }
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    if (!email || password.length < 8) { toast('E-posta ve en az 8 karakterli şifre gir.'); return; }
    $('#authMessage').textContent = 'İşleniyor…';
    try {
      let result;
      if (action === 'signup') {
        const username = $('#profileNameInput').value.trim();
        if (username.length < 2) { $('#authMessage').textContent = 'Önce profil bölümüne en az 2 karakterli oyuncu adı yaz.'; return; }
        let emailRedirectTo;
        const configuredSite = window.GDBT_SUPABASE.siteUrl?.trim();
        if (configuredSite) {
          const callback = new URL(configuredSite);
          if (callback.protocol === 'https:' || (callback.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(callback.hostname))) {
            callback.hash = 'profile';
            emailRedirectTo = callback.toString();
          }
        } else if (location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname))) {
          emailRedirectTo = `${location.origin}${location.pathname}#profile`;
        }
        result = await cloud.auth.signUp({ email, password, options: { data: { username, gd_name: $('#profileGdNameInput').value.trim() }, ...(emailRedirectTo ? { emailRedirectTo } : {}) } });
      } else result = await cloud.auth.signInWithPassword({ email, password });
      if (result.error) { $('#authMessage').textContent = result.error.message; return; }
      if (action === 'signup' && !result.data.session) $('#authMessage').textContent = 'Hesap açıldı. E-postandaki doğrulama bağlantısına tıkla, sonra giriş yap.';
      else { $('#authMessage').textContent = 'Giriş başarılı. Çevrimiçi veriler yükleniyor…'; await refreshCloudState(); }
    } catch (error) { $('#authMessage').textContent = error.message || 'Supabase bağlantısı başarısız.'; }
  }
  $('#authForm').addEventListener('submit', (event) => { event.preventDefault(); authAction('signin'); });
  $('#signUp').onclick = () => authAction('signup');
  $('#signIn').onclick = () => authAction('signin');
  $('#signOut').onclick = async () => { if (cloud) await cloud.auth.signOut(); };
  $('#deleteAccount').onclick = async () => {
    if (!cloud || !cloudUser || !confirm('Hesabın, clan üyeliğin ve çevrimiçi puan geçmişin kalıcı olarak silinsin mi?')) return;
    const { error } = await cloud.rpc('delete_my_account');
    if (error) { toast(`Hesap silinemedi: ${error.message}`); return; }
    await cloud.auth.signOut();
    toast('Hesap ve çevrimiçi verileri silindi.');
  };

  $('#createClanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#clanNameInput').value.trim();
    const tag = $('#clanTagInput').value.trim().replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    if (name.length < 2 || tag.length < 2) { toast('Clan adı en az 2, etiket 2–6 karakter olmalı.'); return; }
    if (cloud) {
      if (!cloudUser) { toast('Çevrimiçi clan kurmak için profilinden giriş yap.'); return; }
      const { error } = await cloud.rpc('create_clan', { p_name: name, p_tag: tag });
      if (error) { toast(`Clan oluşturulamadı: ${error.message}`); return; }
      localClan = null; activeClanDetails = null;
      await refreshCloudState();
      toast('Clan oluşturuldu ve dünya listesine eklendi.');
      return;
    }
    localClan = { id: randomToken(), name, tag, owner: playerProfile.name, createdAt: new Date().toISOString() };
    save(keys.clan, localClan);
    renderClan();
    toast('Clan daveti hazır.');
  });

  $('#joinClanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = $('#joinClanCode').value.trim();
    let invite = raw;
    if (raw.startsWith('http')) { try { invite = new URL(raw).hash.slice(6); } catch { invite = raw; } }
    if (cloud && invite.startsWith('GDINV1.')) {
      if (!cloudUser) { toast('Clan davetine katılmak için önce giriş yap.'); return; }
      const { error } = await cloud.rpc('join_clan_by_invite', { p_code: invite.slice(7) });
      if (error) { toast(`Clan daveti kabul edilmedi: ${error.message}`); return; }
      activeClanDetails = null;
      await refreshCloudState();
      toast('Clana katıldın.');
    } else if (cloud) toast('Çevrimiçi davet GDINV1. ile başlar. Clan davetini yeniden kopyalat.');
    else applyClanInvite(raw);
  });
  $('#copyClanInvite').onclick = () => copyText($('#clanInviteOutput').value).then(() => toast('Clan daveti kopyalandı.'));
  $('#createOnlineInvite').onclick = async () => {
    if (!cloud || !cloudUser || !onlineClan) { toast('Supabase hesabı ve çevrimiçi clan gerekli.'); return; }
    const { data, error } = await cloud.rpc('create_clan_invite', { p_clan_id: onlineClan.id });
    if (error) { toast(`Davet üretilemedi: ${error.message}`); return; }
    const link = `${location.href.split('#')[0]}#join=GDINV1.${data}`;
    $('#clanInviteOutput').value = link;
    await copyText(link);
    toast('30 günlük clan daveti kopyalandı.');
  };
  $('#clanSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
      if (!cloud || !onlineClan || !clanControlsReady) { toast('Önce Supabase’te 202611160002 clan migration dosyasını çalıştır.'); return; }
    const policy = $('#clanJoinPolicy').value;
    const memberLimit = Number($('#clanMemberLimit').value);
    if (!Number.isInteger(memberLimit) || memberLimit < 2 || memberLimit > 100) { toast('Üye kapasitesi 2 ile 100 arasında olmalı.'); return; }
    const { error } = await cloud.rpc('update_clan_settings', { p_clan_id: onlineClan.id, p_join_policy: policy, p_member_limit: memberLimit });
    if (error) { toast(`Clan ayarları kaydedilemedi: ${error.message}`); return; }
    await refreshCloudState();
    if (activeClanDetails?.id) await loadClanDetails(activeClanDetails.id);
    toast('Clan katılım ve kapasite ayarları güncellendi.');
  });
  $('#refreshClans').onclick = () => loadClanDirectory(false);
  $('#loadMoreClans').onclick = () => loadClanDirectory(true);
  let clanSearchTimer = 0;
  $('#clanSearch').addEventListener('input', () => {
    clearTimeout(clanSearchTimer);
    clanSearchTimer = setTimeout(() => {
      clanSearchTerm = $('#clanSearch').value.trim().replace(/[^\p{L}\p{N} _-]/gu, '');
      loadClanDirectory(false);
    }, 250);
  });
  $('#clanDirectoryRows').addEventListener('click', (event) => {
    const join = event.target.closest('[data-join-clan]');
    if (join) {
      event.stopPropagation();
      if (!cloudUser) { toast('Açık clana katılmak için önce profilinden giriş yap.'); setPage('profile'); return; }
      cloud.rpc('join_open_clan', { p_clan_id: join.dataset.joinClan }).then(async ({ error }) => {
        if (error) { toast(`Clana katılamadın: ${error.message}`); return; }
        await refreshCloudState(); toast('Açık clana katıldın.');
      });
      return;
    }
    const button = event.target.closest('[data-clan-id]');
    if (button) loadClanDetails(button.dataset.clanId);
  });
  $('#clanRoster').addEventListener('click', async (event) => {
    const roleButton = event.target.closest('[data-role-target]');
    const kickButton = event.target.closest('[data-kick-member]');
    if (!cloud || !clanControlsReady || !activeClanDetails || (!roleButton && !kickButton)) return;
    let error;
    if (roleButton) ({ error } = await cloud.rpc('set_clan_member_role', { p_clan_id: activeClanDetails.id, p_member_id: roleButton.dataset.roleTarget, p_role: roleButton.dataset.nextRole }));
    if (kickButton) {
      if (!confirm('Bu üyeyi clandan çıkarmak istiyor musun?')) return;
      ({ error } = await cloud.rpc('remove_clan_member', { p_clan_id: activeClanDetails.id, p_member_id: kickButton.dataset.kickMember }));
    }
    if (error) { toast(`Clan işlemi başarısız: ${error.message}`); return; }
    await refreshCloudState();
    if (activeClanDetails?.id) await loadClanDetails(activeClanDetails.id);
    toast(roleButton ? 'Clan rolü güncellendi.' : 'Üye clandan çıkarıldı.');
  });
  $('#viewClanDetails').onclick = () => {
    if (cloud && onlineClan) loadClanDetails(onlineClan.id);
    else if (!cloud && localClan) { activeClanDetails = null; setPage('clanDetail'); }
    else toast('Önce clan oluştur veya bir daveti kabul et.');
  };
  $('#backToClan').onclick = () => setPage('clan');
  $('#clanDetailInvite').onclick = async () => {
    if (cloud && onlineClan) {
      const { data, error } = await cloud.rpc('create_clan_invite', { p_clan_id: onlineClan.id });
      if (error) { toast(error.message); return; }
      const link = `${location.href.split('#')[0]}#join=GDINV1.${data}`;
      await copyText(link); toast('Clan daveti kopyalandı.'); return;
    }
    if (!localClan?.id) { toast('Önce bir clana katıl.'); return; }
    copyText(`${location.href.split('#')[0]}#join=${`GDCLAN1.${encodePayload({ id: localClan.id, name: localClan.name, tag: localClan.tag })}`}`).then(() => toast('Clan daveti kopyalandı.'));
  };
  $('#leaveClan').onclick = async () => {
    if (cloud && cloudUser && onlineClan) {
      const { error } = await cloud.rpc('leave_clan', { p_clan_id: onlineClan.id });
      if (error) { toast(`Clandan ayrılamadın: ${error.message}`); return; }
      activeClanDetails = null; await refreshCloudState(); toast('Clandan ayrıldın.'); return;
    }
    localClan = null;
    save(keys.clan, null);
    renderClan();
    toast('Clan bu cihazdan kaldırıldı.');
  };

  $('#createDuel').onclick = () => {
    const code = `GDBT1-${randomToken()}`;
    $('#duelCodeOutput').value = code;
    $('#duelCodePanel').hidden = false;
  };
  $('#copyDuelCode').onclick = () => copyText($('#duelCodeOutput').value).then(() => toast('Duel kodu kopyalandı.'));
  $('#playDuel').onclick = () => startDuelFromCode($('#duelCodeOutput').value);
  $('#joinDuelForm').addEventListener('submit', (event) => {
    event.preventDefault();
    startDuelFromCode($('#joinDuelCode').value);
  });
  $('#compareDuel').onclick = () => compareDuelResult($('#opponentResultCode').value);
  $('#copyChallengeResult').onclick = () => copyText($('#challengeResultCode').value).then(() => toast('Sonuç kodu kopyalandı.'));
  const initialHash = location.hash;
  if (initialHash.startsWith('#join=')) { $('#joinClanCode').value = initialHash.slice(6); setPage('clan'); }
  if (initialHash.startsWith('#duel=')) { $('#joinDuelCode').value = initialHash.slice(6); setPage('duel'); }

  async function init() {
    try {
      $('#catalogCount').textContent = 'AREDL kataloğu yükleniyor…';
      const response = await fetch(`${API}/levels`);
      if (!response.ok) throw Error(`AREDL ${response.status}`);
      levels = await response.json();
      if (!Array.isArray(levels) || !levels.length) throw Error('Empty AREDL catalog');
      $('#catalogCount').textContent = `AREDL kataloğu · ${levels.length.toLocaleString('tr-TR')} seviye`;
      await loadRound();
    } catch (error) {
      console.error(error);
      $('#catalogCount').textContent = 'AREDL API’ye bağlanılamadı';
      $('#imageStatus').textContent = 'AREDL API’YE ULAŞILAMADI · İNTERNET BAĞLANTISINI KONTROL ET';
    }
  }

  updateStats();
  renderHistory();
  renderProfile();
  renderClan();
  if (lastDuelResult) $('#lastDuelNote').textContent = `Son duel: ${lastDuelResult.name} · ${lastDuelResult.score} puan`;
  const overlay = $('#consentOverlay');
  const accept = $('#acceptConsent');
  const check = $('#consentCheck');
  if (read(keys.consent, false)) {
    overlay.hidden = true;
    initCloud();
    init();
  } else {
    overlay.hidden = false;
    check.addEventListener('change', () => { accept.disabled = !check.checked; });
    accept.addEventListener('click', () => {
      if (!check.checked) return;
      save(keys.consent, true);
      overlay.hidden = true;
      initCloud();
      init();
    });
  }
  $('#resetProgress').addEventListener('click', () => {
    if (!confirm('Bu cihazdaki puan, tur geçmişi ve izin tercihi silinsin mi?')) return;
    try { Object.values(keys).forEach((key) => localStorage.removeItem(key)); } catch { /* storage may be unavailable */ }
    location.reload();
  });
})();

