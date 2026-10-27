import { useTranslation } from '@tio/i18n';
import { useEffect, useState } from 'react';

export default function HtmlPreview({ source }: { source: string }) {
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const [document, setDocument] = useState('');
  useEffect(() => {
    if (!source.trim()) {
      setDocument('');
      return;
    }
    const timer = setTimeout(() => setDocument(source), 300);
    return () => clearTimeout(timer);
  }, [source]);
  if (!source.trim())
    return (
      <div className="tio-code-notice">
        {zh ? '输入 HTML 源码以预览网页' : 'Enter HTML source to preview a web page'}
      </div>
    );
  return (
    <iframe
      className="tio-html-preview"
      title={zh ? 'HTML 预览' : 'HTML preview'}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={document}
    />
  );
}
