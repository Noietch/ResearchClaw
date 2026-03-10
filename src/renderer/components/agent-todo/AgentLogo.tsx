import { Bot } from 'lucide-react';
import type { AgentToolKind } from '@shared';

function ClaudeLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Claude</title>
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="#D97757"
        fillRule="nonzero"
      />
    </svg>
  );
}

function CodeXLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Code X</title>
      <circle cx="80" cy="79" r="65" fill="white" />
      <path
        d="M135 80C135 49.6243 110.376 25 80 25C49.6243 25 25 49.6243 25 80C25 110.376 49.6243 135 80 135V149C41.8924 149 11 118.108 11 80C11 41.8924 41.8924 11 80 11C118.108 11 149 41.8924 149 80C149 118.108 118.108 149 80 149V135C110.376 135 135 110.376 135 80Z"
        fill="black"
      />
      <path
        d="M50.9235 54.3903C54.0216 52.577 58.0026 53.6185 59.8161 56.7165L70.9294 75.7009C72.6642 78.6649 72.6642 82.3345 70.9294 85.2985L59.8161 104.283C58.0026 107.381 54.0216 108.422 50.9235 106.609C47.8255 104.796 46.784 100.815 48.5973 97.7165L58.6745 80.4997L48.5973 63.2829C46.784 60.1848 47.8255 56.2038 50.9235 54.3903Z"
        fill="black"
      />
      <path
        d="M112 89.5C115.59 89.5 118.5 92.4101 118.5 96C118.5 99.5899 115.59 102.5 112 102.5H85C81.4101 102.5 78.5 99.5899 78.5 96C78.5 92.4101 81.4101 89.5 85 89.5H112Z"
        fill="black"
      />
    </svg>
  );
}

function GeminiLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Gemini</title>
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill="#3186FF"
      />
    </svg>
  );
}

function OpenClawLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>OpenCLAW</title>
      <defs>
        <linearGradient id="openclaw-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4d4d" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
      </defs>
      <path
        d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
        fill="url(#openclaw-gradient)"
      />
      <path
        d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
        fill="url(#openclaw-gradient)"
      />
      <path
        d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
        fill="url(#openclaw-gradient)"
      />
      <path
        d="M45 15 Q35 5 30 8"
        stroke="#ff4d4d"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M75 15 Q85 5 90 8"
        stroke="#ff4d4d"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="45" cy="35" r="6" fill="#050810" />
      <circle cx="75" cy="35" r="6" fill="#050810" />
      <circle cx="46" cy="34" r="2.5" fill="#00e5cc" />
      <circle cx="76" cy="34" r="2.5" fill="#00e5cc" />
    </svg>
  );
}

function QwenLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Qwen</title>
      <circle cx="12" cy="12" r="11" fill="#6B4FBB" />
      <path
        d="M7 9.5C7 8.12 8.12 7 9.5 7h5C15.88 7 17 8.12 17 9.5v3.25a4.75 4.75 0 01-4.75 4.75H12l-1.5 1.5v-1.5H9.5A2.5 2.5 0 017 15V9.5z"
        fill="white"
      />
      <circle cx="10" cy="11" r="1" fill="#6B4FBB" />
      <circle cx="14" cy="11" r="1" fill="#6B4FBB" />
    </svg>
  );
}

function GooseLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Goose</title>
      <circle cx="12" cy="12" r="11" fill="#1A1A2E" />
      <ellipse cx="12" cy="13" rx="5" ry="5.5" fill="#E8E8F0" />
      <ellipse cx="12" cy="7.5" rx="3" ry="3.5" fill="#E8E8F0" />
      <circle cx="11" cy="6.5" r="0.8" fill="#1A1A2E" />
      <path d="M12 11V8" stroke="#E8E8F0" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M9.5 16.5C9.5 17.5 10.5 18.5 12 18.5s2.5-1 2.5-2"
        stroke="#F5A623"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M10.5 7.5L9 6.5" stroke="#F5A623" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function OpenCodeLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>OpenCode</title>
      <path d="M180 240H60V120H180V240Z" fill="#CFCECD" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
        fill="#211E1E"
      />
    </svg>
  );
}

export function AgentLogo({
  tool,
  size = 20,
}: {
  tool: AgentToolKind | undefined | null;
  size?: number;
}) {
  switch (tool) {
    case 'claude-code':
      return <ClaudeLogo size={size} />;
    case 'codex':
      return <CodeXLogo size={size} />;
    case 'gemini':
      return <GeminiLogo size={size} />;
    case 'openclaw':
      return <OpenClawLogo size={size} />;
    case 'opencode':
      return <OpenCodeLogo size={size} />;
    case 'qwen':
      return <QwenLogo size={size} />;
    case 'goose':
      return <GooseLogo size={size} />;
    default:
      return <Bot size={size} className="text-notion-text-tertiary" />;
  }
}
