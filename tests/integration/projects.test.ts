import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { ProjectsService } from '../../src/main/services/projects.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

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

  it('adds and lists project papers', async () => {
    const service = new ProjectsService();
    const papersRepo = new PapersRepository();

    const project = await service.createProject({ name: 'Related Works Project' });
    const paper = await papersRepo.create({
      shortId: 'test-paper-001',
      title: 'Test Paper for Related Works',
      authors: ['Alice', 'Bob'],
      source: 'manual',
      abstract: 'A test abstract.',
      tags: [],
    });

    await service.addPaperToProject(project.id, paper.id);
    const papers = await service.listProjectPapers(project.id);

    expect(papers.length).toBe(1);
    expect(papers[0].id).toBe(paper.id);
    expect(papers[0].title).toBe('Test Paper for Related Works');
    expect(papers[0].projectPaperId).toBeDefined();
    expect(papers[0].addedAt).toBeDefined();
  });

  it('removes paper from project', async () => {
    const service = new ProjectsService();
    const papersRepo = new PapersRepository();

    const project = await service.createProject({ name: 'Remove Test Project' });
    const paper = await papersRepo.create({
      shortId: 'test-paper-002',
      title: 'Paper to Remove',
      authors: ['Charlie'],
      source: 'manual',
      tags: [],
    });

    await service.addPaperToProject(project.id, paper.id);
    let papers = await service.listProjectPapers(project.id);
    expect(papers.length).toBe(1);

    await service.removePaperFromProject(project.id, paper.id);
    papers = await service.listProjectPapers(project.id);
    expect(papers.length).toBe(0);
  });

  it('upserts paper-project relation (no duplicate error on double-add)', async () => {
    const service = new ProjectsService();
    const papersRepo = new PapersRepository();

    const project = await service.createProject({ name: 'Upsert Test Project' });
    const paper = await papersRepo.create({
      shortId: 'test-paper-003',
      title: 'Upsert Paper',
      authors: ['Dave'],
      source: 'manual',
      tags: [],
    });

    // Add twice — should not throw
    await service.addPaperToProject(project.id, paper.id);
    await service.addPaperToProject(project.id, paper.id);

    const papers = await service.listProjectPapers(project.id);
    expect(papers.length).toBe(1);
  });
});
