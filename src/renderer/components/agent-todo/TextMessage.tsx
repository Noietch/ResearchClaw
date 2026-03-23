import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

interface TextMessageProps {
  content: { text: string };
  streaming?: boolean;
}

const markdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }: any) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }: any) => <ul className="my-2 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }: any) => <li className="leading-[1.6]">{children}</li>,
  a: ({ href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-notion-border pl-3 my-2 text-notion-text-secondary italic">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-sm w-full">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border border-notion-border px-3 py-1.5 bg-notion-sidebar font-medium text-left">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border border-notion-border px-3 py-1.5">{children}</td>
  ),
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match && !String(children).includes('\n');

    if (isInline) {
      return (
        <code
          className="bg-notion-sidebar px-1.5 py-0.5 rounded text-[13px] font-mono text-blue-600"
          {...props}
        >
          {children}
        </code>
      );
    }

    const lang = match?.[1] ?? 'text';
    return (
      <div className="my-3 rounded-lg overflow-hidden border border-notion-border">
        <div className="bg-notion-sidebar px-3 py-1.5 text-xs text-notion-text-tertiary border-b border-notion-border">
          {lang}
        </div>
        <SyntaxHighlighter
          language={lang}
          style={oneDark}
          customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', lineHeight: '1.5' }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  },
  pre: ({ children }: any) => <>{children}</>,
  hr: () => <hr className="my-4 border-notion-border" />,
};

const remarkPlugins = [remarkGfm, remarkBreaks];

export function TextMessage({ content, streaming }: TextMessageProps) {
  return (
    <div className="agent-message text-sm text-notion-text leading-[1.7]">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {content.text}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-[2px] h-[1em] bg-blue-500 ml-0.5 align-text-bottom animate-pulse" />
      )}
    </div>
  );
}
