/* ============================================================
   Wall3D 落地页脚本
   职责：
   1. 懒启动三个 kpanel-scene-pack 场景（iframe，worker=off 主线程渲染）
   2. 首屏场景舞台：导航三链接直接切换首屏预览的场景（显隐 + 暂停/恢复）
   3. postMessage 协议：切镜头 / 暂停 / 恢复 / ready / error
   4. 离屏暂停、页面隐藏暂停（landing 规则：媒体离屏即停）
   5. 渐进增强：禁 JS 或 WebGL 失败时海报静态成立
   6. GSAP + ScrollTrigger + Lenis：首屏景深（滑动驱动）+ 区块出场（滑动触发 once）
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lenis = null;

  /* 场景数据来自各 manifest.json（镜头中文名） */
  var SCENES = {
    '3c2d1025b70e2f5a00c179b2c056a6f9': {
      name: '霓虹都市',
      cameras: ['黄昏天际线', '蓝调高架', '雨夜街巷']
    },
    '73fc4349b9a676013338e6de85ee6836': {
      name: '海天日月',
      cameras: ['日月光带', '礁石剪影', '海天一色', '远岸城市']
    },
    'ff18942f6589b01a984af80e7880125e': {
      name: '星港轨道',
      cameras: ['行星全景', '空间站近景', '行星日出']
    }
  };

  /* 首屏场景舞台：导航链接 = 在首屏切换预览哪个场景 */
  var HERO_IDS = ['neon-city', 'sea-and-sky', 'orbital-station'];
  var HERO = {
    'neon-city': { hash: '3c2d1025b70e2f5a00c179b2c056a6f9' },
    'sea-and-sky': { hash: '73fc4349b9a676013338e6de85ee6836' },
    'orbital-station': { hash: 'ff18942f6589b01a984af80e7880125e' }
  };
  var activeHeroId = 'neon-city';

  var states = new Map(); // stage/frame 元素 -> state

  function activeHeroStage() { return HERO[activeHeroId] && HERO[activeHeroId].stage; }
  function activeHeroState() { var s = activeHeroStage(); return s && states.get(s); }

  /* ---------- 场景地址 ---------- */
  function sceneUrl(hash, shot) {
    var params = ['worker=off']; /* 实测：OffscreenCanvas worker 模式多实例下只有第一个场景有画面，
                                   主线程渲染多实例正常；配合离屏暂停控制开销 */
    if (typeof shot === 'number' && shot >= 0) params.push('shot=' + shot);
    if (reduced) params.push('entrance=off');
    return 'objects/' + hash + '/index.html?' + params.join('&');
  }

  /* ---------- 启动一个场景 ---------- */
  function startScene(frame) {
    var st = states.get(frame);
    if (!st || st.started) return;
    st.started = true;

    var iframe = document.createElement('iframe');
    iframe.title = st.name + ' 实时 3D 预览';
    iframe.setAttribute('aria-label', st.name + ' 实时 3D 预览');
    iframe.allow = 'fullscreen';
    iframe.tabIndex = -1; /* 键盘焦点走画框容器（有焦点环），iframe 本身不进 Tab 序 */
    iframe.src = sceneUrl(st.hash, st.shot);
    st.iframe = iframe;

    /* iframe 插在海报名下（渲染底层），海报在中层遮住加载期，ready 后淡出 */
    var poster = frame.querySelector('.hero-poster') || frame.querySelector('.frame-poster');
    if (poster) frame.insertBefore(iframe, poster);
    else frame.insertBefore(iframe, frame.firstChild);
    st.posterHost = frame;
  }

  /* ---------- chips（区块） ---------- */
  function buildChips(frame) {
    var st = states.get(frame);
    var holders = frame.querySelectorAll('.chips');
    holders.forEach(function (holder) {
      holder.innerHTML = '';
      st.scene.cameras.forEach(function (name, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = name;
        b.setAttribute('aria-pressed', String(i === st.shot));
        b.disabled = !st.ready;
        b.addEventListener('click', function () { setShot(frame, i); });
        holder.appendChild(b);
      });
    });
  }

  function setShot(frame, index) {
    var st = states.get(frame);
    if (!st.ready || !st.iframe) return;
    st.iframe.contentWindow.postMessage(
      { source: 'kpanel-desktop', type: 'camera', index: index }, '*');
    st.shot = index;
    if (st.isHero) syncHeroChips();
    else syncChips(frame);
  }

  function syncChips(frame) {
    var st = states.get(frame);
    frame.querySelectorAll('.chip').forEach(function (b, i) {
      b.setAttribute('aria-pressed', String(i === st.shot));
    });
  }

  /* ---------- 首屏 chips（挂在 #hero-chips，随 active 场景重建） ---------- */
  function buildHeroChips() {
    var st = activeHeroState();
    var holder = document.getElementById('hero-chips');
    if (!st || !holder) return;
    holder.innerHTML = '';
    st.scene.cameras.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = name;
      b.setAttribute('aria-pressed', String(i === st.shot));
      b.disabled = !st.ready;
      b.addEventListener('click', function () { setShot(activeHeroStage(), i); });
      holder.appendChild(b);
    });
  }

  function syncHeroChips() {
    var st = activeHeroState();
    var holder = document.getElementById('hero-chips');
    if (!st || !holder) return;
    holder.querySelectorAll('.chip').forEach(function (b, i) {
      b.setAttribute('aria-pressed', String(i === st.shot));
    });
  }

  function setChipsEnabled(frame, enabled) {
    var st = states.get(frame);
    if (!st) return;
    var holder = st.isHero ? document.getElementById('hero-chips') : frame;
    if (!holder) return;
    holder.querySelectorAll('.chip').forEach(function (b) { b.disabled = !enabled; });
  }

  /* ---------- 场景事件 ---------- */
  function handleEvent(frame, st, d) {
    var isActiveHero = st.isHero && st.heroId === activeHeroId;
    if (d.type === 'ready') {
      st.ready = true;
      if (st.posterHost) st.posterHost.classList.add('live');
      if (st.isHero) {
        if (isActiveHero) {
          setChipsEnabled(frame, true);
        } else {
          /* 非 active 的预热场景 ready 后立即停帧（visibility:hidden 下 rAF 仍会跑） */
          st.paused = true;
          sendCmd(frame, 'pause');
        }
      } else setChipsEnabled(frame, true);
    } else if (d.type === 'camera') {
      st.shot = d.index;
      if (st.isHero) { if (isActiveHero) syncHeroChips(); }
      else syncChips(frame);
    } else if (d.type === 'error') {
      st.failed = true;
      if (st.isHero) { if (isActiveHero) setChipsEnabled(frame, false); }
      else {
        setChipsEnabled(frame, false);
        var note = frame.querySelector('.frame-static');
        if (note) note.hidden = false;
      }
      /* 海报保持可见：静态兜底成立 */
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'kpanel-scene-pack') return;
    states.forEach(function (st, frame) {
      if (st.iframe && st.iframe.contentWindow === e.source) {
        handleEvent(frame, st, d);
      }
    });
  });

  /* ---------- 暂停 / 恢复 ---------- */
  function sendCmd(frame, type) {
    var st = states.get(frame);
    if (st && st.iframe && st.started) {
      st.iframe.contentWindow.postMessage({ source: 'kpanel-desktop', type: type }, '*');
    }
  }

  /* 首屏各场景的播放状态统一收敛：
     只跑「在视口内 + 是当前 active + 页面可见 + 已 ready」的那一个。
     用 visibility 而非 display 隐藏：display:none 会让 iframe 布局尺寸归零，
     场景初始化时读到 window.innerWidth=0，bloom 渲染目标尺寸为 0 导致
     GL_INVALID_FRAMEBUFFER_OPERATION；visibility:hidden 保留尺寸、只不可见，
     再靠 pause 停帧省资源，切回 resume 即恢复画面。 */
  function syncHeroPlayback() {
    HERO_IDS.forEach(function (id) {
      var conf = HERO[id];
      var st = conf.stage && states.get(conf.stage);
      if (!st) return;
      var isActive = id === activeHeroId;
      conf.stage.style.visibility = isActive ? 'visible' : 'hidden';
      if (!st.started) return;
      var shouldRun = st.inView && isActive && !document.hidden;
      if (shouldRun && st.paused) {
        st.paused = false;
        sendCmd(conf.stage, 'resume');
      } else if (!shouldRun && !st.paused) {
        st.paused = true;
        sendCmd(conf.stage, 'pause');
      }
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      states.forEach(function (st, frame) {
        if (st.started && !st.paused) {
          st.paused = true;
          sendCmd(frame, 'pause');
        }
      });
    } else {
      states.forEach(function (st, frame) {
        if (st.isHero) return; /* 首屏统一走 syncHeroPlayback */
        if (!st.started && st.inView && !reduced) {
          startScene(frame);
        } else if (st.started && st.paused && st.inView) {
          st.paused = false;
          sendCmd(frame, 'resume');
        }
      });
      syncHeroPlayback();
    }
  });

  /* ---------- 注册：首屏三舞台 ---------- */
  function registerHeroStages() {
    var media = document.getElementById('hero-media');
    var overlay = media.querySelector('.hero-overlay');
    HERO_IDS.forEach(function (id) {
      var conf = HERO[id];
      var stage = media.querySelector('.hero-stage[data-hero="' + id + '"]');
      if (!stage) {
        stage = document.createElement('div');
        stage.className = 'hero-stage';
        stage.setAttribute('data-hero', id);
        var poster = document.createElement('img');
        poster.className = 'hero-poster';
        poster.src = 'objects/' + conf.hash + '/poster.webp';
        poster.alt = SCENES[conf.hash].name + '静态海报';
        stage.appendChild(poster);
        media.insertBefore(stage, overlay);
      }
      conf.stage = stage;
      states.set(stage, {
        hash: conf.hash,
        scene: SCENES[conf.hash],
        name: SCENES[conf.hash].name,
        isHero: true,
        heroId: id,
        shot: 0,
        started: false, ready: false, failed: false, paused: false, inView: true
      });
    });
    syncHeroPlayback(); /* 非 active 舞台隐藏 */
    buildHeroChips();
  }

  /* 切换首屏预览的场景 */
  function switchHeroScene(id) {
    if (!HERO[id]) return;
    if (id !== activeHeroId) {
      activeHeroId = id;
      var st = states.get(HERO[id].stage);
      if (!st.started) {
        if (reduced) revealLoadButton(HERO[id].stage);
        else if (!document.hidden) startScene(HERO[id].stage);
      }
      syncHeroPlayback();
      buildHeroChips();
      updateNavActive();
    }
    scrollToTop();
  }

  function updateNavActive() {
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var id = (a.getAttribute('href') || '').replace('#scene-', '');
      a.classList.toggle('active', id === activeHeroId);
    });
  }

  function scrollToTop() {
    if (window.scrollY <= 0) return;
    if (lenis) lenis.scrollTo(0, { duration: 1.1 });
    else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  /* ---------- 注册：三个场景区块 ---------- */
  function registerFrames() {
    document.querySelectorAll('.frame[data-hash]').forEach(function (frame) {
      var hash = frame.getAttribute('data-hash');
      var st = {
        hash: hash,
        scene: SCENES[hash],
        name: SCENES[hash] ? SCENES[hash].name : '',
        isHero: false,
        shot: parseInt(frame.getAttribute('data-shot') || '0', 10) || 0,
        started: false, ready: false, failed: false, paused: false, inView: false
      };
      states.set(frame, st);
      buildChips(frame);

      /* 全屏按钮 */
      var fsBtn = frame.querySelector('.frame-fs');
      if (fsBtn) {
        fsBtn.addEventListener('click', function () {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else if (frame.requestFullscreen) {
            frame.requestFullscreen();
          } else if (frame.webkitRequestFullscreen) {
            frame.webkitRequestFullscreen();
          }
        });
      }
      /* 画框上回车 = 全屏 */
      frame.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target === frame) {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (frame.requestFullscreen) frame.requestFullscreen();
        }
      });
    });
  }

  /* ---------- 观察视口：懒启动 + 离屏暂停 ---------- */
  function setupObserver() {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.target.id === 'hero-media') {
          /* 首屏：视口状态分发给所有首屏场景，再统一收敛播放；
             active 且未启动的场景在此懒启动 */
          HERO_IDS.forEach(function (id) {
            var s = HERO[id].stage && states.get(HERO[id].stage);
            if (s) s.inView = en.isIntersecting;
          });
          var act = activeHeroState();
          if (act && !act.started) {
            if (reduced) revealLoadButton(activeHeroStage());
            else if (!document.hidden) startScene(activeHeroStage());
          }
          syncHeroPlayback();
          return;
        }
        var st = states.get(en.target);
        if (!st) return;
        st.inView = en.isIntersecting;

        if (en.isIntersecting) {
          if (!st.started) {
            if (reduced) {
              revealLoadButton(en.target);
            } else if (!document.hidden) {
              startScene(en.target);
            }
          } else if (st.paused) {
            st.paused = false;
            sendCmd(en.target, 'resume');
          }
        } else if (st.started && !st.paused) {
          st.paused = true;
          sendCmd(en.target, 'pause');
        }
      });
    }, { rootMargin: '420px 0px' });

    io.observe(document.getElementById('hero-media'));
    document.querySelectorAll('.frame[data-hash]').forEach(function (f) { io.observe(f); });
  }

  function revealLoadButton(frame) {
    var st = states.get(frame);
    var btn = st && st.isHero
      ? document.getElementById('hero-load')
      : frame.querySelector('.frame-load');
    if (btn) {
      btn.hidden = false;
      if (!btn._wired) {
        btn._wired = true;
        btn.addEventListener('click', function () {
          btn.hidden = true;
          var s = states.get(frame);
          if (s && s.isHero) startScene(activeHeroStage());
          else startScene(frame);
        });
      }
    }
  }

  /* ---------- 导航：三链接 = 首屏场景切换器 ---------- */
  function setupNav() {
    var nav = document.getElementById('nav');
    var onScroll = function () {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        switchHeroScene((a.getAttribute('href') || '').replace('#scene-', ''));
      });
    });
    updateNavActive();
  }

  /* ---------- 动效：Lenis + GSAP ---------- */
  function setupMotion() {
    if (reduced || typeof gsap === 'undefined') return;

    gsap.registerPlugin(ScrollTrigger);

    if (typeof Lenis !== 'undefined') {
      lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
      /* 区块锚点走 Lenis 平滑滚动；导航链接已被首屏切换接管，排除 */
      document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        if (a.closest('.nav-links')) return;
        a.addEventListener('click', function (e) {
          var id = a.getAttribute('href');
          var target = id.length > 1 && document.querySelector(id);
          if (target) {
            e.preventDefault();
            lenis.scrollTo(target, { offset: -64 });
          }
        });
      });
    }

    /* 首屏景深（滑动驱动）：媒体推近、文案反向退出，往回滚倒放 */
    gsap.timeline({
      scrollTrigger: {
        trigger: '.hero-wrap',
        start: 'top top',
        end: 'bottom bottom',
        scrub: true
      }
    })
      .to('.hero-media', { scale: 1.16, ease: 'none' }, 0)
      .to('.hero-copy', { yPercent: -26, scale: 1.24, opacity: 0, ease: 'none' }, 0)
      .to('.hero-hint', { opacity: 0, ease: 'none' }, 0);

    /* 首屏文案入场（一次性） */
    gsap.from('.hero-title .line > span', {
      yPercent: 112, duration: 1.0, ease: 'power4.out', delay: 0.2
    });
    gsap.from(['.hero-eyebrow', '.hero-sub', '.hero-actions', '.hero-hint'], {
      y: 18, opacity: 0, duration: 0.8, stagger: 0.09, delay: 0.4, clearProps: 'all'
    });

    /* 场景区块出场（滑动触发，once）：
       01/03 遮罩从左揭开，02 从下方升起（幕布）——同种手法全页 ≤ 2 处 */
    document.querySelectorAll('.scene').forEach(function (sec) {
      var frame = sec.querySelector('.frame');
      var rise = sec.classList.contains('reveal-media-rise');
      var fromClip = rise ? 'inset(100% 0% 0% 0%)' : 'inset(0% 100% 0% 0%)';

      gsap.set(frame, { clipPath: fromClip, scale: 1.06 });
      gsap.timeline({
        scrollTrigger: { trigger: frame, start: 'top 78%', once: true }
      })
        .to(frame, {
          clipPath: 'inset(0% 0% 0% 0%)',
          scale: 1,
          duration: 1.05,
          ease: 'power3.out'
        });

      var meta = sec.querySelector('.scene-meta');
      if (meta) {
        var kids = meta.children;
        gsap.set(kids, { y: 26, opacity: 0 });
        gsap.to(kids, {
          y: 0, opacity: 1,
          duration: 0.7, stagger: 0.06, ease: 'power2.out',
          scrollTrigger: { trigger: frame, start: 'top 72%', once: true },
          delay: 0.25
        });
      }
    });
  }

  /* ---------- 空闲预热：非 active 的首屏场景提前加载资源 ----------
     display:none 下 rAF 停帧不渲染，但 fetch/编译照常进行；
     用户点导航切过去时资源已就绪，出画面接近即时 */
  function setupHeroWarmup() {
    if (reduced) return;
    var rest = HERO_IDS.filter(function (id) { return id !== activeHeroId; });
    rest.forEach(function (id, i) {
      setTimeout(function () {
        if (document.hidden) return;
        var st = states.get(HERO[id].stage);
        if (st && !st.started) startScene(HERO[id].stage);
      }, 3500 + i * 1600);
    });
  }

  /* ---------- 启动 ---------- */
  registerHeroStages();
  registerFrames();
  setupNav();
  setupObserver();
  setupMotion();
  setupHeroWarmup();
})();
