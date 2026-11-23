import { t, useTranslation } from '@tio/i18n';
import { useEffect, useState } from 'react';

import { Brand } from './brand';
import { GitHubIcon } from './github-icon';
import { WelcomeSettings } from './welcome-settings';

function TypedLine() {
  const { i18n } = useTranslation();
  const [text, setText] = useState(() => t('welcome.phraseOne'));
  useEffect(() => {
    const phrases = [
      t('welcome.phraseOne'),
      t('welcome.phraseTwo'),
      t('welcome.phraseThree'),
      t('welcome.phraseFour'),
    ];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;
    let length = Array.from(phrases[0]).length;
    let deleting = true;
    function type() {
      if (reduced.matches || document.hidden) return;
      const chars = Array.from(phrases[index]);
      length += deleting ? -1 : 1;
      setText(chars.slice(0, length).join(''));
      let delay = deleting ? 37 : 85;
      if (deleting && length === 0) {
        index = (index + 1) % phrases.length;
        deleting = false;
        delay = 400;
      } else if (!deleting && length === chars.length) {
        deleting = true;
        delay = 2500;
      }
      timer = setTimeout(type, delay);
    }
    function reset() {
      clearTimeout(timer);
      index = 0;
      length = Array.from(phrases[0]).length;
      deleting = true;
      setText(phrases[0]);
      if (!reduced.matches && !document.hidden) timer = setTimeout(type, 2700);
    }
    reduced.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    reset();
    return () => {
      clearTimeout(timer);
      reduced.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [i18n.language]);
  return (
    <div className="login-typed">
      <span className="sr-only">{t('welcome.typingSummary')}</span>
      <span aria-hidden="true">
        {text}
        <span className="login-caret" />
      </span>
    </div>
  );
}

export function LoginHero() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return (
    <section
      className={`login-brand ${hidden ? 'login-brand--paused' : ''}`}
      aria-label={t('welcome.brandIntro')}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="login-wordmark">Tio</span>
          <a
            className="login-repository inline-flex size-9 items-center justify-center rounded-md [&>svg]:size-5"
            href="https://github.com/glink25/tio"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('welcome.repository')}
            title={t('welcome.repository')}
          >
            <GitHubIcon />
          </a>
        </div>
        <WelcomeSettings />
      </header>
      <div className="login-brand-main">
        <Brand hero />
        <h1>
          {t('welcome.headlineFirst')}
          <br />
          {t('welcome.headlineSecond')}
        </h1>
        <TypedLine />
      </div>
    </section>
  );
}
