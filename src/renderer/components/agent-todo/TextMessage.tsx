import ReactMarkdown from 'react-markdown';

interface TextMessageProps {
  content: { text: string };
}

export function TextMessage({ content }: TextMessageProps) {
  return (
    <div className="prose prose-sm max-w-none text-notion-text">
      <ReactMarkdown>{content.text}</ReactMarkdown>
    </div>
  );
}
