import { useTranslation } from '@tio/i18n';
import { useTheme } from '@tio/ui';
import { useEffect, useState } from 'react';

export default function MermaidPreview({ source }: { source: string }) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const [result, setResult] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let active = true;
    setResult({});
    if (!source.trim()) return;
    const timer = setTimeout(() => {
      void import('./mermaid-renderer')
        .then((m) => m.renderDiagram(source, theme))
        .then(
          (svg) => {
            if (active) setResult({ svg });
          },
          (error) => {
            if (active)
              setResult({ error: error instanceof Error ? error.message : String(error) });
          },
        );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [source, theme]);
  if (!source.trim())
    return (
      <div className="tio-code-notice">
        {zh ? '输入 Mermaid 源码以预览图表' : 'Enter Mermaid source to preview a diagram'}
      </div>
    );
  if (result.error)
    return (
      <div role="alert" className="tio-code-notice">
        {zh ? '图表渲染失败，请检查源码。' : 'Unable to render diagram. Check the source.'}
        <pre>{result.error}</pre>
      </div>
    );
  if (!result.svg)
    return (
      <output className="tio-code-notice">{zh ? '正在渲染图表…' : 'Rendering diagram…'}</output>
    );
  return <div className="tio-mermaid-preview" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}
