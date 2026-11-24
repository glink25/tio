import { useT } from '@tio/i18n';
import { useEffect, useState } from 'react';

export default function HtmlPreview({ source }: { source: string }) {
  const t = useT();
  const [document, setDocument] = useState('');
  useEffect(() => {
    if (!source.trim()) {
      setDocument('');
      return;
    }
    const timer = setTimeout(() => setDocument(source), 300);
    return () => clearTimeout(timer);
  }, [source]);
  if (!source.trim()) return <div className="tio-code-notice">{t('codeBlock.htmlEmpty')}</div>;
  return (
    <iframe
      className="tio-html-preview"
      title={t('codeBlock.htmlTitle')}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={document}
    />
  );
}
