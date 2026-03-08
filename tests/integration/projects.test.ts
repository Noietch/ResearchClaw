import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { ProjectsService } from '../../src/main/services/projects.service';

describe('projects service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates and lists projects', async () => {
    const service = new ProjectsService();

    const project = await service.createProject({
      name: 'Test Project',
      description: 'A test project',
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');
    expect(project.description).toBe('A test project');

    const all = await service.listProjects();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('Test Project');
  });

  it('updates project', async () => {
    const service = new ProjectsService();

    const project = await service.createProject({ name: 'Original' });
    const updated = await service.updateProject(project.id, {
      name: 'Updated',
      description: 'New desc',
    });

    expect(updated?.name).toBe('Updated');
    expect(updated?.description).toBe('New desc');
  });

  it('deletes project', async () => {
    const service = new ProjectsService();

    const project = await service.createProject({ name: 'To Delete' });
    await service.deleteProject(project.id);

    const all = await service.listProjects();
    expect(all.length).toBe(0);
  });

  it('manages repos', async () => {
    const service = new ProjectsService();

    const project = await service.createProject({ name: 'Repo Project' });
    const repo = await service.addRepo({
      projectId: project.id,
      repoUrl: 'https://github.com/test/repo.git',
    });

    expect(repo.repoUrl).toBe('https://github.com/test/repo.git');

    const fetched = (await service.listProjects()).find((p) => p.id === project.id);
    expect(fetched?.repos.length).toBe(1);

    await service.deleteRepo(repo.id);
    const cleared = (await service.listProjects()).find((p) => p.id === project.id);
    expect(cleared?.repos.length).toBe(0);
  });

  it('manages ideas', async () => {
    const service = new ProjectsService();

    const project = await service.createProject({ name: 'Idea Project' });
    const idea = await service.createIdea({
      projectId: project.id,
      title: 'Test Idea',
      content: 'Idea content',
      paperIds: [],
    });

    expect(idea.title).toBe('Test Idea');

    const fetched = (await service.listProjects()).find((p) => p.id === project.id);
    expect(fetched?.ideas.length).toBe(1);

    await service.deleteIdea(idea.id);
    const cleared = (await service.listProjects()).find((p) => p.id === project.id);
    expect(cleared?.ideas.length).toBe(0);
  });
});
