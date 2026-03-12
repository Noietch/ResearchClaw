import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpChatService } from '../../src/main/services/acp-chat.service';
import { ProjectsService } from '../../src/main/services/projects.service';
import { resetTestDatabase } from '../support/test-db';

describe('ACP Chat Service', () => {
  let service: AcpChatService;
  let projectsService: ProjectsService;
  let projectId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    service = new AcpChatService();
    projectsService = new ProjectsService();

    // Create a test project
    const project = await projectsService.createProject({
      name: 'Test Project',
      description: 'Test project for ACP chat',
    });
    projectId = project.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session Management', () => {
    it('creates a chat session with lightweight backend', async () => {
      const session = await service.createSession({
        projectId,
        title: 'Test Chat',
        paperIds: [],
        repoIds: [],
        backend: null, // lightweight mode
      });

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      expect(session.projectId).toBe(projectId);
      expect(session.title).toBe('Test Chat');
      expect(session.backend).toBeNull();
    });

    it('creates a chat session with ACP backend', async () => {
      const session = await service.createSession({
        projectId,
        title: 'Agent Chat',
        paperIds: [],
        repoIds: [],
        backend: 'claude-code',
      });

      expect(session).toBeDefined();
      expect(session.backend).toBe('claude-code');
    });

    it('lists sessions by project', async () => {
      await service.createSession({
        projectId,
        title: 'Chat 1',
        paperIds: [],
      });
      await service.createSession({
        projectId,
        title: 'Chat 2',
        paperIds: [],
      });

      const sessions = await service.listSessionsByProject(projectId);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.title)).toEqual(['Chat 1', 'Chat 2']);
    });

    it('gets a session by ID', async () => {
      const created = await service.createSession({
        projectId,
        title: 'Test Session',
        paperIds: ['paper-1', 'paper-2'],
      });

      const retrieved = await service.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Session');
      expect(retrieved?.paperIds).toEqual(['paper-1', 'paper-2']);
    });

    it('updates session title', async () => {
      const session = await service.createSession({
        projectId,
        title: 'Original Title',
        paperIds: [],
      });

      await service.updateSessionTitle(session.id, 'Updated Title');

      const updated = await service.getSession(session.id);
      expect(updated?.title).toBe('Updated Title');
    });

    it('deletes a session', async () => {
      const session = await service.createSession({
        projectId,
        title: 'To Delete',
        paperIds: [],
      });

      await service.deleteSession(session.id);

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Message Management', () => {
    it('adds messages to a session', async () => {
      const session = await service.createSession({
        projectId,
        title: 'Test Chat',
        paperIds: [],
      });

      await service.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });

      await service.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Hi there!',
      });

      const messages = await service.getMessagesBySession(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Hi there!');
    });
  });

  describe('Backend CLI Mapping', () => {
    it('maps backend names to CLI commands', () => {
      // Access private method via type assertion
      const getCommand = (service as any).getCliCommandForBackend.bind(service);

      expect(getCommand('claude-code')).toBe('npx @zed-industries/claude-agent-acp@latest');
      expect(getCommand('codex')).toBe('npx @zed-industries/codex-acp@latest');
      expect(getCommand('gemini')).toBe('gemini --experimental-acp');
      expect(getCommand('opencode')).toBe('opencode acp');
      expect(getCommand('unknown')).toBe('npx @zed-industries/claude-agent-acp@latest'); // fallback
    });
  });
});
