/**
 * SleepMedic App-Interest Smokescreen
 *
 * Drop-in script. Any element with [data-app-interest] becomes a Download App CTA.
 * Click flow:
 *   1. GA4 event: app_interest_click { location }
 *   2. POST to Pi /app-interest (records click + Discord ping)
 *   3. Modal opens: "Coming soon" + optional email field
 *   4. Email submit -> GA4 app_interest_email + Pi /app-interest (with email) + Discord ping
 *
 * Pi endpoint is configurable via window.SM_PI_ENDPOINT or the data-pi attr on the script tag.
 */
(function () {
  const script = document.currentScript;
  const PI_ENDPOINT =
    window.SM_PI_ENDPOINT ||
    (script && script.dataset.pi) ||
    'https://pi.sleepmedic.co/app-interest';

  function track(eventName, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  }

  function postPi(payload) {
    try {
      return fetch(PI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (_) {
      return Promise.resolve();
    }
  }

  function injectStyles() {
    if (document.getElementById('sm-ai-styles')) return;
    const css = `
      .sm-ai-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity .18s;padding:24px;}
      .sm-ai-backdrop.open{opacity:1}
      .sm-ai-modal{background:#141416;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:420px;width:100%;padding:32px 28px;color:#f5f5f5;font-family:Inter,-apple-system,sans-serif;transform:translateY(8px);transition:transform .18s;}
      .sm-ai-backdrop.open .sm-ai-modal{transform:translateY(0)}
      .sm-ai-modal h3{font-size:1.25rem;font-weight:700;margin:0 0 8px;letter-spacing:-.02em}
      .sm-ai-modal p{color:#b0b0b8;font-size:.92rem;line-height:1.55;margin:0 0 20px}
      .sm-ai-modal form{display:flex;gap:8px;margin-bottom:8px}
      .sm-ai-modal input{flex:1;padding:11px 14px;background:#0a0a0c;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f5f5f5;font-size:.9rem;font-family:inherit;outline:none}
      .sm-ai-modal input:focus{border-color:#a78bfa}
      .sm-ai-modal button.sm-ai-submit{padding:11px 18px;background:#a78bfa;color:#0a0a0c;border:none;border-radius:8px;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit}
      .sm-ai-modal button.sm-ai-submit:hover{opacity:.85}
      .sm-ai-modal .sm-ai-skip{background:none;border:none;color:#6b6b76;font-size:.8rem;cursor:pointer;padding:6px 0;font-family:inherit}
      .sm-ai-modal .sm-ai-skip:hover{color:#b0b0b8}
      .sm-ai-modal .sm-ai-done{color:#34d399;font-size:.9rem;margin-top:8px}
      .sm-ai-close{position:absolute;top:14px;right:16px;background:none;border:none;color:#6b6b76;font-size:1.3rem;cursor:pointer;line-height:1}
      .sm-ai-modal-wrap{position:relative}
      @media(max-width:480px){.sm-ai-modal form{flex-direction:column}}
    `;
    const s = document.createElement('style');
    s.id = 'sm-ai-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function openModal(location) {
    injectStyles();

    const backdrop = document.createElement('div');
    backdrop.className = 'sm-ai-backdrop';
    backdrop.innerHTML = `
      <div class="sm-ai-modal-wrap">
        <div class="sm-ai-modal" role="dialog" aria-label="SleepMedic app notification signup">
          <button class="sm-ai-close" aria-label="Close">&times;</button>
          <h3>iOS app launching 2026</h3>
          <p>Thanks for the interest. Drop your email and we'll let you know the moment it hits the App Store. No spam.</p>
          <form>
            <input type="email" name="email" placeholder="you@email.com" required autocomplete="email" />
            <button type="submit" class="sm-ai-submit">Notify me</button>
          </form>
          <button type="button" class="sm-ai-skip">No thanks, just browsing</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const close = () => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
    };

    backdrop.querySelector('.sm-ai-close').onclick = close;
    backdrop.querySelector('.sm-ai-skip').onclick = close;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    const form = backdrop.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      if (!email) return;

      track('app_interest_email', { location, email_domain: email.split('@')[1] || '' });
      postPi({ type: 'email', email, location, path: window.location.pathname, referrer: document.referrer || '' });

      const modal = backdrop.querySelector('.sm-ai-modal');
      modal.innerHTML = `
        <h3>You're on the list</h3>
        <p>We'll email you when the app goes live. Meanwhile, the blog is where the real content is.</p>
        <p class="sm-ai-done">&check; ${email}</p>
      `;
      setTimeout(close, 2400);
    });
  }

  function handleClick(el, e) {
    e.preventDefault();
    const location = el.dataset.appInterest || el.getAttribute('data-location') || 'unknown';

    track('app_interest_click', { location, path: window.location.pathname });
    postPi({ type: 'click', location, path: window.location.pathname, referrer: document.referrer || '' });

    openModal(location);
  }

  function bind() {
    document.querySelectorAll('[data-app-interest]').forEach((el) => {
      if (el.__smBound) return;
      el.__smBound = true;
      el.addEventListener('click', (e) => handleClick(el, e));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SMAppInterest = { bind, open: openModal };
})();
