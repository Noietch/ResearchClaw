import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface TextMessageProps {
  content: { text: string };
  streaming?: boolean;
}

export function TextMessage({ content, streaming }: TextMessageProps) {
  if (streaming) {
    return (
      <div className="text-sm text-notion-text leading-[1.7] whitespace-pre-wrap font-sans">
        {content.text}
        <span className="inline-block w-[2px] h-[1em] bg-notion-accent ml-0.5 align-text-bottom animate-pulse" />
      </div>
    );
  }

  return (
    <div className="agent-message text-sm text-notion-text leading-[1.7]">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.6]">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-notion-accent hover:underline"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-notion-border pl-3 my-2 text-notion-text-secondary italic">
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match;

            if (isInline) {
              return (
                <code
                  className="bg-notion-sidebar px-1.5 py-0.5 rounded text-[13px] font-mono text-notion-purple"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="my-3 rounded-lg overflow-hidden border border-notion-border">
                <div className="bg-notion-sidebar px-3 py-1.5 text-xs text-notion-text-tertiary border-b border-notion-border">
                  {match[1]}
                </div>
                <SyntaxHighlighter
                  language={match[1]}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
            );
          },
          pre: ({ children }) => <>{children}</>,
          hr: () => <hr className="my-4 border-notion-border" />,
        }}
      >
        {content.text}
      </ReactMarkdown>
    </div>
  );
}
