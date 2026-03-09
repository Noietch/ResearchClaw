import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  papers: [] as any[],
  profile: {
    name: '',
    title: '',
    organization: '',
    bio: '',
    researchInterests: '',
    goals: '',
    aiSummary: null as string | null,
    aiSummaryUpdatedAt: null as string | null,
  },
}));

const mocks = vi.hoisted(() => ({
  listPapers: vi.fn(async () => mockState.papers),
  getUserProfile: vi.fn(() => mockState.profile),
  setUserProfile: vi.fn((profile: any) => {
    mockState.profile = profile;
  }),
  generateWithActiveProvider: vi.fn(async () => 'Research summary generated from the library.'),
}));

vi.mock('@db', () => ({
  PapersRepository: class {
    list = mocks.listPapers;
  },
}));

vi.mock('../../src/main/store/app-settings-store', () => ({
  getUserProfile: mocks.getUserProfile,
  setUserProfile: mocks.setUserProfile,
}));

vi.mock('../../src/main/services/ai-provider.service', () => ({
  generateWithActiveProvider: mocks.generateWithActiveProvider,
}));

import { UserProfileService } from '../../src/main/services/user-profile.service';

describe('UserProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.profile = {
      name: 'Lin',
      title: 'PhD Student',
      organization: 'Open Lab',
      bio: 'Works on retrieval and agents.',
      researchInterests: 'retrieval, agents',
      goals: 'find thesis direction',
      aiSummary: null,
      aiSummaryUpdatedAt: null,
    };
    mockState.papers = [
      {
        id: 'paper-1',
        title: 'Retrieval-Augmented Agents',
        authors: ['Author A', 'Author B'],
        tagNames: ['retrieval', 'agents'],
        submittedAt: '2024-05-10T00:00:00.000Z',
        createdAt: '2026-03-01T00:00:00.000Z',
        lastReadAt: '2026-03-05T00:00:00.000Z',
      },
      {
        id: 'paper-2',
        title: 'Neural Ranking for Scientific Search',
        authors: ['Author A'],
        tagNames: ['retrieval', 'ranking'],
        submittedAt: '2023-04-02T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
        lastReadAt: null,
      },
    ];
  });

  it('returns editable profile plus a library snapshot', async () => {
    const service = new UserProfileService();
    const result = await service.getProfile();

    expect(result.profile.name).toBe('Lin');
    expect(result.librarySnapshot.totalPapers).toBe(2);
    expect(result.librarySnapshot.topTags[0]).toEqual({ name: 'retrieval', count: 2 });
    expect(result.librarySnapshot.topAuthors[0]).toEqual({ name: 'Author A', count: 2 });
  });

  it('persists manual profile edits', async () => {
    const service = new UserProfileService();
    const result = await service.updateProfile({ title: 'Research Engineer', goals: 'ship tools' });

    expect(mocks.setUserProfile).toHaveBeenCalled();
    expect(result.profile.title).toBe('Research Engineer');
    expect(result.profile.goals).toBe('ship tools');
  });

  it('generates and stores an AI summary from library context', async () => {
    const service = new UserProfileService();
    const result = await service.generateSummary();

    expect(mocks.generateWithActiveProvider).toHaveBeenCalled();
    expect(result.profile.aiSummary).toContain('Research summary generated');
    expect(result.profile.aiSummaryUpdatedAt).toBeTruthy();
  });

  it('rejects summary generation when the library is empty', async () => {
    mockState.papers = [];
    const service = new UserProfileService();

    await expect(service.generateSummary()).rejects.toThrow(
      'Add papers to your Library before generating a profile summary.',
    );
  });
});
